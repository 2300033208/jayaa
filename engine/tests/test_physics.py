import math

import numpy as np
import pytest

from engine import constants as k
from engine.config import BodyConfig
from engine.geometry import BodyGeometry, bodies_overlap, body_geometry
from engine.physics import (
    body_gz,
    body_potential,
    normal_gravity,
    normal_potential,
    prism_gz,
    prism_potential,
)


def _prism(**overrides):
    base = dict(id="p", geometry="cube", anomaly_type="dense", signed_mass_kg=1000.0 * 200 * 100 * 50,
                signed_density_kg_m3=1000.0, volume_m3=200 * 100 * 50, x_m=30.0, y_m=-20.0, z_center_m=-120.0,
                depth_m=120.0, half_x_m=100.0, half_y_m=50.0, half_z_m=25.0, radius_m=None)
    base.update(overrides)
    return BodyGeometry(**base)


def _quadrature(body, px, py, pz, n=48):
    xg, wg = np.polynomial.legendre.leggauss(n)
    X = body.x_m + body.half_x_m * xg
    Y = body.y_m + body.half_y_m * xg
    Z = body.z_center_m + body.half_z_m * xg
    W = np.einsum("i,j,k->ijk", wg, wg, wg) * body.half_x_m * body.half_y_m * body.half_z_m
    XX, YY, ZZ = np.meshgrid(X, Y, Z, indexing="ij")
    phi, gz = [], []
    for x, y, z in zip(px, py, pz):
        r = np.sqrt((XX - x) ** 2 + (YY - y) ** 2 + (ZZ - z) ** 2)
        phi.append(-k.G * body.signed_density_kg_m3 * np.sum(W / r))
        gz.append(k.G * body.signed_density_kg_m3 * np.sum(W * (z - ZZ) / r**3))
    return np.array(phi), np.array(gz)


def test_prism_closed_form_matches_quadrature():
    body = _prism()
    px = np.array([0.0, 30.0, 130.0, 500.0, -70.0])
    py = np.array([0.0, -20.0, 30.0, 0.0, -70.0])
    pz = np.array([2.0, 2.0, 2.0, 50.0, 0.5])  # includes a point above a vertical edge
    phi, gz = _quadrature(body, px, py, pz)
    np.testing.assert_allclose(prism_potential(px, py, pz, body), phi, rtol=1e-6)
    np.testing.assert_allclose(prism_gz(px, py, pz, body), gz, rtol=1e-6)


def test_prism_far_field_switch_is_continuous():
    body = _prism(half_x_m=5.0, half_y_m=5.0, half_z_m=5.0, signed_mass_kg=1000.0 * 1000, volume_m3=1000.0)
    limit = k.PRISM_FAR_FIELD_RATIO * body.max_dimension_m
    px = np.array([body.x_m + limit * 0.999, body.x_m + limit * 1.001])
    py = np.array([body.y_m, body.y_m])
    pz = np.array([0.0, 0.0])
    phi = body_potential(px, py, pz, body)
    assert phi[0] == pytest.approx(phi[1], rel=5e-3)
    gz = body_gz(px, py, pz, body)
    assert gz[0] == pytest.approx(gz[1], rel=5e-3)


def test_sphere_is_point_mass_and_signs():
    body = body_geometry(BodyConfig(id="s", anomaly_type="dense", geometry="sphere",
                                    density_contrast_kg_m3=2000, mass_kg=1e10, depth_m=200, x_m=0, y_m=0))
    px, py, pz = np.array([0.0]), np.array([0.0]), np.array([0.0])
    assert body_potential(px, py, pz, body)[0] == pytest.approx(-k.G * 1e10 / 200)
    assert body_gz(px, py, pz, body)[0] == pytest.approx(k.G * 1e10 / 200**2)
    cavity = body_geometry(BodyConfig(id="c", anomaly_type="cavity", geometry="sphere",
                                      density_contrast_kg_m3=2000, mass_kg=1e10, depth_m=200, x_m=0, y_m=0))
    assert body_gz(px, py, pz, cavity)[0] < 0
    assert body_potential(px, py, pz, cavity)[0] > 0


def test_wgs84_normal_gravity_reference_values():
    assert float(normal_gravity(0.0, np.array(0.0), "wgs84")) == pytest.approx(9.7803253359, abs=1e-9)
    assert float(normal_gravity(90.0, np.array(0.0), "wgs84")) == pytest.approx(9.8321849378, abs=1e-8)
    # Free-air gradient ≈ −3.086 × 10⁻⁶ s⁻²
    g0 = float(normal_gravity(45.0, np.array(0.0), "wgs84"))
    g1 = float(normal_gravity(45.0, np.array(100.0), "wgs84"))
    assert (g1 - g0) / 100.0 == pytest.approx(-3.086e-6, rel=5e-3)


@pytest.mark.parametrize("model", ["wgs84", "spherical"])
def test_potential_gradient_matches_gravity(model):
    h = np.array([500.0, 500.1])
    phi = normal_potential(30.0, h, model)
    g = float(normal_gravity(30.0, np.array(500.05), model))
    assert (phi[1] - phi[0]) / 0.1 == pytest.approx(g, rel=1e-6)


def test_redshift_scale_one_centimetre():
    # g·Δh/c² for Δh = 1 cm ≈ 1.09 × 10⁻¹⁸
    phi = normal_potential(45.0, np.array([0.0, 0.01]), "wgs84")
    assert (phi[1] - phi[0]) / k.C2 == pytest.approx(1.09e-18, rel=0.01)


def test_body_overlap_detection():
    def sphere(x, depth, mass=1e10):
        return body_geometry(BodyConfig(id=f"s{x}", anomaly_type="dense", geometry="sphere",
                                        density_contrast_kg_m3=1000, mass_kg=mass, depth_m=depth, x_m=x, y_m=0))

    def cube(x, depth, mass=1e10):
        return body_geometry(BodyConfig(id=f"c{x}", anomaly_type="dense", geometry="cube",
                                        density_contrast_kg_m3=1000, mass_kg=mass, depth_m=depth, x_m=x, y_m=0))

    r = sphere(0, 500).radius_m
    assert r is not None
    assert bodies_overlap(sphere(0, 500), sphere(1.5 * r, 500))
    assert not bodies_overlap(sphere(0, 500), sphere(2.1 * r, 500))
    side = cube(0, 500).half_x_m * 2
    assert bodies_overlap(cube(0, 500), cube(side * 0.9, 500))
    assert not bodies_overlap(cube(0, 500), cube(side * 1.1, 500))
    assert bodies_overlap(sphere(0, 500), cube(r + side / 2 - 1, 500))
    assert not bodies_overlap(sphere(0, 500), cube(r + side / 2 + 1, 500))


def test_slab_volume():
    g = body_geometry(BodyConfig(id="t", anomaly_type="dense", geometry="slab",
                                 density_contrast_kg_m3=1000, mass_kg=9e9, depth_m=500, x_m=0, y_m=0))
    thickness = 2 * g.half_z_m
    assert thickness == pytest.approx(100.0)
    assert (2 * g.half_x_m) * (2 * g.half_y_m) * thickness == pytest.approx(9e6)
    assert math.isclose(g.top_depth_m, 450.0)
