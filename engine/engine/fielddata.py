"""Field measurements: CSV import, the analyst's corrections and the same detection and inversion as simulations.

File format (UTF-8 CSV, comma-separated, one header row; column order is free):

    station           text label, 1–64 characters (letters, digits, space, _ . - /), starting with a letter or digit
    time_utc          ISO 8601 time with a UTC offset (e.g. 2027-03-04T10:15:00Z): middle of the averaging window
    x_m, y_m          east and north offsets of the clock from the site centre (m)
    height_m          clock height above the site elevation (m)
    fractional_shift  measured fractional frequency difference, field clock minus reference clock (Δf/f)
    uncertainty       1σ uncertainty of fractional_shift, including per-station errors
    averaging_s       optional: length of the averaging window (s); defaults to the experiment's

The analysis corrects each value with what the analyst can compute for the experiment's site: the
normal gravity field (Earth model, latitude, height), the terrain mass at the assumed density, and the
modelled solid Earth tide. It then runs the matched-filter detection scan and the point-source
inversion with weights 1/σᵢ², exactly as for a simulated survey.
"""

from __future__ import annotations

import csv
import io
import math
import re
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any, Callable

import numpy as np
from scipy.spatial import cKDTree

from . import constants as k
from .analysis import inversion_documents
from .config import ExperimentConfig
from .geometry import body_geometry
from .inversion import InversionInput, invert, point_source_gravity
from .physics import normal_potential, total_anomaly
from .site import J2000, local_offsets_to_latlon, terrain_field, window_averaged_tide
from .survey import plan_survey

MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_ERRORS = 25
MIN_ROWS = 10
REQUIRED = ("station", "time_utc", "x_m", "y_m", "height_m", "fractional_shift", "uncertainty")
OPTIONAL = ("averaging_s",)
NUMERIC_RANGES: dict[str, tuple[float, float, str]] = {
    "x_m": (-1e6, 1e6, "m"),
    "y_m": (-1e6, 1e6, "m"),
    "height_m": (-1000.0, 10000.0, "m"),
    "fractional_shift": (-1e-9, 1e-9, ""),
    "uncertainty": (1e-21, 1e-11, ""),
    "averaging_s": (1.0, 604800.0, "s"),
}
TIME_RANGE = (datetime(2000, 1, 1, tzinfo=timezone.utc), datetime(2100, 12, 31, 23, 59, 59, tzinfo=timezone.utc))
FIT_QUALITY_RANGE = (0.5, 2.0)  # reduced χ² outside this range: the stated uncertainties do not match the scatter
AREA_MARGIN = 0.05  # stations may lie this fraction of the survey extent outside the experiment's area

_NUMBER = re.compile(r"^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$")
_STATION = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _.\-/]{0,63}$")
_FORMULA_PREFIX = ("=", "+", "-", "@", "\t", "\r")


class FieldDataError(ValueError):
    def __init__(self, message: str, problems: list[dict[str, Any]] | None = None):
        super().__init__(message)
        self.problems = problems or []


@dataclass
class _Problems:
    items: list[dict[str, Any]]
    total: int = 0

    def add(self, line: int | None, column: str | None, message: str) -> None:
        self.total += 1
        if len(self.items) < MAX_ERRORS:
            self.items.append({"line": line, "column": column, "message": message})


def _parse_time(text: str) -> datetime | None:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})", text):
        return None
    try:
        value = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return value.astimezone(timezone.utc) if value.tzinfo is not None else None


