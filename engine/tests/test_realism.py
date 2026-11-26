"""Field-campaign realism: performance classes, per-station errors, timing, detection and detectability."""

import copy
import json

import numpy as np
import pytest
from conftest import scenario_config

from engine.analysis import build_results, inversion_input, run_inversion
from engine.config import ExperimentConfig, configuration_hash
from engine.contract import default_config, performance_values, scenarios
from engine.detectability import detectability
from engine.geometry import body_geometry
from engine.inversion import detection_scan
from engine.migrations import migrate_config
from engine.sensor import simulate_measurements
from engine.store import Store
from engine.db import default_database_url
from engine.survey import plan_survey
from engine.validation import validate_config


def _simulate(cfg_dict):
    cfg = ExperimentConfig.model_validate(cfg_dict)
    plan = plan_survey(cfg.survey, cfg.environment, cfg.sensor)
    bodies = [body_geometry(b) for b in cfg.bodies]
    return cfg, plan, bodies, simulate_measurements(cfg, plan, bodies)


# ---------------------------------------------------------------------------- scenarios and classes


def test_default_config_is_the_default_scenario():
    data = scenarios()
    default = next(s for s in data["scenarios"] if s["id"] == data["default"])
    assert default_config() == default["config"]


@pytest.mark.parametrize("scenario", [s["id"] for s in scenarios()["scenarios"]])
def test_every_scenario_is_valid(scenario):
    report = validate_config(ExperimentConfig.model_validate(scenario_config(scenario)))
    assert report.valid, report.errors


def test_performance_class_fixes_clock_values():
    cfg = scenario_config("ore-field")
    cfg["sensor"]["stability_1s"] = 1e-16
    report = validate_config(ExperimentConfig.model_validate(cfg))
    assert {e["field"] for e in report.errors} == {"sensor.stability_1s"}
    assert "must match the selected performance class" in report.errors[0]["message"]

    cfg["sensor"]["performance_class"] = "custom"
    assert validate_config(ExperimentConfig.model_validate(cfg)).valid

    cfg["sensor"]["clock_species"] = "custom"
    cfg["sensor"]["performance_class"] = "field"
    report = validate_config(ExperimentConfig.model_validate(cfg))
    assert "sensor.performance_class" in {e["field"] for e in report.errors}


def test_undemonstrated_performance_is_flagged():
    for scenario, expected in (("ore-field", None), ("ore-laboratory", "Laboratory"), ("ore-projected", "Projected")):
        warnings = validate_config(ExperimentConfig.model_validate(scenario_config(scenario))).warnings
        messages = [w["message"] for w in warnings if w["field"] == "sensor.performance_class"]
        assert (messages[0].startswith(expected) if expected else messages == [])


# ---------------------------------------------------------------------------- noise and timing


def test_per_station_errors_do_not_average_down():
    cfg = scenario_config("ore-field")
    _, _, _, short = _simulate(cfg)
    cfg["sensor"]["measurement_interval_s"] *= 4
    _, _, _, long = _simulate(cfg)
    a = {c.id: c.sigma for c in short.noise_model.components}
    b = {c.id: c.sigma for c in long.noise_model.components}
    assert b["clock_instability"] == pytest.approx(a["clock_instability"] / 2)
    assert b["clock_systematic"] == a["clock_systematic"] == pytest.approx(1e-17)
    assert b["station_height"] == a["station_height"] == pytest.approx(9.78 * 0.01 / 299_792_458.0**2, rel=2e-3)
    kinds = {c.id: c.kind for c in short.noise_model.components}
    assert kinds["clock_systematic"] == kinds["station_height"] == "station"


def test_station_timing_includes_setup_and_uptime():
    cfg = scenario_config("ore-field")
    c = ExperimentConfig.model_validate(cfg)
    plan = plan_survey(c.survey, c.environment, c.sensor)
    averaging_wall = c.sensor.measurement_interval_s * 100 / c.sensor.uptime_percent
    transit = plan.along_track_m[-1] / 5.0
    expected_end = transit + plan.count * (c.survey.setup_time_s + averaging_wall)
    assert plan.duration_s == pytest.approx(expected_end - averaging_wall / 2)
    assert plan.duration_s / 86400 == pytest.approx(32.3, abs=0.1)


