"""Field-data import: CSV validation, the analyst's corrections, and analysis equivalence with simulations."""

import copy
import io
import time
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest
from conftest import scenario_config

from engine.analysis import run_inversion
from engine.config import ExperimentConfig
from engine.fielddata import FieldDataError, analyse, corrections, parse_csv
from engine.geometry import body_geometry
from engine.sensor import simulate_measurements
from engine.survey import plan_survey


def _small(scenario="ore-projected"):
    cfg = scenario_config(scenario)
    cfg["survey"]["spacing_m"] = 1000
    cfg["inversion"]["bootstrap_samples"] = 20
    return cfg


def simulated_survey(cfg_dict):
    """A simulated survey written as a field-data CSV (stations, times and the raw clock comparisons)."""
    cfg = ExperimentConfig.model_validate(cfg_dict)
    plan = plan_survey(cfg.survey, cfg.environment, cfg.sensor)
    meas = simulate_measurements(cfg, plan, [body_geometry(b) for b in cfg.bodies])
    start = datetime(cfg.survey.start_date.year, cfg.survey.start_date.month, cfg.survey.start_date.day,
                     tzinfo=timezone.utc)
    sigma = meas.noise_model.nominal_sigma
    lines = ["station,time_utc,x_m,y_m,height_m,fractional_shift,uncertainty"]
    for i in range(plan.count):
        when = start + timedelta(seconds=float(plan.timestamp_s[i]))
        # Microsecond times: with a drifting clock, millisecond rounding alone shifts results by ~10⁻⁵.
        lines.append(f"P{i + 1},{when.isoformat(timespec='microseconds').replace('+00:00', 'Z')},{plan.x[i]!r},"
                     f"{plan.y[i]!r},{plan.z[i]!r},{meas.columns['raw'][i]!r},{sigma!r}")
    return cfg, plan, meas, ("\n".join(lines) + "\n").encode("utf-8")


VALID = (
    "station,time_utc,x_m,y_m,height_m,fractional_shift,uncertainty\n"
    + "".join(f"S{i},2027-03-01T{10 + i // 6:02d}:{(i % 6) * 10:02d}:00Z,{i * 100},{-i * 50},1.5,{i * 1e-18},2e-18\n"
              for i in range(12))
).encode()


def test_valid_file_is_parsed_and_sorted_by_time():
    reordered = VALID.splitlines()
    data = b"\n".join([reordered[0], *reversed(reordered[1:])]) + b"\n"
    cols = parse_csv(data)
    assert cols["station"][0] == "S0" and cols["elapsed_s"][0] == 0.0 and cols["elapsed_s"][-1] == 6600.0
    assert cols["start_utc"] == "2027-03-01T10:00:00.000Z"
    assert cols["fractional_shift"][3] == pytest.approx(3e-18)


@pytest.mark.parametrize("mutate, column, fragment", [
    (lambda rows: [rows[0].replace(",uncertainty", "")] + [r.rsplit(",", 1)[0] for r in rows[1:]], None,
     "Missing column: uncertainty"),
    (lambda rows: [rows[0] + ",notes"] + [r + ",x" for r in rows[1:]], None, "Unknown column"),
    (lambda rows: [rows[0], rows[1].replace("S0,", "=HYPERLINK(1),"), *rows[2:]], "station", "spreadsheet formulas"),
    (lambda rows: [rows[0], rows[1].replace("S0,", "-S0,"), *rows[2:]], "station", "spreadsheet formulas"),
    (lambda rows: [rows[0], rows[1].replace("10:00:00Z", "10:00:00"), *rows[2:]], "time_utc", "UTC offset"),
    (lambda rows: [rows[0], rows[1].replace(",0.0,2e-18", ",4.29e+14,2e-18"), *rows[2:]], "fractional_shift",
     "not Hz"),
    (lambda rows: [rows[0], rows[1].replace(",2e-18", ",NaN"), *rows[2:]], "uncertainty", "Not a number"),
    (lambda rows: [rows[0], rows[1].replace(",2e-18", ",0"), *rows[2:]], "uncertainty", "Must be between"),
    (lambda rows: [rows[0], rows[1], rows[1], *rows[2:]], "time_utc", "two measurements"),
    (lambda rows: rows[:5], None, "At least 10 measurements"),
])
def test_invalid_files_are_rejected_with_line_and_column(mutate, column, fragment):
    rows = VALID.decode().strip().split("\n")
    with pytest.raises(FieldDataError) as info:
        parse_csv(("\n".join(mutate(rows)) + "\n").encode())
    err = info.value
    text = str(err) + " ".join(p["message"] for p in err.problems)
    assert fragment in text
    if column is not None:
        assert err.problems[0]["column"] == column and err.problems[0]["line"] >= 2