def parse_csv(data: bytes) -> dict[str, Any]:
    """Validate and parse an uploaded file. Raises FieldDataError listing problems with line numbers."""
    if len(data) > MAX_FILE_BYTES:
        raise FieldDataError(f"The file is larger than {MAX_FILE_BYTES // (1024 * 1024)} MB.")
    if b"\x00" in data:
        raise FieldDataError("The file contains binary data; upload a text CSV file.")
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise FieldDataError("The file is not UTF-8 text.") from exc
    from .contract import limits

    max_rows = int(limits()["survey"]["max_points"])
    reader = csv.reader(io.StringIO(text, newline=""), delimiter=",", quotechar='"', strict=True)
    try:
        header = next(reader)
    except StopIteration as exc:
        raise FieldDataError("The file is empty.") from exc
    except csv.Error as exc:
        raise FieldDataError(f"The header row is not valid CSV ({exc}).") from exc
    names = [h.strip().lower() for h in header]
    problems = _Problems([])
    if len(set(names)) != len(names):
        raise FieldDataError("The header repeats a column name.")
    unknown = [n for n in names if n not in REQUIRED and n not in OPTIONAL]
    if unknown:
        raise FieldDataError(f"Unknown column “{unknown[0][:40]}”. Allowed columns: "
                             f"{', '.join(REQUIRED + OPTIONAL)}.")
    missing = [n for n in REQUIRED if n not in names]
    if missing:
        raise FieldDataError(f"Missing column{'s' if len(missing) > 1 else ''}: {', '.join(missing)}.")
    index = {n: i for i, n in enumerate(names)}
    numeric = [n for n in names if n in NUMERIC_RANGES]

    stations: list[str] = []
    times: list[datetime] = []
    values: dict[str, list[float]] = {n: [] for n in numeric}
    seen: dict[tuple[str, datetime], int] = {}
    row_count = 0
    try:
        for row in reader:
            line = reader.line_num
            if not row or all(not cell.strip() for cell in row):
                continue
            row_count += 1
            if row_count > max_rows:
                raise FieldDataError(f"The file has more than {max_rows:,} measurements.".replace(",", " "))
            if len(row) != len(names):
                problems.add(line, None, f"Expected {len(names)} values, found {len(row)}.")
                continue
            ok = True
            station = row[index["station"]].strip()
            if station.startswith(_FORMULA_PREFIX):
                problems.add(line, "station", "Text must not start with =, +, -, @ or a control character "
                                              "(spreadsheet formulas are not accepted).")
                ok = False
            elif not _STATION.match(station):
                problems.add(line, "station", "Station labels are 1–64 letters, digits, spaces or _ . - / and start "
                                              "with a letter or digit.")
                ok = False
            when = _parse_time(row[index["time_utc"]].strip())
            if when is None:
                problems.add(line, "time_utc", "Use an ISO 8601 time with a UTC offset, e.g. 2027-03-04T10:15:00Z.")
                ok = False
            elif not TIME_RANGE[0] <= when <= TIME_RANGE[1]:
                problems.add(line, "time_utc", "Times must be between 2000 and 2100.")
                ok = False
            parsed: dict[str, float] = {}
            for name in numeric:
                cell = row[index[name]].strip()
                if not _NUMBER.match(cell):
                    problems.add(line, name, "Not a number." if cell else "Value is missing.")
                    ok = False
                    continue
                number = float(cell)
                lo, hi, unit = NUMERIC_RANGES[name]
                if not (math.isfinite(number) and lo <= number <= hi):
                    hint = ""
                    if name == "fractional_shift":
                        hint = " Values are dimensionless (Δf/f), not Hz or parts per million."
                    unit_text = f" {unit}" if unit else ""
                    problems.add(line, name, f"Must be between {lo:g}{unit_text} and {hi:g}{unit_text}.{hint}")
                    ok = False
                    continue
                parsed[name] = number
            if ok and when is not None:
                key = (station, when)
                if key in seen:
                    problems.add(line, "time_utc", f"Station {station} has two measurements at this time "
                                                   f"(also line {seen[key]}).")
                    continue
                seen[key] = line
                stations.append(station)
                times.append(when)
                for name in numeric:
                    values[name].append(parsed[name])
    except csv.Error as exc:
        problems.add(reader.line_num, None, f"Malformed CSV ({exc}).")
    if problems.total:
        more = problems.total - len(problems.items)
        message = f"{problems.total} problem{'s' if problems.total != 1 else ''} found in the file" + (
            f"; the first {len(problems.items)} are listed." if more else ".")
        raise FieldDataError(message, problems.items)
    if len(stations) < MIN_ROWS:
        raise FieldDataError(f"At least {MIN_ROWS} measurements are needed; the file has {len(stations)}.")

    order = sorted(range(len(times)), key=lambda i: times[i])
    t0 = times[order[0]]
    columns: dict[str, Any] = {
        "station": [stations[i] for i in order],
        "time_utc": [times[i].isoformat(timespec="milliseconds").replace("+00:00", "Z") for i in order],
        "elapsed_s": [(times[i] - t0).total_seconds() for i in order],
    }
    for name in numeric:
        columns[name] = [values[name][i] for i in order]
    columns["start_utc"] = columns["time_utc"][0]
    return columns


