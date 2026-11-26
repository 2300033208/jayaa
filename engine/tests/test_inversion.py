import numpy as np
import pytest

from engine.analysis import build_results, run_inversion
from engine.config import ExperimentConfig
from engine.geometry import body_geometry
from engine.sensor import simulate_measurements
from engine.survey import plan_survey


def _run(cfg_dict):
    cfg = ExperimentConfig.model_validate(cfg_dict)
    plan = plan_survey(cfg.survey, cfg.environment, cfg.sensor)
    bodies = [body_geometry(b) for b in cfg.bodies]
    meas = simulate_measurements(cfg, plan, bodies)
    inv = run_inversion(cfg, plan, meas)
    return cfg, plan, meas, bodies, inv


def _silence(cfg):
    for key in ("measurement_noise", "environmental_noise", "temperature_fluctuation_k", "vibration_m",
                "station_height_uncertainty_m", "frequency_drift_per_hour"):
        cfg["noise"][key] = 0
    cfg["sensor"]["performance_class"] = "custom"
    cfg["sensor"]["systematic_uncertainty"] = 0
    cfg["sensor"]["stability_1s"] = 1e-19  # minimum allowed; negligible compared with the signal
    cfg["inversion"]["bootstrap_samples"] = 20


def test_noise_free_inversion_recovers_sphere(config_dict):
    _silence(config_dict)
    _, _, _, _, inv = _run(config_dict)
    s = inv.sources[0]
    assert s.mass_kg.estimate == pytest.approx(5e12, rel=1e-3)
    assert s.x_m.estimate == pytest.approx(400, abs=2)
    assert s.y_m.estimate == pytest.approx(-300, abs=2)
    assert s.depth_m.estimate == pytest.approx(1500, rel=1e-3)


def test_remote_reference_and_drift_are_handled(config_dict):
    _silence(config_dict)
    config_dict["sensor"]["mode"] = "remote_reference"
    config_dict["noise"]["frequency_drift_per_hour"] = 5e-20
    _, _, _, _, inv = _run(config_dict)
    s = inv.sources[0]
    assert s.depth_m.estimate == pytest.approx(1500, rel=1e-2)
    assert inv.drift_per_s.estimate == pytest.approx(5e-20 / 3600, rel=1e-2)


def test_measurements_are_deterministic_for_seed(small_config):
    _, _, a, _, _ = _run(small_config)
    _, _, b, _, _ = _run(small_config)
    np.testing.assert_array_equal(a.columns["raw"], b.columns["raw"])
    small_config["noise"]["seed"] += 1
    _, _, c, _, _ = _run(small_config)
    assert not np.array_equal(a.columns["raw"], c.columns["raw"])


def test_ground_truth_never_used_in_inversion_input(small_config):
    """Changing only the (hidden) truth must change the data; the inversion sees data only."""
    cfg, plan, meas, bodies, inv = _run(small_config)
    docs = build_results(cfg, plan, meas, bodies, inv)
    assert docs["summary"]["measurement_count"] == plan.count
    assert set(docs) == {"summary", "noise_budget", "inversion", "uncertainty", "anomaly_map", "signals",
                         "ground_truth", "comparison"}
    # Sanity: truth bodies appear only in the ground_truth/comparison sections.
    assert "bodies" not in docs["inversion"]


def test_results_have_uncertainty_and_comparison(config_dict):
    config_dict["inversion"]["bootstrap_samples"] = 60
    cfg, plan, meas, bodies, inv = _run(config_dict)
    docs = build_results(cfg, plan, meas, bodies, inv)
    params = docs["uncertainty"]["sources"][0]["parameters"]
    for name in ("mass_kg", "x_m", "y_m", "depth_m"):
        p = params[name]
        assert p["ci_low"] < p["estimate"] < p["ci_high"]
        assert sum(p["histogram"]["counts"]) >= 10
    match = docs["comparison"]["matches"][0]
    assert match["truth_id"] == "body-1"
    assert docs["inversion"]["detection"]["anomaly_detected"] is True
    assert docs["anomaly_map"]["available"] is True
    assert len(docs["anomaly_map"]["layers"]["gravity_anomaly_true"]) == plan.ny


def test_profile_has_no_map(small_config):
    small_config["survey"]["pattern"] = "profile"
    small_config["survey"]["spacing_m"] = 200
    small_config["bodies"][0]["y_m"] = 0
    cfg, plan, meas, bodies, inv = _run(small_config)
    docs = build_results(cfg, plan, meas, bodies, inv)
    assert docs["anomaly_map"]["available"] is False
    assert "interpolation" in docs["anomaly_map"]["unavailable_reason"]


def test_two_source_inversion(config_dict):
    _silence(config_dict)
    config_dict["bodies"][0].update({"x_m": -1800, "y_m": 0, "mass_kg": 4e12, "depth_m": 1300})
    config_dict["bodies"].append({**config_dict["bodies"][0], "id": "body-2", "x_m": 1800, "mass_kg": 2e12,
                                  "depth_m": 1100})
    config_dict["inversion"]["source_count"] = 2
    _, _, _, _, inv = _run(config_dict)
    est = sorted((s.x_m.estimate, s.mass_kg.estimate) for s in inv.sources)
    assert est[0][0] == pytest.approx(-1800, abs=20)
    assert est[1][0] == pytest.approx(1800, abs=20)
    assert est[0][1] == pytest.approx(4e12, rel=2e-2)
    assert est[1][1] == pytest.approx(2e12, rel=2e-2)


def test_inversion_is_independent_of_ground_truth(small_config):
    """Same measurements + different configured bodies must give identical estimates."""
    cfg, plan, meas, _, inv_a = _run(small_config)
    moved = cfg.model_copy(deep=True)
    moved.bodies[0].depth_m = 4000
    moved.bodies[0].mass_kg = 1e9
    moved.bodies[0].x_m = -2000
    inv_b = run_inversion(moved, plan, meas)
    np.testing.assert_array_equal(inv_a.theta, inv_b.theta)