def test_binary_and_non_utf8_files_are_rejected():
    with pytest.raises(FieldDataError, match="binary"):
        parse_csv(b"station\x00")
    with pytest.raises(FieldDataError, match="UTF-8"):
        parse_csv("station,é".encode("latin-1"))


@pytest.mark.parametrize("mode", ["local_reference", "remote_reference"])
def test_corrections_reproduce_the_simulators_analyst_model(mode):
    """The corrections applied to field data equal the ones the simulator gives its analyst, term by term:
    normal field, terrain at the assumed density and the modelled tide (here with hills and tides on)."""
    cfg = _small()
    cfg["sensor"]["mode"] = mode
    cfg["sensor"]["reference_distance_km"] = 30.0 if mode == "remote_reference" else 0.0
    cfg["environment"].update({"terrain": "hills", "terrain_relief_m": 80.0, "tides": "modelled",
                               "terrain_density_kg_m3": 2670.0, "terrain_density_assumed_kg_m3": 2500.0})
    config, _, meas, data = simulated_survey(cfg)
    cols = parse_csv(data)
    corr = corrections(config, cols, {})
    total = corr["normal"] + corr["terrain"] + corr["tide"]
    # Both site terms are far larger than the tolerance (the local tide difference over 8 km is ~10⁻²⁰).
    assert np.max(np.abs(corr["tide"])) > 1e-21 and np.max(np.abs(corr["terrain"])) > 1e-19
    assert np.allclose(total, meas.normal_correction, rtol=0, atol=1e-24)


def test_analysis_of_simulated_field_data_matches_the_simulation():
    config, plan, meas, data = simulated_survey(_small())
    cols = parse_csv(data)
    doc = analyse(config, cols, {})
    inv = run_inversion(config, plan, meas)
    assert doc["summary"]["detection_significance_sigma"] == pytest.approx(inv.detection["significance_sigma"],
                                                                           rel=1e-6)
    primary = doc["summary"]["primary_source"]
    best = max(inv.sources, key=lambda s: abs(s.mass_kg.estimate))
    assert primary["mass_kg"] == pytest.approx(best.mass_kg.estimate, rel=1e-4)
    assert primary["depth_m"] == pytest.approx(best.depth_m.estimate, rel=1e-4)
    assert doc["summary"]["fit_quality"] == "consistent"
    # The planned body fits within the noise (χ² near its N − 2 expectation) and explains the data far better
    # than offset and drift alone (an improvement well beyond 5σ).
    hyp = doc["hypothesis"]
    n = len(cols["station"])
    assert hyp["chi_square_hypothesis"] < n - 2 + 4 * np.sqrt(2 * (n - 2))
    assert hyp["chi_square_null"] - hyp["chi_square_hypothesis"] > 25


def test_unequal_uncertainties_are_weighted():
    """Half the stations are ten times noisier, and say so: the weighted analysis stays consistent, and
    treating every station alike would misjudge the fit."""
    config, plan, meas, _ = simulated_survey(_small())
    rng = np.random.default_rng(5)
    sigma = np.full(plan.count, meas.noise_model.nominal_sigma)
    noisy = np.arange(plan.count) % 2 == 1
    sigma[noisy] *= 10
    raw = meas.columns["raw"] + np.where(noisy, rng.standard_normal(plan.count) * sigma, 0.0)
    start = datetime(2027, 3, 1, tzinfo=timezone.utc)
    rows = ["station,time_utc,x_m,y_m,height_m,fractional_shift,uncertainty"]
    for i in range(plan.count):
        when = start + timedelta(seconds=float(plan.timestamp_s[i]))
        rows.append(f"P{i},{when.isoformat(timespec='milliseconds').replace('+00:00', 'Z')},{plan.x[i]!r},"
                    f"{plan.y[i]!r},{plan.z[i]!r},{raw[i]!r},{sigma[i]!r}")
    cols = parse_csv(("\n".join(rows) + "\n").encode())
    weighted = analyse(config, cols, {})
    assert weighted["summary"]["fit_quality"] == "consistent"
    assert weighted["summary"]["anomaly_detected"]
    equal = copy.deepcopy(cols)
    equal["uncertainty"] = [float(np.median(sigma))] * plan.count
    unweighted = analyse(config, equal, {})
    assert unweighted["summary"]["fit_quality"] == "scatter_exceeds_uncertainties"


