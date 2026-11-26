"""Semantic configuration validation and derived quantities.

Field messages follow the same templates as the frontend validator so users see
consistent wording regardless of which layer rejected a value.
"""

from __future__ import annotations

import math
from datetime import date
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from . import constants as k
from .config import ExperimentConfig, SensorConfig
from .contract import field_spec, limits, performance_values, preset_by_id
from .geometry import bodies_overlap, body_geometry
from .physics import normal_gravity, total_anomaly
from .sensor import build_noise_model
from .survey import axis_count, grid_shape, ground_minimum, plan_survey, survey_area_axes, terrain_elevation
from .terrain import CoverageError

_SUPERSCRIPT = str.maketrans("-0123456789", "⁻⁰¹²³⁴⁵⁶⁷⁸⁹")
CAMPAIGN_WARNING_DAYS = 90
DATUM_WARNING_M = 25.0  # elevation model mean height vs site elevation
START_DATE_RANGE = (date(2000, 1, 1), date(2100, 12, 31))  # validity range of the analytical ephemerides


def format_limit(value: float) -> str:
    """Human-readable number for messages, e.g. 1 × 10⁶ or 0.1."""
    if value == 0:
        return "0"
    magnitude = abs(value)
    if magnitude >= 1e5 or magnitude < 1e-3:
        exponent = int(math.floor(math.log10(magnitude)))
        mantissa = value / 10**exponent
        mantissa_text = f"{mantissa:.3g}"
        exponent_text = str(exponent).translate(_SUPERSCRIPT)
        if mantissa_text == "1":
            return f"10{exponent_text}"
        if mantissa_text == "-1":
            return f"−10{exponent_text}"
        return f"{mantissa_text.replace('-', '−')} × 10{exponent_text}"
    text = f"{value:.6g}"
    return text.replace("-", "−")


def with_unit(value_text: str, unit: str) -> str:
    if not unit:
        return value_text
    if unit == "°":
        return f"{value_text}°"
    return f"{value_text} {unit}"


@dataclass
class ValidationReport:
    errors: list[dict[str, str]] = field(default_factory=list)
    warnings: list[dict[str, str]] = field(default_factory=list)
    derived: dict[str, Any] | None = None

    @property
    def valid(self) -> bool:
        return not self.errors

    def error(self, path: str, message: str) -> None:
        self.errors.append({"field": path, "message": message})

    def warn(self, path: str, message: str) -> None:
        self.warnings.append({"field": path, "message": message})

    def to_json(self) -> dict[str, Any]:
        return {"valid": self.valid, "errors": self.errors, "warnings": self.warnings, "derived": self.derived}


def _check_range(report: ValidationReport, path: str, value: float) -> bool:
    spec = field_spec(path)
    label, unit = spec["label"], spec.get("unit", "")
    if not math.isfinite(value):
        report.error(path, f"{label} must be a finite number.")
        return False
    if spec.get("integer") and value != int(value):
        report.error(path, f"{label} must be a whole number.")
        return False
    if spec.get("positive") and value <= 0:
        report.error(path, f"{label} must be greater than {with_unit('0', unit)}.")
        return False
    if value < spec["min"]:
        report.error(path, f"{label} must be at least {with_unit(format_limit(spec['min']), unit)}.")
        return False
    if value > spec["max"]:
        report.error(path, f"{label} must be at most {with_unit(format_limit(spec['max']), unit)}.")
        return False
    return True


