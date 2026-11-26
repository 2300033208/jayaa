"""Site effects: the gravitational field of the terrain and the solid Earth tide.

Terrain: the ground between the survey datum and the terrain surface is a set of uniform prisms (a
TERRAIN_CELLS × TERRAIN_CELLS grid over the survey area; terrain outside the area is not included).
With an uploaded elevation model each prism takes the model's mean height over its cell.
Hills add mass, valleys remove it. For large surveys the field is evaluated on a lattice and
interpolated, as the terrain models here are smooth.

Tides: degree-2 tidal potential of the Moon and the Sun from low-precision analytical ephemerides
(Montenbruck & Gill, Satellite Orbits, 2000, §3.3.2; accuracy of a few arcminutes, ample for a
potential), on a spherical Earth. A clock on the deforming Earth sees (1 + k₂ − h₂) of the external
tidal potential. Each measurement is the average over its averaging window, so long averaging
suppresses the diurnal and semidiurnal tides.
"""

from __future__ import annotations

import math
from datetime import date, datetime, timezone

import numpy as np
from numpy.typing import NDArray
from scipy.interpolate import RegularGridInterpolator

from . import constants as k
from .config import EnvironmentConfig, SurveyConfig
from .geometry import BodyGeometry
from .physics import body_gz, body_potential
from .survey import terrain_elevation
from .terrain import block_mean_heights, require_grid

FloatArray = NDArray[np.float64]

TERRAIN_CELLS = 24
TERRAIN_LATTICE = 41  # lattice points per axis for interpolation on large surveys
TERRAIN_DIRECT_MAX_POINTS = 4000

