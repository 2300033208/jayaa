"""Shared pieces of the HTTP API: settings, errors, authentication and ownership checks."""

from __future__ import annotations

import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal
from urllib.parse import urlsplit

from fastapi import Request, WebSocket
from fastapi.responses import Response

from . import auth
from .config import ExperimentConfig
from .serialization import dumps
from .store import Store, valid_id
from .validation import validate_config

if TYPE_CHECKING:
    from .dataset_runner import DatasetManager
    from .runner import SimulationManager
    from .study_runner import StudyManager

DEV_ORIGINS = r"^http://(localhost|127\.0\.0\.1)(:\d+)?$"


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    database_url: str
    allow_signup: bool
    allowed_origins: re.Pattern[str]
    cookie_secure: Literal["auto", "always", "never"]
    cookie_samesite: Literal["strict", "lax", "none"]
    static_dir: Path | None


def load_settings() -> Settings:
    from .db import database_url

    override = os.environ.get("ENGINE_DATA_DIR")
    data_dir = Path(override) if override else Path(__file__).resolve().parents[1] / "data"
    secure = os.environ.get("ENGINE_COOKIE_SECURE", "auto")
    if secure not in ("auto", "always", "never"):
        raise RuntimeError("ENGINE_COOKIE_SECURE must be auto, always or never")
    samesite = os.environ.get("ENGINE_COOKIE_SAMESITE", "strict")
    if samesite not in ("strict", "lax", "none"):
        raise RuntimeError("ENGINE_COOKIE_SAMESITE must be strict, lax or none")
    static = os.environ.get("ENGINE_STATIC_DIR")
    return Settings(
        data_dir=data_dir,
        database_url=database_url(data_dir),
        allow_signup=os.environ.get("ENGINE_ALLOW_SIGNUP", "1") == "1",
        allowed_origins=re.compile(os.environ.get("ENGINE_ALLOWED_ORIGINS", DEV_ORIGINS)),
        cookie_secure=secure,  # type: ignore[arg-type]
        cookie_samesite=samesite,  # type: ignore[arg-type]
        static_dir=Path(static).resolve() if static else None,
    )


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, fields: list[dict[str, str]] | None = None,
                 extra: dict[str, Any] | None = None, headers: dict[str, str] | None = None):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message
        self.fields = fields or []
        self.extra = extra or {}
        self.headers = headers


def json_response(data: Any, status: int = 200, headers: dict[str, str] | None = None) -> Response:
    return Response(content=dumps(data), status_code=status, media_type="application/json", headers=headers)


def settings(request: Request | WebSocket) -> Settings:
    return request.app.state.settings


def store(request: Request | WebSocket) -> Store:
    return request.app.state.store


def manager(request: Request | WebSocket) -> "SimulationManager":
    return request.app.state.manager


def studies(request: Request) -> "StudyManager":
    return request.app.state.studies


def datasets(request: Request) -> "DatasetManager":
    return request.app.state.datasets


# ---------------------------------------------------------------------------- origin checks


def origin_allowed(origin: str | None, host: str | None, allowed: re.Pattern[str]) -> bool:
    """A missing Origin is allowed (non-browser clients cannot carry a victim's cookies across sites); a present
    one must be this server or an allowed development origin."""
    if origin is None:
        return True
    if allowed.match(origin):
        return True
    parts = urlsplit(origin)
    return bool(host) and parts.scheme in ("http", "https") and parts.netloc.lower() == (host or "").lower()


# ---------------------------------------------------------------------------- sessions


def authenticate(app_state: Any, token: str | None) -> tuple[dict[str, Any], dict[str, Any]]:
    """The signed-in user and session for a cookie token. Raises 401 when there is none or it has expired."""
    if not token or len(token) > 200:
        raise ApiError(401, "not_authenticated", "Sign in to continue.")
    st: Store = app_state.store
    session = st.session_by_token_hash(auth.token_hash(token))
    if session is None:
        raise ApiError(401, "not_authenticated", "Sign in to continue.")
    now = time.time()
    if session["expires_at"] <= now or session["last_seen_at"] <= now - auth.IDLE_TIMEOUT_S:
        st.delete_session(session["id"])
        raise ApiError(401, "session_expired", "Your session has expired. Sign in again to continue.")
    user = st.user_by_id(session["user_id"])
    if user is None:
        st.delete_session(session["id"])
        raise ApiError(401, "not_authenticated", "Sign in to continue.")
    if now - session["last_seen_at"] >= auth.TOUCH_INTERVAL_S:
        st.touch_session(session["id"], now)
    return user, session


async def current_user(request: Request) -> dict[str, Any]:
    """FastAPI dependency: the signed-in user (authorization is always decided here, never by the client)."""
    user, session = authenticate(request.app.state, request.cookies.get(auth.SESSION_COOKIE))
    request.state.session_id = session["id"]
    return user


def public_user(user: dict[str, Any]) -> dict[str, Any]:
    return {"id": user["id"], "email": user["email"], "display_name": user["display_name"],
            "created_at": user["created_at"]}


# ---------------------------------------------------------------------------- ownership


def owned_experiment(request: Request, user: dict[str, Any], exp_id: str) -> dict[str, Any]:
    """The experiment if it belongs to the user. Another user's experiment is reported as not found."""
    exp = store(request).get_experiment(exp_id) if valid_id(exp_id) else None
    if exp is None or exp["owner_id"] != user["id"]:
        raise ApiError(404, "not_found", "Experiment not found.")
    return exp


def terrain_access_errors(request: Request, user: dict[str, Any], config: ExperimentConfig) -> list[dict[str, str]]:
    """A configuration may only refer to the user's own elevation models."""
    terrain_id = config.environment.terrain_model_id
    if terrain_id is None:
        return []
    meta = store(request).get_terrain_model(terrain_id)
    if meta is None or meta["owner_id"] != user["id"]:
        return [{"field": "environment.terrain_model_id", "message": "Elevation model not found."}]
    return []


def require_valid(request: Request, user: dict[str, Any], config: ExperimentConfig) -> None:
    access = terrain_access_errors(request, user, config)
    if access:
        raise ApiError(422, "invalid_configuration", "The configuration is invalid.", access)
    report = validate_config(config)
    if not report.valid:
        raise ApiError(422, "invalid_configuration", "The configuration is invalid.", report.errors)