def validate_config(config: ExperimentConfig) -> ValidationReport:
    report = ValidationReport()
    lim = limits()

    if not config.name.strip():
        report.error("name", "Experiment name is required.")

    env = config.environment
    for name in ("latitude_deg", "longitude_deg", "elevation_m", "terrain_relief_m", "terrain_density_kg_m3",
                 "terrain_density_assumed_kg_m3"):
        _check_range(report, f"environment.{name}", getattr(env, name))

    body_limits = lim["bodies"]
    if not body_limits["min_count"] <= len(config.bodies) <= body_limits["max_count"]:
        report.error(
            "bodies",
            f"Define between {body_limits['min_count']} and {body_limits['max_count']} subsurface bodies.",
        )
    ids = [b.id for b in config.bodies]
    if len(set(ids)) != len(ids):
        report.error("bodies", "Subsurface body identifiers must be unique.")

    bodies_ok = True
    for i, body in enumerate(config.bodies):
        for name in ("density_contrast_kg_m3", "mass_kg", "depth_m", "x_m", "y_m"):
            bodies_ok &= _check_range(report, f"bodies.{i}.{name}", getattr(body, name))

    terrain_ok = math.isfinite(env.terrain_relief_m) and env.terrain_relief_m >= 0
    if env.terrain == "dem":
        if env.terrain_model_id is None:
            report.error("environment.terrain_model_id", "Select an elevation model.")
            terrain_ok = False
    elif env.terrain_model_id is not None:
        report.error("environment.terrain_model_id",
                     "An elevation model is used only with the “Elevation model” terrain; clear it or change the terrain.")
        terrain_ok = False
    ground_low = 0.0
    if terrain_ok:
        try:
            ground_low = ground_minimum(env, config.survey)
        except CoverageError as exc:
            report.error("environment.terrain_model_id", str(exc))
            terrain_ok = False
    geometries = []
    if bodies_ok and terrain_ok:
        for i, body in enumerate(config.bodies):
            geom = body_geometry(body)
            geometries.append(geom)
            clearance = geom.z_center_m + geom.half_z_m  # elevation of the body top
            if clearance >= ground_low:
                required = geom.half_z_m - ground_low
                report.error(
                    f"bodies.{i}.depth_m",
                    "Body extends above the ground surface. "
                    f"Increase depth beyond {with_unit(format_limit(round(required, 1)), 'm')} or reduce the mass.",
                )
        for i in range(len(geometries)):
            for j in range(i + 1, len(geometries)):
                if bodies_overlap(geometries[i], geometries[j]):
                    report.error(f"bodies.{j}", f"Body {j + 1} overlaps body {i + 1}. Move or resize one of them.")

    sensor = config.sensor
    sensor_ok = True
    for name in ("reference_frequency_hz", "bbr_sensitivity_per_k", "measurement_interval_s", "stability_1s",
                 "systematic_uncertainty", "uptime_percent", "reference_distance_km"):
        sensor_ok &= _check_range(report, f"sensor.{name}", getattr(sensor, name))
    _check_performance(report, sensor)
    if sensor.clock_species != "custom":
        preset = preset_by_id(sensor.clock_species)
        if preset is None:
            report.error("sensor.clock_species", "Unknown clock species.")
        else:
            if math.isfinite(sensor.reference_frequency_hz) and not math.isclose(
                sensor.reference_frequency_hz, preset["reference_frequency_hz"], rel_tol=1e-12
            ):
                report.error(
                    "sensor.reference_frequency_hz",
                    "Reference frequency must match the selected clock species. Choose “Custom” to set it manually.",
                )
            if math.isfinite(sensor.bbr_sensitivity_per_k) and not math.isclose(
                sensor.bbr_sensitivity_per_k, preset["bbr_sensitivity_per_k"], rel_tol=1e-9
            ):
                report.error(
                    "sensor.bbr_sensitivity_per_k",
                    "Blackbody sensitivity must match the selected clock species. Choose “Custom” to set it manually.",
                )

    noise_ok = True
    for name in ("measurement_noise", "frequency_drift_per_hour", "environmental_noise",
                 "temperature_fluctuation_k", "vibration_m", "station_height_uncertainty_m", "tide_residual_percent",
                 "seed"):
        noise_ok &= _check_range(report, f"noise.{name}", float(getattr(config.noise, name)))

    survey = config.survey
    survey_ok = True
    for name in ("width_m", "length_m", "spacing_m", "sensor_height_m", "setup_time_s"):
        survey_ok &= _check_range(report, f"survey.{name}", getattr(survey, name))
    if not START_DATE_RANGE[0] <= survey.start_date <= START_DATE_RANGE[1]:
        report.error("survey.start_date",
                     f"Start date must be between {START_DATE_RANGE[0].isoformat()} and {START_DATE_RANGE[1].isoformat()}.")
    if survey_ok:
        min_axis = lim["survey"]["min_points_per_axis"]
        nx, ny = grid_shape(survey)
        if nx < min_axis:
            report.error(
                "survey.spacing_m",
                f"Resolution is too coarse: at least {min_axis} points are needed across the survey width. "
                f"Use a spacing of at most {with_unit(format_limit(survey.width_m / (min_axis - 1)), 'm')}.",
            )
            survey_ok = False
        elif survey.pattern != "profile" and ny < min_axis:
            report.error(
                "survey.spacing_m",
                f"Resolution is too coarse: at least {min_axis} points are needed along the survey length. "
                f"Use a spacing of at most {with_unit(format_limit(survey.length_m / (min_axis - 1)), 'm')}.",
            )
            survey_ok = False
        else:
            max_points = lim["survey"]["max_points"]
            count = nx * ny
            if count > max_points:
                minimum = _minimum_spacing(survey.width_m, survey.length_m if survey.pattern != "profile" else None,
                                           max_points)
                report.error(
                    "survey.spacing_m",
                    f"Survey would contain {count:,} measurement points; the maximum is {max_points:,}. "
                    f"Use a spacing of at least {with_unit(format_limit(minimum), 'm')}.".replace(",", " "),
                )
                survey_ok = False

    inversion = config.inversion
    _check_range(report, "inversion.source_count", float(inversion.source_count))
    _check_range(report, "inversion.bootstrap_samples", float(inversion.bootstrap_samples))

    if report.valid:
        report.derived = _derived(config)
        _warnings(config, report)
    return report


