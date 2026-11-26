"""HTTP + WebSocket API for the simulation engine.

Every endpoint except health, defaults and sign-in requires a session; every experiment, run, study,
dataset and elevation model is visible only to its owner (others get 404, so existence is not revealed).
"""

from __future__ import annotations

import asyncio
import mimetypes
import os
from contextlib import asynccontextmanager
from typing import Any, Literal

from fastapi import Depends, FastAPI, Header, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, ConfigDict, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import ENGINE_VERSION, auth, terrain
from .api_common import (ApiError, Settings, authenticate, current_user, datasets, load_settings, manager,
                         origin_allowed, owned_experiment, require_valid, settings, store, studies,
                         terrain_access_errors)
from .api_common import json_response as _json
from .benchmarks import benchmarks
from .config import ExperimentConfig, Playback, configuration_hash
from .contract import clock_presets, default_config, field_spec, limits, scenarios
from .dataset_runner import DatasetManager
from .design import DesignRequest, design_survey
from .detectability import detectability
from .geometry import body_geometry
from .instruments import InstrumentRequest, compare_instruments
from .report import export_csv, export_json, render_report
from .routes_auth import router as auth_router
from .routes_field import UPLOAD_LIMITS, load_grid
from .routes_field import router as field_router
from .runner import ACTIVE, ConflictError, SimulationManager, SimulationRun, plan_document
from .serialization import dumps, measurement_columns
from .store import Store, valid_id
from .studies import StudyRequest, validate_request
from .study_runner import StudyManager
from .survey import plan_survey
from .validation import validate_config

HEARTBEAT_S = 10.0
BACKLOG_CHUNK = 2000
RESULT_SECTIONS = ("summary", "noise_budget", "comparison", "ground_truth")
UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
UPLOAD_OVERHEAD_BYTES = 64 * 1024  # multipart framing and form fields
UPLOAD_PATHS = (("/datasets", UPLOAD_LIMITS["dataset"]), ("/api/terrain-models", UPLOAD_LIMITS["terrain"]))
MAX_JSON_BYTES = 2 * 1024 * 1024
CONTENT_SECURITY_POLICY = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
    "font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; "
    "form-action 'self'; frame-ancestors 'none'"
)
SECURITY_HEADERS = [
    (b"x-content-type-options", b"nosniff"),
    (b"referrer-policy", b"same-origin"),
    (b"x-frame-options", b"DENY"),
    (b"cross-origin-opener-policy", b"same-origin"),
    (b"permissions-policy", b"camera=(), microphone=(), geolocation=()"),
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    cfg = load_settings()
    app.state.settings = cfg
    app.state.store = Store(cfg.database_url)
    app.state.throttle = auth.LoginThrottle()
    terrain.set_loader(lambda terrain_id: load_grid(app.state.store, terrain_id))
    app.state.manager = SimulationManager(app.state.store)
    app.state.studies = StudyManager(app.state.store)
    app.state.datasets = DatasetManager(app.state.store)
    yield
    await app.state.manager.shutdown()
    await asyncio.to_thread(app.state.studies.shutdown)
    await asyncio.to_thread(app.state.datasets.shutdown)
    terrain.set_loader(None)
    app.state.store.close()


class SecurityMiddleware:
    """Response security headers; request-forgery and request-size checks for state-changing API calls."""

    def __init__(self, app):  # noqa: ANN001 - ASGI application
        self.app = app

    @staticmethod
    async def _reject(send, status: int, code: str, message: str) -> None:  # noqa: ANN001
        body = dumps({"error": {"code": code, "message": message, "fields": []}}).encode("utf-8")
        await send({"type": "http.response.start", "status": status,
                    "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode()),
                                (b"cache-control", b"no-store"), *SECURITY_HEADERS]})
        await send({"type": "http.response.body", "body": body})

    async def __call__(self, scope, receive, send):  # noqa: ANN001
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        path: str = scope.get("path", "")
        if path.startswith("/api/") and scope.get("method") in UNSAFE_METHODS:
            cfg: Settings = scope["app"].state.settings
            if headers.get(auth.CSRF_HEADER.lower()) != auth.CSRF_VALUE:
                await self._reject(send, 403, "csrf_rejected",
                                   "The request was refused because it did not come from this application.")
                return
            if not origin_allowed(headers.get("origin"), headers.get("host"), cfg.allowed_origins):
                await self._reject(send, 403, "csrf_rejected", "The request was refused: unexpected origin.")
                return
            is_upload = headers.get("content-type", "").startswith("multipart/form-data")
            limit = MAX_JSON_BYTES
            if is_upload:
                limit = next((size for suffix, size in UPLOAD_PATHS if path.endswith(suffix)), 0) + UPLOAD_OVERHEAD_BYTES
            length_text = headers.get("content-length")
            if length_text is None:
                if headers.get("transfer-encoding"):
                    await self._reject(send, 411, "length_required", "Send the request with a Content-Length.")
                    return
            elif not length_text.isdigit() or int(length_text) > limit:
                await self._reject(send, 413, "file_too_large" if is_upload else "request_too_large",
                                   f"The request is larger than {max(1, limit // (1024 * 1024))} MB.")
                return

        async def send_with_headers(message):  # noqa: ANN001
            if message["type"] == "http.response.start":
                extra = list(SECURITY_HEADERS)
                if path.startswith("/api/"):
                    extra.append((b"cache-control", b"no-store"))
                else:
                    extra.append((b"content-security-policy", CONTENT_SECURITY_POLICY.encode()))
                message = {**message, "headers": [*message.get("headers", []), *extra]}
            await send(message)

        await self.app(scope, receive, send_with_headers)