# ---------------------------------------------------------------------------- template


def template_csv(config: ExperimentConfig) -> str:
    """Station list of the planned survey with planned times, ready to be filled in the field."""
    plan = plan_survey(config.survey, config.environment, config.sensor)
    start = datetime(config.survey.start_date.year, config.survey.start_date.month, config.survey.start_date.day,
                     tzinfo=timezone.utc)
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow([*REQUIRED, "averaging_s"])
    window = config.sensor.measurement_interval_s * 100.0 / config.sensor.uptime_percent
    for i in range(plan.count):
        when = datetime.fromtimestamp(start.timestamp() + float(plan.timestamp_s[i]), tz=timezone.utc)
        writer.writerow([f"P{i + 1:05d}", when.isoformat(timespec="seconds").replace("+00:00", "Z"),
                         f"{plan.x[i]:.3f}", f"{plan.y[i]:.3f}", f"{plan.z[i]:.3f}", "", "", f"{window:.0f}"])
    return out.getvalue()


# ---------------------------------------------------------------------------- analysis


class AnalysisCancelled(Exception):
    pass


def _days_since_j2000(times_utc: list[str]) -> np.ndarray:
    return np.array([(datetime.fromisoformat(t.replace("Z", "+00:00")) - J2000).total_seconds() / 86_400
                     for t in times_utc])


def _reference(config: ExperimentConfig, columns: dict[str, Any], options: dict[str, Any]):
    """Reference clock position: local mode, the given position or else the first measurement's; remote
    mode, the experiment's fibre-linked reference on the reference surface."""
    if config.sensor.mode != "local_reference":
        return None
    first = 0
    rx = options.get("reference_x_m")
    ry = options.get("reference_y_m")
    rz = options.get("reference_height_m")
    return (float(columns["x_m"][first] if rx is None else rx), float(columns["y_m"][first] if ry is None else ry),
            float(columns["height_m"][first] if rz is None else rz))


def corrections(config: ExperimentConfig, columns: dict[str, Any], options: dict[str, Any]) -> dict[str, np.ndarray]:
    """What the analyst can compute at each station, as fractional frequency: normal field, terrain at the
    assumed density and the modelled tide, each relative to the reference clock."""
    env, sensor = config.environment, config.sensor
    x = np.asarray(columns["x_m"], dtype=np.float64)
    y = np.asarray(columns["y_m"], dtype=np.float64)
    z = np.asarray(columns["height_m"], dtype=np.float64)
    lat, model = env.latitude_deg, env.earth_model
    reference = _reference(config, columns, options)
    phi_normal = normal_potential(lat, env.elevation_m + z, model)
    if reference is not None:
        ref = tuple(np.array([v]) for v in reference)
        phi_ref = float(normal_potential(lat, np.array([env.elevation_m + reference[2]]), model)[0])
        ref_lat, ref_lon = local_offsets_to_latlon(lat, env.longitude_deg, ref[0], ref[1])
    else:
        ref_lat_deg = lat + math.degrees(sensor.reference_distance_km * 1000.0 / k.EARTH_MEAN_RADIUS)
        phi_ref = float(normal_potential(ref_lat_deg, np.array([0.0]), model)[0])
        ref_lat, ref_lon = np.array([ref_lat_deg]), np.array([env.longitude_deg])
    normal = (phi_normal - phi_ref) / k.C2

    terrain = np.zeros(x.size)
    if env.terrain_density_assumed_kg_m3 > 0.0:
        h_sensor = config.survey.sensor_height_m
        phi_t, _ = terrain_field(env, config.survey, h_sensor, env.terrain_density_assumed_kg_m3, x, y, z)
        if reference is not None:
            phi_t = phi_t - terrain_field(env, config.survey, h_sensor, env.terrain_density_assumed_kg_m3,
                                          *(np.array([v]) for v in reference))[0][0]
        terrain = phi_t / k.C2

    tide = np.zeros(x.size)
    if env.tides == "modelled":
        default_window = sensor.measurement_interval_s * 100.0 / sensor.uptime_percent
        window = (np.asarray(columns["averaging_s"], dtype=np.float64) if "averaging_s" in columns
                  else np.full(x.size, default_window))
        days = _days_since_j2000(columns["time_utc"])
        epoch = date(2000, 1, 1)  # window_averaged_tide counts seconds from a UTC midnight
        mid_s = (days + 0.5) * 86_400.0  # J2000 is noon on 2000-01-01
        st_lat, st_lon = local_offsets_to_latlon(lat, env.longitude_deg, x, y)
        tide_station = window_averaged_tide(st_lat, st_lon, epoch, mid_s, window)
        tide_ref = window_averaged_tide(np.full(x.size, ref_lat[0]), np.full(x.size, ref_lon[0]), epoch, mid_s, window)
        tide = (tide_station - tide_ref) / k.C2
    return {"normal": normal, "terrain": terrain, "tide": tide}


