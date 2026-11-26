"""Monte Carlo studies: what a campaign achieves over many noise realizations.

Three kinds, all evaluated against the configured ground truth (this is the evaluation layer; the
detection test and inversion inside each run still see observables only):

- ``repeat``      the experiment with many noise seeds: detection rate, estimation bias and RMSE,
                  and how often the 95 % intervals contain the truth (coverage).
- ``sweep``       detection probability over a grid of masses and depths for the first body, next to
                  the probability predicted analytically from the expected significance.
- ``time_lapse``  two surveys of the same stations with a mass change of the first body in between
                  (e.g. aquifer depletion): can the change be detected and estimated? Station-height
                  errors cancel because the same benchmarks are reoccupied; clock set-up errors do not.
"""

from __future__ import annotations

import math
from datetime import timedelta
from typing import Any, Callable, Literal

import numpy as np
from pydantic import BaseModel, ConfigDict, Field
from scipy.stats import norm

from . import constants as k
from .analysis import build_results, inversion_input, run_inversion
from .config import ExperimentConfig
from .detectability import _significance_threshold_statistic
from .geometry import BodyGeometry, body_geometry
from .inversion import InversionCancelled, detection_grid, invert, null_calibration, scan_with
from .sensor import simulate_measurements
from .survey import ground_minimum, plan_survey

StudyKind = Literal["repeat", "sweep", "time_lapse"]
STUDY_BOOTSTRAP_CAP = 60  # bootstrap samples per study run (the configured value when lower)
MAX_RUNS = 500
MAX_SWEEP_AXIS = 10
MAX_WORK = 4e8  # cap on runs × cells × stations × search trials, bounding study run time
PARAMETERS = ("depth_m", "mass_kg", "x_m", "y_m")
# Instrument errors drawn again in every survey (the station height is not: same benchmark).
REPEATED_ERRORS = ("clock_instability", "clock_systematic", "measurement", "thermal", "vibration")

Progress = Callable[[float], None]
Cancelled = Callable[[], bool]


class StudyCancelled(Exception):
    pass


class StudyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    kind: StudyKind
    runs: int = Field(ge=5, le=MAX_RUNS)
    masses_kg: list[float] | None = None
    depths_m: list[float] | None = None
    mass_change_kg: float | None = None
    interval_days: float | None = None


def validate_request(request: StudyRequest, config: ExperimentConfig) -> list[dict[str, str]]:
    """Field errors for a study request (same {field, message} shape as configuration errors)."""
    errors: list[dict[str, str]] = []

    def err(field: str, message: str) -> None:
        errors.append({"field": field, "message": message})

    if request.kind == "sweep":
        for name, values, low, high, unit in (("masses_kg", request.masses_kg, 1e6, 1e15, "kg"),
                                              ("depths_m", request.depths_m, 1.0, 20_000.0, "m")):
            if not values or not 2 <= len(values) <= MAX_SWEEP_AXIS:
                err(name, f"Give between 2 and {MAX_SWEEP_AXIS} values.")
            elif any(not (low <= v <= high) for v in values):
                err(name, f"Values must lie between {low:g} {unit} and {high:g} {unit}.")
            elif len(set(values)) != len(values):
                err(name, "Values must be distinct.")
    if request.kind == "time_lapse":
        change = request.mass_change_kg
        signed = body_geometry(config.bodies[0]).signed_mass_kg
        if change is None or change == 0:
            err("mass_change_kg", "Enter a non-zero mass change.")
        elif abs(change) > 1e15:
            err("mass_change_kg", "Mass change must be at most 10¹⁵ kg in magnitude.")
        elif (signed + change) == 0 or math.copysign(1, signed + change) != math.copysign(1, signed):
            err("mass_change_kg", "The change would remove or reverse the body; use a smaller change.")
        if request.interval_days is None or not 1 <= request.interval_days <= 3650:
            err("interval_days", "Time between surveys must be between 1 and 3650 days.")
    if not errors:
        plan = plan_survey(config.survey, config.environment, config.sensor)
        cells = len(request.masses_kg or [1]) * len(request.depths_m or [1]) if request.kind == "sweep" else 1
        epochs = 2 if request.kind == "time_lapse" else 1
        work = request.runs * cells * epochs * plan.count * 500
        if work > MAX_WORK:
            err("runs", "The study is too large for this survey; use fewer runs, fewer grid values or fewer stations.")
    return errors


# ---------------------------------------------------------------------------- statistics helpers