def test_stations_outside_the_survey_area_are_reported():
    config, _, _, data = simulated_survey(_small())
    cols = parse_csv(data)
    cols["x_m"][3] = 50_000.0
    with pytest.raises(FieldDataError, match="1 station lie outside"):
        analyse(config, cols, {})


# ---------------------------------------------------------------------------- API


def _wait(client, dataset_id, timeout=120):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        meta = client.get(f"/api/datasets/{dataset_id}").json()
        if meta["status"] != "analysing":
            return meta
        time.sleep(0.1)
    raise AssertionError("analysis did not finish")


def _upload(client, exp_id, data, name="Spring campaign", filename="field.csv"):
    return client.post(f"/api/experiments/{exp_id}/datasets", data={"name": name},
                       files={"file": (filename, io.BytesIO(data), "text/csv")})


def test_dataset_upload_analyse_and_reanalyse(client):
    cfg = _small()
    exp = client.post("/api/experiments", json={"config": cfg}).json()
    _, _, _, data = simulated_survey(cfg)
    res = _upload(client, exp["id"], data, filename="../../etc/passwd<script>.csv")
    assert res.status_code == 201, res.text
    created = res.json()
    assert created["status"] == "analysing" and created["measurement_count"] == 81
    assert created["file_name"] == "passwd_script_.csv"
    meta = _wait(client, created["id"])
    assert meta["status"] == "ready", meta
    assert meta["configuration_hash"] == exp["configuration_hash"]
    results = client.get(f"/api/datasets/{created['id']}/results").json()
    assert results["summary"]["anomaly_detected"] is True
    assert len(results["stations"]["residual"]) == 81
    listed = client.get(f"/api/experiments/{exp['id']}/datasets").json()["items"]
    assert [d["id"] for d in listed] == [created["id"]]

    # A changed site configuration leaves the analysis out of date until it is re-run.
    cfg["environment"]["tides"] = "off"
    updated = client.put(f"/api/experiments/{exp['id']}", json={"config": cfg, "expected_version": 1}).json()
    rerun = client.post(f"/api/datasets/{created['id']}/analyse")
    assert rerun.status_code == 200
    meta = _wait(client, created["id"])
    assert meta["configuration_hash"] == updated["configuration_hash"]
    assert client.delete(f"/api/datasets/{created['id']}").status_code == 204
    assert client.get(f"/api/datasets/{created['id']}").status_code == 404


def test_dataset_upload_rejections(client):
    cfg = _small()
    exp = client.post("/api/experiments", json={"config": cfg}).json()
    bad = VALID.replace(b"S3,", b"@SUM(A1),")
    res = _upload(client, exp["id"], bad)
    assert res.status_code == 422
    body = res.json()["error"]
    assert body["code"] == "invalid_file" and body["problems"][0]["column"] == "station"
    assert body["problems"][0]["line"] == 5
    # Stations far outside the experiment's survey area: stored, but the analysis explains why it failed.
    far = VALID.replace(b",1.5,", b",1.5,").replace(b"S0,2027-03-01T10:00:00Z,0,", b"S0,2027-03-01T10:00:00Z,90000,")
    meta = _wait(client, _upload(client, exp["id"], far).json()["id"])
    assert meta["status"] == "failed" and "outside the experiment's survey area" in meta["error"]["message"]
    assert _upload(client, exp["id"], VALID, name="  ").status_code == 422


def test_field_template_lists_the_planned_stations(client):
    cfg = _small()
    exp = client.post("/api/experiments", json={"config": cfg}).json()
    res = client.get(f"/api/experiments/{exp['id']}/datasets/template")
    assert res.status_code == 200 and res.headers["content-type"].startswith("text/csv")
    lines = res.text.strip().split("\n")
    assert lines[0] == "station,time_utc,x_m,y_m,height_m,fractional_shift,uncertainty,averaging_s"
    assert len(lines) == 82 and lines[1].startswith("P00001,2027-03-01T")