app = FastAPI(title="Atomic Gravity Simulation Engine", version=ENGINE_VERSION, lifespan=lifespan,
              docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(SecurityMiddleware)
app.include_router(auth_router)
app.include_router(field_router)


# ---------------------------------------------------------------------------- error handling


@app.exception_handler(ApiError)
async def _api_error(_: Request, exc: ApiError) -> Response:
    body = {"error": {"code": exc.code, "message": exc.message, "fields": exc.fields, **exc.extra}}
    return _json(body, exc.status, headers=exc.headers)


@app.exception_handler(ConflictError)
async def _conflict(_: Request, exc: ConflictError) -> Response:
    return _json({"error": {"code": exc.code, "message": exc.message, "fields": []}}, 409)


@app.exception_handler(StarletteHTTPException)
async def _http_error(_: Request, exc: StarletteHTTPException) -> Response:
    code = {404: "not_found", 405: "method_not_allowed", 413: "request_too_large"}.get(exc.status_code, "http_error")
    return _json({"error": {"code": code, "message": str(exc.detail), "fields": []}}, exc.status_code)


def _field_path(loc: tuple[Any, ...]) -> str:
    parts = [str(p) for p in loc if p not in ("body",)]
    if parts and parts[0] == "config":
        parts = parts[1:]
    return ".".join(parts) or "request"


def _friendly(path: str, err: dict[str, Any]) -> str:
    try:
        spec = field_spec(path)
        label = spec["label"]
    except KeyError:
        label = path.split(".")[-1].replace("_", " ").capitalize() if path else "Value"
    kind = err.get("type", "")
    if kind == "missing":
        return f"{label} is required."
    if kind in ("finite_number", "float_parsing", "float_type", "int_parsing", "int_type", "int_from_float"):
        if kind == "int_from_float":
            return f"{label} must be a whole number."
        return f"{label} must be a finite number."
    if kind == "extra_forbidden":
        return f"Unknown field “{path.split('.')[-1]}”."
    return f"{label}: {err.get('msg', 'invalid value')}."


@app.exception_handler(RequestValidationError)
async def _validation_error(_: Request, exc: RequestValidationError) -> Response:
    fields = []
    for err in exc.errors():
        path = _field_path(tuple(err.get("loc", ())))
        fields.append({"field": path, "message": _friendly(path, err)})
    body = {"error": {"code": "invalid_request", "message": "The request contains invalid values.", "fields": fields}}
    return _json(body, 422)


@app.exception_handler(Exception)
async def _unexpected(_: Request, exc: Exception) -> Response:
    body = {"error": {"code": "internal_error", "message": f"Engine error ({type(exc).__name__}).", "fields": []}}
    return _json(body, 500)


# ---------------------------------------------------------------------------- request models


class _Req(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ConfigBody(_Req):
    config: ExperimentConfig


class UpdateBody(_Req):
    config: ExperimentConfig
    expected_version: int = Field(ge=1)


class StartBody(_Req):
    playback: Playback = "normal"
    expected_configuration_hash: str | None = Field(default=None, min_length=64, max_length=64)


class FailBody(_Req):
    phase: str


class InjectBody(_Req):
    raw: str


# ---------------------------------------------------------------------------- helpers


def _owned_sim(request: Request, user: dict[str, Any], sim_id: str) -> tuple[SimulationRun | None, dict[str, Any]]:
    """The run (live or stored) if its experiment belongs to the user."""
    if not valid_id(sim_id):
        raise ApiError(404, "not_found", "Simulation not found.")
    run = manager(request).get(sim_id)
    meta = run.status_json() if run is not None else store(request).get_simulation(sim_id)
    if meta is None:
        raise ApiError(404, "not_found", "Simulation not found.")
    exp = store(request).get_experiment(meta["experiment_id"])
    if exp is None or exp["owner_id"] != user["id"]:
        raise ApiError(404, "not_found", "Simulation not found.")
    return run, _public_meta(meta)


def _sim_status(request: Request, sim_id: str) -> dict[str, Any] | None:
    """Status of a run of an experiment the caller already owns."""
    run = manager(request).get(sim_id)
    if run is not None:
        return run.status_json()
    meta = store(request).get_simulation(sim_id)
    return _public_meta(meta) if meta is not None else None


def _public_meta(meta: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in meta.items() if k != "idempotency_key"}


def _latest_sim_json(request: Request, exp: dict[str, Any]) -> dict[str, Any] | None:
    sim_id = exp.get("latest_simulation_id")
    if not sim_id:
        return None
    meta = _sim_status(request, sim_id)
    if meta is None:
        return None
    return {
        "id": meta["id"],
        "status": meta["status"],
        "configuration_hash": meta["configuration_hash"],
        "experiment_version": meta["experiment_version"],
        "created_at": meta["created_at"],
        "completed_at": meta["completed_at"],
        "results_available": meta["results_available"],
    }


def _experiment_json(request: Request, exp: dict[str, Any]) -> dict[str, Any]:
    out = {k: v for k, v in exp.items() if k not in ("latest_simulation_id", "owner_id")}
    out["latest_simulation"] = _latest_sim_json(request, exp)
    return out


# ---------------------------------------------------------------------------- meta endpoints


@app.get("/api/health")
async def health() -> Response:
    return _json({"status": "ok", "engine_version": ENGINE_VERSION})


@app.get("/api/defaults")
async def defaults() -> Response:
    return _json({"config": default_config(), "presets": clock_presets(), "limits": limits(),
                  "scenarios": scenarios()})


# ---------------------------------------------------------------------------- experiments


@app.post("/api/experiments/validate")
async def validate(request: Request, body: ConfigBody, user: dict = Depends(current_user)) -> Response:
    access = terrain_access_errors(request, user, body.config)
    if access:
        return _json({"valid": False, "errors": access, "warnings": [], "derived": None})
    return _json((await asyncio.to_thread(validate_config, body.config)).to_json())


@app.post("/api/experiments/detectability")
async def detectability_study(request: Request, body: ConfigBody, user: dict = Depends(current_user)) -> Response:
    """Expected detection significance over source mass and depth for this site, survey and clock."""
    require_valid(request, user, body.config)
    return _json(await asyncio.to_thread(detectability, body.config))


@app.post("/api/experiments/design")
async def design_study(request: Request, body: DesignRequest, user: dict = Depends(current_user)) -> Response:
    """Station spacing and averaging time that detect a target within a fieldwork budget."""
    require_valid(request, user, body.config)
    return _json(await asyncio.to_thread(design_survey, body.config, body.target_mass_kg, body.target_depth_m,
                                         body.max_days))


@app.post("/api/experiments/instruments")
async def instrument_comparison(request: Request, body: InstrumentRequest,
                                user: dict = Depends(current_user)) -> Response:
    """Clock, gravimeter and joint clock + gravimeter surveys of the same stations (Cramér–Rao and Monte Carlo)."""
    require_valid(request, user, body.config)
    return _json(await asyncio.to_thread(compare_instruments, body.config, body.gravimeter,
                                         body.gravimeter_sigma_ugal, body.monte_carlo))


@app.get("/api/benchmarks")
async def published_benchmarks() -> Response:
    """Published experiments and synthetic cases recomputed with the engine's physics."""
    return _json(await asyncio.to_thread(benchmarks))


@app.post("/api/experiments")
async def create_experiment(request: Request, body: ConfigBody, user: dict = Depends(current_user)) -> Response:
    require_valid(request, user, body.config)
    exp = store(request).create_experiment(user["id"], body.config.model_dump(mode="json"),
                                           configuration_hash(body.config))
    return _json(_experiment_json(request, exp), 201)


@app.get("/api/experiments")
async def list_experiments(request: Request, limit: int = Query(default=50, ge=1, le=500),
                           user: dict = Depends(current_user)) -> Response:
    items = []
    for exp in store(request).list_experiments(user["id"], limit):
        cfg = exp["config"]
        items.append({
            "id": exp["id"],
            "code": exp["code"],
            "name": exp["name"],
            "created_at": exp["created_at"],
            "updated_at": exp["updated_at"],
            "version": exp["version"],
            "configuration_hash": exp["configuration_hash"],
            "body_count": len(cfg["bodies"]),
            "pattern": cfg["survey"]["pattern"],
            "sensor_mode": cfg["sensor"]["mode"],
            "latest_simulation": _latest_sim_json(request, exp),
        })
    return _json({"items": items})


@app.get("/api/experiments/{exp_id}")
async def get_experiment(request: Request, exp_id: str, user: dict = Depends(current_user)) -> Response:
    return _json(_experiment_json(request, owned_experiment(request, user, exp_id)))


@app.put("/api/experiments/{exp_id}")
async def update_experiment(request: Request, exp_id: str, body: UpdateBody,
                            user: dict = Depends(current_user)) -> Response:
    exp = owned_experiment(request, user, exp_id)
    if body.expected_version != exp["version"]:
        raise ApiError(409, "version_conflict",
                       "The experiment was modified elsewhere. Reload it before saving again.",
                       extra={"current_version": exp["version"]})
    active = manager(request).active_for(exp_id)
    new_hash = configuration_hash(body.config)
    if active is not None and new_hash != exp["configuration_hash"]:
        raise ApiError(409, "simulation_active",
                       "The configuration cannot change while a simulation is running. Cancel it first.",
                       extra={"simulation_id": active.id})
    require_valid(request, user, body.config)
    updated = store(request).update_experiment(exp_id, body.config.model_dump(mode="json"), new_hash)
    return _json(_experiment_json(request, updated))


@app.get("/api/experiments/{exp_id}/plan")
async def plan_preview(request: Request, exp_id: str, user: dict = Depends(current_user)) -> Response:
    exp = owned_experiment(request, user, exp_id)
    config = ExperimentConfig.model_validate(exp["config"])
    require_valid(request, user, config)
    bodies = [body_geometry(b) for b in config.bodies]
    plan = plan_survey(config.survey, config.environment, config.sensor)
    return _json(plan_document(config, plan, bodies, None))


@app.delete("/api/experiments/{exp_id}")
async def delete_experiment(request: Request, exp_id: str, user: dict = Depends(current_user)) -> Response:
    owned_experiment(request, user, exp_id)
    if manager(request).active_for(exp_id) is not None:
        raise ApiError(409, "simulation_active", "Cancel the running simulation before deleting the experiment.")
    for study_id in studies(request).active_for(exp_id):
        studies(request).cancel(study_id)
    for dataset in store(request).datasets_for(exp_id):
        datasets(request).cancel(dataset["id"])
    store(request).delete_experiment(exp_id)
    return Response(status_code=204)


# ---------------------------------------------------------------------------- simulations


@app.post("/api/experiments/{exp_id}/simulations")
async def start_simulation(
    request: Request,
    exp_id: str,
    body: StartBody,
    idempotency_key: str | None = Header(default=None, max_length=128),
    user: dict = Depends(current_user),
) -> Response:
    exp = owned_experiment(request, user, exp_id)
    mgr = manager(request)
    if idempotency_key:
        existing = mgr.existing_for_key(exp_id, idempotency_key)
        meta = _sim_status(request, existing) if existing else None
        if meta is not None:
            return _json(meta, 200)
    if body.expected_configuration_hash and body.expected_configuration_hash != exp["configuration_hash"]:
        raise ApiError(409, "configuration_changed",
                       "The saved configuration differs from the one being started. Reload the experiment.")
    active = mgr.active_for(exp_id)
    if active is not None:
        raise ApiError(409, "simulation_active", "A simulation is already running for this experiment.",
                       extra={"simulation_id": active.id})
    config = ExperimentConfig.model_validate(exp["config"])
    require_valid(request, user, config)
    run = mgr.start(exp, config, body.playback, idempotency_key)
    return _json(run.status_json(), 201)


@app.get("/api/experiments/{exp_id}/simulations")
async def list_simulations(request: Request, exp_id: str, user: dict = Depends(current_user)) -> Response:
    owned_experiment(request, user, exp_id)
    items = []
    for meta in store(request).simulations_for(exp_id):
        run = manager(request).get(meta["id"])
        items.append(run.status_json() if run else _public_meta(meta))
    return _json({"items": items})


# ---------------------------------------------------------------------------- studies


def _study_summary(doc: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in doc.items() if k != "result"}


@app.post("/api/experiments/{exp_id}/studies")
async def start_study(request: Request, exp_id: str, body: StudyRequest, user: dict = Depends(current_user)) -> Response:
    exp = owned_experiment(request, user, exp_id)
    config = ExperimentConfig.model_validate(exp["config"])
    require_valid(request, user, config)
    errors = await asyncio.to_thread(validate_request, body, config)
    if errors:
        raise ApiError(422, "invalid_study", "The study settings are invalid.", errors)
    return _json(studies(request).start(exp, config, body), 201)


@app.get("/api/experiments/{exp_id}/studies")
async def list_studies(request: Request, exp_id: str, user: dict = Depends(current_user)) -> Response:
    owned_experiment(request, user, exp_id)
    mgr = studies(request)
    items = [_study_summary(mgr.get(s["id"]) or s) for s in store(request).studies_for(exp_id)]
    return _json({"items": items})


def _study_or_404(request: Request, user: dict[str, Any], study_id: str) -> dict[str, Any]:
    doc = studies(request).get(study_id) if valid_id(study_id) else None
    exp = store(request).get_experiment(doc["experiment_id"]) if doc is not None else None
    if doc is None or exp is None or exp["owner_id"] != user["id"]:
        raise ApiError(404, "not_found", "Study not found.")
    return doc


@app.get("/api/studies/{study_id}")
async def get_study(request: Request, study_id: str, user: dict = Depends(current_user)) -> Response:
    return _json(_study_or_404(request, user, study_id))


@app.post("/api/studies/{study_id}/cancel")
async def cancel_study(request: Request, study_id: str, user: dict = Depends(current_user)) -> Response:
    doc = _study_or_404(request, user, study_id)
    if doc["status"] not in ("queued", "running"):
        raise ApiError(409, "study_finished", "The study has already finished.")
    return _json(studies(request).cancel(study_id) or doc)


@app.get("/api/simulations/{sim_id}")
async def get_simulation(request: Request, sim_id: str, user: dict = Depends(current_user)) -> Response:
    return _json(_owned_sim(request, user, sim_id)[1])


def _live_run(request: Request, user: dict[str, Any], sim_id: str) -> SimulationRun:
    run, meta = _owned_sim(request, user, sim_id)
    if run is None:
        raise ApiError(409, "invalid_transition", "The simulation has already finished.",
                       extra={"status": meta["status"]})
    return run


@app.post("/api/simulations/{sim_id}/pause")
async def pause_simulation(request: Request, sim_id: str, user: dict = Depends(current_user)) -> Response:
    run = _live_run(request, user, sim_id)
    run.pause()
    return _json(run.status_json())


@app.post("/api/simulations/{sim_id}/resume")
async def resume_simulation(request: Request, sim_id: str, user: dict = Depends(current_user)) -> Response:
    run = _live_run(request, user, sim_id)
    run.resume()
    return _json(run.status_json())


@app.post("/api/simulations/{sim_id}/cancel")
async def cancel_simulation(request: Request, sim_id: str, user: dict = Depends(current_user)) -> Response:
    run = _live_run(request, user, sim_id)
    run.cancel()
    return _json(run.status_json())


@app.get("/api/simulations/{sim_id}/plan")
async def get_plan(request: Request, sim_id: str, user: dict = Depends(current_user)) -> Response:
    run, _ = _owned_sim(request, user, sim_id)
    if run is not None:
        return _json(run.plan_json())
    doc = store(request).load_sim_doc(sim_id, "plan")
    if doc is None:
        raise ApiError(404, "not_found", "Survey plan not found.")
    return _json(doc)


@app.get("/api/simulations/{sim_id}/measurements")
async def get_measurements(
    request: Request,
    sim_id: str,
    after_index: int = Query(default=-1, ge=-1),
    limit: int = Query(default=200_000, ge=1, le=200_000),
    user: dict = Depends(current_user),
) -> Response:
    run, meta = _owned_sim(request, user, sim_id)
    start = after_index + 1
    if run is not None and run.measurements is not None:
        available = run.emitted
        end = min(available, start + limit)
        cols = measurement_columns(run.measurements.columns, start, end) if end > start else None
    else:
        doc = store(request).load_sim_doc(sim_id, "measurements") if run is None else None
        available = int(doc["count"]) if doc else 0
        end = min(available, start + limit)
        if doc and doc["columns"] and end > start:
            cols = {name: values[start:end] for name, values in doc["columns"].items()}
        else:
            cols = None
    count = max(end - start, 0)
    return _json({
        "simulation_id": sim_id,
        "status": meta["status"],
        "start_index": start,
        "count": count,
        "available": available,
        "total": meta["measurements_total"],
        "columns": cols,
    })


def _completed_doc(request: Request, meta: dict[str, Any], sim_id: str, section: str) -> Any:
    if meta["status"] != "completed" or not meta["results_available"]:
        raise ApiError(409, "results_not_ready", "Results are available only after the simulation completes.",
                       extra={"status": meta["status"]})
    doc = store(request).load_sim_doc(sim_id, section)
    if doc is None:
        raise ApiError(404, "not_found", "Result section not found.")
    return doc


def _result_envelope(meta: dict[str, Any]) -> dict[str, Any]:
    return {
        "simulation_id": meta["id"],
        "experiment_id": meta["experiment_id"],
        "experiment_version": meta["experiment_version"],
        "configuration_hash": meta["configuration_hash"],
        "status": meta["status"],
        "completed_at": meta["completed_at"],
    }


@app.get("/api/simulations/{sim_id}/results")
async def get_results(request: Request, sim_id: str, user: dict = Depends(current_user)) -> Response:
    _, meta = _owned_sim(request, user, sim_id)
    sections = {name: _completed_doc(request, meta, sim_id, name) for name in RESULT_SECTIONS}
    return _json({**_result_envelope(meta), **sections})


@app.get("/api/simulations/{sim_id}/results/{section}")
async def get_result_section(request: Request, sim_id: str,
                             section: Literal["signals", "anomaly-map", "inversion", "uncertainty"],
                             user: dict = Depends(current_user)) -> Response:
    _, meta = _owned_sim(request, user, sim_id)
    doc = _completed_doc(request, meta, sim_id, section.replace("-", "_"))
    return _json({**_result_envelope(meta), "data": doc})


@app.get("/api/simulations/{sim_id}/export")
async def export(request: Request, sim_id: str, format: Literal["csv", "json"] = "csv",
                 user: dict = Depends(current_user)) -> Response:
    run, meta = _owned_sim(request, user, sim_id)
    if meta["status"] in ACTIVE:
        raise ApiError(409, "simulation_active", "Export is available after the simulation stops.")
    exp = store(request).get_experiment(meta["experiment_id"])
    measurements = store(request).load_sim_doc(sim_id, "measurements") or {"count": 0, "columns": None}
    sections = {}
    if meta["status"] == "completed":
        for name in ("summary", "noise_budget", "inversion", "uncertainty", "comparison", "ground_truth", "signals"):
            sections[name] = store(request).load_sim_doc(sim_id, name)
    code = exp["code"] if exp else "EXP"
    if format == "csv":
        text = export_csv(meta, measurements, sections.get("signals"))
        return Response(text, media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="{code}-{sim_id[:8]}.csv"'})
    payload = export_json(meta, exp, measurements, sections)
    return Response(dumps(payload), media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="{code}-{sim_id[:8]}.json"'})


@app.get("/api/simulations/{sim_id}/report")
async def report(request: Request, sim_id: str, user: dict = Depends(current_user)) -> Response:
    _, meta = _owned_sim(request, user, sim_id)
    sections = {name: _completed_doc(request, meta, sim_id, name)
                for name in ("summary", "noise_budget", "inversion", "uncertainty", "comparison", "ground_truth",
                             "anomaly_map", "signals")}
    exp = store(request).get_experiment(meta["experiment_id"])
    measurements = store(request).load_sim_doc(sim_id, "measurements")
    html = await asyncio.to_thread(render_report, meta, exp, measurements, sections)
    code = exp["code"] if exp else "EXP"
    return Response(html, media_type="text/html; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{code}-report.html"'})


# ---------------------------------------------------------------------------- websocket


async def _next_event(sub, timeout: float):
    get_task = asyncio.ensure_future(sub.queue.get())
    closed_task = asyncio.ensure_future(sub.closed.wait())
    try:
        done, _ = await asyncio.wait({get_task, closed_task}, timeout=timeout,
                                     return_when=asyncio.FIRST_COMPLETED)
    finally:
        for task in (get_task, closed_task):
            if not task.done():
                task.cancel()
    if get_task in done:
        return get_task.result()
    if closed_task in done:
        return "closed"
    return None


@app.websocket("/api/simulations/{sim_id}/stream")
async def stream(ws: WebSocket, sim_id: str, after_index: int = -1) -> None:
    await ws.accept()
    # Browsers send cookies with cross-site WebSocket handshakes; the Origin check prevents hijacking.
    if not origin_allowed(ws.headers.get("origin"), ws.headers.get("host"), settings(ws).allowed_origins):
        await ws.close(code=4403, reason="Unexpected origin")
        return
    try:
        user, _ = authenticate(ws.app.state, ws.cookies.get(auth.SESSION_COOKIE))
    except ApiError as exc:
        await ws.close(code=4401, reason=exc.code)
        return
    if not valid_id(sim_id):
        await ws.close(code=4404, reason="Simulation not found")
        return
    run = manager(ws).get(sim_id)
    meta = run.status_json() if run is not None else store(ws).get_simulation(sim_id)
    exp = store(ws).get_experiment(meta["experiment_id"]) if meta is not None else None
    if meta is None or exp is None or exp["owner_id"] != user["id"]:
        await ws.close(code=4404, reason="Simulation not found")
        return
    if run is None:
        await ws.send_text(dumps({"type": "snapshot", "simulation_id": sim_id, "seq": meta.get("last_seq", 0),
                                  "simulation": _public_meta(meta)}))
        await ws.close(code=1000)
        return

    sub = run.subscribe()
    try:
        # Snapshot and backlog boundary are captured synchronously with the subscription, so
        # live events that follow never overlap with the backlog.
        snapshot = run.snapshot_event()
        emitted = run.emitted
        await ws.send_text(dumps(snapshot))
        start = max(after_index + 1, 0)
        while start < emitted:
            end = min(emitted, start + BACKLOG_CHUNK)
            await ws.send_text(dumps(run.batch_event(start, end, replay_seq=snapshot["seq"])))
            start = end
        if run.status in ("completed", "failed", "cancelled"):
            await ws.close(code=1000)
            return
        while True:
            event = await _next_event(sub, HEARTBEAT_S)
            if event == "closed":
                await ws.close(code=4000 if sub.overflowed else 4001, reason="Stream reset")
                return
            if event is None:
                await ws.send_text(dumps({"type": "heartbeat", "simulation_id": sim_id, "seq": run.seq}))
                continue
            if "__raw__" in event:
                await ws.send_text(event["__raw__"])
                continue
            await ws.send_text(dumps(event))
            if event["type"] in ("simulation_completed", "simulation_failed", "simulation_cancelled"):
                await ws.close(code=1000)
                return
    except WebSocketDisconnect:
        return
    finally:
        run.unsubscribe(sub)


# ---------------------------------------------------------------------------- test hooks

if os.environ.get("ENGINE_TEST_HOOKS") == "1":

    @app.post("/api/_test/reset")
    async def _reset(request: Request) -> Response:
        mgr = manager(request)
        for run in list(mgr.runs.values()):
            if run.task and not run.task.done():
                if run.status in ACTIVE:
                    run.cancel()
                await asyncio.wait([run.task], timeout=5)
        mgr.runs.clear()
        mgr.idempotency.clear()
        await asyncio.to_thread(studies(request).reset)
        await asyncio.to_thread(datasets(request).reset)
        store(request).delete_all_content()
        request.app.state.throttle.clear()
        return _json({"ok": True})

    @app.post("/api/_test/expire-sessions")
    async def _expire_sessions(request: Request) -> Response:
        store(request).expire_all_sessions()
        return _json({"ok": True})

    @app.post("/api/_test/fail-next-simulation")
    async def _fail_next(request: Request, body: FailBody) -> Response:
        manager(request).hooks.fail_phase = body.phase
        return _json({"ok": True})

    @app.post("/api/_test/simulations/{sim_id}/drop-connections")
    async def _drop(request: Request, sim_id: str) -> Response:
        run = manager(request).get(sim_id)
        if run is None:
            raise ApiError(404, "not_found", "Simulation not active.")
        run.drop_connections()
        return _json({"ok": True})

    @app.post("/api/_test/simulations/{sim_id}/inject")
    async def _inject(request: Request, sim_id: str, body: InjectBody) -> Response:
        run = manager(request).get(sim_id)
        if run is None:
            raise ApiError(404, "not_found", "Simulation not active.")
        run.inject(body.raw)
        return _json({"ok": True})


# ---------------------------------------------------------------------------- built frontend

for _ext, _type in ((".js", "text/javascript"), (".mjs", "text/javascript"), (".css", "text/css"),
                    (".svg", "image/svg+xml"), (".woff2", "font/woff2"), (".json", "application/json"),
                    (".map", "application/json"), (".wasm", "application/wasm")):
    mimetypes.add_type(_type, _ext)  # the Windows registry can map .js to text/plain


@app.get("/{path:path}", include_in_schema=False)
async def frontend(request: Request, path: str) -> Response:
    """Serve the built single-page app (ENGINE_STATIC_DIR): files as they are, other routes get index.html."""
    root = settings(request).static_dir
    if root is None or path.startswith("api/") or path == "api":
        raise ApiError(404, "not_found", "Not found.")
    candidate = (root / path).resolve()
    if not candidate.is_relative_to(root):
        raise ApiError(404, "not_found", "Not found.")
    if path and candidate.is_file():
        immutable = path.startswith("assets/")
        return FileResponse(candidate, headers={
            "Cache-Control": "public, max-age=31536000, immutable" if immutable else "no-cache"})
    if "." in path.rsplit("/", 1)[-1]:
        raise ApiError(404, "not_found", "Not found.")
    index = root / "index.html"
    if not index.is_file():
        raise ApiError(404, "not_found", "The frontend has not been built (npm run build).")
    return FileResponse(index, headers={"Cache-Control": "no-cache"})
