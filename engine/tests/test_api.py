import json
import time

import pytest


def _create(client, cfg):
    res = client.post("/api/experiments", json={"config": cfg})
    assert res.status_code == 201, res.text
    return res.json()


def _wait(client, sim_id, statuses, timeout=60.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        body = client.get(f"/api/simulations/{sim_id}").json()
        if body["status"] in statuses:
            return body
        time.sleep(0.05)
    raise AssertionError(f"simulation did not reach {statuses}")


def _wait_phase(client, sim_id, phase, timeout=30.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        body = client.get(f"/api/simulations/{sim_id}").json()
        if body["phase"] == phase:
            return body
        time.sleep(0.02)
    raise AssertionError(f"simulation did not reach phase {phase}")


def test_health_and_defaults(client):
    assert client.get("/api/health").json()["status"] == "ok"
    body = client.get("/api/defaults").json()
    assert body["config"]["bodies"][0]["geometry"] == "sphere"
    assert any(p["id"] == "sr" for p in body["presets"]["presets"])


def test_invalid_configuration_is_rejected_with_fields(client, small_config):
    small_config["bodies"][0]["depth_m"] = -1
    res = client.post("/api/experiments", json={"config": small_config})
    assert res.status_code == 422
    fields = {f["field"]: f["message"] for f in res.json()["error"]["fields"]}
    assert fields["bodies.0.depth_m"] == "Depth must be greater than 0 m."


def test_nan_literal_is_rejected(client, small_config):
    text = json.dumps({"config": small_config}).replace('"mass_kg": 5000000000000.0', '"mass_kg": NaN')
    assert "NaN" in text
    res = client.post("/api/experiments/validate", content=text, headers={"Content-Type": "application/json"})
    assert res.status_code == 422
    fields = {f["field"]: f["message"] for f in res.json()["error"]["fields"]}
    assert fields["bodies.0.mass_kg"] == "Mass must be a finite number."


def test_unknown_ids_return_404(client):
    assert client.get("/api/experiments/not-an-id").status_code == 404
    assert client.get("/api/simulations/" + "0" * 32).status_code == 404


def test_full_lifecycle_instant(client, small_config):
    exp = _create(client, small_config)
    assert exp["code"].startswith("EXP-")
    res = client.post(f"/api/experiments/{exp['id']}/simulations", json={"playback": "instant"},
                      headers={"Idempotency-Key": "k-1"})
    assert res.status_code == 201
    sim = res.json()
    # Same key returns the same simulation rather than creating a duplicate.
    again = client.post(f"/api/experiments/{exp['id']}/simulations", json={"playback": "instant"},
                        headers={"Idempotency-Key": "k-1"})
    assert again.status_code == 200 and again.json()["id"] == sim["id"]

    done = _wait(client, sim["id"], {"completed", "failed"})
    assert done["status"] == "completed", done
    assert done["measurements_completed"] == done["measurements_total"] == 81

    meas = client.get(f"/api/simulations/{sim['id']}/measurements").json()
    assert meas["count"] == 81
    assert meas["columns"]["index"] == list(range(81))

    results = client.get(f"/api/simulations/{sim['id']}/results").json()
    assert results["configuration_hash"] == exp["configuration_hash"]
    assert "summary" in results and "comparison" in results
    for section in ("signals", "anomaly-map", "inversion", "uncertainty"):
        r = client.get(f"/api/simulations/{sim['id']}/results/{section}")
        assert r.status_code == 200, section

    csv = client.get(f"/api/simulations/{sim['id']}/export?format=csv")
    assert csv.status_code == 200 and "attachment" in csv.headers["content-disposition"]
    assert csv.text.count("\n") > 81
    bundle = client.get(f"/api/simulations/{sim['id']}/export?format=json").json()
    assert bundle["partial"] is False
    report = client.get(f"/api/simulations/{sim['id']}/report")
    assert report.status_code == 200 and "<!doctype html>" in report.text

    exp_after = client.get(f"/api/experiments/{exp['id']}").json()
    assert exp_after["latest_simulation"]["id"] == sim["id"]


def test_pause_resume_cancel(client, config_dict):
    exp = _create(client, config_dict)
    sim = client.post(f"/api/experiments/{exp['id']}/simulations", json={"playback": "normal"}).json()
    # Pause is rejected before the survey phase.
    early = client.post(f"/api/simulations/{sim['id']}/pause")
    assert early.status_code == 409
    _wait_phase(client, sim["id"], "running_survey")
    time.sleep(0.3)
    paused = client.post(f"/api/simulations/{sim['id']}/pause").json()
    assert paused["status"] == "paused"
    count = client.get(f"/api/simulations/{sim['id']}").json()["measurements_completed"]
    time.sleep(0.4)
    assert client.get(f"/api/simulations/{sim['id']}").json()["measurements_completed"] == count
    # A second simulation for the same experiment is refused while one is active.
    dup = client.post(f"/api/experiments/{exp['id']}/simulations", json={"playback": "normal"})
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "simulation_active"
    assert client.post(f"/api/simulations/{sim['id']}/resume").json()["status"] == "running"
    assert client.post(f"/api/simulations/{sim['id']}/cancel").json()["status"] == "cancelling"
    final = _wait(client, sim["id"], {"cancelled"})
    assert final["results_available"] is False
    res = client.get(f"/api/simulations/{sim['id']}/results")
    assert res.status_code == 409 and res.json()["error"]["code"] == "results_not_ready"
    assert client.post(f"/api/simulations/{sim['id']}/resume").status_code == 409
    partial = client.get(f"/api/simulations/{sim['id']}/export?format=json").json()
    assert partial["partial"] is True


def test_update_rules(client, small_config):
    exp = _create(client, small_config)
    small_config["bodies"][0]["depth_m"] = 1600
    stale = client.put(f"/api/experiments/{exp['id']}", json={"config": small_config, "expected_version": 99})
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "version_conflict"
    ok = client.put(f"/api/experiments/{exp['id']}", json={"config": small_config, "expected_version": 1})
    assert ok.status_code == 200
    assert ok.json()["version"] == 2
    assert ok.json()["configuration_hash"] != exp["configuration_hash"]
    # Starting with an outdated configuration hash is refused.
    res = client.post(f"/api/experiments/{exp['id']}/simulations",
                      json={"playback": "instant", "expected_configuration_hash": exp["configuration_hash"]})
    assert res.status_code == 409 and res.json()["error"]["code"] == "configuration_changed"


def test_injected_failure_reports_reason(client, small_config):
    exp = _create(client, small_config)
    client.post("/api/_test/fail-next-simulation", json={"phase": "performing_inversion"})
    sim = client.post(f"/api/experiments/{exp['id']}/simulations", json={"playback": "instant"}).json()
    final = _wait(client, sim["id"], {"failed", "completed"})
    assert final["status"] == "failed"
    assert final["error"]["phase"] == "performing_inversion"
    assert "Injected failure" in final["error"]["message"]


def _collect(ws, until_types, limit=100_000):
    events = []
    for _ in range(limit):
        event = json.loads(ws.receive_text())
        events.append(event)
        if event["type"] in until_types:
            break
    return events


def _indices(events):
    out = []
    for e in events:
        if e["type"] == "measurement_batch":
            out.extend(e["columns"]["index"])
        elif e["type"] == "measurement":
            out.append(e["measurement"]["index"])
    return out


def test_websocket_stream_and_reconnect(client, small_config):
    exp = _create(client, small_config)
    sim = client.post(f"/api/experiments/{exp['id']}/simulations", json={"playback": "fast"}).json()
    with client.websocket_connect(f"/api/simulations/{sim['id']}/stream") as ws:
        first = json.loads(ws.receive_text())
        assert first["type"] == "snapshot"
        events = []
        while len(_indices(events)) < 10:
            events.append(json.loads(ws.receive_text()))
    seen = _indices(events)
    assert seen == list(range(len(seen)))
    last = seen[-1]
    with client.websocket_connect(f"/api/simulations/{sim['id']}/stream?after_index={last}") as ws:
        events = _collect(ws, {"simulation_completed", "simulation_failed"})
    rest = _indices(events)
    assert rest[0] == last + 1
    assert seen + rest == list(range(81))
    assert events[-1]["type"] == "simulation_completed"
    seqs = [e["seq"] for e in events]
    assert seqs == sorted(seqs)


def test_websocket_unknown_simulation(client):
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect) as info:
        with client.websocket_connect("/api/simulations/" + "a" * 32 + "/stream") as ws:
            ws.receive_text()
    assert info.value.code == 4404


def test_playback_pacing_respects_duration(client, small_config):
    """Fast playback of 9 points must take min(8 s, 0.15 s × 9) = 1.35 s, not one point per tick."""
    small_config["survey"]["spacing_m"] = 4000  # 3 × 3 = 9 points
    exp = _create(client, small_config)
    sim = client.post(f"/api/experiments/{exp['id']}/simulations", json={"playback": "fast"}).json()
    _wait_phase(client, sim["id"], "running_survey")
    started = time.monotonic()
    deadline = started + 30
    while time.monotonic() < deadline:
        body = client.get(f"/api/simulations/{sim['id']}").json()
        if body["phase"] != "running_survey":
            break
        time.sleep(0.02)
    elapsed = time.monotonic() - started
    assert 1.1 <= elapsed <= 5.0, elapsed
    _wait(client, sim["id"], {"completed"})


def test_plan_preview_and_reset_hook(client, small_config):
    exp = _create(client, small_config)
    plan = client.get(f"/api/experiments/{exp['id']}/plan").json()
    assert plan["simulation_id"] is None
    assert plan["point_count"] == 81 == len(plan["path"]["x_m"])
    assert plan["bodies"][0]["id"] == "body-1"
    assert client.post("/api/_test/reset").json() == {"ok": True}
    assert client.get("/api/experiments").json()["items"] == []


def test_defaults_include_scenarios(client):
    body = client.get("/api/defaults").json()
    ids = [s["id"] for s in body["scenarios"]["scenarios"]]
    assert body["scenarios"]["default"] in ids
    assert all(s["config"]["sensor"]["performance_class"] in ("field", "laboratory", "projected")
               for s in body["scenarios"]["scenarios"])


def test_detectability_study(client, small_config):
    res = client.post("/api/experiments/detectability", json={"config": small_config})
    assert res.status_code == 200
    study = res.json()
    assert len(study["significance_sigma"]) == len(study["depths_m"])
    assert len(study["significance_sigma"][0]) == len(study["masses_kg"])
    assert study["threshold_sigma"] == 3
    assert study["bodies"][0]["expected_significance_sigma"] > 3
    small_config["survey"]["spacing_m"] = -1
    bad = client.post("/api/experiments/detectability", json={"config": small_config})
    assert bad.status_code == 422
    assert bad.json()["error"]["fields"][0]["field"] == "survey.spacing_m"
