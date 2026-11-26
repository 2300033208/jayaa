"""Monte Carlo studies, the survey design assistant and their API endpoints."""

import time

import pytest
from conftest import scenario_config

from engine.config import ExperimentConfig
from engine.design import design_survey
from engine.studies import StudyCancelled, StudyRequest, run_repeat, run_sweep, run_time_lapse, validate_request, wilson


def _config(scenario: str, **survey) -> ExperimentConfig:
    cfg = scenario_config(scenario)
    cfg["survey"].update(survey)
    return ExperimentConfig.model_validate(cfg)


def test_wilson_interval():
    w = wilson(9, 10)
    assert w["rate"] == 0.9 and 0.59 < w["low"] < 0.6 and 0.98 < w["high"] < 0.99
    assert wilson(0, 0)["rate"] is None


def test_repeat_study_reports_rates_bias_and_coverage():
    result = run_repeat(_config("ore-projected", spacing_m=500), runs=12)
    assert result["detection"]["n"] == 12 and result["detection"]["rate"] == 1.0
    depth = result["accuracy_all"]["depth_m"]
    assert depth["n"] == 12 and abs(depth["bias"]) < 600 and depth["rmse"] > 0
    assert depth["coverage"]["n"] == 12
    assert len(result["records"]) == 12 and len(result["significance"]["values"]) == 12


def test_sweep_observed_detection_tracks_prediction():
    result = run_sweep(_config("ore-laboratory"), [1e12, 2e13, 1e14], [2000, 4000], runs=20)
    observed = [[None if c is None else c["rate"] for c in row] for row in result["detection"]]
    predicted = result["predicted_probability"]
    # Weak signals are rarely detected, strong ones always; observation agrees with prediction there.
    assert observed[0][0] <= 0.15 and predicted[0][0] < 0.05
    assert observed[1][2] == 1.0 and predicted[1][2] > 0.95
    # A body that would reach above the ground is left out.
    assert observed[0][2] is None and predicted[0][2] is None


def test_time_lapse_benchmarks_cancel_station_height_errors():
    result = run_time_lapse(_config("ore-projected", spacing_m=500), mass_change=-2e12, interval_days=365, runs=8)
    assert result["sigma_difference"] < result["sigma_difference_without_benchmarks"]
    assert result["mass_change_rate_kg_per_year"] == pytest.approx(-2e12, rel=1e-3)
    assert result["detection"]["n"] == 8
    assert result["truth"]["mass_after_kg"] == pytest.approx(3e12)


def test_study_requests_are_validated():
    cfg = _config("ore-field")
    bad = StudyRequest(kind="sweep", runs=10, masses_kg=[1e12], depths_m=[1000, 1000])
    fields = {e["field"] for e in validate_request(bad, cfg)}
    assert fields == {"masses_kg", "depths_m"}
    reverse = StudyRequest(kind="time_lapse", runs=10, mass_change_kg=-6e12, interval_days=30)
    assert [e["field"] for e in validate_request(reverse, cfg)] == ["mass_change_kg"]
    huge = StudyRequest(kind="repeat", runs=500)
    big = _config("ore-field", spacing_m=50)
    assert [e["field"] for e in validate_request(huge, big)] == ["runs"]


def test_studies_can_be_cancelled():
    with pytest.raises(StudyCancelled):
        run_repeat(_config("ore-field"), runs=10, cancelled=lambda: True)


def test_design_assistant_finds_the_fastest_reliable_design():
    result = design_survey(_config("regional-field"), 6.4e14, 10_000, 40)
    best = result["recommended"]
    assert result["verdict"] == "reliable"
    assert best["detection_probability"] >= 0.9 and best["duration_days"] <= 40
    faster = [c for c in result["candidates"] if c["within_budget"] and c["resolves_depth"]
              and c["detection_probability"] >= 0.9 and c["duration_days"] < best["duration_days"]]
    assert faster == []
    hopeless = design_survey(_config("ore-field"), 5e12, 1500, 20)
    assert hopeless["verdict"] in ("best_within_budget", "none_within_budget")


# ---------------------------------------------------------------------------- API


def _create(client, cfg):
    res = client.post("/api/experiments", json={"config": cfg})
    assert res.status_code == 201
    return res.json()


def _wait(client, study_id, timeout=120):
    deadline = time.time() + timeout
    while time.time() < deadline:
        doc = client.get(f"/api/studies/{study_id}").json()
        if doc["status"] not in ("queued", "running"):
            return doc
        time.sleep(0.2)
    raise AssertionError("study did not finish")


def test_study_api_lifecycle(client, small_config):
    exp = _create(client, small_config)
    bad = client.post(f"/api/experiments/{exp['id']}/studies", json={"kind": "sweep", "runs": 10, "masses_kg": [1e12]})
    assert bad.status_code == 422
    assert {f["field"] for f in bad.json()["error"]["fields"]} == {"masses_kg", "depths_m"}

    res = client.post(f"/api/experiments/{exp['id']}/studies", json={"kind": "repeat", "runs": 5})
    assert res.status_code == 201
    doc = _wait(client, res.json()["id"])
    assert doc["status"] == "completed" and doc["progress"] == 1.0
    assert doc["result"]["detection"]["n"] == 5
    assert doc["configuration_hash"] == exp["configuration_hash"]
    listed = client.get(f"/api/experiments/{exp['id']}/studies").json()["items"]
    assert [s["id"] for s in listed] == [doc["id"]] and "result" not in listed[0]
    assert client.post(f"/api/studies/{doc['id']}/cancel").status_code == 409
    assert client.get("/api/studies/" + "0" * 32).status_code == 404


def test_study_cancellation_via_api(client, config_dict):
    exp = _create(client, config_dict)
    res = client.post(f"/api/experiments/{exp['id']}/studies", json={"kind": "repeat", "runs": 200})
    study_id = res.json()["id"]
    assert client.post(f"/api/studies/{study_id}/cancel").status_code == 200
    assert _wait(client, study_id)["status"] == "cancelled"


def test_design_api(client, small_config):
    res = client.post("/api/experiments/design", json={"config": small_config, "target_mass_kg": 5e12,
                                                       "target_depth_m": 1500, "max_days": 60})
    assert res.status_code == 200
    body = res.json()
    assert body["verdict"] in ("reliable", "best_within_budget", "none_within_budget")
    assert body["candidates"] and body["target"]["depth_m"] == 1500
    assert client.post("/api/experiments/design", json={"config": small_config, "target_mass_kg": -1,
                                                        "target_depth_m": 1500, "max_days": 60}).status_code == 422
