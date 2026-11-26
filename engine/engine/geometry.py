"""Body geometry derived from mass and density contrast.

Every body is specified by |mass| and |density contrast|; the volume follows as V = M/Δρ.
  sphere: radius r = (3V / 4π)^(1/3)
  cube:   side a = V^(1/3)
  slab:   tabular prism with width = length = 3h and thickness h, so V = 9h³
Coordinates: x east, y north, z up; z = 0 is the survey datum (mean ground surface).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .config import BodyConfig


@dataclass(frozen=True)
class BodyGeometry:
    id: str
    geometry: str
    anomaly_type: str
    signed_mass_kg: float
    signed_density_kg_m3: float
    volume_m3: float
    x_m: float
    y_m: float
    z_center_m: float  # elevation of the centre (negative below datum)
    depth_m: float
    half_x_m: float
    half_y_m: float
    half_z_m: float
    radius_m: float | None  # spheres only

    @property
    def top_depth_m(self) -> float:
        return self.depth_m - self.half_z_m

    @property
    def max_dimension_m(self) -> float:
        return 2.0 * max(self.half_x_m, self.half_y_m, self.half_z_m)


def body_geometry(body: BodyConfig) -> BodyGeometry:
    mass = abs(body.mass_kg)
    density = abs(body.density_contrast_kg_m3)
    volume = mass / density
    sign = 1.0 if body.anomaly_type == "dense" else -1.0
    radius: float | None = None
    if body.geometry == "sphere":
        radius = (3.0 * volume / (4.0 * math.pi)) ** (1.0 / 3.0)
        hx = hy = hz = radius
    elif body.geometry == "cube":
        side = volume ** (1.0 / 3.0)
        hx = hy = hz = side / 2.0
    else:  # slab
        thickness = (volume / 9.0) ** (1.0 / 3.0)
        hx = hy = 1.5 * thickness
        hz = thickness / 2.0
    return BodyGeometry(
        id=body.id,
        geometry=body.geometry,
        anomaly_type=body.anomaly_type,
        signed_mass_kg=sign * mass,
        signed_density_kg_m3=sign * density,
        volume_m3=volume,
        x_m=body.x_m,
        y_m=body.y_m,
        z_center_m=-body.depth_m,
        depth_m=body.depth_m,
        half_x_m=hx,
        half_y_m=hy,
        half_z_m=hz,
        radius_m=radius,
    )


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def bodies_overlap(a: BodyGeometry, b: BodyGeometry) -> bool:
    if a.radius_m is not None and b.radius_m is not None:
        dist = math.dist((a.x_m, a.y_m, a.z_center_m), (b.x_m, b.y_m, b.z_center_m))
        return dist < a.radius_m + b.radius_m
    if a.radius_m is None and b.radius_m is None:
        return (
            abs(a.x_m - b.x_m) < a.half_x_m + b.half_x_m
            and abs(a.y_m - b.y_m) < a.half_y_m + b.half_y_m
            and abs(a.z_center_m - b.z_center_m) < a.half_z_m + b.half_z_m
        )
    sphere, box = (a, b) if a.radius_m is not None else (b, a)
    assert sphere.radius_m is not None
    cx = _clamp(sphere.x_m, box.x_m - box.half_x_m, box.x_m + box.half_x_m)
    cy = _clamp(sphere.y_m, box.y_m - box.half_y_m, box.y_m + box.half_y_m)
    cz = _clamp(sphere.z_center_m, box.z_center_m - box.half_z_m, box.z_center_m + box.half_z_m)
    return math.dist((sphere.x_m, sphere.y_m, sphere.z_center_m), (cx, cy, cz)) < sphere.radius_m


def terrain_max_elevation(terrain: str, relief_m: float) -> float:
    """Highest ground elevation above the datum produced by the terrain model."""
    return 0.0 if terrain == "flat" else relief_m / 2.0


def terrain_min_elevation(terrain: str, relief_m: float) -> float:
    """Lowest ground elevation relative to the datum produced by the terrain model."""
    return 0.0 if terrain == "flat" else -relief_m / 2.0
