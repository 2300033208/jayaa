"""Detectability study: expected detection significance across source mass and depth.

For the configured site, survey, clock and noise, answers "which buried masses could this campaign
detect?" before any simulation is run. It uses the same detection test as a completed run (matched-
filter scan with the same look-elsewhere calibration), evaluated for a noise-free point source at the
position of the first configured body. The value reported is the median expected significance: noise
scatters individual runs around it by about ±1σ.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

from . import constants as k
from .analysis import inversion_input, resolution_depth
from .config import ExperimentConfig
from .inversion import _Model, _TrialGrid, null_calibration, significance_from_statistic
from .physics import normal_gravity
from .sensor import build_noise_model
from .survey import plan_survey

DEPTH_POINTS = 16
MASS_POINTS = 22
MASS_RANGE_KG = (1e8, 1e15)
MAX_DEPTH_M = 20_000.0
MIN_STUDY_DEPTH_M = 10.0


def _significance_threshold_statistic(threshold: float, trials: float) -> float:
    """Scan statistic at which the significance equals ``threshold`` (bisection; monotonic)."""
    low, high = 0.0, 1.0
    while significance_from_statistic(high, trials) < threshold:
        high *= 2.0
    for _ in range(80):
        mid = 0.5 * (low + high)
        if significance_from_statistic(mid, trials) < threshold:
            low = mid
        else:
            high = mid
    return high


def detectability(config: ExperimentConfig) -> dict[str, Any]:
    plan = plan_survey(config.survey, config.environment, config.sensor)
    env = config.environment
    g_mean = float(np.mean(normal_gravity(env.latitude_deg, env.elevation_m + plan.z, env.earth_model)))
    sigma = build_noise_model(config, g_mean, plan.duration_s).nominal_sigma
    inp = inversion_input(config, plan, np.zeros(plan.count), sigma)
    model = _Model(inp, 1)
    trials, _ = null_calibration(_TrialGrid(model, inp), config.noise.seed)
    threshold = k.DETECTION_SIGMA
    q_threshold = _significance_threshold_statistic(threshold, trials)

    nuisance, _ = np.linalg.qr(np.column_stack([np.ones_like(inp.x), model.tn]))
    body = config.bodies[0]

    def strength(depth: float) -> float:
        """Signal of 1 kg at the body position, after removing offset and drift, in units of σ."""
        r = np.sqrt((inp.x - body.x_m) ** 2 + (inp.y - body.y_m) ** 2 + (inp.z + depth) ** 2)
        unit = -k.G / r
        if inp.reference is not None:
            xr, yr, zr = inp.reference
            unit = unit + k.G / math.sqrt((xr - body.x_m) ** 2 + (yr - body.y_m) ** 2 + (zr + depth) ** 2)
        unit = unit / k.C2
        unit = unit - nuisance @ (nuisance.T @ unit)
        return float(np.linalg.norm(unit)) / sigma

    shallowest = max(resolution_depth(config), MIN_STUDY_DEPTH_M)
    depths = np.geomspace(shallowest, max(MAX_DEPTH_M, shallowest * 2), DEPTH_POINTS)
    masses = np.geomspace(*MASS_RANGE_KG, MASS_POINTS)
    rows, minimum = [], []
    for depth in depths:
        per_kg = strength(float(depth))
        rows.append([significance_from_statistic(float((m * per_kg) ** 2), trials) for m in masses])
        minimum.append(math.sqrt(q_threshold) / per_kg if per_kg > 0 else None)

    configured = []
    for b in config.bodies:
        per_kg = strength(b.depth_m) if b is body else None
        configured.append({
            "id": b.id,
            "mass_kg": abs(b.mass_kg),
            "depth_m": b.depth_m,
            "expected_significance_sigma": (
                significance_from_statistic(float((abs(b.mass_kg) * per_kg) ** 2), trials)
                if per_kg is not None else None
            ),
        })
    return {
        "threshold_sigma": threshold,
        "depths_m": depths.tolist(),
        "masses_kg": masses.tolist(),
        "significance_sigma": rows,
        "min_detectable_mass_kg": minimum,
        "position": {"x_m": body.x_m, "y_m": body.y_m},
        "resolution_depth_m": resolution_depth(config),
        "nominal_sigma": sigma,
        "station_count": plan.count,
        "effective_trials": trials,
        "bodies": configured,
        "assumptions": (
            "Point source at the position of the first body; median expected significance of the same "
            "look-elsewhere-corrected scan used for completed runs. Individual runs scatter by about ±1σ."
        ),
    }