PERFORMANCE_FIELDS = (
    ("stability_1s", "Sensor stability"),
    ("systematic_uncertainty", "Systematic uncertainty"),
    ("uptime_percent", "Clock uptime"),
)


def _check_performance(report: ValidationReport, sensor: SensorConfig) -> None:
    """A named performance class fixes stability, systematic uncertainty and uptime to its published values."""
    if sensor.performance_class == "custom":
        return
    if sensor.clock_species == "custom":
        report.error("sensor.performance_class", "A custom clock needs custom performance values. Choose “Custom”.")
        return
    values = performance_values(sensor.clock_species, sensor.performance_class)
    if values is None:
        report.error("sensor.performance_class", "Unknown performance class for this clock species.")
        return
    for name, label in PERFORMANCE_FIELDS:
        value = getattr(sensor, name)
        if math.isfinite(value) and not math.isclose(value, values[name], rel_tol=1e-9, abs_tol=0.0):
            report.error(
                f"sensor.{name}",
                f"{label} must match the selected performance class. Choose “Custom” performance to set it manually.",
            )


def _minimum_spacing(width: float, length: float | None, max_points: int) -> float:
    spacing = math.sqrt(width * (length or width) / max_points) if length else width / (max_points - 1)
    spacing = max(spacing, 1.0)
    while True:
        count = axis_count(width, spacing) * (axis_count(length, spacing) if length else 1)
        if count <= max_points:
            return math.ceil(spacing * 10) / 10
        spacing *= 1.01


