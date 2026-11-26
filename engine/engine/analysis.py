"""Signal processing, anomaly maps, uncertainty packaging and ground-truth comparison."""

from __future__ import annotations

import math
from typing import Any, Callable

import numpy as np
from scipy.ndimage import gaussian_filter, gaussian_filter1d
from scipy.optimize import linear_sum_assignment

from . import constants as k
from .config import ExperimentConfig
from .geometry import BodyGeometry
from .inversion import InversionInput, InversionResult, ParameterEstimate, invert, point_source_gravity
from .sensor import MeasurementSet
from .survey import SurveyPlan

HISTOGRAM_BINS = 30
PARAMETERS = (("mass_kg", "kg"), ("x_m", "m"), ("y_m", "m"), ("depth_m", "m"))


def _grid(plan: SurveyPlan, values: np.ndarray) -> list[list[float]]:
    grid = np.full((plan.ny, plan.nx), np.nan)
    grid[plan.grid_j, plan.grid_i] = values
    if not np.all(np.isfinite(grid)):
        raise ValueError("Anomaly map contains unfilled cells")
    return grid.tolist()


def _smooth(plan: SurveyPlan, values: np.ndarray) -> np.ndarray:
    if plan.ny > 1:
        grid = np.zeros((plan.ny, plan.nx))
        grid[plan.grid_j, plan.grid_i] = values
        return gaussian_filter(grid, sigma=1.0, mode="nearest")[plan.grid_j, plan.grid_i]
    order = np.argsort(plan.x)
    out = np.empty_like(values)
    out[order] = gaussian_filter1d(values[order], sigma=1.0, mode="nearest")
    return out


def _estimate_json(est: ParameterEstimate) -> dict[str, Any]:
    return {"estimate": est.estimate, "std_error": est.std_error}


def resolution_depth(config: ExperimentConfig) -> float:
    """Shallowest source depth the station spacing can resolve (half the spacing, at least 1 m)."""
    return max(1.0, config.survey.spacing_m / 2.0)


def inversion_input(config: ExperimentConfig, plan: SurveyPlan, data: np.ndarray,
                    nominal_sigma: float) -> InversionInput:
    """Observables handed to the inversion: station geometry, times, data and the instrument σ."""
    reference = (
        (plan.reference_x, plan.reference_y, plan.reference_z) if config.sensor.mode == "local_reference" else None
    )
    grid_ok = plan.ny > 1
    return InversionInput(
        x=plan.x, y=plan.y, z=plan.z, t=plan.timestamp_s, data=data, reference=reference,
        source_count=config.inversion.source_count,
        half_width=config.survey.width_m / 2.0,
        half_length=(config.survey.length_m if config.survey.pattern != "profile" else config.survey.width_m) / 2.0,
        grid_shape=(plan.ny, plan.nx) if grid_ok else None,
        grid_index=(plan.grid_j, plan.grid_i) if grid_ok else None,
        nominal_sigma=nominal_sigma,
        min_depth=resolution_depth(config),
    )


def run_inversion(
    config: ExperimentConfig,
    plan: SurveyPlan,
    meas: MeasurementSet,
    on_progress: Callable[[float], None] | None = None,
    should_cancel: Callable[[], bool] | None = None,
    on_bootstrap_start: Callable[[], None] | None = None,
) -> InversionResult:
    inp = inversion_input(config, plan, meas.columns["raw"] - meas.normal_correction,
                          meas.noise_model.nominal_sigma)
    return invert(inp, config.inversion.bootstrap_samples, config.noise.seed, on_progress, should_cancel,
                  on_bootstrap_start)


def _detection_json(scan: dict[str, Any]) -> dict[str, Any]:
    significance = scan.get("significance_sigma")
    return {
        "criterion_sigma": k.DETECTION_SIGMA,
        "method": "matched-filter scan with look-elsewhere correction",
        "description": (
            f"A buried point mass anywhere on the search grid improves the fit over offset and drift alone "
            f"by at least {k.DETECTION_SIGMA:g}σ, after correcting for the number of positions and depths searched"
        ),
        "anomaly_detected": bool(significance is not None and significance >= k.DETECTION_SIGMA),
        "significance_sigma": significance,
        "delta_chi_square": scan.get("statistic"),
        "effective_trials": scan.get("effective_trials"),
        "null_samples": scan.get("null_samples", 0),
        "null_exceedance": scan.get("null_exceedance"),
    }


