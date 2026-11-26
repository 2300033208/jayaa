"""Atomic-clock sensor model: gravitational redshift observable and noise realization."""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from . import constants as k
from .config import ExperimentConfig
from .geometry import BodyGeometry
from .physics import normal_gravity, normal_potential, total_anomaly
from .site import local_offsets_to_latlon, terrain_field, window_averaged_tide
from .survey import SurveyPlan

FloatArray = NDArray[np.float64]

LIVE_BASELINE_POINTS = 20
LIVE_MIN_POINTS = 5


@dataclass(frozen=True)
class NoiseComponent:
    id: str
    label: str
    sigma: float  # fractional frequency, per measurement
    kind: str  # "white" | "station" | "correlated" | "systematic"
    description: str


@dataclass(frozen=True)
class NoiseModel:
    components: list[NoiseComponent]
    # Root-sum-square of the components that are independent between stations: white noise
    # (averages down with τ) and per-station errors (fixed at each set-up, do not average down).
    white_sigma: float
    environmental_sigma: float  # effective correlated amplitude after common-mode rejection
    drift_per_s: float

    @property
    def nominal_sigma(self) -> float:
        return math.sqrt(self.white_sigma**2 + self.environmental_sigma**2)


def build_noise_model(config: ExperimentConfig, mean_gravity: float, survey_duration_s: float) -> NoiseModel:
    s, n = config.sensor, config.noise
    stability = s.stability_1s * math.sqrt(2.0) / math.sqrt(s.measurement_interval_s)
    thermal = s.bbr_sensitivity_per_k * n.temperature_fluctuation_k
    vibration = mean_gravity * n.vibration_m / k.C2
    station_height = mean_gravity * n.station_height_uncertainty_m / k.C2
    rejection = k.LOCAL_REFERENCE_COMMON_MODE_REJECTION if s.mode == "local_reference" else 0.0
    environmental = n.environmental_noise * (1.0 - rejection)
    drift_per_s = n.frequency_drift_per_hour / 3600.0
    white = math.sqrt(stability**2 + s.systematic_uncertainty**2 + n.measurement_noise**2 + thermal**2
                      + vibration**2 + station_height**2)
    components = [
        NoiseComponent("clock_instability", "Clock instability", stability, "white",
                       "Two-clock comparison: σ_y(1 s)·√2 / √τ"),
        NoiseComponent("clock_systematic", "Clock systematic (per set-up)", s.systematic_uncertainty, "station",
                       "Residual systematic shift after each set-up; independent between stations, "
                       "does not average down"),
        NoiseComponent("measurement", "Measurement noise", n.measurement_noise, "white",
                       "Additional white readout and link noise"),
        NoiseComponent("thermal", "Thermal (blackbody)", thermal, "white",
                       "Blackbody sensitivity × temperature fluctuation"),
        NoiseComponent("vibration", "Vibration", vibration, "white",
                       "Height jitter converted to potential: g·δz / c²"),
        NoiseComponent("station_height", "Station height", station_height, "station",
                       "Error in the known station height used for the normal-field correction: g·δh / c²"),
        NoiseComponent("environmental", "Environmental", environmental, "correlated",
                       f"Gauss–Markov process, correlation time {k.ENVIRONMENT_CORRELATION_TIME_S:.0f} s"
                       + (", 90 % common-mode rejection" if rejection > 0 else "")),
        NoiseComponent("drift", "Frequency drift (total over survey)", abs(drift_per_s) * survey_duration_s,
                       "systematic", "Linear clock drift accumulated over the survey"),
    ]
    return NoiseModel(components=components, white_sigma=white, environmental_sigma=environmental,
                      drift_per_s=drift_per_s)


@dataclass(frozen=True)
class MeasurementSet:
    """Columnar simulated measurements (one entry per survey point, in acquisition order)."""

    columns: dict[str, FloatArray]
    # Simulator-internal series: never exposed as observations.
    normal_correction: FloatArray  # (Φ_normal(p) − Φ_normal(ref)) / c², known to the analyst
    true_anomaly_signal: FloatArray  # (Φ_anomaly(p) − Φ_anomaly(ref)) / c², ground truth
    true_drift: FloatArray
    reference_anomaly_potential: float
    noise_model: NoiseModel

    @property
    def count(self) -> int:
        return int(self.columns["index"].size)


