"""JSON helpers that refuse to emit non-finite numbers."""

from __future__ import annotations

import json
import math
from typing import Any

import numpy as np

NULLABLE_COLUMNS = frozenset({"z_score"})
INTEGER_COLUMNS = frozenset({"index", "line_index"})
MEASUREMENT_COLUMNS = (
    "index",
    "timestamp_s",
    "x_m",
    "y_m",
    "z_m",
    "along_track_m",
    "line_index",
    "potential_m2_s2",
    "gravity_m_s2",
    "gravity_anomaly_m_s2",
    "fractional_shift",
    "absolute_shift_hz",
    "ai_phase_rad",
    "raw",
    "noise",
    "z_score",
)


class NonFiniteValueError(ValueError):
    pass


def to_jsonable(value: Any) -> Any:
    """Convert numpy containers/scalars to plain Python, rejecting NaN and ±Infinity."""
    if isinstance(value, dict):
        return {str(k): to_jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_jsonable(v) for v in value]
    if isinstance(value, np.ndarray):
        return to_jsonable(value.tolist())
    if isinstance(value, (np.bool_,)):
        return bool(value)
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (float, np.floating)):
        f = float(value)
        if not math.isfinite(f):
            raise NonFiniteValueError("Non-finite value in engine output")
        return f
    return value


def dumps(value: Any) -> str:
    return json.dumps(to_jsonable(value), separators=(",", ":"), allow_nan=False, ensure_ascii=False)


def measurement_columns(columns: dict[str, np.ndarray], start: int, end: int) -> dict[str, list]:
    out: dict[str, list] = {}
    for name in MEASUREMENT_COLUMNS:
        values = columns[name][start:end]
        if name in NULLABLE_COLUMNS:
            out[name] = [None if not math.isfinite(v) else float(v) for v in values.tolist()]
        elif name in INTEGER_COLUMNS:
            out[name] = [int(v) for v in values.tolist()]
        else:
            if not np.all(np.isfinite(values)):
                raise NonFiniteValueError(f"Non-finite value in measurement column {name}")
            out[name] = values.tolist()
    return out