def _seeds(base: int, n: int, salt: int) -> list[int]:
    return [int(v) for v in np.random.SeedSequence([base, salt]).generate_state(n)]


def wilson(successes: int, n: int) -> dict[str, float | int | None]:
    """Proportion with its 95 % Wilson score interval."""
    if n == 0:
        return {"k": 0, "n": 0, "rate": None, "low": None, "high": None}
    z = 1.959963984540054
    p = successes / n
    centre = (p + z * z / (2 * n)) / (1 + z * z / n)
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return {"k": successes, "n": n, "rate": p, "low": max(0.0, centre - half), "high": min(1.0, centre + half)}


def _accuracy(estimates: list[float], truth: float, inside: list[bool | None]) -> dict[str, Any]:
    known = [v for v in inside if v is not None]
    if not estimates:
        return {"n": 0, "bias": None, "rmse": None, "coverage": wilson(0, 0)}
    errors = np.asarray(estimates) - truth
    return {
        "n": len(estimates),
        "bias": float(np.mean(errors)),
        "rmse": float(np.sqrt(np.mean(errors**2))),
        "coverage": wilson(sum(known), len(known)),
    }


def _detection_probability(lam: float, q_threshold: float) -> float:
    """P(detect) when the matched-filter amplitude is N(√λ, 1) and detection needs q ≥ q_threshold."""
    root, cut = math.sqrt(max(lam, 0.0)), math.sqrt(q_threshold)
    return float(norm.cdf(root - cut) + norm.cdf(-root - cut))


def _projected_power(grid: Any, signal: np.ndarray, sigma: float) -> float:
    """λ: squared norm of the noise-free signal after removing offset and drift, in units of σ²."""
    residual = signal - grid.nuisance @ (grid.nuisance.T @ signal)
    return float(residual @ residual) / sigma**2


def _with_body(config: ExperimentConfig, **changes: Any) -> ExperimentConfig:
    copy = config.model_copy(deep=True)
    for name, value in changes.items():
        setattr(copy.bodies[0], name, value)
    return copy


def _above_ground(body: BodyGeometry, config: ExperimentConfig) -> bool:
    ground_low = ground_minimum(config.environment, config.survey)
    return body.z_center_m + body.half_z_m >= ground_low


def _check(cancelled: Cancelled | None) -> None:
    if cancelled and cancelled():
        raise StudyCancelled()


# ---------------------------------------------------------------------------- study kinds


def run_repeat(config: ExperimentConfig, runs: int, progress: Progress | None = None,
               cancelled: Cancelled | None = None) -> dict[str, Any]:
    plan = plan_survey(config.survey, config.environment, config.sensor)
    bodies = [body_geometry(b) for b in config.bodies]
    truth = bodies[0]
    truth_values = {"depth_m": truth.depth_m, "mass_kg": truth.signed_mass_kg, "x_m": truth.x_m, "y_m": truth.y_m}
    records = []
    for i, seed in enumerate(_seeds(config.noise.seed, runs, 1)):
        _check(cancelled)
        cfg = config.model_copy(deep=True)
        cfg.noise.seed = seed
        cfg.inversion.bootstrap_samples = min(cfg.inversion.bootstrap_samples, STUDY_BOOTSTRAP_CAP)
        meas = simulate_measurements(cfg, plan, bodies)
        try:
            inv = run_inversion(cfg, plan, meas, should_cancel=cancelled)
        except InversionCancelled as exc:
            raise StudyCancelled() from exc
        docs = build_results(cfg, plan, meas, bodies, inv)
        match = next(m for m in docs["comparison"]["matches"] if m["truth_id"] == truth.id)
        source = next(s for s in docs["inversion"]["sources"] if s["id"] == match["source_id"])
        records.append({
            "seed": seed,
            "detected": docs["summary"]["anomaly_detected"],
            "significance_sigma": docs["summary"]["detection_significance_sigma"],
            **{name: source[name]["estimate"] for name in PARAMETERS},
            "truth_within_ci": match["truth_within_ci"],
        })
        if progress:
            progress((i + 1) / runs)

    def accuracy(subset: list[dict[str, Any]]) -> dict[str, Any]:
        return {name: _accuracy([r[name] for r in subset], truth_values[name], [r["truth_within_ci"][name] for r in subset])
                for name in PARAMETERS}

    detected = [r for r in records if r["detected"]]
    significance = [r["significance_sigma"] for r in records if r["significance_sigma"] is not None]
    return {
        "kind": "repeat",
        "runs": runs,
        "stations": plan.count,
        "bootstrap_samples": min(config.inversion.bootstrap_samples, STUDY_BOOTSTRAP_CAP),
        "truth": truth_values,
        "detection": wilson(len(detected), len(records)),
        "significance": {"median": float(np.median(significance)) if significance else None, "values": significance},
        "accuracy_all": accuracy(records),
        "accuracy_detected": accuracy(detected),
        "records": records,
    }


