"""Typed experiment configuration (wire format: snake_case JSON)."""

from __future__ import annotations

import hashlib
import json
from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

EarthModel = Literal["wgs84", "spherical"]
Terrain = Literal["flat", "slope", "hills", "dem"]
Tides = Literal["off", "modelled"]
AnomalyType = Literal["dense", "cavity"]
Geometry = Literal["sphere", "cube", "slab"]
SensorMode = Literal["local_reference", "remote_reference"]
ClockSpecies = Literal["sr", "yb", "al_ion", "cs", "custom"]
PerformanceClass = Literal["field", "laboratory", "projected", "custom"]
ScanPattern = Literal["serpentine", "raster", "profile"]
Playback = Literal["normal", "fast", "instant"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class EnvironmentConfig(_Strict):
    earth_model: EarthModel
    latitude_deg: float
    longitude_deg: float
    elevation_m: float
    terrain: Terrain
    terrain_relief_m: float  # synthetic terrains only
    terrain_model_id: str | None = Field(pattern=r"^[0-9a-f]{32}$")  # uploaded elevation model ("dem" terrain)
    terrain_density_kg_m3: float  # true rock density of the terrain (0: terrain mass not modelled)
    terrain_density_assumed_kg_m3: float  # density the analyst assumes in the terrain correction
    tides: Tides


class BodyConfig(_Strict):
    id: str = Field(min_length=1, max_length=64)
    anomaly_type: AnomalyType
    geometry: Geometry
    density_contrast_kg_m3: float
    mass_kg: float
    depth_m: float
    x_m: float
    y_m: float


class SensorConfig(_Strict):
    mode: SensorMode
    clock_species: ClockSpecies
    performance_class: PerformanceClass
    reference_frequency_hz: float
    bbr_sensitivity_per_k: float
    measurement_interval_s: float  # clock-comparison averaging time per station (clock running)
    stability_1s: float
    systematic_uncertainty: float  # residual systematic shift incurred at every station set-up
    uptime_percent: float
    reference_distance_km: float  # remote reference only: distance (due north) to the reference clock


class NoiseConfig(_Strict):
    measurement_noise: float
    frequency_drift_per_hour: float
    environmental_noise: float
    temperature_fluctuation_k: float
    vibration_m: float
    station_height_uncertainty_m: float
    tide_residual_percent: float  # unmodelled loading, as a fraction of the solid-Earth tide
    seed: int


class SurveyConfig(_Strict):
    width_m: float
    length_m: float
    spacing_m: float
    sensor_height_m: float
    setup_time_s: float  # transport excluded: re-establishing clock operation at each station
    start_date: date  # UTC date the campaign starts (sets the tides)
    pattern: ScanPattern


class InversionConfig(_Strict):
    source_count: int
    bootstrap_samples: int


class ExperimentConfig(_Strict):
    name: str = Field(max_length=120)
    environment: EnvironmentConfig
    bodies: list[BodyConfig]
    sensor: SensorConfig
    noise: NoiseConfig
    survey: SurveyConfig
    inversion: InversionConfig


def configuration_hash(config: ExperimentConfig) -> str:
    """SHA-256 over the scientific configuration. The experiment name is excluded."""
    payload = config.model_dump(mode="json", exclude={"name"})
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