def station_spacing(x: np.ndarray, y: np.ndarray) -> float:
    """Median distance from each station to its nearest neighbour."""
    points = np.column_stack([x, y])
    unique = np.unique(points, axis=0)
    if unique.shape[0] < 2:
        return 0.0
    distances, _ = cKDTree(unique).query(unique, k=2)
    return float(np.median(distances[:, 1]))


def check_coverage(config: ExperimentConfig, columns: dict[str, Any]) -> str | None:
    """None if the stations lie in the experiment's survey area, else the reason they do not."""
    s = config.survey
    length = s.length_m if s.pattern != "profile" else s.width_m
    half_w = s.width_m / 2 * (1 + AREA_MARGIN)
    half_l = length / 2 * (1 + AREA_MARGIN)
    x = np.asarray(columns["x_m"])
    y = np.asarray(columns["y_m"])
    outside = int(np.count_nonzero((np.abs(x) > half_w) | (np.abs(y) > half_l)))
    if outside:
        return (f"{outside} station{'s' if outside != 1 else ''} lie outside the experiment's survey area "
                f"(±{s.width_m / 2:g} m east, ±{length / 2:g} m north of the site centre). Make the survey area "
                "cover the field data, or check the x_m and y_m columns.")
    return None


def analyse(config: ExperimentConfig, columns: dict[str, Any], options: dict[str, Any],
            should_cancel: Callable[[], bool] | None = None,
            on_progress: Callable[[float], None] | None = None) -> dict[str, Any]:
    reason = check_coverage(config, columns)
    if reason is not None:
        raise FieldDataError(reason)
    n = len(columns["station"])
    n_params = 4 * config.inversion.source_count + 2
    if n <= n_params + 2:
        raise FieldDataError(f"{n} measurements cannot constrain {config.inversion.source_count} source(s); "
                             "use fewer sources or more measurements.")
    x = np.asarray(columns["x_m"], dtype=np.float64)
    y = np.asarray(columns["y_m"], dtype=np.float64)
    z = np.asarray(columns["height_m"], dtype=np.float64)
    t = np.asarray(columns["elapsed_s"], dtype=np.float64)
    observed = np.asarray(columns["fractional_shift"], dtype=np.float64)
    sigma = np.asarray(columns["uncertainty"], dtype=np.float64)
    corr = corrections(config, columns, options)
    correction = corr["normal"] + corr["terrain"] + corr["tide"]
    corrected = observed - correction
    nominal = float(np.median(sigma))
    weights = nominal / sigma
    spacing = station_spacing(x, y)
    min_depth = max(1.0, spacing / 2.0)
    reference = _reference(config, columns, options)
    s = config.survey
    inp = InversionInput(
        x=x, y=y, z=z, t=t, data=corrected, reference=reference, source_count=config.inversion.source_count,
        half_width=s.width_m / 2.0, half_length=(s.length_m if s.pattern != "profile" else s.width_m) / 2.0,
        grid_shape=None, grid_index=None, nominal_sigma=nominal, min_depth=min_depth, weights=weights,
    )
    inv = invert(inp, config.inversion.bootstrap_samples, config.noise.seed, on_progress, should_cancel)
    sources_json, _, inversion_doc, uncertainty_sources, uncertainty_doc = inversion_documents(inv, min_depth)
    nuisance = inv.prediction - inv.source_signal
    residual = corrected - inv.prediction

    # The experiment's planned bodies at the real stations: does the data support the hypothesis?
    bodies = [body_geometry(b) for b in config.bodies]
    phi_b, dg_b = total_anomaly(x, y, z, bodies)
    if reference is not None:
        phi_b = phi_b - total_anomaly(*(np.array([v]) for v in reference), bodies)[0][0]
    hypothesis = phi_b / k.C2
    design = np.column_stack([np.ones(n), (t - t.mean()) / (np.ptp(t) or 1.0)]) * weights[:, None]

    def chi2_after_nuisance(signal: np.ndarray) -> float:
        target = (corrected - signal) * weights
        coef, *_ = np.linalg.lstsq(design, target, rcond=None)
        return float(np.sum((target - design @ coef) ** 2) / nominal**2)

    chi2_null = chi2_after_nuisance(np.zeros(n))
    chi2_hypothesis = chi2_after_nuisance(hypothesis)
    chi2_fit = float(np.sum((residual * weights) ** 2) / nominal**2)
    reduced = inv.reduced_chi_square
    if reduced is None:
        quality = "unknown"
    elif reduced > FIT_QUALITY_RANGE[1]:
        quality = "scatter_exceeds_uncertainties"
    elif reduced < FIT_QUALITY_RANGE[0]:
        quality = "uncertainties_overstated"
    else:
        quality = "consistent"

    primary = sources_json[0]
    primary_unc = uncertainty_sources[0]["parameters"]
    detection = inversion_doc["detection"]
    summary = {
        "anomaly_detected": detection["anomaly_detected"],
        "detection_significance_sigma": detection["significance_sigma"],
        "detection_description": detection["description"],
        "primary_source": {
            "id": primary["id"], "mass_kg": primary["mass_kg"]["estimate"], "x_m": primary["x_m"]["estimate"],
            "y_m": primary["y_m"]["estimate"], "depth_m": primary["depth_m"]["estimate"],
            "depth_ci_low": primary_unc["depth_m"]["ci_low"], "depth_ci_high": primary_unc["depth_m"]["ci_high"],
            "mass_ci_low": primary_unc["mass_kg"]["ci_low"], "mass_ci_high": primary_unc["mass_kg"]["ci_high"],
            "mass_significance_sigma": primary["mass_significance_sigma"],
        },
        "measurement_count": n,
        "station_count": len(set(columns["station"])),
        "median_uncertainty": nominal,
        "station_spacing_m": spacing,
        "reduced_chi_square": reduced,
        "fit_quality": quality,
        "duration_s": float(np.ptp(t)),
    }
    return {
        "summary": summary,
        "inversion": inversion_doc,
        "uncertainty": uncertainty_doc,
        "corrections": {
            "normal_rms": float(np.std(corr["normal"])),
            "terrain_rms": float(np.std(corr["terrain"])),
            "tide_rms": float(np.std(corr["tide"])),
            "terrain_density_kg_m3": config.environment.terrain_density_assumed_kg_m3,
            "tides": config.environment.tides,
            "reference": ({"mode": "local", "x_m": reference[0], "y_m": reference[1], "height_m": reference[2]}
                          if reference is not None else
                          {"mode": "remote", "distance_km": config.sensor.reference_distance_km}),
        },
        "hypothesis": {
            "description": "The experiment's subsurface bodies forward-modelled at the measured stations, with "
                           "offset and drift fitted",
            "body_count": len(bodies),
            "chi_square_null": chi2_null,
            "chi_square_hypothesis": chi2_hypothesis,
            "chi_square_fit": chi2_fit,
            "peak_signal": float(np.max(np.abs(hypothesis - np.median(hypothesis)))) if n else 0.0,
        },
        "stations": {
            "station": columns["station"],
            "time_utc": columns["time_utc"],
            "x_m": x.tolist(), "y_m": y.tolist(), "height_m": z.tolist(),
            "observed": observed.tolist(),
            "correction": correction.tolist(),
            "corrected": corrected.tolist(),
            "drift_removed": (corrected - nuisance).tolist(),
            "model": inv.source_signal.tolist(),
            "residual": residual.tolist(),
            "uncertainty": sigma.tolist(),
            "hypothesis": hypothesis.tolist(),
            "gravity_anomaly_estimated_m_s2": point_source_gravity(inv.sources, x, y, z).tolist(),
            "gravity_anomaly_hypothesis_m_s2": dg_b.tolist(),
        },
    }