def run_sweep(config: ExperimentConfig, masses: list[float], depths: list[float], runs: int,
              progress: Progress | None = None, cancelled: Cancelled | None = None) -> dict[str, Any]:
    plan = plan_survey(config.survey, config.environment, config.sensor)
    template = simulate_measurements(config, plan, [body_geometry(b) for b in config.bodies])
    sigma = template.noise_model.nominal_sigma
    inp = inversion_input(config, plan, np.zeros(plan.count), sigma)
    grid = detection_grid(inp)
    trials, _ = null_calibration(grid, config.noise.seed)
    q_threshold = _significance_threshold_statistic(k.DETECTION_SIGMA, trials)
    masses, depths = sorted(masses), sorted(depths)
    seeds = _seeds(config.noise.seed, runs, 2)
    observed: list[list[dict[str, Any] | None]] = []
    predicted: list[list[float | None]] = []
    done, total = 0, len(masses) * len(depths)
    for depth in depths:
        row_obs: list[dict[str, Any] | None] = []
        row_pred: list[float | None] = []
        for mass in masses:
            cfg = _with_body(config, mass_kg=mass, depth_m=depth)
            bodies = [body_geometry(b) for b in cfg.bodies]
            if _above_ground(bodies[0], cfg):
                row_obs.append(None)
                row_pred.append(None)
            else:
                hits = 0
                signal = None
                for seed in seeds:
                    _check(cancelled)
                    cfg.noise.seed = seed
                    meas = simulate_measurements(cfg, plan, bodies)
                    signal = meas.true_anomaly_signal
                    scan = scan_with(grid, trials, meas.columns["raw"] - meas.normal_correction, sigma)
                    hits += scan["significance_sigma"] >= k.DETECTION_SIGMA
                row_obs.append(wilson(hits, runs))
                assert signal is not None
                row_pred.append(_detection_probability(_projected_power(grid, signal, sigma), q_threshold))
            done += 1
            if progress:
                progress(done / total)
        observed.append(row_obs)
        predicted.append(row_pred)
    return {
        "kind": "sweep",
        "runs_per_cell": runs,
        "stations": plan.count,
        "masses_kg": masses,
        "depths_m": depths,
        "detection": observed,
        "predicted_probability": predicted,
        "effective_trials": trials,
        "threshold_sigma": k.DETECTION_SIGMA,
        "note": "Cells where the body would reach above the ground are left empty. Other configured bodies remain.",
    }


