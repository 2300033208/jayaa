"""Clock, gravimeter and joint clock + gravimeter surveys of the same stations.

Bondarescu et al. (2012, GJI 191, 78) proposed surveying with clocks and relative gravimeters together:
the two observables fall off differently with depth (potential ΔΦ ∝ 1/r, gravity Δg ∝ z/r³), so their
combination should constrain the depth of a source better than either alone. They supported the idea
with forward models only. This module tests it quantitatively for a configured campaign:

  * the same stations are occupied by the configured clock and by a gravimeter;
  * the source is the first configured body, treated as a point mass (the inversion's model);
  * both instruments carry their nuisance terms: the clock its offset and drift (as in the inversion),
    a relative gravimeter its own offset (base-station tie) and drift; an absolute gravimeter has none;
  * the station-height uncertainty enters both: g·δh/c² for the clock (already in its noise model) and
    the free-air gradient × δh for the gravimeter.

For each case (clock only, gravimeter only, joint) it reports the expected matched-filter SNR at the
true position and the Cramér–Rao bound (linearized covariance) of mass, position and depth, including
the mass–depth correlation that expresses the degeneracy. A Monte Carlo of full nonlinear fits checks
the bound. Sweeps over clock accuracy and source depth show where clocks add information.

Assumptions: independent white errors per station for both instruments (the clock's correlated
environmental noise is folded into its nominal σ, as in the detectability study); no terrain mass.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Literal

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field
from scipy.optimize import least_squares

from . import constants as k
from .analysis import inversion_input, resolution_depth
from .config import ExperimentConfig
from .inversion import _Model
from .physics import normal_gravity
from .sensor import build_noise_model
from .survey import plan_survey

FloatArray = NDArray[np.float64]
Case = Literal["clock", "gravimeter", "joint"]
CASES: tuple[Case, ...] = ("clock", "gravimeter", "joint")
CLOCK_SIGMA_RANGE = (1e-23, 1e-15)  # far beyond any clock, so the sweep shows the whole transition
CLOCK_SIGMA_POINTS = 33
DEPTH_POINTS = 24
MAX_SWEEP_DEPTH_M = 200_000.0
DEPTH_GAIN_THRESHOLD = 0.9  # "clocks add information": joint depth bound at most 90 % of the gravimeter's
MONTE_CARLO_DEFAULT = 40
MONTE_CARLO_MAX = 200
SINGULAR_RATIO = 1e-13  # smallest/largest eigenvalue of the normalized Fisher matrix treated as singular


@dataclass(frozen=True)
class Gravimeter:
    id: str
    label: str
    sigma_m_s2: float  # per-station reading uncertainty (instrument and reading, before station height)
    relative: bool  # relative instruments need an offset (base tie) and drift; absolute ones do not
    basis: str


GRAVIMETERS: dict[str, Gravimeter] = {
    "relative": Gravimeter(
        "relative", "Field relative gravimeter", 5e-8, True,
        "Spring/quartz relative gravimeter (e.g. Scintrex CG-6): manufacturer field repeatability < 5 µGal. "
        "Tied to a base station, so an unknown offset and a linear drift are estimated.",
    ),
    "absolute": Gravimeter(
        "absolute", "Absolute gravimeter", 2e-8, False,
        "Free-fall absolute gravimeter (e.g. Micro-g LaCoste FG5-X): stated accuracy 2 µGal, hours per station. "
        "No offset or drift to estimate.",
    ),
}


class InstrumentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    config: ExperimentConfig
    gravimeter: Literal["relative", "absolute"] = "relative"
    gravimeter_sigma_ugal: float | None = Field(default=None, gt=0, le=1000)
    monte_carlo: int = Field(default=MONTE_CARLO_DEFAULT, ge=0, le=MONTE_CARLO_MAX)


class _Survey:
    """Station geometry, both forward models and their Jacobians for a point source (m, x, y, depth).

    All returned signals and Jacobians are whitened (divided by the instrument σ). Nuisance columns are
    returned unwhitened ([1, t̃]) so their coefficients are in units of σ and of order one.
    """

    def __init__(self, config: ExperimentConfig, gravimeter: Gravimeter, gravimeter_sigma: float):
        plan = plan_survey(config.survey, config.environment, config.sensor)
        env = config.environment
        g_mean = float(np.mean(normal_gravity(env.latitude_deg, env.elevation_m + plan.z, env.earth_model)))
        self.sigma_clock = build_noise_model(config, g_mean, plan.duration_s).nominal_sigma
        height_term = k.FREE_AIR_GRADIENT_S2 * config.noise.station_height_uncertainty_m
        self.sigma_gravity = math.hypot(gravimeter_sigma, height_term)
        self.gravimeter = gravimeter
        self.inp = inversion_input(config, plan, np.zeros(plan.count), self.sigma_clock)
        self.model = _Model(self.inp, 1)
        self.profile = bool(np.all(plan.y == plan.y[0]))
        self.free = [0, 1, 3] if self.profile else [0, 1, 2, 3]
        self.n = plan.count
        self.min_depth = resolution_depth(config)
        self.L = self.model.L
        self.trend = np.column_stack([np.ones(self.n), self.model.tn])

    def clock(self, src: FloatArray, sigma: float | None = None) -> tuple[FloatArray, FloatArray]:
        s = self.sigma_clock if sigma is None else sigma
        theta = np.array([*src, 0.0, 0.0])
        return self.model.source_signal(theta) / s, self.model.jacobian(theta)[:, :4] / s

    def gravity(self, src: FloatArray) -> tuple[FloatArray, FloatArray]:
        m, xs, ys, d = src
        inp = self.inp
        dx, dy, dz = inp.x - xs, inp.y - ys, inp.z + d
        r2 = dx * dx + dy * dy + dz * dz
        r3 = r2 * np.sqrt(r2)
        r5 = r3 * r2
        signal = k.G * m * dz / r3
        jac = np.column_stack([
            k.G * dz / r3,
            3.0 * k.G * m * dz * dx / r5,
            3.0 * k.G * m * dz * dy / r5,
            k.G * m * (1.0 / r3 - 3.0 * dz * dz / r5),
        ])
        return signal / self.sigma_gravity, jac / self.sigma_gravity

    def nuisance_count(self, case: Case) -> int:
        clock = 2 if case in ("clock", "joint") else 0
        gravity = 2 if case in ("gravimeter", "joint") and self.gravimeter.relative else 0
        return clock + gravity

    def stack(self, src: FloatArray, case: Case, clock_sigma: float | None = None) -> tuple[FloatArray, FloatArray]:
        """Whitened signal and Jacobian (free source parameters, then nuisance coefficients) of a case."""
        blocks: list[tuple[FloatArray, FloatArray, bool]] = []
        if case in ("clock", "joint"):
            blocks.append((*self.clock(src, clock_sigma), True))
        if case in ("gravimeter", "joint"):
            blocks.append((*self.gravity(src), self.gravimeter.relative))
        n_free = len(self.free)
        jac = np.zeros((self.n * len(blocks), n_free + self.nuisance_count(case)))
        col = n_free
        for b, (_, j, has_nuisance) in enumerate(blocks):
            rows = slice(b * self.n, (b + 1) * self.n)
            jac[rows, :n_free] = j[:, self.free]
            if has_nuisance:
                jac[rows, col:col + 2] = self.trend
                col += 2
        return np.concatenate([s for s, _, _ in blocks]), jac

    def snr(self, src: FloatArray, case: Case, clock_sigma: float | None = None) -> float:
        """Expected matched-filter SNR at the true position: signal norm after removing the nuisance terms."""
        total = 0.0
        if case in ("clock", "joint"):
            total += _projected_norm_sq(self.clock(src, clock_sigma)[0], self.trend)
        if case in ("gravimeter", "joint"):
            total += _projected_norm_sq(self.gravity(src)[0], self.trend if self.gravimeter.relative else None)
        return math.sqrt(total)


def _projected_norm_sq(signal: FloatArray, nuisance: FloatArray | None) -> float:
    if nuisance is not None:
        q, _ = np.linalg.qr(nuisance)
        signal = signal - q @ (q.T @ signal)
    return float(signal @ signal)


def _covariance(jac: FloatArray) -> FloatArray | None:
    """Cramér–Rao bound (inverse Fisher matrix) for whitened data; None when parameters are not identifiable."""
    norms = np.linalg.norm(jac, axis=0)
    if not np.all(norms > 0.0) or not np.all(np.isfinite(norms)):
        return None
    jn = jac / norms
    fisher = jn.T @ jn
    eig = np.linalg.eigvalsh(fisher)
    if eig[0] <= eig[-1] * SINGULAR_RATIO:
        return None
    return np.linalg.inv(fisher) / np.outer(norms, norms)


def _case_summary(survey: _Survey, src: FloatArray, case: Case) -> dict[str, Any]:
    _, jac = survey.stack(src, case)
    cov = _covariance(jac)
    names = ["mass_kg", "x_m", "y_m", "depth_m"]
    std: dict[str, float | None] = {name: None for name in names}
    corr = None
    cov_md = None
    if cov is not None:
        for col, p in enumerate(survey.free):
            std[names[p]] = float(math.sqrt(max(cov[col, col], 0.0)))
        im, idp = 0, len(survey.free) - 1  # mass is first, depth last among the free source parameters
        cov_md = [[float(cov[im, im]), float(cov[im, idp])], [float(cov[idp, im]), float(cov[idp, idp])]]
        denom = math.sqrt(cov[im, im] * cov[idp, idp])
        corr = float(cov[im, idp] / denom) if denom > 0 else None
    mass = abs(float(src[0]))
    return {
        "snr": survey.snr(src, case),
        "identifiable": cov is not None,
        "std": std,
        "relative_mass_uncertainty": std["mass_kg"] / mass if std["mass_kg"] is not None and mass > 0 else None,
        "relative_depth_uncertainty": std["depth_m"] / float(src[3]) if std["depth_m"] is not None else None,
        "mass_depth_correlation": corr,
        "mass_depth_covariance": cov_md,
    }


def _monte_carlo(survey: _Survey, src: FloatArray, case: Case, realizations: int, seed: int) -> dict[str, Any]:
    """Nonlinear least-squares fits to noisy synthetic data, started at the truth (a local check of the bound)."""
    if realizations == 0:
        return {"realizations": 0, "converged": 0, "mass_std_kg": None, "depth_std_m": None,
                "mass_bias_kg": None, "depth_bias_m": None}
    n_free, n_nuis = len(survey.free), survey.nuisance_count(case)
    scale = np.array([max(abs(float(src[0])), 1.0), survey.L, survey.L, survey.L])[survey.free]
    lo = np.full(n_free + n_nuis, -np.inf)
    hi = np.full(n_free + n_nuis, np.inf)
    lo[n_free - 1] = survey.min_depth / survey.L
    hi[n_free - 1] = 5.0 + 1.0 / survey.L
    signal0, _ = survey.stack(src, case)

    def unpack(p: FloatArray) -> FloatArray:
        full = src.copy()
        full[survey.free] = p[:n_free] * scale
        return full

    def residual(p: FloatArray, data: FloatArray) -> FloatArray:
        s, jac = survey.stack(unpack(p), case)
        return s + jac[:, n_free:] @ p[n_free:] - data

    def jacobian(p: FloatArray, data: FloatArray) -> FloatArray:  # noqa: ARG001 - signature required by SciPy
        _, jac = survey.stack(unpack(p), case)
        jac[:, :n_free] *= scale
        return jac

    p0 = np.concatenate([src[survey.free] / scale, np.zeros(n_nuis)])
    p0[n_free - 1] = float(np.clip(p0[n_free - 1], lo[n_free - 1] * (1 + 1e-9), hi[n_free - 1] * (1 - 1e-9)))
    rng = np.random.default_rng(np.random.SeedSequence([seed, 31337, CASES.index(case)]))
    mass, depth = [], []
    for _ in range(realizations):
        data = signal0 + rng.standard_normal(signal0.size)
        fit = least_squares(residual, p0, jac=jacobian, args=(data,), bounds=(lo, hi), method="trf",
                            x_scale="jac", max_nfev=100)
        if fit.status > 0:
            est = unpack(fit.x)
            mass.append(est[0])
            depth.append(est[3])
    ok = len(mass) >= 5
    return {
        "realizations": realizations,
        "converged": len(mass),
        "mass_std_kg": float(np.std(mass, ddof=1)) if ok else None,
        "depth_std_m": float(np.std(depth, ddof=1)) if ok else None,
        "mass_bias_kg": float(np.mean(mass) - src[0]) if ok else None,
        "depth_bias_m": float(np.mean(depth) - src[3]) if ok else None,
    }


def _log_crossing(xs: list[float], ys: list[float | None], level: float) -> float | None:
    """Largest x at which y first falls to ``level`` scanning from large x down (log–log interpolation)."""
    points = [(x, y) for x, y in zip(xs, ys) if y is not None and y > 0]
    for (x_hi, y_hi), (x_lo, y_lo) in zip(reversed(points), list(reversed(points))[1:]):
        if y_hi > level >= y_lo:
            f = (math.log(level) - math.log(y_hi)) / (math.log(y_lo) - math.log(y_hi))
            return math.exp(math.log(x_hi) + f * (math.log(x_lo) - math.log(x_hi)))
    return None


def compare_instruments(config: ExperimentConfig, gravimeter_id: str = "relative",
                        gravimeter_sigma_ugal: float | None = None,
                        monte_carlo: int = MONTE_CARLO_DEFAULT) -> dict[str, Any]:
    gravimeter = GRAVIMETERS[gravimeter_id]
    sigma_g = gravimeter.sigma_m_s2 if gravimeter_sigma_ugal is None else gravimeter_sigma_ugal * 1e-8
    survey = _Survey(config, gravimeter, sigma_g)
    body = config.bodies[0]
    signed_mass = abs(body.mass_kg) * (1.0 if body.anomaly_type == "dense" else -1.0)
    src = np.array([signed_mass, body.x_m, body.y_m, body.depth_m])

    cases = {case: _case_summary(survey, src, case) for case in CASES}
    for case in CASES:
        cases[case]["monte_carlo"] = _monte_carlo(survey, src, case, monte_carlo, config.noise.seed)
    grav_depth = cases["gravimeter"]["std"]["depth_m"]
    joint_depth = cases["joint"]["std"]["depth_m"]

    # Clock accuracy sweep: the Fisher information of the clock block scales as 1/σ².
    sigmas = np.geomspace(*CLOCK_SIGMA_RANGE, CLOCK_SIGMA_POINTS)
    sweep_clock_snr, sweep_clock_depth, sweep_joint_depth, sweep_joint_mass, sweep_gain = [], [], [], [], []
    for s in sigmas:
        sweep_clock_snr.append(survey.snr(src, "clock", float(s)))
        cov_c = _covariance(survey.stack(src, "clock", float(s))[1])
        cov_j = _covariance(survey.stack(src, "joint", float(s))[1])
        idp = len(survey.free) - 1
        sweep_clock_depth.append(float(math.sqrt(cov_c[idp, idp])) if cov_c is not None else None)
        jd = float(math.sqrt(cov_j[idp, idp])) if cov_j is not None else None
        sweep_joint_depth.append(jd)
        sweep_joint_mass.append(float(math.sqrt(cov_j[0, 0])) if cov_j is not None else None)
        sweep_gain.append(jd / grav_depth if jd is not None and grav_depth else None)
    clock_snr = cases["clock"]["snr"]
    grav_snr = cases["gravimeter"]["snr"]
    equal_snr_sigma = survey.sigma_clock * clock_snr / grav_snr if grav_snr > 0 and clock_snr > 0 else None
    gain_sigma = _log_crossing(sigmas.tolist(), sweep_gain, DEPTH_GAIN_THRESHOLD)

    # Depth sweep at the configured mass and position.
    depths = np.geomspace(max(survey.min_depth, 10.0), MAX_SWEEP_DEPTH_M, DEPTH_POINTS)
    depth_clock, depth_grav = [], []
    for d in depths:
        trial = np.array([signed_mass, body.x_m, body.y_m, float(d)])
        depth_clock.append(survey.snr(trial, "clock"))
        depth_grav.append(survey.snr(trial, "gravimeter"))
    ratio = [c / g if g > 0 else None for c, g in zip(depth_clock, depth_grav)]
    crossover = next((float(d) for d, r in zip(depths, ratio) if r is not None and r >= 1.0), None)

    return {
        "source": {"body_id": body.id, "mass_kg": signed_mass, "x_m": body.x_m, "y_m": body.y_m,
                   "depth_m": body.depth_m, "model": "point mass at the first body"},
        "station_count": survey.n,
        "profile": survey.profile,
        "clock": {"sigma": survey.sigma_clock, "unit": "fractional frequency per station",
                  "species": config.sensor.clock_species, "performance_class": config.sensor.performance_class},
        "gravimeter": {"id": gravimeter.id, "label": gravimeter.label, "relative": gravimeter.relative,
                       "reading_sigma_m_s2": sigma_g, "sigma_m_s2": survey.sigma_gravity,
                       "station_height_term_m_s2": k.FREE_AIR_GRADIENT_S2 * config.noise.station_height_uncertainty_m,
                       "basis": gravimeter.basis},
        "cases": cases,
        "depth_gain": joint_depth / grav_depth if joint_depth is not None and grav_depth else None,
        "clock_sweep": {
            "clock_sigma": sigmas.tolist(),
            "clock_snr": sweep_clock_snr,
            "clock_depth_std_m": sweep_clock_depth,
            "joint_depth_std_m": sweep_joint_depth,
            "joint_mass_std_kg": sweep_joint_mass,
            "depth_gain": sweep_gain,
            "gravimeter_depth_std_m": grav_depth,
            "gravimeter_snr": grav_snr,
            "equal_snr_clock_sigma": equal_snr_sigma,
            "depth_gain_threshold": DEPTH_GAIN_THRESHOLD,
            "depth_gain_clock_sigma": gain_sigma,
        },
        "depth_sweep": {"depths_m": depths.tolist(), "clock_snr": depth_clock, "gravimeter_snr": depth_grav,
                        "clock_to_gravimeter": ratio, "crossover_depth_m": crossover},
        "assumptions": (
            "Same stations for both instruments; point-mass source at the first body; independent white errors "
            "per station (the clock's correlated environmental noise is folded into its nominal σ); the "
            "station-height uncertainty enters the clock as g·δh/c² and the gravimeter as 3.086 µGal/cm × δh; "
            "no terrain mass. Uncertainties are Cramér–Rao bounds, checked by Monte Carlo fits started at the truth."
        ),
    }