LOVE_K2 = 0.298
LOVE_H2 = 0.604
TIDE_FACTOR = 1.0 + LOVE_K2 - LOVE_H2  # diminishing factor seen by a clock on the elastic Earth
GM_MOON = 4.902800066e12  # m³/s²
GM_SUN = 1.32712440018e20  # m³/s²
TIDE_WINDOW_SAMPLES = 16
J2000 = datetime(2000, 1, 1, 12, 0, 0, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------- terrain


def _terrain_prisms(env: EnvironmentConfig, survey: SurveyConfig, density: float) -> list[BodyGeometry]:
    width = survey.width_m
    length = survey.length_m if survey.pattern != "profile" else survey.width_m
    dx, dy = width / TERRAIN_CELLS, length / TERRAIN_CELLS
    xs = -width / 2 + dx * (np.arange(TERRAIN_CELLS) + 0.5)
    ys = -length / 2 + dy * (np.arange(TERRAIN_CELLS) + 0.5)
    xx, yy = np.meshgrid(xs, ys)
    if env.terrain == "dem":
        # Mean height of the elevation model over each cell, not the height at its centre.
        grid = require_grid(env.terrain_model_id)
        heights = block_mean_heights(grid, env.latitude_deg, env.longitude_deg, xx.ravel(), yy.ravel(), dx, dy)             - env.elevation_m
    else:
        heights = terrain_elevation(xx.ravel(), yy.ravel(), env, survey)
    prisms = []
    for x, y, h in zip(xx.ravel(), yy.ravel(), heights):
        if abs(h) < 1e-6:
            continue
        sign = 1.0 if h > 0 else -1.0  # a valley below the datum is missing rock
        volume = dx * dy * abs(h)
        prisms.append(BodyGeometry(
            id="terrain", geometry="cube", anomaly_type="dense" if sign > 0 else "cavity",
            signed_mass_kg=sign * density * volume, signed_density_kg_m3=sign * density, volume_m3=volume,
            x_m=float(x), y_m=float(y), z_center_m=float(h) / 2, depth_m=-float(h) / 2,
            half_x_m=dx / 2, half_y_m=dy / 2, half_z_m=abs(float(h)) / 2, radius_m=None,
        ))
    return prisms


def _terrain_direct(prisms: list[BodyGeometry], px: FloatArray, py: FloatArray, pz: FloatArray):
    phi = np.zeros_like(px, dtype=np.float64)
    gz = np.zeros_like(px, dtype=np.float64)
    for prism in prisms:
        phi += body_potential(px, py, pz, prism)
        gz += body_gz(px, py, pz, prism)
    return phi, gz


def terrain_field(env: EnvironmentConfig, survey: SurveyConfig, sensor_height: float, density: float,
                  px: FloatArray, py: FloatArray, pz: FloatArray) -> tuple[FloatArray, FloatArray]:
    """Potential (m²/s²) and downward gravity (m/s²) of the terrain mass at the given points."""
    zeros = np.zeros_like(px, dtype=np.float64)
    if density == 0.0 or env.terrain == "flat" or (env.terrain != "dem" and env.terrain_relief_m == 0.0):
        return zeros, zeros.copy()
    prisms = _terrain_prisms(env, survey, density)
    if px.size <= TERRAIN_DIRECT_MAX_POINTS:
        return _terrain_direct(prisms, px, py, pz)
    # Lattice at sensor height above the ground, interpolated to the stations.
    lx = np.linspace(px.min(), px.max(), TERRAIN_LATTICE)
    ly = np.linspace(py.min(), py.max(), TERRAIN_LATTICE) if np.ptp(py) > 0 else np.array([py[0], py[0] + 1.0])
    gx, gy = np.meshgrid(lx, ly, indexing="ij")
    gzv = terrain_elevation(gx.ravel(), gy.ravel(), env, survey) + sensor_height
    phi, gz = _terrain_direct(prisms, gx.ravel(), gy.ravel(), gzv)
    points = np.column_stack([px, py])
    shape = (lx.size, ly.size)
    phi_i = RegularGridInterpolator((lx, ly), phi.reshape(shape))(points)
    gz_i = RegularGridInterpolator((lx, ly), gz.reshape(shape))(points)
    return phi_i, gz_i


# ---------------------------------------------------------------------------- tides


def _sun_moon_equatorial(days: FloatArray) -> tuple[FloatArray, FloatArray]:
    """Geocentric equatorial (of date) positions in metres, shape (n, 3), for days since J2000."""
    t = days / 36525.0
    rad = math.pi / 180.0
    arcsec = rad / 3600.0
    eps = 23.43929111 * rad

    m_sun = (357.5256 + 35999.049 * t) * rad
    lam_sun = (282.9400 * rad) + m_sun + (6892.0 * np.sin(m_sun) + 72.0 * np.sin(2 * m_sun)) * arcsec
    r_sun = (149.619 - 2.499 * np.cos(m_sun) - 0.021 * np.cos(2 * m_sun)) * 1e9
    sun = np.column_stack([r_sun * np.cos(lam_sun), r_sun * np.sin(lam_sun), np.zeros_like(r_sun)])

    l0 = (218.31617 + 481267.88088 * t) * rad
    lm = (134.96292 + 477198.86753 * t) * rad
    ls = (357.52543 + 35999.04944 * t) * rad
    f = (93.27283 + 483202.01873 * t) * rad
    d = (297.85027 + 445267.11135 * t) * rad
    dlam = (22640 * np.sin(lm) + 769 * np.sin(2 * lm) - 4586 * np.sin(lm - 2 * d) + 2370 * np.sin(2 * d)
            - 668 * np.sin(ls) - 412 * np.sin(2 * f) - 212 * np.sin(2 * lm - 2 * d) - 206 * np.sin(lm + ls - 2 * d)
            + 192 * np.sin(lm + 2 * d) - 165 * np.sin(ls - 2 * d) + 148 * np.sin(lm - ls) - 125 * np.sin(d)
            - 110 * np.sin(lm + ls) - 55 * np.sin(2 * f - 2 * d)) * arcsec
    lam_moon = l0 + dlam
    beta = (18520 * np.sin(f + dlam + (412 * np.sin(2 * f) + 541 * np.sin(ls)) * arcsec)
            - 526 * np.sin(f - 2 * d) + 44 * np.sin(lm + f - 2 * d) - 31 * np.sin(-lm + f - 2 * d)
            - 25 * np.sin(-2 * lm + f) - 23 * np.sin(ls + f - 2 * d) + 21 * np.sin(-lm + f)
            + 11 * np.sin(-ls + f - 2 * d)) * arcsec
    r_moon = (385000 - 20905 * np.cos(lm) - 3699 * np.cos(2 * d - lm) - 2956 * np.cos(2 * d)
              - 570 * np.cos(2 * lm) + 246 * np.cos(2 * lm - 2 * d) - 205 * np.cos(ls - 2 * d)
              - 171 * np.cos(lm + 2 * d) - 152 * np.cos(lm + ls - 2 * d)) * 1e3
    moon = np.column_stack([r_moon * np.cos(beta) * np.cos(lam_moon), r_moon * np.cos(beta) * np.sin(lam_moon),
                            r_moon * np.sin(beta)])

    def to_equatorial(v: FloatArray) -> FloatArray:
        return np.column_stack([v[:, 0], v[:, 1] * math.cos(eps) - v[:, 2] * math.sin(eps),
                                v[:, 1] * math.sin(eps) + v[:, 2] * math.cos(eps)])

    return to_equatorial(sun), to_equatorial(moon)


def _station_unit(lat_deg: FloatArray, lon_deg: FloatArray, days: FloatArray) -> FloatArray:
    """Unit vector to the station in the equatorial (of date) frame, rotating with the Earth."""
    gmst = np.deg2rad((280.46061837 + 360.98564736629 * days) % 360.0)
    lat, lon = np.deg2rad(lat_deg), np.deg2rad(lon_deg) + gmst
    return np.column_stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)])


