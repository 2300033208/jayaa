"""Site physics: solid Earth tide and terrain mass, checked against independent expectations."""

from datetime import date

import numpy as np
import pytest
from conftest import scenario_config

from engine import constants as k
from engine.config import ExperimentConfig
from engine.geometry import body_geometry
from engine.sensor import simulate_measurements
from engine.site import TIDE_FACTOR, _terrain_prisms, tidal_potential, days_since_j2000, terrain_field, window_averaged_tide
from engine.survey import plan_survey


def _hourly(days: int, lat: float = 0.0):
    t = np.arange(days * 24) * 3600.0
    d = days_since_j2000(date(2027, 3, 1), t)
    return t, tidal_potential(np.full(t.size, lat), np.full(t.size, 0.0), d)


def test_tide_has_the_lunar_semidiurnal_period_and_expected_size():
    _, phi = _hourly(60, lat=0.0)
    spectrum = np.abs(np.fft.rfft(phi - phi.mean()))
    freqs = np.fft.rfftfreq(phi.size, d=1.0)  # cycles per hour
    period_h = 1.0 / freqs[np.argmax(spectrum[1:]) + 1]
    assert period_h == pytest.approx(12.42, abs=0.15)  # M2
    # Equatorial body tide: external potential up to about 3.9 m²/s² (Moon) plus 1.8 m²/s² (Sun), scaled by 1+k−h.
    assert 0.5 * np.ptp(phi) == pytest.approx(TIDE_FACTOR * 4.5, rel=0.35)


def test_averaging_over_a_day_suppresses_the_tide():
    t, phi = _hourly(30, lat=17.0)
    averaged = window_averaged_tide(np.full(t.size, 17.0), np.zeros(t.size), date(2027, 3, 1), t, 24.84 * 3600)
    assert np.std(averaged) < 0.25 * np.std(phi)


def test_terrain_prisms_match_point_masses_at_distance():
    """Exact prism fields agree with point masses where the prisms look small (independent check)."""
    cfg = ExperimentConfig.model_validate(scenario_config("ore-field"))
    cfg.environment.terrain = "hills"
    cfg.environment.terrain_relief_m = 300
    prisms = _terrain_prisms(cfg.environment, cfg.survey, 2670)
    point = np.array([12_000.0]), np.array([0.0]), np.array([9_000.0])  # 15 km: closed form, not the far-field switch
    phi, _ = terrain_field(cfg.environment, cfg.survey, 1.0, 2670, *point)
    terms = [-k.G * p.signed_mass_kg / np.sqrt((point[0][0] - p.x_m) ** 2 + p.y_m**2 + (point[2][0] - p.z_center_m) ** 2)
             for p in prisms]
    assert abs(phi[0] - sum(terms)) < 2e-3 * sum(abs(t) for t in terms)


def test_terrain_lattice_interpolation_matches_direct_evaluation():
    cfg = ExperimentConfig.model_validate(scenario_config("ore-field"))
    cfg.environment.terrain = "hills"
    cfg.environment.terrain_relief_m = 200
    xs = np.linspace(-3500, 3500, 70)
    xx, yy = np.meshgrid(xs, xs)
    x, y = xx.ravel(), yy.ravel()
    from engine.survey import terrain_elevation
    z = terrain_elevation(x, y, cfg.environment, cfg.survey) + 1.0
    lattice, _ = terrain_field(cfg.environment, cfg.survey, 1.0, 2670, x, y, z)  # 4900 points → lattice
    sample = slice(0, None, 97)
    direct, _ = terrain_field(cfg.environment, cfg.survey, 1.0, 2670, x[sample], y[sample], z[sample])
    assert np.max(np.abs(lattice[sample] - direct)) < 0.02 * np.ptp(direct)


def _corrected(cfg_dict):
    cfg = ExperimentConfig.model_validate(cfg_dict)
    plan = plan_survey(cfg.survey, cfg.environment, cfg.sensor)
    meas = simulate_measurements(cfg, plan, [body_geometry(b) for b in cfg.bodies])
    return meas, meas.columns["raw"] - meas.normal_correction


def test_exact_models_cancel_and_residuals_remain():
    base = scenario_config("ore-field")
    base["environment"].update({"terrain": "hills", "terrain_relief_m": 300})
    off = {**base, "environment": {**base["environment"], "tides": "off", "terrain_density_kg_m3": 0,
                                   "terrain_density_assumed_kg_m3": 0}}
    exact = {**base, "noise": {**base["noise"], "tide_residual_percent": 0}}
    _, reference = _corrected(off)
    meas, corrected = _corrected(exact)
    assert np.allclose(corrected, reference, rtol=0, atol=1e-26)  # exact up to rounding of the ~1e-14 normal-field terms
    assert np.ptp(meas.columns["raw"] - reference) > 0  # but they were present in the raw data

    wrong = {**base, "environment": {**base["environment"], "terrain_density_assumed_kg_m3": 2670 * 0.9}}
    _, biased = _corrected(wrong)
    residual = biased - reference
    terrain_signal = meas.columns["raw"] - reference
    assert np.std(residual) == pytest.approx(0.1 * np.std(terrain_signal), rel=0.2)


def test_distant_reference_sees_differential_tide():
    local = scenario_config("ore-field")
    local["noise"]["tide_residual_percent"] = 100  # make the tide part of the "residual" to measure it
    remote = {**local, "sensor": {**local["sensor"], "mode": "remote_reference", "reference_distance_km": 800}}
    local_budget = {c.id: c.sigma for c in _corrected(local)[0].noise_model.components}
    remote_budget = {c.id: c.sigma for c in _corrected(remote)[0].noise_model.components}
    assert remote_budget["tide_residual"] > 20 * local_budget["tide_residual"]