def inversion_documents(inv: InversionResult, min_depth_m: float):
    """Inversion and uncertainty documents of a fit (shared by simulations and field datasets).

    Returns (sources, ordered source estimates, inversion document, uncertainty sources, uncertainty document);
    sources are ordered by |mass|, largest first, so "S1" is the dominant source.
    """
    sources_json = []
    for idx, s in enumerate(inv.sources):
        sigma_m = s.mass_kg.bootstrap_std if s.mass_kg.bootstrap_std is not None else s.mass_kg.std_error
        # How well the mass is constrained (not the detection test: mass trades off against depth).
        mass_significance = abs(s.mass_kg.estimate) / sigma_m if sigma_m and sigma_m > 0 else None
        sources_json.append({
            "id": f"S{idx + 1}",
            "mass_kg": _estimate_json(s.mass_kg),
            "x_m": _estimate_json(s.x_m),
            "y_m": _estimate_json(s.y_m),
            "depth_m": _estimate_json(s.depth_m),
            "mass_significance_sigma": mass_significance,
        })
    # Order sources by |mass| (largest first) so "S1" is the dominant source.
    order = sorted(range(len(sources_json)), key=lambda i: -abs(sources_json[i]["mass_kg"]["estimate"]))
    sources_json = [sources_json[i] for i in order]
    ordered_sources = [inv.sources[i] for i in order]
    for i, sj in enumerate(sources_json):
        sj["id"] = f"S{i + 1}"

    inversion_doc = {
        "model": "point masses + offset + linear drift",
        "source_count": len(sources_json),
        "sources": sources_json,
        "offset": _estimate_json(inv.offset),
        "drift_per_s": _estimate_json(inv.drift_per_s),
        "fit": {
            "converged": inv.converged,
            "message": inv.message,
            "evaluations": inv.evaluations,
            "n_points": inv.n_points,
            "n_parameters": inv.n_parameters,
            "residual_rms": inv.residual_rms,
            "reduced_chi_square": inv.reduced_chi_square,
            "covariance_available": inv.covariance_ok,
            "min_depth_m": min_depth_m,
        },
        "detection": _detection_json(inv.detection),
    }

    # ------------------------------------------------------------------ uncertainty
    uncertainty_sources = []
    for sj, s in zip(sources_json, ordered_sources):
        params = {}
        for name, unit in PARAMETERS:
            est: ParameterEstimate = getattr(s, name)
            histogram = None
            if est.samples is not None and est.samples.size >= 10:
                counts, edges = np.histogram(est.samples, bins=HISTOGRAM_BINS)
                histogram = {"bin_edges": edges.tolist(), "counts": counts.astype(int).tolist()}
            params[name] = {
                "unit": unit,
                "estimate": est.estimate,
                "std_error": est.std_error,
                "bootstrap_std": est.bootstrap_std,
                "ci_low": est.ci_low,
                "ci_high": est.ci_high,
                "histogram": histogram,
            }
        uncertainty_sources.append({"source_id": sj["id"], "parameters": params})
    uncertainty_doc = {
        "method": inv.bootstrap.get("method"),
        "confidence_level": inv.bootstrap.get("confidence_level"),
        "requested_samples": inv.bootstrap.get("requested_samples"),
        "samples_used": inv.bootstrap.get("samples_used"),
        "converged_samples": inv.bootstrap.get("converged_samples"),
        "block_length": inv.bootstrap.get("block_length"),
        "capped": inv.bootstrap.get("capped"),
        "sources": uncertainty_sources,
    }

    return sources_json, ordered_sources, inversion_doc, uncertainty_sources, uncertainty_doc