def tidal_potential(lat_deg: FloatArray, lon_deg: FloatArray, days: FloatArray) -> FloatArray:
    """Tidal potential Φ (m²/s², physics sign) seen by a clock on the elastic Earth: −(1+k₂−h₂)·V₂."""
    sun, moon = _sun_moon_equatorial(days)
    unit = _station_unit(lat_deg, lon_deg, days)
    r = k.EARTH_MEAN_RADIUS
    total = np.zeros(days.size)
    for body, gm in ((moon, GM_MOON), (sun, GM_SUN)):
        dist = np.linalg.norm(body, axis=1)
        cos_psi = np.sum(unit * body, axis=1) / dist
        total += gm * r * r / dist**3 * 0.5 * (3 * cos_psi**2 - 1)
    return -TIDE_FACTOR * total


def days_since_j2000(start: date, seconds: FloatArray) -> FloatArray:
    start_dt = datetime(start.year, start.month, start.day, tzinfo=timezone.utc)
    return (start_dt - J2000).total_seconds() / 86_400 + seconds / 86_400


def window_averaged_tide(lat_deg: FloatArray, lon_deg: FloatArray, start: date, mid_s: FloatArray,
                         window_s: float) -> FloatArray:
    """Tidal potential averaged over each measurement window [mid − w/2, mid + w/2]."""
    offsets = (np.arange(TIDE_WINDOW_SAMPLES) + 0.5) / TIDE_WINDOW_SAMPLES - 0.5
    total = np.zeros(mid_s.size)
    for off in offsets:
        total += tidal_potential(lat_deg, lon_deg, days_since_j2000(start, mid_s + off * window_s))
    return total / TIDE_WINDOW_SAMPLES


def local_offsets_to_latlon(lat0: float, lon0: float, x_m: FloatArray, y_m: FloatArray) -> tuple[FloatArray, FloatArray]:
    """Small east/north offsets (m) to latitude/longitude (degrees) on a sphere."""
    r = k.EARTH_MEAN_RADIUS
    lat = lat0 + np.rad2deg(y_m / r)
    lon = lon0 + np.rad2deg(x_m / (r * max(math.cos(math.radians(lat0)), 1e-6)))
    return lat, lon
