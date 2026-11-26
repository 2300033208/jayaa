"""Field data and elevation-model endpoints: upload, list, analyse, preview and delete."""

from __future__ import annotations

import asyncio
import hashlib
import re
import unicodedata
from typing import Any

import numpy as np
from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import Response

from . import terrain
from .api_common import ApiError, current_user, datasets, json_response, owned_experiment, require_valid, store
from .config import ExperimentConfig
from .fielddata import MAX_FILE_BYTES as DATASET_MAX_BYTES
from .fielddata import FieldDataError, parse_csv, template_csv
from .store import valid_id

router = APIRouter()
NAME_MAX = 120
PREVIEW_MAX_CELLS = 160
UPLOAD_LIMITS = {"dataset": DATASET_MAX_BYTES, "terrain": terrain.MAX_FILE_BYTES}


def _clean_name(value: str, field: str) -> str:
    name = value.strip()
    if not name:
        raise ApiError(422, "invalid_request", "Some values are invalid.", [{"field": field, "message": "Name is required."}])
    if len(name) > NAME_MAX or any(unicodedata.category(ch).startswith("C") for ch in name):
        raise ApiError(422, "invalid_request", "Some values are invalid.",
                       [{"field": field, "message": f"Use at most {NAME_MAX} printable characters."}])
    return name


def _file_name(upload: UploadFile) -> str:
    """Base name of the uploaded file, reduced to safe characters (it is only displayed)."""
    raw = (upload.filename or "upload").replace("\\", "/").rsplit("/", 1)[-1]
    cleaned = re.sub(r"[^A-Za-z0-9 ._()-]", "_", raw).strip(" .")[:120]
    return cleaned or "upload"


async def _read_limited(upload: UploadFile, limit: int) -> bytes:
    data = await upload.read(limit + 1)
    if len(data) > limit:
        raise ApiError(413, "file_too_large", f"The file is larger than {limit // (1024 * 1024)} MB.")
    if not data:
        raise ApiError(422, "invalid_file", "The file is empty.")
    return data


def _optional_number(text: str | None, field: str, low: float, high: float) -> float | None:
    if text is None or text.strip() == "":
        return None
    if not re.fullmatch(r"[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?", text.strip()):
        raise ApiError(422, "invalid_request", "Some values are invalid.", [{"field": field, "message": "Not a number."}])
    value = float(text)
    if not low <= value <= high:
        raise ApiError(422, "invalid_request", "Some values are invalid.",
                       [{"field": field, "message": f"Must be between {low:g} and {high:g}."}])
    return value


# ---------------------------------------------------------------------------- field datasets


