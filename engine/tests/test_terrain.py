"""Elevation models: projection, file parsing, sampling, terrain physics and the upload API."""

import io
import math

import numpy as np
import pytest
import tifffile
from conftest import register, scenario_config

from engine import terrain
from engine.config import ExperimentConfig
from engine.site import local_offsets_to_latlon, terrain_field
from engine.survey import terrain_elevation
from engine.validation import validate_config


def test_utm_projection_matches_reference_values():
    # Equator, 3° east of the central meridian (zone edge) and 45° N on the central meridian:
    # standard check values of the WGS 84 transverse Mercator (0.9996 × meridian arc 4 984 944.378 m).
    e, n = terrain.utm_forward(np.array([0.0]), np.array([6.0]), 31, False)
    assert e[0] == pytest.approx(833_978.557, abs=0.001) and n[0] == 0.0
    e, n = terrain.utm_forward(np.array([45.0]), np.array([3.0]), 31, False)
    assert e[0] == pytest.approx(500_000.0, abs=1e-6) and n[0] == pytest.approx(4_982_950.400, abs=0.001)
    _, n_south = terrain.utm_forward(np.array([-45.0]), np.array([3.0]), 31, True)
    assert n_south[0] == pytest.approx(10_000_000.0 - 4_982_950.400, abs=0.001)


def _ascii_grid(heights: np.ndarray, x0: float, y0_south: float, cell: float, nodata: float | None = None,
                corner: bool = True) -> bytes:
    rows, cols = heights.shape
    key = "corner" if corner else "center"
    lines = [f"ncols {cols}", f"nrows {rows}", f"xll{key} {x0}", f"yll{key} {y0_south}", f"cellsize {cell}"]
    if nodata is not None:
        lines.append(f"NODATA_value {nodata}")
    lines += [" ".join(f"{v:.6f}" for v in row) for row in heights]
    return ("\n".join(lines) + "\n").encode()


def test_ascii_grid_is_parsed_north_first():
    heights = np.array([[3.0, 4.0, 5.0], [0.0, 1.0, -9999.0]])
    parsed = terrain.parse_ascii_grid(_ascii_grid(heights, 10.0, 20.0, 2.0, nodata=-9999))
    assert parsed.x0 == 11.0 and parsed.y0 == 23.0 and parsed.dx == 2.0 and parsed.dy == -2.0
    assert np.isnan(parsed.heights[1, 2]) and parsed.heights[0, 0] == 3.0
    centred = terrain.parse_ascii_grid(_ascii_grid(heights, 11.0, 21.0, 2.0, corner=False))
    assert (centred.x0, centred.y0) == (11.0, 23.0)


@pytest.mark.parametrize("text, fragment", [
    (b"ncols 2\nnrows 2\nxllcorner 0\nyllcorner 0\ncellsize 1\n1 2 3\n", "Expected 2 × 2 = 4 heights, found 3"),
    (b"ncols 2\nnrows 2\nxllcorner 0\ncellsize 1\n1 2\n3 4\n", "xllcorner/yllcorner"),
    (b"ncols 2\nnrows 2\nxllcorner 0\nyllcorner 0\ncellsize 1\nfoo 2\n1 2 3 4\n", "Unknown header key"),
    (b"ncols 2\nnrows 2\nxllcorner 0\nyllcorner 0\ncellsize 1\n1 nan\n3 4\n", "NaN or infinite"),
    (b"ncols 5000\nnrows 5000\nxllcorner 0\nyllcorner 0\ncellsize 1\n", "at most 4,000,000"),
])
def test_ascii_grid_errors(text, fragment):
    with pytest.raises(terrain.TerrainFileError, match=fragment):
        terrain.parse_ascii_grid(text)


