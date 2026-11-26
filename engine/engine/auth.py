"""Accounts and sessions.

Passwords are hashed with Argon2id. A session is a random 256-bit token held in an HttpOnly,
SameSite=Strict cookie; the database stores only its SHA-256, so a database leak does not reveal
usable sessions. Sessions end after IDLE_TIMEOUT_S without use or ABSOLUTE_TIMEOUT_S after login.
Every state-changing request must carry the X-Requested-With header (a cross-site page cannot add it
without a CORS pre-flight, which is refused) and, when the browser sends one, an allowed Origin.
"""

from __future__ import annotations

import hashlib
import re
import secrets
import threading
import time
import unicodedata
from collections import deque

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

SESSION_COOKIE = "agrav_session"
CSRF_HEADER = "X-Requested-With"
CSRF_VALUE = "XMLHttpRequest"
IDLE_TIMEOUT_S = 12 * 3600.0
ABSOLUTE_TIMEOUT_S = 14 * 86400.0
TOUCH_INTERVAL_S = 300.0  # last-seen time is written at most this often
PASSWORD_MIN = 12
PASSWORD_MAX = 256  # bounds hashing work per request
EMAIL_MAX = 254
NAME_MAX = 80
THROTTLE_WINDOW_S = 15 * 60.0
THROTTLE_PER_ACCOUNT = 5
THROTTLE_PER_ADDRESS = 20

_EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s.]+(\.[^@\s.]+)+$")
_hasher = PasswordHasher()  # Argon2id with the library's current recommended parameters
# Verifying against this hash when the account does not exist keeps response times alike.
_DUMMY_HASH = _hasher.hash(secrets.token_hex(16))


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(stored_hash: str | None, password: str) -> bool:
    try:
        return _hasher.verify(stored_hash or _DUMMY_HASH, password) and stored_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(stored_hash: str) -> bool:
    return _hasher.check_needs_rehash(stored_hash)


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def normalize_email(value: str) -> str:
    return unicodedata.normalize("NFKC", value).strip().lower()


def email_error(email: str) -> str | None:
    if not email:
        return "Email is required."
    if len(email) > EMAIL_MAX or not _EMAIL_RE.match(email):
        return "Enter a valid email address."
    return None


def password_error(password: str, email: str) -> str | None:
    if len(password) < PASSWORD_MIN:
        return f"Password must be at least {PASSWORD_MIN} characters."
    if len(password) > PASSWORD_MAX:
        return f"Password must be at most {PASSWORD_MAX} characters."
    if password.strip().lower() == email:
        return "Password must not be your email address."
    if len(set(password)) < 4:
        return "Password is too repetitive."
    return None


def name_error(name: str) -> str | None:
    if not name.strip():
        return "Name is required."
    if len(name) > NAME_MAX:
        return f"Name must be at most {NAME_MAX} characters."
    if any(unicodedata.category(ch).startswith("C") for ch in name):
        return "Name contains control characters."
    return None


class LoginThrottle:
    """Failed sign-ins per account and per client address within a sliding window."""

    def __init__(self) -> None:
        self._failures: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def _recent(self, key: str, now: float) -> deque[float]:
        times = self._failures.setdefault(key, deque())
        while times and times[0] <= now - THROTTLE_WINDOW_S:
            times.popleft()
        return times

    def retry_after(self, account: str, address: str, now: float | None = None) -> int | None:
        """Seconds until another attempt is allowed, or None if allowed now."""
        now = time.monotonic() if now is None else now
        with self._lock:
            waits = []
            for key, limit in ((f"a:{account}", THROTTLE_PER_ACCOUNT), (f"i:{address}", THROTTLE_PER_ADDRESS)):
                times = self._recent(key, now)
                if len(times) >= limit:
                    waits.append(times[0] + THROTTLE_WINDOW_S - now)
            return max(1, int(max(waits)) + 1) if waits else None

    def failed(self, account: str, address: str, now: float | None = None) -> None:
        now = time.monotonic() if now is None else now
        with self._lock:
            for key in (f"a:{account}", f"i:{address}"):
                self._recent(key, now).append(now)

    def succeeded(self, account: str) -> None:
        with self._lock:
            self._failures.pop(f"a:{account}", None)

    def clear(self) -> None:
        with self._lock:
            self._failures.clear()