def _owned_dataset(request: Request, user: dict[str, Any], dataset_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    meta = store(request).get_dataset(dataset_id) if valid_id(dataset_id) else None
    if meta is None:
        raise ApiError(404, "not_found", "Dataset not found.")
    exp = store(request).get_experiment(meta["experiment_id"])
    if exp is None or exp["owner_id"] != user["id"]:
        raise ApiError(404, "not_found", "Dataset not found.")
    return datasets(request).decorate(meta), exp


@router.get("/api/experiments/{exp_id}/datasets")
async def list_datasets(request: Request, exp_id: str, user: dict = Depends(current_user)) -> Response:
    owned_experiment(request, user, exp_id)
    mgr = datasets(request)
    return json_response({"items": [mgr.decorate(m) for m in store(request).datasets_for(exp_id)]})


@router.get("/api/experiments/{exp_id}/datasets/template")
async def dataset_template(request: Request, exp_id: str, user: dict = Depends(current_user)) -> Response:
    exp = owned_experiment(request, user, exp_id)
    config = ExperimentConfig.model_validate(exp["config"])
    require_valid(request, user, config)
    text = await asyncio.to_thread(template_csv, config)
    return Response(text, media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{exp["code"]}-field-template.csv"'})


@router.post("/api/experiments/{exp_id}/datasets")
async def upload_dataset(
    request: Request,
    exp_id: str,
    file: UploadFile = File(...),
    name: str = Form(..., max_length=NAME_MAX * 4),
    reference_x_m: str | None = Form(default=None, max_length=40),
    reference_y_m: str | None = Form(default=None, max_length=40),
    reference_height_m: str | None = Form(default=None, max_length=40),
    user: dict = Depends(current_user),
) -> Response:
    exp = owned_experiment(request, user, exp_id)
    label = _clean_name(name, "name")
    options = {
        "reference_x_m": _optional_number(reference_x_m, "reference_x_m", -1e6, 1e6),
        "reference_y_m": _optional_number(reference_y_m, "reference_y_m", -1e6, 1e6),
        "reference_height_m": _optional_number(reference_height_m, "reference_height_m", -1000, 10000),
    }
    data = await _read_limited(file, DATASET_MAX_BYTES)
    try:
        columns = await asyncio.to_thread(parse_csv, data)
    except FieldDataError as exc:
        raise ApiError(422, "invalid_file", str(exc), extra={"problems": exc.problems}) from None
    config = ExperimentConfig.model_validate(exp["config"])
    require_valid(request, user, config)
    meta = {
        "name": label,
        "file_name": _file_name(file),
        "file_sha256": hashlib.sha256(data).hexdigest(),
        "size_bytes": len(data),
        "measurement_count": len(columns["station"]),
        "station_count": len(set(columns["station"])),
        "start_utc": columns["time_utc"][0],
        "end_utc": columns["time_utc"][-1],
        "has_averaging_column": "averaging_s" in columns,
        "options": options,
        "status": "analysing",
        "progress": 0.0,
        "error": None,
        "summary": None,
        "analysed_at": None,
    }
    created = store(request).create_dataset(exp_id, meta, columns)
    started = datasets(request).start(created, exp, config)
    return json_response(started, 201)


@router.get("/api/datasets/{dataset_id}")
async def get_dataset(request: Request, dataset_id: str, user: dict = Depends(current_user)) -> Response:
    meta, _ = _owned_dataset(request, user, dataset_id)
    return json_response(meta)


@router.get("/api/datasets/{dataset_id}/results")
async def dataset_results(request: Request, dataset_id: str, user: dict = Depends(current_user)) -> Response:
    meta, _ = _owned_dataset(request, user, dataset_id)
    if meta["status"] != "ready":
        raise ApiError(409, "results_not_ready", "Results are available after the analysis completes.",
                       extra={"status": meta["status"]})
    doc = store(request).dataset_analysis(dataset_id)
    if doc is None:
        raise ApiError(404, "not_found", "Analysis not found.")
    return json_response({"dataset": meta, **doc})


@router.post("/api/datasets/{dataset_id}/analyse")
async def reanalyse_dataset(request: Request, dataset_id: str, user: dict = Depends(current_user)) -> Response:
    meta, exp = _owned_dataset(request, user, dataset_id)
    if datasets(request).active(dataset_id):
        raise ApiError(409, "analysis_active", "The dataset is already being analysed.")
    config = ExperimentConfig.model_validate(exp["config"])
    require_valid(request, user, config)
    return json_response(datasets(request).start(meta, exp, config))


@router.post("/api/datasets/{dataset_id}/cancel")
async def cancel_dataset(request: Request, dataset_id: str, user: dict = Depends(current_user)) -> Response:
    meta, _ = _owned_dataset(request, user, dataset_id)
    if not datasets(request).active(dataset_id):
        raise ApiError(409, "analysis_finished", "The analysis has already finished.")
    datasets(request).cancel(dataset_id)
    return json_response(meta)


@router.delete("/api/datasets/{dataset_id}")
async def delete_dataset(request: Request, dataset_id: str, user: dict = Depends(current_user)) -> Response:
    _owned_dataset(request, user, dataset_id)
    datasets(request).cancel(dataset_id)
    store(request).delete_dataset(dataset_id)
    return Response(status_code=204)


# ---------------------------------------------------------------------------- elevation models


def load_grid(st: Any, terrain_id: str) -> terrain.ElevationGrid | None:
    """Loader for the terrain registry: stored grid bytes back to an array."""
    meta = st.get_terrain_model(terrain_id)
    raw = st.terrain_grid(terrain_id) if meta is not None else None
    if meta is None or raw is None:
        return None
    heights = np.frombuffer(raw, dtype="<f4").reshape(meta["rows"], meta["columns"])
    return terrain.ElevationGrid(id=terrain_id, georef=terrain.Georeference.from_json(meta["georeference"]),
                                 heights=heights)


def _public_terrain(meta: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in meta.items() if k != "owner_id"}


def _owned_terrain(request: Request, user: dict[str, Any], terrain_id: str) -> dict[str, Any]:
    meta = store(request).get_terrain_model(terrain_id) if valid_id(terrain_id) else None
    if meta is None or meta["owner_id"] != user["id"]:
        raise ApiError(404, "not_found", "Elevation model not found.")
    return meta


@router.get("/api/terrain-models")
async def list_terrain_models(request: Request, user: dict = Depends(current_user)) -> Response:
    return json_response({"items": [_public_terrain(m) for m in store(request).terrain_models_for(user["id"])]})


@router.post("/api/terrain-models")
async def upload_terrain_model(
    request: Request,
    file: UploadFile = File(...),
    name: str = Form(..., max_length=NAME_MAX * 4),
    crs: str | None = Form(default=None, max_length=20),
    utm_zone: str | None = Form(default=None, max_length=4),
    hemisphere: str | None = Form(default=None, max_length=10),
    user: dict = Depends(current_user),
) -> Response:
    label = _clean_name(name, "name")
    if crs not in (None, "", "geographic", "utm"):
        raise ApiError(422, "invalid_request", "Some values are invalid.",
                       [{"field": "crs", "message": "Choose latitude/longitude or UTM."}])
    if hemisphere not in (None, "", "north", "south"):
        raise ApiError(422, "invalid_request", "Some values are invalid.",
                       [{"field": "hemisphere", "message": "Choose north or south."}])
    zone = None
    if utm_zone not in (None, ""):
        if not re.fullmatch(r"\d{1,2}", utm_zone or "") or not 1 <= int(utm_zone or 0) <= 60:
            raise ApiError(422, "invalid_request", "Some values are invalid.",
                           [{"field": "utm_zone", "message": "UTM zones are 1–60."}])
        zone = int(utm_zone or 0)
    data = await _read_limited(file, terrain.MAX_FILE_BYTES)
    file_name = _file_name(file)

    def build():
        parsed = terrain.parse_file(data, file_name)
        return parsed, *terrain.build_model(parsed, crs or None, zone, hemisphere or None)  # type: ignore[arg-type]

    try:
        parsed, georef, summary = await asyncio.to_thread(build)
    except terrain.TerrainFileError as exc:
        raise ApiError(422, "invalid_file", str(exc)) from None
    meta = {"name": label, "file_name": file_name, "file_sha256": terrain.file_checksum(data), "size_bytes": len(data),
            "georeference": georef.to_json(), **summary}
    created = store(request).create_terrain_model(user["id"], meta, terrain.grid_bytes(parsed.heights))
    return json_response(_public_terrain(created), 201)


@router.get("/api/terrain-models/{terrain_id}")
async def get_terrain_model(request: Request, terrain_id: str, user: dict = Depends(current_user)) -> Response:
    meta = _owned_terrain(request, user, terrain_id)
    return json_response({**_public_terrain(meta), "used_by": store(request).experiments_using_terrain(terrain_id)})


@router.get("/api/terrain-models/{terrain_id}/preview")
async def terrain_preview(request: Request, terrain_id: str, user: dict = Depends(current_user)) -> Response:
    """Heights reduced to at most PREVIEW_MAX_CELLS per axis (block maxima keep peaks visible), in the file's
    own coordinates."""
    _owned_terrain(request, user, terrain_id)
    grid = terrain.get_grid(terrain_id)
    if grid is None:
        raise ApiError(404, "not_found", "Elevation model not found.")
    rows, cols = grid.heights.shape
    step = max(1, int(np.ceil(max(rows, cols) / PREVIEW_MAX_CELLS)))
    reduced = grid.heights[::step, ::step].astype(np.float64)
    g = grid.georef
    return json_response({
        "x": (g.x0 + g.dx * step * np.arange(reduced.shape[1])).tolist(),
        "y": (g.y0 + g.dy * step * np.arange(reduced.shape[0])).tolist(),
        "heights": [[None if not np.isfinite(v) else float(v) for v in row] for row in reduced],
        "crs": g.crs, "utm_zone": g.utm_zone, "hemisphere": g.hemisphere, "step": step,
    })


@router.delete("/api/terrain-models/{terrain_id}")
async def delete_terrain_model(request: Request, terrain_id: str, user: dict = Depends(current_user)) -> Response:
    _owned_terrain(request, user, terrain_id)
    used = store(request).experiments_using_terrain(terrain_id)
    if used:
        raise ApiError(409, "terrain_in_use",
                       f"Experiments {', '.join(used)} use this elevation model. Change their terrain first.",
                       extra={"experiments": used})
    store(request).delete_terrain_model(terrain_id)
    terrain.forget(terrain_id)
    return Response(status_code=204)