def _derived(config: ExperimentConfig) -> dict[str, Any]:
    plan = plan_survey(config.survey, config.environment, config.sensor)
    geometries = [body_geometry(b) for b in config.bodies]
    g_mean = float(np.mean(normal_gravity(config.environment.latitude_deg,
                                          config.environment.elevation_m + plan.z,
                                          config.environment.earth_model)))
    noise = build_noise_model(config, g_mean, plan.duration_s)

    # Forward-model estimate of the peak anomalous signal directly above each body.
    px = np.array([g.x_m for g in geometries])
    py = np.array([g.y_m for g in geometries])
    pz = np.full(px.size, config.survey.sensor_height_m)
    phi, dg = total_anomaly(px, py, pz, geometries)
    peak_idx = int(np.argmax(np.abs(phi)))
    peak_shift = float(phi[peak_idx] / k.C2)
    peak_dg = float(dg[int(np.argmax(np.abs(dg)))])

    return {
        "bodies": [
            {
                "id": g.id,
                "volume_m3": g.volume_m3,
                "signed_mass_kg": g.signed_mass_kg,
                "radius_m": g.radius_m,
                "size_x_m": 2 * g.half_x_m,
                "size_y_m": 2 * g.half_y_m,
                "size_z_m": 2 * g.half_z_m,
                "top_depth_m": g.top_depth_m,
            }
            for g in geometries
        ],
        "survey": {
            "nx": plan.nx,
            "ny": plan.ny,
            "point_count": plan.count,
            "duration_s": plan.duration_s,
            "path_length_m": float(plan.along_track_m[-1]),
        },
        "noise": {
            "white_sigma": noise.white_sigma,
            "environmental_sigma": noise.environmental_sigma,
            "nominal_sigma": noise.nominal_sigma,
        },
        "forward_estimate": {
            "peak_fractional_shift": peak_shift,
            "peak_gravity_anomaly_m_s2": peak_dg,
            "per_point_snr": abs(peak_shift) / noise.nominal_sigma if noise.nominal_sigma > 0 else None,
        },
    }


def _warnings(config: ExperimentConfig, report: ValidationReport) -> None:
    s = config.survey
    half_w, half_l = s.width_m / 2, s.length_m / 2
    for i, body in enumerate(config.bodies):
        outside = abs(body.x_m) > half_w or (s.pattern != "profile" and abs(body.y_m) > half_l)
        if s.pattern == "profile" and abs(body.y_m) > s.spacing_m:
            report.warn(f"bodies.{i}.y_m", "The profile runs along y = 0 m; this body is offset from the profile line.")
        if outside:
            report.warn(f"bodies.{i}", "The body centre lies outside the survey area; the anomaly will be poorly sampled.")
        if body.depth_m < s.spacing_m / 2:
            report.warn(
                f"bodies.{i}.depth_m",
                "The body is shallower than half the station spacing, so the survey cannot resolve its depth; "
                "reduce the spacing.",
            )
        if body.depth_m > max(half_w, half_l):
            report.warn(
                f"bodies.{i}.depth_m",
                "The body is deeper than half the survey extent; the anomaly may not decay within the survey area.",
            )
    performance = config.sensor.performance_class
    if performance == "laboratory":
        report.warn(
            "sensor.performance_class",
            "Laboratory performance has not yet been reached by a transportable clock; treat the result as a "
            "near-term projection.",
        )
    elif performance == "projected":
        report.warn(
            "sensor.performance_class",
            "Projected performance has not been demonstrated anywhere; treat the result as a feasibility study.",
        )
    env = config.environment
    if env.terrain == "dem":
        xs, ys = survey_area_axes(s)
        xx, yy = np.meshgrid(xs, ys)
        mean_height = float(np.mean(terrain_elevation(xx.ravel(), yy.ravel(), env, s))) + env.elevation_m
        if abs(mean_height - env.elevation_m) > DATUM_WARNING_M:
            report.warn(
                "environment.elevation_m",
                f"The elevation model's mean height over the survey area is {mean_height:.0f} m. Set the site "
                "elevation close to it: terrain mass is modelled between the site elevation and the ground.",
            )
    derived = report.derived
    if derived:
        days = derived["survey"]["duration_s"] / 86_400
        if days > CAMPAIGN_WARNING_DAYS:
            report.warn(
                "survey.spacing_m",
                f"The campaign would need about {days:,.0f} days of field time. Reported transportable-clock "
                "campaigns last days to weeks; use fewer stations or a shorter averaging time.".replace(",", " "),
            )
        snr = derived["forward_estimate"]["per_point_snr"]
        if snr is not None and snr < 1.0:
            report.warn(
                "noise",
                "Forward-model peak signal is below the per-measurement noise level; detection may not be possible.",
            )
