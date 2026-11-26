"""Inverse reconstruction of subsurface point sources from clock observations.

Observation model (fractional frequency, after the known normal-field correction):
    d_i = Σ_s [Φ_s(p_i) − Φ_s(p_ref)] / c² + a + b·(t_i − t̄)/T + ε_i
with Φ_s(p) = −G m_s / |p − c_s| and c_s = (x_s, y_s, −depth_s). For a remote reference the
Φ_s(p_ref) term is zero. Offset a and drift b are nuisance parameters estimated jointly.

Only observables are used here: sensor positions, times, measured values, the reference position
and the analyst-selected number of sources. Ground truth never enters this module.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable

import numpy as np
from numpy.typing import NDArray
from scipy.optimize import least_squares
from scipy.special import log_ndtr, ndtri_exp
from scipy.stats import chi2

from . import constants as k

FloatArray = NDArray[np.float64]
PARAMS_PER_SOURCE = 4
BOOTSTRAP_BUDGET = 2_500_000  # max (samples × points) to bound runtime
SEARCH_GRID_POINTS = 9  # trial source positions per horizontal axis in the initial grid search
SEARCH_DEPTH_FRACTIONS = (0.05, 0.1, 0.2, 0.4, 0.7, 1.0)  # trial depths as fractions of the survey half-extent
SEARCH_STARTS = 4  # best grid-search trials refined by nonlinear least squares
DETECTION_NULL_SAMPLES = 4000  # Monte Carlo samples calibrating the look-elsewhere effect


class InversionCancelled(Exception):
    pass


@dataclass(frozen=True)
class InversionInput:
    x: FloatArray
    y: FloatArray
    z: FloatArray
    t: FloatArray
    data: FloatArray
    reference: tuple[float, float, float] | None
    source_count: int
    half_width: float
    half_length: float
    grid_shape: tuple[int, int] | None  # (ny, nx) when points form a grid
    grid_index: tuple[NDArray[np.int64], NDArray[np.int64]] | None  # (row j, column i) per point
    nominal_sigma: float
    # Shallowest resolvable source: half the station spacing. A shallower source would produce an
    # anomaly narrower than the sampling interval (it could fit a single noisy station).
    min_depth: float = 1.0
    # Field data with per-measurement uncertainties σᵢ: weights nominal_sigma / σᵢ. Data, model and nuisance
    # terms are all scaled by the weights (whitening), so the whitened noise has σ = nominal_sigma everywhere
    # and the detection test and fit statistics apply unchanged. None means equal weights.
    weights: FloatArray | None = None


@dataclass
class ParameterEstimate:
    estimate: float
    std_error: float | None
    bootstrap_std: float | None = None
    ci_low: float | None = None
    ci_high: float | None = None
    samples: FloatArray | None = None


@dataclass
class SourceEstimate:
    mass_kg: ParameterEstimate
    x_m: ParameterEstimate
    y_m: ParameterEstimate
    depth_m: ParameterEstimate


@dataclass
class InversionResult:
    sources: list[SourceEstimate]
    offset: ParameterEstimate
    drift_per_s: ParameterEstimate
    converged: bool
    message: str
    evaluations: int
    residual_rms: float
    reduced_chi_square: float | None
    n_points: int
    n_parameters: int
    theta: FloatArray
    prediction: FloatArray  # full model (sources + offset + drift) at observation points
    source_signal: FloatArray  # sources only, relative to the reference
    covariance_ok: bool
    bootstrap: dict = field(default_factory=dict)
    detection: dict = field(default_factory=dict)


class _Model:
    def __init__(self, inp: InversionInput, n_sources: int):
        self.inp = inp
        self.n = n_sources
        self.t_mid = float(np.mean(inp.t))
        span = float(np.ptp(inp.t))
        self.t_span = span if span > 0 else 1.0
        self.tn = (inp.t - self.t_mid) / self.t_span
        self.L = max(inp.half_width, inp.half_length)
        self.w = inp.weights if inp.weights is not None else None

    def unpack(self, theta: FloatArray) -> tuple[FloatArray, float, float]:
        src = theta[: self.n * PARAMS_PER_SOURCE].reshape(self.n, PARAMS_PER_SOURCE)
        return src, float(theta[-2]), float(theta[-1])

    def source_signal(self, theta: FloatArray) -> FloatArray:
        src, _, _ = self.unpack(theta)
        inp = self.inp
        out = np.zeros_like(inp.x)
        for m, xs, ys, d in src:
            r = np.sqrt((inp.x - xs) ** 2 + (inp.y - ys) ** 2 + (inp.z + d) ** 2)
            out += -k.G * m / r
            if inp.reference is not None:
                xr, yr, zr = inp.reference
                rr = math.sqrt((xr - xs) ** 2 + (yr - ys) ** 2 + (zr + d) ** 2)
                out += k.G * m / rr
        return out / k.C2

    def predict(self, theta: FloatArray) -> FloatArray:
        _, a, b = self.unpack(theta)
        return self.source_signal(theta) + a + b * self.tn

    def jacobian(self, theta: FloatArray) -> FloatArray:
        src, _, _ = self.unpack(theta)
        inp = self.inp
        cols = np.empty((inp.x.size, theta.size))
        for s, (m, xs, ys, d) in enumerate(src):
            dx, dy, dz = inp.x - xs, inp.y - ys, inp.z + d
            r = np.sqrt(dx * dx + dy * dy + dz * dz)
            r3 = r**3
            j_m = -k.G / r
            j_x = -k.G * m * dx / r3
            j_y = -k.G * m * dy / r3
            j_d = k.G * m * dz / r3
            if inp.reference is not None:
                xr, yr, zr = inp.reference
                rdx, rdy, rdz = xr - xs, yr - ys, zr + d
                rr = math.sqrt(rdx * rdx + rdy * rdy + rdz * rdz)
                rr3 = rr**3
                j_m = j_m + k.G / rr
                j_x = j_x + k.G * m * rdx / rr3
                j_y = j_y + k.G * m * rdy / rr3
                j_d = j_d - k.G * m * rdz / rr3
            base = s * PARAMS_PER_SOURCE
            cols[:, base] = j_m / k.C2
            cols[:, base + 1] = j_x / k.C2
            cols[:, base + 2] = j_y / k.C2
            cols[:, base + 3] = j_d / k.C2
        cols[:, -2] = 1.0
        cols[:, -1] = self.tn
        return cols

    def bounds(self, data_scale: float) -> tuple[FloatArray, FloatArray]:
        lo, hi = [], []
        span_x = 2.0 * self.inp.half_width
        span_y = 2.0 * self.inp.half_length
        for _ in range(self.n):
            lo += [-np.inf, -span_x, -span_y, self.inp.min_depth]
            hi += [np.inf, span_x, span_y, 5.0 * self.L + 1.0]
        lo += [-np.inf, -np.inf]
        hi += [np.inf, np.inf]
        return np.array(lo), np.array(hi)


def _scales(model: _Model, data_scale: float, mass_scale: float) -> FloatArray:
    per_source = [mass_scale, model.L, model.L, model.L]
    return np.array(per_source * model.n + [data_scale, data_scale])


def _fit(model: _Model, data: FloatArray, theta0: FloatArray, data_scale: float, mass_scale: float,
         max_nfev: int = 200):
    scale = _scales(model, data_scale, mass_scale)
    lo, hi = model.bounds(data_scale)
    finite_lo, finite_hi = np.isfinite(lo), np.isfinite(hi)
    inner_lo = np.where(finite_lo, lo + 1e-9 * np.abs(np.where(finite_lo, lo, 0.0)) + 1e-12, lo)
    inner_hi = np.where(finite_hi, hi - 1e-9 * np.abs(np.where(finite_hi, hi, 0.0)) - 1e-12, hi)
    p0 = np.clip(theta0, inner_lo, inner_hi) / scale

    w = model.w

    def fun(p: FloatArray) -> FloatArray:
        r = (model.predict(p * scale) - data) / data_scale
        return r if w is None else r * w

    def jac(p: FloatArray) -> FloatArray:
        j = model.jacobian(p * scale) * scale / data_scale
        return j if w is None else j * w[:, None]

    res = least_squares(fun, p0, jac=jac, bounds=(lo / scale, hi / scale), method="trf",
                        x_scale="jac", max_nfev=max_nfev)
    return res, scale


class _TrialGrid:
    """Trial point sources on a fixed grid of positions and depths, with their signals projected
    orthogonal to the nuisance terms (offset and drift).

    For a trial position and depth the model is linear in mass, offset and drift, so a trial is
    scored by a projection. Stored as a Gram matrix (trials × trials) plus per-trial norms, so memory
    does not grow with the number of stations.
    """

    def __init__(self, model: _Model, inp: InversionInput):
        profile = bool(np.all(inp.y == inp.y[0]))
        xs = np.linspace(-inp.half_width, inp.half_width, SEARCH_GRID_POINTS)
        ys = np.array([float(inp.y[0])]) if profile else np.linspace(-inp.half_length, inp.half_length,
                                                                     SEARCH_GRID_POINTS)
        depths = np.array([max(frac * model.L, inp.min_depth * 1.01) for frac in SEARCH_DEPTH_FRACTIONS])
        dd, xx, yy = np.meshgrid(depths, xs, ys, indexing="ij")
        self.params = np.column_stack([xx.ravel(), yy.ravel(), dd.ravel()])  # x, y, depth
        self.inp = inp
        self.w = inp.weights
        nuisance = np.column_stack([np.ones_like(inp.x), model.tn])
        if self.w is not None:
            nuisance = nuisance * self.w[:, None]
        self.nuisance, _ = np.linalg.qr(nuisance)
        # Pass 1: nuisance components of every trial signal. Pass 2: Gram matrix of the complements.
        n_trials = self.params.shape[0]
        vn = np.zeros((n_trials, 2))
        for rows, block in self._blocks():
            vn += block.T @ self.nuisance[rows]
        gram = np.zeros((n_trials, n_trials))
        for rows, block in self._blocks():
            projected = block - self.nuisance[rows] @ vn.T
            gram += projected.T @ projected
        self._vn = vn
        self.norm = np.sqrt(np.clip(np.diag(gram), 0.0, None))
        self.valid = self.norm > 0.0
        safe = np.where(self.valid, self.norm, 1.0)
        self.correlation = gram / np.outer(safe, safe)

    def _blocks(self, size: int = 4096):
        """Yield (row slice, dimensionless trial signals for those stations)."""
        inp = self.inp
        xs, ys, ds = self.params[:, 0], self.params[:, 1], self.params[:, 2]
        ref = None
        if inp.reference is not None:
            xr, yr, zr = inp.reference
            ref = 1.0 / np.sqrt((xr - xs) ** 2 + (yr - ys) ** 2 + (zr + ds) ** 2)
        for start in range(0, inp.x.size, size):
            rows = slice(start, min(start + size, inp.x.size))
            r = np.sqrt((inp.x[rows, None] - xs) ** 2 + (inp.y[rows, None] - ys) ** 2 + (inp.z[rows, None] + ds) ** 2)
            block = -1.0 / r if ref is None else ref - 1.0 / r
            if self.w is not None:
                block = block * self.w[rows, None]
            yield rows, block * ds  # scaled by depth: values of order one

    def coefficients(self, data: FloatArray) -> FloatArray:
        """Projection of the (whitened) data on each unit-norm trial signal (fractional-frequency units)."""
        if self.w is not None:
            data = data * self.w
        target = data - self.nuisance @ (self.nuisance.T @ data)
        dots = np.zeros(self.params.shape[0])
        for rows, block in self._blocks():
            dots += block.T @ target[rows]  # the target is already orthogonal to the nuisance terms
        return np.where(self.valid, dots / np.where(self.valid, self.norm, 1.0), 0.0)

    def masses(self, coefficients: FloatArray) -> FloatArray:
        """Least-squares mass of each trial source, given its projection coefficient."""
        depth = self.params[:, 2]
        safe = np.where(self.valid, self.norm, 1.0)
        return np.where(self.valid, coefficients / safe * depth * k.C2 / k.G, 0.0)


def _initial_candidates(model: _Model, inp: InversionInput, residual: FloatArray) -> list[FloatArray]:
    """Starting points for one additional source: the best trials of a coarse grid search.

    The data extremum alone is not a reliable start: with an unknown offset, a broad anomaly measured
    against a corner reference puts the extremum of the centred data at the survey edge rather than
    over the source.
    """
    grid = _TrialGrid(model, inp)
    coefficients = grid.coefficients(residual)
    masses = grid.masses(coefficients)
    order = np.argsort(-coefficients**2)
    return [np.array([masses[i], *grid.params[i]]) for i in order[:SEARCH_STARTS] if grid.valid[i]]


def null_calibration(grid: _TrialGrid, seed: int) -> tuple[float, FloatArray]:
    """Effective number of independent trials, and Monte Carlo maxima of the statistic under noise only.

    Projections of white noise onto the unit-norm trials are jointly N(0, correlation), so the null
    distribution needs only the trial correlation matrix, not the station count.
    """
    corr = grid.correlation[np.ix_(grid.valid, grid.valid)]
    eigval, eigvec = np.linalg.eigh(corr)
    factor = eigvec * np.sqrt(np.clip(eigval, 0.0, None))
    rng = np.random.default_rng(np.random.SeedSequence([seed, 104729]))
    q_null = np.max((factor @ rng.standard_normal((factor.shape[1], DETECTION_NULL_SAMPLES))) ** 2, axis=0)
    p_single_median = float(chi2.sf(float(np.median(q_null)), 1))
    trials = max(1.0, math.log(0.5) / math.log1p(-p_single_median)) if 0.0 < p_single_median < 1.0 else 1.0
    return trials, q_null


def significance_from_statistic(q: float, trials: float) -> float:
    """One-sided Gaussian-equivalent significance of the scan maximum q, given the effective trials."""
    log_p_single = math.log(2.0) + float(log_ndtr(-math.sqrt(max(q, 0.0))))  # log P(χ²₁ > q)
    p_single = math.exp(log_p_single)
    p_any = -math.expm1(trials * math.log1p(-p_single)) if p_single < 1.0 else 1.0
    log_p = math.log(p_any) if p_any > 1e-300 else math.log(trials) + log_p_single
    return max(0.0, float(-ndtri_exp(log_p)))


def detection_scan(inp: InversionInput, seed: int) -> dict:
    """Is any point source present? Matched-filter scan with a look-elsewhere correction.

    The statistic is the largest reduction in χ² (in units of the instrument's nominal noise σ) that
    one point source on the trial grid achieves over a model with offset and drift only. Under pure
    white noise each trial's reduction follows χ²(1); the maximum over correlated trials is calibrated
    by Monte Carlo, summarized as an effective number of independent trials, and converted to a
    one-sided Gaussian-equivalent significance. Uses observables and the instrument specification only.
    """
    grid = _TrialGrid(_Model(inp, 1), inp)
    if inp.nominal_sigma <= 0.0 or not np.any(grid.valid):
        return {"available": False, "significance_sigma": None, "statistic": None, "effective_trials": None,
                "null_samples": 0, "null_exceedance": None, "best_trial": None}
    trials, q_null = null_calibration(grid, seed)
    return scan_with(grid, trials, inp.data, inp.nominal_sigma, q_null)


def scan_with(grid: _TrialGrid, trials: float, data: FloatArray, sigma: float,
              q_null: FloatArray | None = None) -> dict:
    """Detection scan on ``data`` with a precomputed trial grid and calibration (geometry-only, reusable)."""
    q = (grid.coefficients(data) / sigma) ** 2
    best = int(np.argmax(np.where(grid.valid, q, -np.inf)))
    q_obs = float(q[best])
    return {
        "available": True,
        "significance_sigma": significance_from_statistic(q_obs, trials),
        "statistic": q_obs,
        "effective_trials": trials,
        "null_samples": DETECTION_NULL_SAMPLES if q_null is not None else 0,
        "null_exceedance": float(np.mean(q_null >= q_obs)) if q_null is not None else None,
        "best_trial": {"x_m": float(grid.params[best, 0]), "y_m": float(grid.params[best, 1]),
                       "depth_m": float(grid.params[best, 2])},
    }


def detection_grid(inp: InversionInput) -> _TrialGrid:
    """Trial grid of the detection scan for this station geometry (public for repeated scans)."""
    return _TrialGrid(_Model(inp, 1), inp)


def _fit_all(inp: InversionInput) -> tuple[_Model, object, FloatArray]:
    data = inp.data
    data_scale = float(np.std(data)) or (inp.nominal_sigma or 1e-18)
    known: list[FloatArray] = []
    nuisance = np.zeros(2)
    best = None
    best_scale = None
    model = None
    for n in range(1, inp.source_count + 1):
        model = _Model(inp, n)
        if known:
            prev_model = _Model(inp, n - 1)
            residual = data - prev_model.predict(np.concatenate([*known, nuisance]))
        else:
            residual = data
        best = None
        for cand in _initial_candidates(model, inp, residual):
            theta0 = np.concatenate([*known, cand, [float(np.median(data)), 0.0]])
            mass_scale = max(abs(cand[0]), 1.0)
            res, scale = _fit(model, data, theta0, data_scale, mass_scale)
            if best is None or res.cost < best.cost:
                best, best_scale = res, scale
        assert best is not None and best_scale is not None
        theta = best.x * best_scale
        known = [theta[s * PARAMS_PER_SOURCE:(s + 1) * PARAMS_PER_SOURCE] for s in range(n)]
        nuisance = theta[-2:]
    assert model is not None and best is not None and best_scale is not None
    return model, best, best_scale


def _estimate_from(value: float, std: float | None) -> ParameterEstimate:
    return ParameterEstimate(estimate=value, std_error=std)


def invert(
    inp: InversionInput,
    bootstrap_samples: int,
    seed: int,
    on_progress: Callable[[float], None] | None = None,
    should_cancel: Callable[[], bool] | None = None,
    on_bootstrap_start: Callable[[], None] | None = None,
) -> InversionResult:
    detection = detection_scan(inp, seed)
    model, res, scale = _fit_all(inp)
    if should_cancel and should_cancel():
        raise InversionCancelled()
    theta = res.x * scale
    prediction = model.predict(theta)
    residual = inp.data - prediction
    w = inp.weights
    white_residual = residual if w is None else residual * w
    n_points, n_params = inp.data.size, theta.size
    dof = max(n_points - n_params, 1)
    variance = float(np.sum(white_residual**2) / dof)

    # Linearized covariance from the Jacobian at the solution.
    covariance_ok = True
    std = np.full(n_params, np.nan)
    try:
        jac = model.jacobian(theta) * scale
        if w is not None:
            jac = jac * w[:, None]
        cov_scaled = np.linalg.pinv(jac.T @ jac) * variance
        std = np.sqrt(np.clip(np.diag(cov_scaled), 0.0, None)) * scale
        if not np.all(np.isfinite(std)):
            covariance_ok = False
    except np.linalg.LinAlgError:
        covariance_ok = False

    def std_at(i: int) -> float | None:
        v = float(std[i])
        return v if covariance_ok and math.isfinite(v) else None

    src, _, _ = model.unpack(theta)
    sources = []
    for s in range(model.n):
        base = s * PARAMS_PER_SOURCE
        sources.append(SourceEstimate(
            mass_kg=_estimate_from(float(src[s, 0]), std_at(base)),
            x_m=_estimate_from(float(src[s, 1]), std_at(base + 1)),
            y_m=_estimate_from(float(src[s, 2]), std_at(base + 2)),
            depth_m=_estimate_from(float(src[s, 3]), std_at(base + 3)),
        ))
    offset = _estimate_from(float(theta[-2]), std_at(n_params - 2))
    drift = _estimate_from(float(theta[-1]) / model.t_span, None if std_at(n_params - 1) is None
                           else std_at(n_params - 1) / model.t_span)

    # Moving-block residual bootstrap, refitting from the solution.
    requested = int(bootstrap_samples)
    cap = max(20, BOOTSTRAP_BUDGET // max(n_points, 1))
    used = min(requested, cap)
    block = max(1, int(round(n_points ** (1.0 / 3.0))))
    rng = np.random.default_rng(np.random.SeedSequence([seed, 7919]))
    samples = np.full((used, n_params), np.nan)
    data_scale = float(np.std(inp.data)) or (inp.nominal_sigma or 1e-18)
    if on_bootstrap_start:
        on_bootstrap_start()
    for b in range(used):
        if should_cancel and should_cancel():
            raise InversionCancelled()
        starts = rng.integers(0, max(n_points - block, 0) + 1, size=int(math.ceil(n_points / block)))
        resampled = np.concatenate([white_residual[s:s + block] for s in starts])[:n_points]
        synthetic = prediction + (resampled if w is None else resampled / w)
        mass_scale = float(scale[0])
        fit_b, scale_b = _fit(model, synthetic, theta, data_scale, mass_scale, max_nfev=60)
        if fit_b.status > 0:
            samples[b] = fit_b.x * scale_b
        if on_progress:
            on_progress((b + 1) / used)

    valid = samples[np.all(np.isfinite(samples), axis=1)]

    def attach(est: ParameterEstimate, column: FloatArray) -> None:
        if column.size >= 10:
            est.bootstrap_std = float(np.std(column, ddof=1))
            est.ci_low = float(np.percentile(column, 2.5))
            est.ci_high = float(np.percentile(column, 97.5))
            est.samples = column

    for s, source in enumerate(sources):
        base = s * PARAMS_PER_SOURCE
        attach(source.mass_kg, valid[:, base])
        attach(source.x_m, valid[:, base + 1])
        attach(source.y_m, valid[:, base + 2])
        attach(source.depth_m, valid[:, base + 3])

    nominal = inp.nominal_sigma
    return InversionResult(
        sources=sources,
        offset=offset,
        drift_per_s=drift,
        converged=bool(res.status > 0),
        message=str(res.message),
        evaluations=int(res.nfev),
        residual_rms=float(np.sqrt(np.mean(residual**2))),
        reduced_chi_square=float(variance / nominal**2) if nominal > 0 else None,
        n_points=n_points,
        n_parameters=n_params,
        theta=theta,
        prediction=prediction,
        source_signal=model.source_signal(theta),
        covariance_ok=covariance_ok,
        bootstrap={
            "method": "moving-block residual bootstrap",
            "requested_samples": requested,
            "samples_used": used,
            "converged_samples": int(valid.shape[0]),
            "block_length": block,
            "confidence_level": 0.95,
            "capped": used < requested,
        },
        detection=detection,
    )


def point_source_gravity(sources: list[SourceEstimate], x: FloatArray, y: FloatArray, z: FloatArray) -> FloatArray:
    """Downward gravity anomaly (m/s²) of estimated point sources."""
    out = np.zeros_like(x)
    for s in sources:
        m, xs, ys, d = s.mass_kg.estimate, s.x_m.estimate, s.y_m.estimate, s.depth_m.estimate
        dz = z + d
        r2 = (x - xs) ** 2 + (y - ys) ** 2 + dz * dz
        out += k.G * m * dz / (r2 * np.sqrt(r2))
    return out
