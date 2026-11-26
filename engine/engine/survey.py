"""Survey planning: measurement locations, terrain, path and timing."""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from . import constants as k
from .config import SurveyConfig, EnvironmentConfig, SensorConfig
from .geometry import terrain_min_elevation

FloatArray = NDArray[np.float64]
IntArray = NDArray[np.int64]


@dataclass(frozen=True)
class SurveyPlan:
    pattern: str
    nx: int
    ny: int
    grid_x: FloatArray  # unique x coordinates (nx)
    grid_y: FloatArray  # unique y coordinates (ny)
    x: FloatArray  # measurement order
    y: FloatArray
    z: FloatArray  # sensor elevation above datum
    ground_z: FloatArray  # ground elevation under the sensor
    grid_i: IntArray  # column index into grid_x
    grid_j: IntArray  # row index into grid_y
    line_index: IntArray
    along_track_m: FloatArray
    timestamp_s: FloatArray  # mid-integration time since survey start
    reference_x: float
    reference_y: float
    reference_z: float  # local datum elevation; for remote references this is unused

    @property
    def count(self) -> int:
        return int(self.x.size)

    @property
    def duration_s(self) -> float:
        return float(self.timestamp_s[-1]) if self.count else 0.0


def axis_count(extent_m: float, spacing_m: float) -> int:
    return int(math.floor(extent_m / spacing_m + 1e-9)) + 1


def grid_shape(survey: SurveyConfig) -> tuple[int, int]:
    nx = axis_count(survey.width_m, survey.spacing_m)
    ny = 1 if survey.pattern == "profile" else axis_count(survey.length_m, survey.spacing_m)
    return nx, ny


def _axis(n: int, spacing: float) -> FloatArray:
    span = (n - 1) * spacing
    return -span / 2.0 + spacing * np.arange(n, dtype=np.float64)


def terrain_elevation(x: FloatArray, y: FloatArray, env: EnvironmentConfig, survey: SurveyConfig) -> FloatArray:
    """Ground elevation relative to the datum (the site elevation). Synthetic terrains range over
    [−relief/2, +relief/2]; an elevation model gives its heights minus the site elevation."""
    if env.terrain == "dem":
        from .terrain import require_grid, sample_heights

        grid = require_grid(env.terrain_model_id)
        return sample_heights(grid, env.latitude_deg, env.longitude_deg, x, y) - env.elevation_m
    relief = env.terrain_relief_m
    if env.terrain == "flat" or relief == 0.0:
        return np.zeros_like(x, dtype=np.float64)
    if env.terrain == "slope":
        return relief * np.clip(x / survey.width_m, -0.5, 0.5)
    wavelength_x = survey.width_m / 1.5
    wavelength_y = survey.length_m / 1.5
    return 0.5 * relief * np.sin(2.0 * np.pi * x / wavelength_x) * np.cos(2.0 * np.pi * y / wavelength_y)


def survey_area_axes(survey: SurveyConfig, resolution: int = 41) -> tuple[FloatArray, FloatArray]:
    """Sample positions across the area the terrain model covers (a profile uses a width × width square)."""
    length = survey.length_m if survey.pattern != "profile" else survey.width_m
    return (np.linspace(-survey.width_m / 2.0, survey.width_m / 2.0, resolution),
            np.linspace(-length / 2.0, length / 2.0, resolution))


def ground_minimum(env: EnvironmentConfig, survey: SurveyConfig) -> float:
    """Lowest ground elevation relative to the datum over the survey area."""
    if env.terrain == "dem":
        xs, ys = survey_area_axes(survey)
        xx, yy = np.meshgrid(xs, ys)
        return float(np.min(terrain_elevation(xx.ravel(), yy.ravel(), env, survey)))
    return terrain_min_elevation(env.terrain, env.terrain_relief_m)


def plan_survey(survey: SurveyConfig, env: EnvironmentConfig, sensor: SensorConfig) -> SurveyPlan:
    nx, ny = grid_shape(survey)
    gx = _axis(nx, survey.spacing_m)
    gy = np.array([0.0]) if survey.pattern == "profile" else _axis(ny, survey.spacing_m)

    cols: list[IntArray] = []
    rows: list[IntArray] = []
    for j in range(ny):
        order = np.arange(nx, dtype=np.int64)
        if survey.pattern == "serpentine" and j % 2 == 1:
            order = order[::-1]
        cols.append(order)
        rows.append(np.full(nx, j, dtype=np.int64))
    gi = np.concatenate(cols)
    gj = np.concatenate(rows)
    x = gx[gi]
    y = gy[gj]
    ground = terrain_elevation(x, y, env, survey)
    z = ground + survey.sensor_height_m

    # Path length between consecutive points (raster surveys fly back to the start of each line).
    step = np.zeros(x.size, dtype=np.float64)
    if x.size > 1:
        step[1:] = np.sqrt(np.diff(x) ** 2 + np.diff(y) ** 2 + np.diff(z) ** 2)
    along = np.cumsum(step)
    transit_time = step / k.TRANSIT_SPEED_M_S
    # Each station: travel, re-establish clock operation (set-up), then average until τ seconds of
    # valid data have accumulated; with uptime below 100 % that takes τ / uptime of wall-clock time.
    # The timestamp is the middle of the averaging window.
    averaging_wall = sensor.measurement_interval_s * 100.0 / sensor.uptime_percent
    end_times = np.cumsum(transit_time + survey.setup_time_s + averaging_wall)
    timestamps = end_times - averaging_wall / 2.0

    return SurveyPlan(
        pattern=survey.pattern,
        nx=nx,
        ny=ny,
        grid_x=gx,
        grid_y=gy,
        x=x,
        y=y,
        z=z,
        ground_z=ground,
        grid_i=gi,
        grid_j=gj,
        line_index=gj.copy(),
        along_track_m=along,
        timestamp_s=timestamps,
        reference_x=float(x[0]),
        reference_y=float(y[0]),
        reference_z=float(z[0]),
    )


def terrain_grid(env: EnvironmentConfig, survey: SurveyConfig, resolution: int = 41) -> dict[str, list]:
    """Coarse ground-elevation grid for visualization."""
    xs = np.linspace(-survey.width_m / 2.0, survey.width_m / 2.0, resolution)
    ys = np.linspace(-survey.length_m / 2.0, survey.length_m / 2.0, resolution)
    xx, yy = np.meshgrid(xs, ys)
    zz = terrain_elevation(xx, yy, env, survey)
    return {"x_m": xs.tolist(), "y_m": ys.tolist(), "elevation_m": zz.tolist()}