def _geotiff(heights: np.ndarray, x_tl: float, y_tl: float, cell: float, keys: list[int],
             nodata: str | None = None, compression: str | None = "lzw") -> bytes:
    directory = [1, 1, 0, len(keys) // 4, *keys]
    extratags = [(33550, "d", 3, (cell, cell, 0.0), False), (33922, "d", 6, (0, 0, 0, x_tl, y_tl, 0), False),
                 (34735, "H", len(directory), tuple(directory), False)]
    if nodata is not None:
        extratags.append((42113, "s", 0, nodata, False))
    buf = io.BytesIO()
    tifffile.imwrite(buf, heights.astype(np.float32), extratags=extratags, compression=compression)
    return buf.getvalue()


def test_geotiff_utm_and_geographic_georeferencing():
    heights = np.arange(12, dtype=np.float32).reshape(3, 4) + 100
    heights[2, 3] = -32768
    utm = terrain.parse_geotiff(_geotiff(heights, 500_000.0, 4_000_000.0, 30.0,
                                         [1024, 0, 1, 1, 3072, 0, 1, 32633], nodata="-32768"))
    assert (utm.crs, utm.utm_zone, utm.hemisphere, utm.datum) == ("utm", 33, "north", "WGS 84")
    assert utm.x0 == 500_015.0 and utm.y0 == 3_999_985.0 and utm.dy == -30.0
    assert np.isnan(utm.heights[2, 3]) and utm.heights[0, 1] == 101.0
    geo = terrain.parse_geotiff(_geotiff(heights, 10.0, 46.0, 0.001, [1024, 0, 1, 2, 2048, 0, 1, 4326],
                                         compression=None))
    assert geo.crs == "geographic" and geo.x0 == pytest.approx(10.0005)
    with pytest.raises(terrain.TerrainFileError, match="EPSG:3857 is not supported"):
        terrain.parse_geotiff(_geotiff(heights, 0, 0, 30.0, [1024, 0, 1, 1, 3072, 0, 1, 3857]))
    with pytest.raises(terrain.TerrainFileError, match="not a readable TIFF"):
        terrain.parse_geotiff(b"garbage")
    with pytest.raises(terrain.TerrainFileError, match="contains no image"):
        terrain.parse_geotiff(b"II*\x00garbage")


def test_model_checks_units_and_coordinates():
    parsed = terrain.parse_ascii_grid(_ascii_grid(np.full((3, 3), 12000.0), 10.0, 45.0, 0.01))
    with pytest.raises(terrain.TerrainFileError, match="expected metres above sea level"):
        terrain.build_model(parsed, "geographic", None, None)
    parsed = terrain.parse_ascii_grid(_ascii_grid(np.full((3, 3), 120.0), 500_000.0, 4_000_000.0, 30.0))
    with pytest.raises(terrain.TerrainFileError, match="not valid latitudes"):
        terrain.build_model(parsed, "geographic", None, None)
    with pytest.raises(terrain.TerrainFileError, match="Select the grid's coordinate system"):
        terrain.build_model(parsed, None, None, None)
    georef, summary = terrain.build_model(parsed, "utm", 33, "north")
    assert georef.crs == "utm" and summary["rows"] == 3 and summary["max_height_m"] == 120.0


# ---------------------------------------------------------------------------- sampling and physics


def _register(grid_id: str, grid: terrain.ElevationGrid):
    terrain.set_loader(lambda tid: grid if tid == grid_id else None)


def _slope_dem(cfg: dict, grid_id: str, extra: float = 2000.0, install: bool = True) -> terrain.ElevationGrid:
    """A geographic DEM of the synthetic "slope" terrain around the site, heights in metres above sea level."""
    env = ExperimentConfig.model_validate(cfg).environment
    survey = ExperimentConfig.model_validate(cfg).survey
    half = max(survey.width_m, survey.length_m) / 2 + extra
    n = 161
    lat, lon = local_offsets_to_latlon(env.latitude_deg, env.longitude_deg, np.zeros(2), np.array([-half, half]))
    lat_s, lat_n = lat
    lon_w = local_offsets_to_latlon(env.latitude_deg, env.longitude_deg, np.array([-half]), np.zeros(1))[1][0]
    lon_e = local_offsets_to_latlon(env.latitude_deg, env.longitude_deg, np.array([half]), np.zeros(1))[1][0]
    lats = np.linspace(lat_n, lat_s, n)
    lons = np.linspace(lon_w, lon_e, n)
    # Invert the local→lat/lon mapping for the grid points (east offset from longitude, north from latitude).
    r = 6_371_008.8
    east = np.deg2rad(lons - env.longitude_deg) * r * math.cos(math.radians(env.latitude_deg))
    north = np.deg2rad(lats - env.latitude_deg) * r
    ee, nn = np.meshgrid(east, north)
    slope_env = env.model_copy(update={"terrain": "slope"})
    heights = terrain_elevation(ee.ravel(), nn.ravel(), slope_env, survey).reshape(n, n) + env.elevation_m
    georef = terrain.Georeference(crs="geographic", utm_zone=None, hemisphere=None, x0=float(lons[0]),
                                  y0=float(lats[0]), dx=float(lons[1] - lons[0]), dy=float(lats[1] - lats[0]))
    grid = terrain.ElevationGrid(id=grid_id, georef=georef, heights=heights.astype(np.float32))
    if install:
        _register(grid_id, grid)
    return grid


@pytest.fixture
def slope_config():
    cfg = scenario_config("ore-projected")
    cfg["survey"]["spacing_m"] = 1000
    cfg["environment"].update({"terrain": "slope", "terrain_relief_m": 120.0, "elevation_m": 350.0})
    yield cfg
    terrain.set_loader(None)


def test_dem_reproduces_the_equivalent_synthetic_terrain(slope_config):
    """A DEM of the synthetic slope gives the same ground heights and terrain potential as the slope model."""
    grid_id = "d" * 32
    _slope_dem(slope_config, grid_id)
    synthetic = ExperimentConfig.model_validate(slope_config)
    dem_cfg = {**slope_config, "environment": {**slope_config["environment"], "terrain": "dem",
                                               "terrain_model_id": grid_id}}
    dem = ExperimentConfig.model_validate(dem_cfg)
    x = np.linspace(-3500, 3500, 15)
    y = np.linspace(-3000, 3000, 15)
    h_syn = terrain_elevation(x, y, synthetic.environment, synthetic.survey)
    h_dem = terrain_elevation(x, y, dem.environment, dem.survey)
    assert np.max(np.abs(h_dem - h_syn)) < 0.01  # float32 storage and bilinear interpolation of a plane
    z = h_syn + 1.0
    phi_syn, _ = terrain_field(synthetic.environment, synthetic.survey, 1.0, 2670.0, x, y, z)
    phi_dem, _ = terrain_field(dem.environment, dem.survey, 1.0, 2670.0, x, y, z)
    assert np.max(np.abs(phi_dem - phi_syn)) < 1e-3 * np.max(np.abs(phi_syn))
    report = validate_config(dem)
    assert report.valid, report.errors


def test_dem_validation_reports_missing_and_partial_coverage(slope_config):
    grid_id = "e" * 32
    _slope_dem(slope_config, grid_id, extra=-2500.0)  # smaller than the survey area
    dem_cfg = {**slope_config, "environment": {**slope_config["environment"], "terrain": "dem",
                                               "terrain_model_id": grid_id}}
    errors = {e["field"]: e["message"] for e in validate_config(ExperimentConfig.model_validate(dem_cfg)).errors}
    assert errors["environment.terrain_model_id"] == "The elevation model does not cover the whole survey area."
    dem_cfg["environment"]["terrain_model_id"] = None
    errors = {e["field"]: e["message"] for e in validate_config(ExperimentConfig.model_validate(dem_cfg)).errors}
    assert errors["environment.terrain_model_id"] == "Select an elevation model."
    synthetic = {**slope_config, "environment": {**slope_config["environment"], "terrain_model_id": grid_id}}
    errors = {e["field"] for e in validate_config(ExperimentConfig.model_validate(synthetic)).errors}
    assert "environment.terrain_model_id" in errors


def test_site_elevation_far_from_the_dem_is_flagged(slope_config):
    grid_id = "f" * 32
    _slope_dem(slope_config, grid_id)
    cfg = {**slope_config, "environment": {**slope_config["environment"], "terrain": "dem",
                                           "terrain_model_id": grid_id, "elevation_m": 250.0}}
    report = validate_config(ExperimentConfig.model_validate(cfg))
    warnings = {w["field"]: w["message"] for w in report.warnings}
    assert "mean height over the survey area is 350 m" in warnings["environment.elevation_m"]


# ---------------------------------------------------------------------------- API


def _upload(client, data: bytes, filename: str, **form):
    return client.post("/api/terrain-models", data={"name": "Site DEM", **form},
                       files={"file": (filename, io.BytesIO(data), "application/octet-stream")})


def _site_grid_bytes(cfg: dict) -> bytes:
    grid = _slope_dem(cfg, "0" * 32, install=False)  # the app's own loader stays in place
    g = grid.georef
    rows, _ = grid.heights.shape
    return _ascii_grid(grid.heights.astype(np.float64), g.x0, g.y0 + (rows - 1) * g.dy, g.dx, corner=False)


def test_terrain_model_api_ownership_and_use(client, slope_config):
    data = _site_grid_bytes(slope_config)
    res = _upload(client, data, "site.asc")
    assert res.status_code == 422 and "coordinate system" in res.json()["error"]["message"]
    res = _upload(client, data, "site.asc", crs="geographic")
    assert res.status_code == 201, res.text
    model = res.json()
    assert model["rows"] == 161 and model["georeference"]["crs"] == "geographic" and "owner_id" not in model
    cfg = {**slope_config, "environment": {**slope_config["environment"], "terrain": "dem",
                                           "terrain_model_id": model["id"]}}
    exp = client.post("/api/experiments", json={"config": cfg})
    assert exp.status_code == 201, exp.text
    plan = client.get(f"/api/experiments/{exp.json()['id']}/plan").json()
    assert max(max(row) for row in plan["terrain"]["elevation_m"]) > 50  # the DEM's slope, relative to 350 m
    preview = client.get(f"/api/terrain-models/{model['id']}/preview").json()
    assert len(preview["heights"]) == 81 and preview["step"] == 2
    in_use = client.delete(f"/api/terrain-models/{model['id']}")
    assert in_use.status_code == 409 and in_use.json()["error"]["experiments"] == ["EXP-00001"]

    # Another account can neither see the model nor use it in a configuration.
    client.post("/api/auth/logout")
    register(client, "other@example.org")
    assert client.get(f"/api/terrain-models/{model['id']}").status_code == 404
    assert client.get("/api/terrain-models").json()["items"] == []
    res = client.post("/api/experiments", json={"config": cfg})
    assert res.status_code == 422
    assert res.json()["error"]["fields"] == [{"field": "environment.terrain_model_id",
                                             "message": "Elevation model not found."}]
    check = client.post("/api/experiments/validate", json={"config": cfg}).json()
    assert check["valid"] is False


def test_terrain_upload_rejects_unsupported_files(client):
    assert _upload(client, b"not a grid", "site.png").status_code == 422
    assert _upload(client, b"", "site.asc", crs="geographic").status_code == 422
    res = _upload(client, b"ncols 2\nnrows 2\n", "site.asc", crs="utm", utm_zone="61", hemisphere="north")
    assert res.status_code == 422 and res.json()["error"]["fields"][0]["field"] == "utm_zone"
