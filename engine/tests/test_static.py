"""The engine serves the built frontend: one process, one port, same origin as the API."""

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def site(tmp_path, monkeypatch):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>App</title>", encoding="utf-8")
    (dist / "assets" / "app-1a2b.js").write_text("console.log(1)", encoding="utf-8")
    (tmp_path / "secret.txt").write_text("secret", encoding="utf-8")
    monkeypatch.setenv("ENGINE_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("ENGINE_STATIC_DIR", str(dist))
    from engine.main import app

    with TestClient(app) as client:
        yield client


def test_pages_assets_and_security_headers(site):
    page = site.get("/experiments/abc/analysis")
    assert page.status_code == 200 and "<title>App</title>" in page.text
    csp = page.headers["content-security-policy"]
    assert "script-src 'self'" in csp and "frame-ancestors 'none'" in csp and "unsafe-eval" not in csp
    assert page.headers["cache-control"] == "no-cache"
    asset = site.get("/assets/app-1a2b.js")
    assert asset.headers["content-type"].startswith("text/javascript")
    assert "immutable" in asset.headers["cache-control"]
    assert site.get("/assets/missing.js").status_code == 404


@pytest.mark.parametrize("path", ["/..%2Fsecret.txt", "/%2e%2e/secret.txt", "/assets/..%2F..%2Fsecret.txt"])
def test_paths_outside_the_build_are_not_served(site, path):
    res = site.get(path)
    assert res.status_code in (404, 400) and "secret" not in res.text


def test_unknown_api_paths_are_json_404(site):
    res = site.get("/api/nothing-here")
    assert res.status_code == 404 and res.json()["error"]["code"] == "not_found"