def run_time_lapse(config: ExperimentConfig, mass_change: float, interval_days: float, runs: int,
                   progress: Progress | None = None, cancelled: Cancelled | None = None) -> dict[str, Any]:
    plan = plan_survey(config.survey, config.environment, config.sensor)
    before = config
    start = body_geometry(config.bodies[0])
    end_signed = start.signed_mass_kg + mass_change
    # Same body volume, changed density: water filling or draining pore space, or ore being removed.
    scale = abs(end_signed) / abs(start.signed_mass_kg)
    after = _with_body(config, mass_kg=abs(end_signed),
                       density_contrast_kg_m3=config.bodies[0].density_contrast_kg_m3 * scale)
    bodies_before = [body_geometry(b) for b in before.bodies]
    bodies_after = [body_geometry(b) for b in after.bodies]

    template = simulate_measurements(before, plan, bodies_before)
    sigmas = {c.id: c.sigma for c in template.noise_model.components}
    # Per-station errors in the difference of two surveys: everything except the station height
    # (same benchmark) appears twice; the correlated environmental term is independent between epochs.
    single = sum(sigmas[key] ** 2 for key in REPEATED_ERRORS)
    single += template.noise_model.environmental_sigma**2
    sigma_diff = math.sqrt(2.0 * single)
    sigma_naive = math.sqrt(2.0) * template.noise_model.nominal_sigma

    inp0 = inversion_input(before, plan, np.zeros(plan.count), sigma_diff)
    grid = detection_grid(inp0)
    trials, _ = null_calibration(grid, config.noise.seed)
    q_threshold = _significance_threshold_statistic(k.DETECTION_SIGMA, trials)

    seeds_a, seeds_b = _seeds(config.noise.seed, runs, 3), _seeds(config.noise.seed, runs, 4)
    station_seeds = _seeds(config.noise.seed, runs, 5)
    bootstrap = min(config.inversion.bootstrap_samples, STUDY_BOOTSTRAP_CAP)
    records = []
    true_change_signal = None
    for i in range(runs):
        _check(cancelled)
        cfg_a, cfg_b = before.model_copy(deep=True), after.model_copy(deep=True)
        cfg_a.noise.seed, cfg_b.noise.seed = seeds_a[i], seeds_b[i]
        cfg_b.survey.start_date = before.survey.start_date + timedelta(days=interval_days)  # tides of the later survey
        first = simulate_measurements(cfg_a, plan, bodies_before, station_seed=station_seeds[i])
        second = simulate_measurements(cfg_b, plan, bodies_after, station_seed=station_seeds[i])
        true_change_signal = second.true_anomaly_signal - first.true_anomaly_signal
        diff = (second.columns["raw"] - second.normal_correction) - (first.columns["raw"] - first.normal_correction)
        scan = scan_with(grid, trials, diff, sigma_diff)
        inp = inversion_input(before, plan, diff, sigma_diff)
        try:
            inv = invert(inp, bootstrap, seeds_a[i], should_cancel=cancelled)
        except InversionCancelled as exc:
            raise StudyCancelled() from exc
        s = inv.sources[0]

        def inside(est: Any, value: float) -> bool | None:
            return None if est.ci_low is None or est.ci_high is None else bool(est.ci_low <= value <= est.ci_high)

        records.append({
            "seed": seeds_a[i],
            "detected": scan["significance_sigma"] >= k.DETECTION_SIGMA,
            "significance_sigma": scan["significance_sigma"],
            "mass_change_kg": s.mass_kg.estimate,
            "depth_m": s.depth_m.estimate,
            "truth_within_ci": {"mass_change_kg": inside(s.mass_kg, mass_change), "depth_m": inside(s.depth_m, start.depth_m)},
        })
        if progress:
            progress((i + 1) / runs)

    assert true_change_signal is not None
    lam = _projected_power(grid, true_change_signal, sigma_diff)

    def accuracy(subset: list[dict[str, Any]]) -> dict[str, Any]:
        return {
            "mass_change_kg": _accuracy([r["mass_change_kg"] for r in subset], mass_change,
                                        [r["truth_within_ci"]["mass_change_kg"] for r in subset]),
            "depth_m": _accuracy([r["depth_m"] for r in subset], start.depth_m,
                                 [r["truth_within_ci"]["depth_m"] for r in subset]),
        }

    detected = [r for r in records if r["detected"]]
    significance = [r["significance_sigma"] for r in records]
    return {
        "kind": "time_lapse",
        "runs": runs,
        "stations": plan.count,
        "bootstrap_samples": bootstrap,
        "mass_change_kg": mass_change,
        "interval_days": interval_days,
        "mass_change_rate_kg_per_year": mass_change / interval_days * 365.25,
        "truth": {"mass_change_kg": mass_change, "depth_m": start.depth_m,
                  "mass_before_kg": start.signed_mass_kg, "mass_after_kg": end_signed},
        "sigma_difference": sigma_diff,
        "sigma_difference_without_benchmarks": sigma_naive,
        "predicted_probability": _detection_probability(lam, q_threshold),
        "detection": wilson(len(detected), runs),
        "significance": {"median": float(np.median(significance)), "values": significance},
        "accuracy_all": accuracy(records),
        "accuracy_detected": accuracy(detected),
        "records": records,
        "note": ("Each survey re-incurs the clock set-up error; station-height errors cancel because the same "
                 "benchmarks are reoccupied. The body keeps its volume; its density contrast changes."),
    }


def run_study(config: ExperimentConfig, request: StudyRequest, progress: Progress | None = None,
              cancelled: Cancelled | None = None) -> dict[str, Any]:
    if request.kind == "repeat":
        return run_repeat(config, request.runs, progress, cancelled)
    if request.kind == "sweep":
        assert request.masses_kg is not None and request.depths_m is not None
        return run_sweep(config, request.masses_kg, request.depths_m, request.runs, progress, cancelled)
    assert request.mass_change_kg is not None and request.interval_days is not None
    return run_time_lapse(config, request.mass_change_kg, request.interval_days, request.runs, progress, cancelled)