# ---------------------------------------------------------------------------- detection


def test_detection_scan_false_positive_rate_under_pure_noise():
    """No anomaly (negligible mass): the look-elsewhere-corrected scan must rarely exceed 3σ."""
    cfg = scenario_config("ore-laboratory")
    cfg["bodies"][0]["mass_kg"] = 1e6
    significances = []
    for seed in range(60):
        cfg["noise"]["seed"] = seed
        c, plan, _, meas = _simulate(cfg)
        inp = inversion_input(c, plan, meas.columns["raw"] - meas.normal_correction, meas.noise_model.nominal_sigma)
        significances.append(detection_scan(inp, seed)["significance_sigma"])
    significances = np.array(significances)
    assert np.sum(significances >= 3.0) <= 1  # expected rate 0.13 %
    # Calibration: about 10 % of noise-only runs should exceed the one-sided 90 % level (1.28σ).
    assert 0.02 <= np.mean(significances >= 1.2816) <= 0.25


def test_regional_anomaly_is_detected_although_mass_is_degenerate():
    """Detection asks whether any source is present; mass and depth may still trade off."""
    cfg = scenario_config("regional-field")
    cfg["inversion"]["bootstrap_samples"] = 40
    c, plan, bodies, meas = _simulate(cfg)
    docs = build_results(c, plan, meas, bodies, run_inversion(c, plan, meas))
    assert docs["summary"]["anomaly_detected"] is True
    assert docs["summary"]["detection_significance_sigma"] > 3
    assert docs["summary"]["primary_source"]["mass_significance_sigma"] < 3


def test_fit_reaches_global_minimum_for_broad_anomaly():
    """Regression: the start at the extremum of centred data used to converge to a spurious shallow source."""
    cfg = scenario_config("regional-field")
    cfg["noise"]["seed"] = 20260929
    cfg["inversion"]["bootstrap_samples"] = 20
    c, plan, _, meas = _simulate(cfg)
    inv = run_inversion(c, plan, meas)
    data = meas.columns["raw"] - meas.normal_correction
    sigma = meas.noise_model.nominal_sigma
    truth_signal = meas.true_anomaly_signal
    basis = np.column_stack([np.ones_like(data), (plan.timestamp_s - plan.timestamp_s.mean())])
    coef, *_ = np.linalg.lstsq(basis, data - truth_signal, rcond=None)
    chi2_truth = np.sum((data - truth_signal - basis @ coef) ** 2) / sigma**2
    chi2_fit = np.sum((data - inv.prediction) ** 2) / sigma**2
    assert chi2_fit <= chi2_truth
    assert inv.sources[0].depth_m.estimate > 2500


def test_estimates_respect_the_resolution_limit():
    cfg = scenario_config("ore-field")
    cfg["inversion"]["bootstrap_samples"] = 20
    c, plan, bodies, meas = _simulate(cfg)
    inv = run_inversion(c, plan, meas)
    limit = c.survey.spacing_m / 2
    assert inv.sources[0].depth_m.estimate >= limit
    assert inv.sources[0].depth_m.ci_low >= limit
    doc = build_results(c, plan, meas, bodies, inv)
    assert doc["inversion"]["fit"]["min_depth_m"] == limit


def test_shallow_body_warning():
    cfg = scenario_config("ore-field")
    cfg["bodies"][0].update({"mass_kg": 1e9, "depth_m": 300})
    warnings = validate_config(ExperimentConfig.model_validate(cfg)).warnings
    assert any(w["field"] == "bodies.0.depth_m" and "cannot resolve" in w["message"] for w in warnings)


# ---------------------------------------------------------------------------- detectability study


def test_detectability_matches_scenario_outcomes_and_is_monotonic():
    expected = {}
    for scenario in ("ore-field", "ore-projected", "regional-field"):
        study = detectability(ExperimentConfig.model_validate(scenario_config(scenario)))
        expected[scenario] = study["bodies"][0]["expected_significance_sigma"]
        grid = np.array(study["significance_sigma"])
        assert grid.shape == (len(study["depths_m"]), len(study["masses_kg"]))
        assert np.all(np.diff(grid, axis=1) >= -1e-9)  # more mass → more significant
        assert np.all(np.diff(grid, axis=0) <= 1e-9)  # deeper → less significant
        assert study["depths_m"][0] >= study["resolution_depth_m"]
    assert expected["ore-field"] < 3 < expected["regional-field"] < expected["ore-projected"]


