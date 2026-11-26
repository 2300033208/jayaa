"""Account endpoints: register, sign in, sign out, current user and password change."""

from __future__ import annotations

import asyncio
import time
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field

from . import auth
from .api_common import ApiError, authenticate, current_user, json_response, public_user, settings, store
from .store import EmailTaken

router = APIRouter(prefix="/api/auth")


class _Req(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RegisterBody(_Req):
    email: str = Field(max_length=auth.EMAIL_MAX)
    display_name: str = Field(max_length=auth.NAME_MAX)
    password: str = Field(max_length=auth.PASSWORD_MAX)


class LoginBody(_Req):
    email: str = Field(max_length=auth.EMAIL_MAX)
    password: str = Field(max_length=auth.PASSWORD_MAX)


class PasswordBody(_Req):
    current_password: str = Field(max_length=auth.PASSWORD_MAX)
    new_password: str = Field(max_length=auth.PASSWORD_MAX)


def _client_address(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _secure(request: Request) -> bool:
    mode = settings(request).cookie_secure
    return mode == "always" or (mode == "auto" and request.url.scheme == "https")


def _start_session(request: Request, response: Response, user: dict[str, Any]) -> None:
    token = auth.new_token()
    now = time.time()
    store(request).purge_sessions(now, auth.IDLE_TIMEOUT_S)
    store(request).create_session(user["id"], auth.token_hash(token), now, now + auth.ABSOLUTE_TIMEOUT_S,
                                  request.headers.get("user-agent", ""))
    response.set_cookie(auth.SESSION_COOKIE, token, max_age=int(auth.ABSOLUTE_TIMEOUT_S), path="/", httponly=True,
                        samesite="strict", secure=_secure(request))


def _clear_cookie(request: Request, response: Response) -> None:
    response.delete_cookie(auth.SESSION_COOKIE, path="/", httponly=True, samesite="strict", secure=_secure(request))


@router.get("/config")
async def auth_config(request: Request) -> Response:
    return json_response({"signup_allowed": settings(request).allow_signup,
                          "password_min_length": auth.PASSWORD_MIN})


@router.post("/register")
async def register(request: Request, body: RegisterBody) -> Response:
    if not settings(request).allow_signup:
        raise ApiError(403, "signup_disabled", "New accounts are created by the administrator on this server.")
    email = auth.normalize_email(body.email)
    name = body.display_name.strip()
    fields = []
    for field, message in (("email", auth.email_error(email)), ("display_name", auth.name_error(name)),
                           ("password", auth.password_error(body.password, email))):
        if message:
            fields.append({"field": field, "message": message})
    if fields:
        raise ApiError(422, "invalid_request", "Some values are invalid.", fields)
    password_hash = await asyncio.to_thread(auth.hash_password, body.password)
    try:
        user = store(request).create_user(email, name, password_hash)
    except EmailTaken:
        raise ApiError(409, "email_taken", "An account with this email already exists. Sign in instead.",
                       [{"field": "email", "message": "An account with this email already exists."}]) from None
    response = json_response({"user": public_user(user)}, 201)
    _start_session(request, response, user)
    return response


@router.post("/login")
async def login(request: Request, body: LoginBody) -> Response:
    email = auth.normalize_email(body.email)
    address = _client_address(request)
    throttle: auth.LoginThrottle = request.app.state.throttle
    wait = throttle.retry_after(email, address)
    if wait is not None:
        raise ApiError(429, "too_many_attempts", f"Too many failed sign-in attempts. Try again in {wait // 60 + 1} min.",
                       headers={"Retry-After": str(wait)})
    user = store(request).user_by_email(email)
    ok = await asyncio.to_thread(auth.verify_password, user["password_hash"] if user else None, body.password)
    if not ok or user is None:
        throttle.failed(email, address)
        raise ApiError(401, "invalid_credentials", "Email or password is incorrect.")
    throttle.succeeded(email)
    if auth.needs_rehash(user["password_hash"]):
        store(request).set_password(user["id"], await asyncio.to_thread(auth.hash_password, body.password))
    response = json_response({"user": public_user(user)})
    _start_session(request, response, user)
    return response


@router.post("/logout")
async def logout(request: Request) -> Response:
    token = request.cookies.get(auth.SESSION_COOKIE)
    if token:
        session = store(request).session_by_token_hash(auth.token_hash(token)) if len(token) <= 200 else None
        if session is not None:
            store(request).delete_session(session["id"])
    response = Response(status_code=204)
    _clear_cookie(request, response)
    return response


@router.get("/me")
async def me(request: Request) -> Response:
    user, _ = authenticate(request.app.state, request.cookies.get(auth.SESSION_COOKIE))
    return json_response({"user": public_user(user)})


@router.post("/password")
async def change_password(request: Request, body: PasswordBody, user: dict = Depends(current_user)) -> Response:
    ok = await asyncio.to_thread(auth.verify_password, user["password_hash"], body.current_password)
    if not ok:
        raise ApiError(422, "invalid_request", "Some values are invalid.",
                       [{"field": "current_password", "message": "Current password is incorrect."}])
    problem = auth.password_error(body.new_password, user["email"])
    if problem:
        raise ApiError(422, "invalid_request", "Some values are invalid.",
                       [{"field": "new_password", "message": problem}])
    store(request).set_password(user["id"], await asyncio.to_thread(auth.hash_password, body.new_password))
    # Every other session ends: a changed password must lock out whoever else had access.
    store(request).delete_sessions_for(user["id"], keep=request.state.session_id)
    return Response(status_code=204)