def _gauss_markov(rng: np.random.Generator, t: FloatArray, sigma: float, tau_c: float) -> FloatArray:
    out = np.zeros(t.size, dtype=np.float64)
    if sigma == 0.0 or t.size == 0:
        return out
    xi = rng.standard_normal(t.size)
    out[0] = sigma * xi[0]
    rho = np.exp(-np.diff(t) / tau_c)
    scale = sigma * np.sqrt(1.0 - rho * rho)
    for i in range(1, t.size):
        out[i] = rho[i - 1] * out[i - 1] + scale[i - 1] * xi[i]
    return out


def simulate_measurements(config: ExperimentConfig, plan: SurveyPlan, bodies: list[BodyGeometry],
                          station_seed: int | None = None) -> MeasurementSet:
    """Simulate one survey. ``station_seed`` fixes the station-height errors independently of the other
    noise: repeat surveys of the same benchmarks share them (time-lapse), while every set-up gets a new
    clock systematic."""
    env, sensor = config.environment, config.sensor
    lat, model = env.latitude_deg, env.earth_model

    h_abs = env.elevation_m + plan.z
    phi_normal = normal_potential(lat, h_abs, model)
    g_normal = normal_gravity(lat, h_abs, model)
    phi_anom, dg = total_anomaly(plan.x, plan.y, plan.z, bodies)

    local = sensor.mode == "local_reference"
    if local:
        ref = (np.array([plan.reference_x]), np.array([plan.reference_y]), np.array([plan.reference_z]))
        phi_ref_normal = float(normal_potential(lat, np.array([env.elevation_m + plan.reference_z]), model)[0])
        phi_ref_anom = float(total_anomaly(*ref, bodies)[0][0])
        ref_lat, ref_lon = local_offsets_to_latlon(lat, env.longitude_deg, ref[0], ref[1])
    else:
        # Remote reference on the reference surface, the given distance due north (fibre-linked lab).
        ref_lat_deg = lat + math.degrees(sensor.reference_distance_km * 1000.0 / k.EARTH_MEAN_RADIUS)
        phi_ref_normal = float(normal_potential(ref_lat_deg, np.array([0.0]), model)[0])
        phi_ref_anom = 0.0
        ref_lat, ref_lon = np.array([ref_lat_deg]), np.array([env.longitude_deg])

    # Site effects. The truth uses the true terrain density and the full tide (body tide plus the
    # unmodelled loading residual); the analyst's correction uses the assumed density and the tide model.
    site_truth = np.zeros(plan.count)
    site_model = np.zeros(plan.count)
    terrain_gz = np.zeros(plan.count)
    terrain_residual = np.zeros(plan.count)
    if env.terrain_density_kg_m3 > 0.0 or env.terrain_density_assumed_kg_m3 > 0.0:
        h_sensor = config.survey.sensor_height_m
        phi_t, terrain_gz = terrain_field(env, config.survey, h_sensor, env.terrain_density_kg_m3, plan.x, plan.y, plan.z)
        phi_m, _ = terrain_field(env, config.survey, h_sensor, env.terrain_density_assumed_kg_m3, plan.x, plan.y, plan.z)
        if local:
            phi_t = phi_t - terrain_field(env, config.survey, h_sensor, env.terrain_density_kg_m3, *ref)[0][0]
            phi_m = phi_m - terrain_field(env, config.survey, h_sensor, env.terrain_density_assumed_kg_m3, *ref)[0][0]
        site_truth += phi_t
        site_model += phi_m
        terrain_residual = phi_t - phi_m
    tide_residual = np.zeros(plan.count)
    if env.tides == "modelled":
        window = sensor.measurement_interval_s * 100.0 / sensor.uptime_percent
        st_lat, st_lon = local_offsets_to_latlon(lat, env.longitude_deg, plan.x, plan.y)
        start = config.survey.start_date
        tide_station = window_averaged_tide(st_lat, st_lon, start, plan.timestamp_s, window)
        tide_ref = window_averaged_tide(np.full(plan.count, ref_lat[0]), np.full(plan.count, ref_lon[0]), start,
                                        plan.timestamp_s, window)
        tide_model = tide_station - tide_ref
        tide_residual = tide_model * config.noise.tide_residual_percent / 100.0
        site_truth += tide_model + tide_residual
        site_model += tide_model

    delta_phi = (phi_normal - phi_ref_normal) + (phi_anom - phi_ref_anom) + site_truth
    y_grav = delta_phi / k.C2
    # Everything the analyst can compute: normal field, modelled terrain and modelled tide.
    normal_correction = ((phi_normal - phi_ref_normal) + site_model) / k.C2
    true_anomaly = (phi_anom - phi_ref_anom) / k.C2

    noise_model = build_noise_model(config, float(np.mean(g_normal)), plan.duration_s)
    # Site residuals are deterministic for a given site and date, not instrument noise: they are listed in
    # the budget (RMS over the survey) but do not enter the instrument σ used by the detection test.
    site_components = []
    if env.terrain_density_kg_m3 > 0.0 or env.terrain_density_assumed_kg_m3 > 0.0:
        rms = float(np.std(terrain_residual)) / k.C2
        site_components.append(NoiseComponent(
            "terrain_residual", "Terrain correction residual", rms, "systematic",
            "Terrain mass at the true density minus the analyst's assumed density (RMS over the survey)"))
    if env.tides == "modelled":
        rms = float(np.std(tide_residual)) / k.C2
        site_components.append(NoiseComponent(
            "tide_residual", "Tide residual", rms, "correlated",
            "Unmodelled ocean and atmospheric loading, proportional to the body tide (RMS over the survey)"))
    if site_components:
        noise_model = NoiseModel(components=[*noise_model.components, *site_components],
                                 white_sigma=noise_model.white_sigma,
                                 environmental_sigma=noise_model.environmental_sigma,
                                 drift_per_s=noise_model.drift_per_s)
    # Child streams are indexed, so adding streams leaves earlier realizations unchanged.
    seeds = np.random.SeedSequence(config.noise.seed).spawn(7)
    streams = [np.random.default_rng(s) for s in seeds]
    height_stream = streams[6] if station_seed is None else np.random.default_rng(
        np.random.SeedSequence([station_seed, 6]))
    n_pts = plan.count
    by_id = {c.id: c.sigma for c in noise_model.components}
    white = (
        by_id["clock_instability"] * streams[0].standard_normal(n_pts)
        + by_id["measurement"] * streams[1].standard_normal(n_pts)
        + by_id["thermal"] * streams[2].standard_normal(n_pts)
        + by_id["vibration"] * streams[3].standard_normal(n_pts)
        + by_id["clock_systematic"] * streams[5].standard_normal(n_pts)
        + by_id["station_height"] * height_stream.standard_normal(n_pts)
    )
    environmental = _gauss_markov(streams[4], plan.timestamp_s, noise_model.environmental_sigma,
                                  k.ENVIRONMENT_CORRELATION_TIME_S)
    drift = noise_model.drift_per_s * plan.timestamp_s
    stochastic = white + environmental
    y_raw = y_grav + stochastic + drift

    # Causal quick-look deviation used only for live display: baseline from the first points,
    # scaled by the nominal sensor noise (instrument specification, not ground truth).
    live = y_raw - normal_correction
    z_score = np.full(n_pts, np.nan)
    nominal = noise_model.nominal_sigma
    if nominal > 0.0:
        fixed_baseline = None
        for i in range(n_pts):
            if i + 1 < LIVE_MIN_POINTS:
                continue
            if i < LIVE_BASELINE_POINTS:
                baseline = float(np.median(live[: i + 1]))
            else:
                if fixed_baseline is None:
                    fixed_baseline = float(np.median(live[:LIVE_BASELINE_POINTS]))
                baseline = fixed_baseline
            z_score[i] = (live[i] - baseline) / nominal

    f0 = sensor.reference_frequency_hz
    columns = {
        "index": np.arange(n_pts, dtype=np.float64),
        "timestamp_s": plan.timestamp_s,
        "x_m": plan.x,
        "y_m": plan.y,
        "z_m": plan.z,
        "along_track_m": plan.along_track_m,
        "line_index": plan.line_index.astype(np.float64),
        "potential_m2_s2": delta_phi,
        "gravity_m_s2": g_normal + dg + terrain_gz,
        "gravity_anomaly_m_s2": dg,
        "fractional_shift": y_grav,
        "absolute_shift_hz": f0 * y_grav,
        "ai_phase_rad": k.AI_K_EFF * dg * k.AI_PULSE_SEPARATION_S**2,
        "raw": y_raw,
        "noise": stochastic,
        "z_score": z_score,
    }
    return MeasurementSet(
        columns=columns,
        normal_correction=normal_correction,
        true_anomaly_signal=true_anomaly,
        true_drift=drift,
        reference_anomaly_potential=phi_ref_anom,
        noise_model=noise_model,
    )
