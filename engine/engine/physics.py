"""Forward gravity models.

Sign conventions
  * Gravitational potential Φ uses the physics convention (negative, increasing upward).
    A clock at higher Φ ticks faster: Δf/f₀ = (Φ_sensor − Φ_reference) / c².
  * Gravity values are magnitudes of the downward attraction; an excess mass below the
    sensor produces a positive gravity anomaly Δg.
  * Local frame: x east, y north, z up, z = 0 at the survey datum.
"""

from __future__ import annotations

import math

import numpy as np
from numpy.typing import NDArray

from . import constants as k
from .geometry import BodyGeometry

FloatArray = NDArray[np.float64]


# --------------------------------------------------------------------------- normal Earth field


def normal_gravity(latitude_deg: float, height_m: FloatArray, earth_model: str) -> FloatArray:
    """Normal gravity (m/s²) at ellipsoidal height ``height_m``."""
    h = np.asarray(height_m, dtype=np.float64)
    if earth_model == "spherical":
        r = k.EARTH_MEAN_RADIUS + h
        return k.EARTH_GM / (r * r)
    s2 = math.sin(math.radians(latitude_deg)) ** 2
    gamma0 = k.WGS84_GAMMA_E * (1.0 + k.WGS84_K * s2) / math.sqrt(1.0 - k.WGS84_E2 * s2)
    c1 = (2.0 / k.WGS84_A) * (1.0 + k.WGS84_F + k.WGS84_M - 2.0 * k.WGS84_F * s2)
    c2 = 3.0 / (k.WGS84_A * k.WGS84_A)
    return gamma0 * (1.0 - c1 * h + c2 * h * h)


def normal_potential(latitude_deg: float, height_m: FloatArray, earth_model: str) -> FloatArray:
    """Normal gravity potential Φ (m²/s², physics sign convention) at height ``height_m``."""
    h = np.asarray(height_m, dtype=np.float64)
    if earth_model == "spherical":
        return -k.EARTH_GM / (k.EARTH_MEAN_RADIUS + h)
    s2 = math.sin(math.radians(latitude_deg)) ** 2
    gamma0 = k.WGS84_GAMMA_E * (1.0 + k.WGS84_K * s2) / math.sqrt(1.0 - k.WGS84_E2 * s2)
    c1 = (2.0 / k.WGS84_A) * (1.0 + k.WGS84_F + k.WGS84_M - 2.0 * k.WGS84_F * s2)
    c2 = 3.0 / (k.WGS84_A * k.WGS84_A)
    # W(h) = U0 − ∫₀ʰ γ(h') dh'
    w = k.WGS84_U0 - gamma0 * (h - 0.5 * c1 * h * h + (c2 / 3.0) * h * h * h)
    return -w


# --------------------------------------------------------------------------- point mass


def point_mass_potential(
    mass: FloatArray | float, cx: FloatArray | float, cy: FloatArray | float, cz: FloatArray | float,
    px: FloatArray, py: FloatArray, pz: FloatArray,
) -> FloatArray:
    r = np.sqrt((px - cx) ** 2 + (py - cy) ** 2 + (pz - cz) ** 2)
    return -k.G * mass / r


def point_mass_gz(
    mass: FloatArray | float, cx: FloatArray | float, cy: FloatArray | float, cz: FloatArray | float,
    px: FloatArray, py: FloatArray, pz: FloatArray,
) -> FloatArray:
    dz = pz - cz
    r2 = (px - cx) ** 2 + (py - cy) ** 2 + dz * dz
    return k.G * mass * dz / (r2 * np.sqrt(r2))


# --------------------------------------------------------------------------- right rectangular prism
# Closed-form expressions (Nagy, Papp & Benedek 2000). X, Y, Z are vertex coordinates relative to the
# observation point. Z < 0 at every vertex because the prism lies strictly below the sensor, so the
# logarithms are evaluated in cancellation-free forms.


def _log_sum(a: FloatArray, r: FloatArray, other_sq: FloatArray) -> FloatArray:
    """ln(a + r) evaluated stably for negative ``a`` where other_sq = r² − a²."""
    with np.errstate(divide="ignore", invalid="ignore"):
        positive = np.log(a + r)
        negative = np.log(other_sq) - np.log(r - a)
    return np.where(a >= 0.0, positive, negative)


