import copy
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["ENGINE_TEST_HOOKS"] = "1"

from engine.contract import scenarios  # noqa: E402

# Physics and API tests use a fixed scenario (not the product default, which may change): a 5 × 10¹² kg
# ore body 1.5 km deep under an 8 km × 8 km grid, with projected clocks.
TEST_SCENARIO = "ore-projected"


def scenario_config(scenario_id: str) -> dict:
    for scenario in scenarios()["scenarios"]:
        if scenario["id"] == scenario_id:
            return copy.deepcopy(scenario["config"])
    raise KeyError(scenario_id)


@pytest.fixture
def config_dict():
    return scenario_config(TEST_SCENARIO)


@pytest.fixture
def small_config(config_dict):
    """A fast configuration: 9 × 9 grid, few bootstrap samples."""
    cfg = config_dict
    cfg["survey"]["spacing_m"] = 1000
    cfg["inversion"]["bootstrap_samples"] = 20
    return cfg


TEST_PASSWORD = "correct horse battery staple"


def _reset_database(url: str) -> None:
    """Empty a shared test database (PostgreSQL runs): drop every table so the app migrates from scratch."""
    from sqlalchemy import text

    from engine.db import Base, make_engine

    engine = make_engine(url)
    with engine.begin() as connection:
        Base.metadata.drop_all(connection)
        connection.execute(text("DROP TABLE IF EXISTS alembic_version"))
    engine.dispose()


@pytest.fixture
def anon_client(tmp_path, monkeypatch):
    """A browser-like client with no session. TEST_DATABASE_URL selects a PostgreSQL database; otherwise each
    test gets its own SQLite file."""
    monkeypatch.setenv("ENGINE_DATA_DIR", str(tmp_path / "data"))
    url = os.environ.get("TEST_DATABASE_URL")
    if url:
        monkeypatch.setenv("DATABASE_URL", url)
        _reset_database(url)
    else:
        monkeypatch.delenv("DATABASE_URL", raising=False)
    from fastapi.testclient import TestClient

    from engine.main import app

    with TestClient(app) as c:
        c.headers["X-Requested-With"] = "XMLHttpRequest"
        yield c


def register(client, email: str, name: str = "Test researcher", password: str = TEST_PASSWORD):
    res = client.post("/api/auth/register", json={"email": email, "display_name": name, "password": password})
    assert res.status_code == 201, res.text
    return res.json()["user"]


@pytest.fixture
def client(anon_client):
    """A client signed in as a fresh researcher account."""
    register(anon_client, "researcher@example.org")
    return anon_client
