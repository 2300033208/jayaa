import numpy as np
import pytest

from engine import constants as k
from engine.benchmarks import benchmarks
from engine.config import ExperimentConfig
from engine.instruments import GRAVIMETERS, _covariance, _Survey, compare_instruments


@pytest.fixture
def survey(small_config):
    return _Survey(ExperimentConfig.model_validate(small_config), GRAVIMETERS["relative"], 5e-8)


def _source(small_config):
    b = small_config["bodies"][0]
    return np.array([b["mass_kg"], b["x_m"], b["y_m"], b["depth_m"]])


def test_gravity_jacobian_matches_finite_differences(survey, small_config):
    src = _source(small_config)
    _, jac = survey.gravity(src)
    for p, step in enumerate([src[0] * 1e-6, 0.01, 0.01, 0.01]):
        hi, lo = src.copy(), src.copy()
        hi[p] += step
        lo[p] -= step
        numeric = (survey.gravity(hi)[0] - survey.gravity(lo)[0]) / (2 * step)
        assert np.allclose(jac[:, p], numeric, rtol=1e-5, atol=1e-9 * np.max(np.abs(numeric)))


def test_gravity_model_is_point_mass_attraction(survey, small_config):
    src = _source(small_config)
    signal, _ = survey.gravity(src)
    i = int(np.argmin((survey.inp.x - src[1]) ** 2 + (survey.inp.y - src[2]) ** 2))
    dz = survey.inp.z[i] + src[3]
    r = np.sqrt((survey.inp.x[i] - src[1]) ** 2 + (survey.inp.y[i] - src[2]) ** 2 + dz**2)
    assert signal[i] * survey.sigma_gravity == pytest.approx(k.G * src[0] * dz / r**3, rel=1e-12)


def test_station_height_enters_both_instruments(small_config):
    small_config["noise"]["station_height_uncertainty_m"] = 0.05
    s = _Survey(ExperimentConfig.model_validate(small_config), GRAVIMETERS["relative"], 5e-8)
    assert s.sigma_gravity == pytest.approx(np.hypot(5e-8, k.FREE_AIR_GRADIENT_S2 * 0.05))


def test_joint_bound_is_never_worse_than_either_instrument(small_config):
    result = compare_instruments(ExperimentConfig.model_validate(small_config), monte_carlo=0)
    cases = result["cases"]
    for name in ("mass_kg", "depth_m", "x_m"):
        joint = cases["joint"]["std"][name]
        assert joint <= cases["clock"]["std"][name] * (1 + 1e-9)
        assert joint <= cases["gravimeter"]["std"][name] * (1 + 1e-9)
    assert cases["joint"]["snr"] ** 2 == pytest.approx(cases["clock"]["snr"] ** 2 + cases["gravimeter"]["snr"] ** 2)


def test_cramer_rao_bound_agrees_with_monte_carlo(small_config):
    """Where the signal is strong the fits are linear and the empirical scatter follows the bound."""
    result = compare_instruments(ExperimentConfig.model_validate(small_config), monte_carlo=120)
    for case in ("gravimeter", "joint"):
        summary = result["cases"][case]
        mc = summary["monte_carlo"]
        assert mc["converged"] >= 110
        assert mc["depth_std_m"] == pytest.approx(summary["std"]["depth_m"], rel=0.3)
        assert mc["mass_std_kg"] == pytest.approx(summary["std"]["mass_kg"], rel=0.3)


def test_clock_sweep_recovers_gravimeter_limit_and_clock_dominance(small_config):
    result = compare_instruments(ExperimentConfig.model_validate(small_config), monte_carlo=0)
    sweep = result["clock_sweep"]
    gains = [g for g in sweep["depth_gain"] if g is not None]
    # Bad clocks add nothing; very good clocks dominate the joint estimate.
    assert gains[-1] == pytest.approx(1.0, abs=1e-3)
    assert gains[0] < 0.5
    assert all(a <= b + 1e-9 for a, b in zip(gains, gains[1:]))
    snr = sweep["clock_snr"]
    assert snr[0] / snr[-1] == pytest.approx(sweep["clock_sigma"][-1] / sweep["clock_sigma"][0], rel=1e-9)


def test_absolute_gravimeter_has_no_nuisance_terms(survey, small_config):
    absolute = _Survey(ExperimentConfig.model_validate(small_config), GRAVIMETERS["absolute"], 2e-8)
    assert absolute.nuisance_count("gravimeter") == 0
    assert survey.nuisance_count("gravimeter") == 2
    assert absolute.snr(_source(small_config), "gravimeter") > survey.snr(_source(small_config), "gravimeter")


def test_covariance_rejects_unidentifiable_parameters():
    jac = np.column_stack([np.ones(10), 2 * np.ones(10)])
    assert _covariance(jac) is None


def test_published_benchmarks_all_pass():
    result = benchmarks()
    failed = [(b["id"], r["quantity"]) for b in result["benchmarks"] for r in b["rows"] if not r["passed"]]
    assert failed == []
    assert result["total"] >= 9


def test_instruments_api(client, small_config):
    res = client.post("/api/experiments/instruments", json={"config": small_config, "monte_carlo": 0})
    assert res.status_code == 200, res.text
    body = res.json()
    assert set(body["cases"]) == {"clock", "gravimeter", "joint"}
    assert body["gravimeter"]["relative"] is True
    absolute = client.post("/api/experiments/instruments",
                           json={"config": small_config, "gravimeter": "absolute", "gravimeter_sigma_ugal": 10,
                                 "monte_carlo": 0}).json()
    assert absolute["gravimeter"]["reading_sigma_m_s2"] == pytest.approx(1e-7)
    small_config["survey"]["spacing_m"] = -1
    bad = client.post("/api/experiments/instruments", json={"config": small_config})
    assert bad.status_code == 422


def test_benchmarks_api(client):
    body = client.get("/api/benchmarks").json()
    assert body["passed"] == body["total"]
    assert {b["id"] for b in body["benchmarks"]} == {"skytree-2020", "modane-2018", "bondarescu-2012"}