def _prism_corner_terms(px: FloatArray, py: FloatArray, pz: FloatArray, body: BodyGeometry):
    xs = (body.x_m - body.half_x_m, body.x_m + body.half_x_m)
    ys = (body.y_m - body.half_y_m, body.y_m + body.half_y_m)
    zs = (body.z_center_m - body.half_z_m, body.z_center_m + body.half_z_m)
    # Definite integral over each axis: +F at the upper limit, −F at the lower limit.
    for i, xv in enumerate(xs):
        for j, yv in enumerate(ys):
            for kk, zv in enumerate(zs):
                sign = (1.0 if i == 1 else -1.0) * (1.0 if j == 1 else -1.0) * (1.0 if kk == 1 else -1.0)
                yield sign, xv - px, yv - py, zv - pz


def prism_potential(px: FloatArray, py: FloatArray, pz: FloatArray, body: BodyGeometry) -> FloatArray:
    """Potential Φ (m²/s², negative for positive density) of a uniform prism."""
    total = np.zeros_like(px, dtype=np.float64)
    for sign, x, y, z in _prism_corner_terms(px, py, pz, body):
        x2, y2, z2 = x * x, y * y, z * z
        r = np.sqrt(x2 + y2 + z2)
        with np.errstate(divide="ignore", invalid="ignore"):
            t1 = np.where(x * y == 0.0, 0.0, x * y * _log_sum(z, r, x2 + y2))
            t2 = y * z * _log_sum(x, r, y2 + z2)
            t3 = z * x * _log_sum(y, r, x2 + z2)
            t4 = np.where(x == 0.0, 0.0, 0.5 * x2 * np.arctan(y * z / (x * r)))
            t5 = np.where(y == 0.0, 0.0, 0.5 * y2 * np.arctan(z * x / (y * r)))
            t6 = 0.5 * z2 * np.arctan(x * y / (z * r))
        total += sign * (t1 + t2 + t3 - t4 - t5 - t6)
    return -k.G * body.signed_density_kg_m3 * total


def prism_gz(px: FloatArray, py: FloatArray, pz: FloatArray, body: BodyGeometry) -> FloatArray:
    """Downward gravitational attraction (m/s²) of a uniform prism."""
    total = np.zeros_like(px, dtype=np.float64)
    for sign, x, y, z in _prism_corner_terms(px, py, pz, body):
        x2, y2, z2 = x * x, y * y, z * z
        r = np.sqrt(x2 + y2 + z2)
        term = (
            x * _log_sum(y, r, x2 + z2)
            + y * _log_sum(x, r, y2 + z2)
            - z * np.arctan(x * y / (z * r))
        )
        total += sign * term
    return k.G * body.signed_density_kg_m3 * total


# --------------------------------------------------------------------------- bodies


def body_potential(px: FloatArray, py: FloatArray, pz: FloatArray, body: BodyGeometry) -> FloatArray:
    if body.radius_m is not None:
        return point_mass_potential(body.signed_mass_kg, body.x_m, body.y_m, body.z_center_m, px, py, pz)
    return _prism_with_far_field(px, py, pz, body, prism_potential, point_mass_potential)


def body_gz(px: FloatArray, py: FloatArray, pz: FloatArray, body: BodyGeometry) -> FloatArray:
    if body.radius_m is not None:
        return point_mass_gz(body.signed_mass_kg, body.x_m, body.y_m, body.z_center_m, px, py, pz)
    return _prism_with_far_field(px, py, pz, body, prism_gz, point_mass_gz)


def _prism_with_far_field(px, py, pz, body, exact, point):
    """Closed form near the prism; monopole far away to avoid floating-point cancellation."""
    dist = np.sqrt((px - body.x_m) ** 2 + (py - body.y_m) ** 2 + (pz - body.z_center_m) ** 2)
    far = dist > k.PRISM_FAR_FIELD_RATIO * body.max_dimension_m
    out = np.empty_like(px, dtype=np.float64)
    if np.any(far):
        out[far] = point(body.signed_mass_kg, body.x_m, body.y_m, body.z_center_m, px[far], py[far], pz[far])
    near = ~far
    if np.any(near):
        out[near] = exact(px[near], py[near], pz[near], body)
    return out


def total_anomaly(
    px: FloatArray, py: FloatArray, pz: FloatArray, bodies: list[BodyGeometry]
) -> tuple[FloatArray, FloatArray]:
    """Anomalous potential Φₐ (m²/s²) and anomalous downward gravity Δg (m/s²) summed over bodies."""
    phi = np.zeros_like(px, dtype=np.float64)
    gz = np.zeros_like(px, dtype=np.float64)
    for body in bodies:
        phi += body_potential(px, py, pz, body)
        gz += body_gz(px, py, pz, body)
    return phi, gz