def build_results(
    config: ExperimentConfig,
    plan: SurveyPlan,
    meas: MeasurementSet,
    bodies: list[BodyGeometry],
    inv: InversionResult,
) -> dict[str, dict[str, Any]]:
    """Return the result documents keyed by section name."""
    corrected = meas.columns["raw"] - meas.normal_correction
    nuisance = inv.prediction - inv.source_signal
    drift_corrected = corrected - nuisance
    filtered = _smooth(plan, drift_corrected)
    residual = corrected - inv.prediction
    estimated_dg = point_source_gravity(inv.sources, plan.x, plan.y, plan.z)
    true_dg = meas.columns["gravity_anomaly_m_s2"]

    sources_json, ordered_sources, inversion_doc, uncertainty_sources, uncertainty_doc = inversion_documents(
        inv, resolution_depth(config))

    # ------------------------------------------------------------------ anomaly map
    if plan.ny > 1:
        map_doc: dict[str, Any] = {
            "available": True,
            "unavailable_reason": None,
            "nx": plan.nx,
            "ny": plan.ny,
            "x_m": plan.grid_x.tolist(),
            "y_m": plan.grid_y.tolist(),
            "layers": {
                "gravity_anomaly_true": _grid(plan, true_dg),
                "gravity_anomaly_estimated": _grid(plan, estimated_dg),
                "observed_shift": _grid(plan, corrected),
                "filtered_shift": _grid(plan, filtered),
                "residual": _grid(plan, residual),
                "raw": _grid(plan, meas.columns["raw"]),
                "fractional_shift": _grid(plan, meas.columns["fractional_shift"]),
            },
            "measurement_index": [[int(v) for v in row] for row in _grid(plan, meas.columns["index"])],
        }
    else:
        map_doc = {
            "available": False,
            "unavailable_reason": "A single profile has no second horizontal axis, so a 2D anomaly map cannot be "
                                  "formed without interpolation. Use a serpentine or raster survey for a map.",
            "nx": plan.nx, "ny": plan.ny, "x_m": plan.grid_x.tolist(), "y_m": plan.grid_y.tolist(), "layers": None,
            "measurement_index": None,
        }

    # ------------------------------------------------------------------ signals (aligned with measurement index)
    signals_doc = {
        "index": meas.columns["index"].astype(int).tolist(),
        "filtered": filtered.tolist(),
        "drift_corrected": drift_corrected.tolist(),
        "residual": residual.tolist(),
        "model_prediction": (inv.prediction + meas.normal_correction).tolist(),
        "estimated_gravity_anomaly_m_s2": estimated_dg.tolist(),
        "filter_description": "Offset and drift removed using the joint inversion; Gaussian smoothing with σ = 1 "
                              "sample spacing (display only; inversion uses unsmoothed data).",
    }

    # ------------------------------------------------------------------ ground truth + comparison
    truth = [
        {
            "id": b.id,
            "anomaly_type": b.anomaly_type,
            "geometry": b.geometry,
            "mass_kg": b.signed_mass_kg,
            "density_contrast_kg_m3": b.signed_density_kg_m3,
            "x_m": b.x_m,
            "y_m": b.y_m,
            "depth_m": b.depth_m,
            "top_depth_m": b.top_depth_m,
            "size_x_m": 2 * b.half_x_m,
            "size_y_m": 2 * b.half_y_m,
            "size_z_m": 2 * b.half_z_m,
        }
        for b in bodies
    ]
    comparison_doc = _compare(truth, sources_json, uncertainty_sources, meas, inv, estimated_dg, true_dg)

    noise_doc = {
        "components": [
            {"id": c.id, "label": c.label, "sigma": c.sigma, "kind": c.kind, "description": c.description}
            for c in meas.noise_model.components
        ],
        "white_sigma": meas.noise_model.white_sigma,
        "environmental_sigma": meas.noise_model.environmental_sigma,
        "nominal_sigma": meas.noise_model.nominal_sigma,
    }

    primary = sources_json[0]
    primary_unc = uncertainty_sources[0]["parameters"]
    summary_doc = {
        "anomaly_detected": inversion_doc["detection"]["anomaly_detected"],
        "detection_description": inversion_doc["detection"]["description"],
        "detection_significance_sigma": inversion_doc["detection"]["significance_sigma"],
        "primary_source": {
            "id": primary["id"],
            "mass_kg": primary["mass_kg"]["estimate"],
            "x_m": primary["x_m"]["estimate"],
            "y_m": primary["y_m"]["estimate"],
            "depth_m": primary["depth_m"]["estimate"],
            "depth_ci_low": primary_unc["depth_m"]["ci_low"],
            "depth_ci_high": primary_unc["depth_m"]["ci_high"],
            "mass_ci_low": primary_unc["mass_kg"]["ci_low"],
            "mass_ci_high": primary_unc["mass_kg"]["ci_high"],
            "mass_significance_sigma": primary["mass_significance_sigma"],
        },
        "peak_observed_deviation": float(np.max(np.abs(drift_corrected - np.median(drift_corrected)))),
        "measurement_count": meas.count,
    }

    return {
        "summary": summary_doc,
        "noise_budget": noise_doc,
        "inversion": inversion_doc,
        "uncertainty": uncertainty_doc,
        "anomaly_map": map_doc,
        "signals": signals_doc,
        "ground_truth": {"bodies": truth},
        "comparison": comparison_doc,
    }