# ---------------------------------------------------------------------------- migration


def test_migration_preserves_measurements_and_hashes(tmp_path):
    current = scenario_config("ore-projected")
    legacy = copy.deepcopy(current)
    for section, key in (("sensor", "performance_class"), ("sensor", "systematic_uncertainty"),
                         ("sensor", "uptime_percent"), ("noise", "station_height_uncertainty_m"),
                         ("survey", "setup_time_s")):
        del legacy[section][key]
    upgraded = migrate_config(legacy)
    assert upgraded is not None and migrate_config(upgraded) is None
    assert upgraded["sensor"]["performance_class"] == "custom"
    # Neutral values: no per-station error, full uptime and no set-up time.
    neutral = copy.deepcopy(current)
    neutral["sensor"].update({"performance_class": "custom", "systematic_uncertainty": 0.0, "uptime_percent": 100.0})
    neutral["noise"]["station_height_uncertainty_m"] = 0.0
    neutral["survey"]["setup_time_s"] = 0.0
    assert upgraded == neutral

    # Stored experiment and its current run are upgraded together; the run stays current.
    root = tmp_path / "data"
    (root / "experiments").mkdir(parents=True)
    (root / "simulations").mkdir(parents=True)
    exp_id, sim_id = "a" * 32, "b" * 32
    exp = {"id": exp_id, "code": "EXP-00001", "name": "legacy", "created_at": "t", "updated_at": "t", "version": 3,
           "configuration_hash": "0" * 64, "config": legacy, "latest_simulation_id": sim_id}
    (root / "experiments" / f"{exp_id}.json").write_text(json.dumps(exp), encoding="utf-8")
    (root / "simulations" / sim_id).mkdir(parents=True)
    meta = {"id": sim_id, "experiment_id": exp_id, "configuration_hash": "0" * 64, "created_at": "t",
            "status": "completed"}
    (root / "simulations" / sim_id / "meta.json").write_text(json.dumps(meta), encoding="utf-8")
    store = Store(default_database_url(tmp_path / "db"))
    owner = store.create_user("owner@example.org", "Owner", "x")
    assert store.import_legacy_files(root, owner["id"]) == {"experiments": 1, "simulations": 1, "studies": 0,
                                                           "skipped": 0}
    new_hash = configuration_hash(ExperimentConfig.model_validate(upgraded))
    exp = store.get_experiment(exp_id)
    assert exp["configuration_hash"] == new_hash and exp["owner_id"] == owner["id"]
    assert exp["version"] == 3 and exp["config"] == upgraded
    assert store.get_simulation(sim_id)["configuration_hash"] == new_hash
    # Repeating the import changes nothing.
    assert store.import_legacy_files(root, owner["id"])["experiments"] == 0
    store.close()


def test_stored_configuration_is_upgraded_on_read(tmp_path):
    """A configuration written before a schema change is upgraded when read; its current run stays current."""
    store = Store(default_database_url(tmp_path / "db"))
    owner = store.create_user("owner@example.org", "Owner", "x")
    current = scenario_config("ore-projected")
    legacy = copy.deepcopy(current)
    del legacy["environment"]["terrain_model_id"]
    exp = store.create_experiment(owner["id"], legacy, "1" * 64)
    store.save_sim_meta({"id": "c" * 32, "experiment_id": exp["id"], "created_at": "t", "status": "completed",
                         "configuration_hash": "1" * 64})
    store.set_latest_simulation(exp["id"], "c" * 32)
    upgraded = store.get_experiment(exp["id"])
    assert upgraded["config"] == current
    new_hash = configuration_hash(ExperimentConfig.model_validate(current))
    assert upgraded["configuration_hash"] == new_hash
    assert store.get_simulation("c" * 32)["configuration_hash"] == new_hash
    store.close()


def test_performance_values_come_from_the_contract():
    values = performance_values("sr", "field")
    assert values is not None and values["stability_1s"] == 5e-16 and values["uptime_percent"] == 50
    assert performance_values("sr", "unknown") is None and performance_values("custom", "field") is None
