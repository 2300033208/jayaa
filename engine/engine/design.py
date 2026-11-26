"""Survey design assistant: which station spacing and averaging time detect a target within a time budget?

For every candidate design (stations per axis × averaging time) over the configured survey area, the
engine plans the campaign (duration from transport, set-up, averaging and uptime), builds the noise
model, and evaluates the probability that one campaign detects a point source of the target mass and
depth at the first body's position, using the same look-elsewhere-corrected detection test as a run.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from pydantic import BaseModel, ConfigDict, Field

from . import constants as k
from .analysis import inversion_input
from .config import ExperimentConfig
from .detectability import _significance_threshold_statistic
from .inversion import _Model, detection_grid, null_calibration, significance_from_statistic
from .physics import normal_gravity
from .sensor import build_noise_model
from .studies import _detection_probability
from .survey import grid_shape, plan_survey

STATIONS_PER_AXIS = (3, 4, 5, 6, 7, 9, 11, 13, 17, 21, 26, 33, 41)
AVERAGING_TIMES_S = (600.0, 1800.0, 3600.0, 10_800.0, 21_600.0, 43_200.0, 86_400.0)
TARGET_PROBABILITY = 0.9
MAX_STATIONS = 20_000


class DesignRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    config: ExperimentConfig
    target_mass_kg: float = Field(gt=0, le=1e15)
    target_depth_m: float = Field(gt=0, le=20_000)
    max_days: float = Field(gt=0, le=3650)


def design_survey(config: ExperimentConfig, target_mass: float, target_depth: float, max_days: float) -> dict[str, Any]:
    body = config.bodies[0]
    env = config.environment
    profile = config.survey.pattern == "profile"
    candidates = []
    for per_axis in STATIONS_PER_AXIS:
        spacing = config.survey.width_m / (per_axis - 1)
        cfg = config.model_copy(deep=True)
        cfg.survey.spacing_m = spacing
        nx, ny = grid_shape(cfg.survey)
        if nx * ny > MAX_STATIONS or (not profile and ny < 3):
            continue
        # Geometry-only quantities (search grid, look-elsewhere calibration) are shared by all averaging times.
        plan = plan_survey(cfg.survey, cfg.environment, cfg.sensor)
        inp = inversion_input(cfg, plan, np.zeros(plan.count), 1.0)
        grid = detection_grid(inp)
        trials, _ = null_calibration(grid, config.noise.seed)
        q_threshold = _significance_threshold_statistic(k.DETECTION_SIGMA, trials)
        r = np.sqrt((inp.x - body.x_m) ** 2 + (inp.y - body.y_m) ** 2 + (inp.z + target_depth) ** 2)
        unit = -k.G / r
        if inp.reference is not None:
            xr, yr, zr = inp.reference
            unit = unit + k.G / math.sqrt((xr - body.x_m) ** 2 + (yr - body.y_m) ** 2 + (zr + target_depth) ** 2)
        unit = unit / k.C2
        nuisance = _Model(inp, 1).tn
        basis, _ = np.linalg.qr(np.column_stack([np.ones_like(unit), nuisance]))
        projected = float(np.linalg.norm(unit - basis @ (basis.T @ unit)))
        for tau in AVERAGING_TIMES_S:
            cfg.sensor.measurement_interval_s = tau
            timed = plan_survey(cfg.survey, cfg.environment, cfg.sensor)
            g_mean = float(np.mean(normal_gravity(env.latitude_deg, env.elevation_m + timed.z, env.earth_model)))
            sigma = build_noise_model(cfg, g_mean, timed.duration_s).nominal_sigma
            lam = (target_mass * projected / sigma) ** 2 if sigma > 0 else 0.0
            days = timed.duration_s / 86_400
            candidates.append({
                "spacing_m": spacing,
                "stations": timed.count,
                "averaging_time_s": tau,
                "duration_days": days,
                "nominal_sigma": sigma,
                "expected_significance_sigma": significance_from_statistic(lam, trials),
                "detection_probability": _detection_probability(lam, q_threshold),
                "within_budget": days <= max_days,
                "resolves_depth": target_depth >= spacing / 2,
            })
    feasible = [c for c in candidates if c["within_budget"] and c["resolves_depth"]]
    reliable = [c for c in feasible if c["detection_probability"] >= TARGET_PROBABILITY]
    if reliable:
        best = min(reliable, key=lambda c: (c["duration_days"], -c["detection_probability"]))
        verdict = "reliable"
    elif feasible:
        best = max(feasible, key=lambda c: (c["detection_probability"], -c["duration_days"]))
        verdict = "best_within_budget"
    else:
        best = None
        verdict = "none_within_budget"
    return {
        "target": {"mass_kg": target_mass, "depth_m": target_depth, "x_m": body.x_m, "y_m": body.y_m},
        "max_days": max_days,
        "target_probability": TARGET_PROBABILITY,
        "threshold_sigma": k.DETECTION_SIGMA,
        "verdict": verdict,
        "recommended": best,
        "candidates": sorted(candidates, key=lambda c: (not c["within_budget"], -c["detection_probability"], c["duration_days"])),
        "assumptions": ("Survey area, clock, noise and logistics as configured; only station spacing and averaging "
                        "time vary. Detection probability is for one campaign and a point source at the first "
                        "body's position. Designs whose spacing cannot resolve the target depth are excluded."),
    }