def _compare(truth, sources_json, uncertainty_sources, meas: MeasurementSet, inv: InversionResult,
             estimated_dg: np.ndarray, true_dg: np.ndarray) -> dict[str, Any]:
    true_signal = meas.true_anomaly_signal
    field_rmse = float(np.sqrt(np.mean((inv.source_signal - true_signal) ** 2)))
    amplitude = float(np.max(true_signal) - np.min(true_signal))
    gravity_rmse = float(np.sqrt(np.mean((estimated_dg - true_dg) ** 2)))
    noise_rms = float(np.sqrt(np.mean(meas.columns["noise"] ** 2)))

    cost = np.zeros((len(truth), len(sources_json)))
    for i, t in enumerate(truth):
        for j, s in enumerate(sources_json):
            cost[i, j] = math.dist(
                (t["x_m"], t["y_m"], -t["depth_m"]),
                (s["x_m"]["estimate"], s["y_m"]["estimate"], -s["depth_m"]["estimate"]),
            )
    rows, cols = linear_sum_assignment(cost)
    matches = []
    for i, j in zip(rows, cols):
        t, s = truth[i], sources_json[j]
        unc = uncertainty_sources[j]["parameters"]

        def within(name: str, value: float) -> bool | None:
            low, high = unc[name]["ci_low"], unc[name]["ci_high"]
            if low is None or high is None:
                return None
            return bool(low <= value <= high)

        dx = s["x_m"]["estimate"] - t["x_m"]
        dy = s["y_m"]["estimate"] - t["y_m"]
        dd = s["depth_m"]["estimate"] - t["depth_m"]
        matches.append({
            "truth_id": t["id"],
            "source_id": s["id"],
            "depth_error_m": dd,
            "mass_error_percent": (s["mass_kg"]["estimate"] - t["mass_kg"]) / abs(t["mass_kg"]) * 100.0,
            "mass_error_kg": s["mass_kg"]["estimate"] - t["mass_kg"],
            "x_error_m": dx,
            "y_error_m": dy,
            "horizontal_error_m": math.hypot(dx, dy),
            "location_error_m": math.sqrt(dx * dx + dy * dy + dd * dd),
            "truth_within_ci": {
                "mass_kg": within("mass_kg", t["mass_kg"]),
                "x_m": within("x_m", t["x_m"]),
                "y_m": within("y_m", t["y_m"]),
                "depth_m": within("depth_m", t["depth_m"]),
            },
        })
    matched_truth = {m["truth_id"] for m in matches}
    matched_sources = {m["source_id"] for m in matches}
    return {
        "matching": "optimal assignment on 3D centre distance",
        "matches": matches,
        "unmatched_truth_ids": [t["id"] for t in truth if t["id"] not in matched_truth],
        "unmatched_source_ids": [s["id"] for s in sources_json if s["id"] not in matched_sources],
        "field_rmse_fractional": field_rmse,
        "field_rmse_relative": field_rmse / amplitude if amplitude > 0 else None,
        "gravity_rmse_m_s2": gravity_rmse,
        "signal_amplitude_fractional": amplitude,
        "noise_rms_fractional": noise_rms,
        "snr": amplitude / noise_rms if noise_rms > 0 else None,
        "snr_definition": "Peak-to-peak noise-free anomaly signal divided by the RMS of the injected noise",
    }
