"""Digital elevation models (DEM): parsing, georeferencing and sampling at survey positions.

Accepted files: ESRI ASCII grid (.asc) and single-band GeoTIFF (.tif). Supported coordinate
systems: geographic latitude/longitude (WGS 84, NAD83 or ETRS89; these agree to about a metre) and
UTM zones on those datums. Survey positions are local east/north offsets from the site centre; they
are converted to latitude/longitude and, for UTM grids, projected with the Krüger series
(Karney, J. Geodesy 85, 2011), accurate to well below a millimetre within a zone. Heights are
metres above sea level and are interpolated bilinearly.
"""

from __future__ import annotations

import hashlib
import io
import math
import re
import threading
from collections import OrderedDict
from dataclasses import dataclass
from typing import Callable, Literal

import numpy as np
from numpy.typing import NDArray
from scipy.ndimage import map_coordinates


FloatArray = NDArray[np.float64]
Crs = Literal["geographic", "utm"]

MAX_FILE_BYTES = 64 * 1024 * 1024
MAX_CELLS = 4_000_000
MIN_CELLS_PER_AXIS = 2
HEIGHT_RANGE_M = (-500.0, 9000.0)  # outside: not metres above sea level (or an undeclared no-data value)
CACHE_SIZE = 6
BLOCK_SAMPLES = 4  # samples per axis averaged for each terrain prism

GEOGRAPHIC_EPSG = {4326: "WGS 84", 4269: "NAD83", 4258: "ETRS89"}
SUPPORTED_COMPRESSION = {1, 5, 8, 32773, 32946}  # none, LZW, deflate, PackBits, deflate (old code)


class TerrainFileError(ValueError):
    """The file cannot be used as an elevation model; the message says why."""


@dataclass(frozen=True)
class Georeference:
    crs: Crs
    utm_zone: int | None
    hemisphere: Literal["north", "south"] | None
    x0: float  # first column's cell centre: longitude (degrees) or easting (m)
    y0: float  # first row's cell centre: latitude (degrees) or northing (m)
    dx: float  # column spacing (> 0)
    dy: float  # row spacing (< 0 for north-up grids)

    def to_json(self) -> dict[str, object]:
        return {"crs": self.crs, "utm_zone": self.utm_zone, "hemisphere": self.hemisphere, "x0": self.x0,
                "y0": self.y0, "dx": self.dx, "dy": self.dy}

    @staticmethod
    def from_json(doc: dict) -> "Georeference":
        return Georeference(crs=doc["crs"], utm_zone=doc["utm_zone"], hemisphere=doc["hemisphere"],
                            x0=float(doc["x0"]), y0=float(doc["y0"]), dx=float(doc["dx"]), dy=float(doc["dy"]))


@dataclass(frozen=True)
class ElevationGrid:
    id: str
    georef: Georeference
    heights: NDArray[np.float32]  # (rows, columns), NaN where there is no data


@dataclass(frozen=True)
class ParsedGrid:
    heights: NDArray[np.float32]
    x0: float
    y0: float
    dx: float
    dy: float
    crs: Crs | None  # None when the file does not say (ASCII grids)
    utm_zone: int | None
    hemisphere: Literal["north", "south"] | None
    datum: str | None


# ---------------------------------------------------------------------------- UTM projection

_A = 6378137.0
_F = 1.0 / 298.257223563
_K0 = 0.9996
_N = _F / (2.0 - _F)
_A_RECT = _A / (1.0 + _N) * (1.0 + _N**2 / 4.0 + _N**4 / 64.0)
_ALPHA = (
    _N / 2.0 - 2.0 * _N**2 / 3.0 + 5.0 * _N**3 / 16.0 + 41.0 * _N**4 / 180.0,
    13.0 * _N**2 / 48.0 - 3.0 * _N**3 / 5.0 + 557.0 * _N**4 / 1440.0,
    61.0 * _N**3 / 240.0 - 103.0 * _N**4 / 140.0,
    49561.0 * _N**4 / 161280.0,
)


def utm_forward(lat_deg: FloatArray, lon_deg: FloatArray, zone: int, south: bool) -> tuple[FloatArray, FloatArray]:
    """WGS 84 latitude/longitude to UTM easting/northing (m) in the given zone."""
    lam0 = math.radians(zone * 6.0 - 183.0)
    phi = np.radians(lat_deg)
    lam = np.radians(lon_deg) - lam0
    e2n = 2.0 * math.sqrt(_N) / (1.0 + _N)
    t = np.sinh(np.arctanh(np.sin(phi)) - e2n * np.arctanh(e2n * np.sin(phi)))
    xi_p = np.arctan2(t, np.cos(lam))
    eta_p = np.arctanh(np.sin(lam) / np.sqrt(1.0 + t * t))
    xi, eta = xi_p.copy(), eta_p.copy()
    for j, alpha in enumerate(_ALPHA, start=1):
        xi += alpha * np.sin(2 * j * xi_p) * np.cosh(2 * j * eta_p)
        eta += alpha * np.cos(2 * j * xi_p) * np.sinh(2 * j * eta_p)
    easting = 500_000.0 + _K0 * _A_RECT * eta
    northing = _K0 * _A_RECT * xi + (10_000_000.0 if south else 0.0)
    return easting, northing


def utm_zone_for(lon_deg: float) -> int:
    return int(min(60, max(1, math.floor((lon_deg + 180.0) / 6.0) + 1)))


# ---------------------------------------------------------------------------- file parsing

_NUMBER = re.compile(r"^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$")


def _number(text: str, what: str) -> float:
    if not _NUMBER.match(text):
        raise TerrainFileError(f"{what} is not a number: “{text[:20]}”.")
    return float(text)


def _check_size(rows: int, cols: int) -> None:
    if rows < MIN_CELLS_PER_AXIS or cols < MIN_CELLS_PER_AXIS:
        raise TerrainFileError("The grid must have at least 2 rows and 2 columns.")
    if rows * cols > MAX_CELLS:
        raise TerrainFileError(f"The grid has {rows} × {cols} cells; at most {MAX_CELLS:,} are accepted. "
                               "Crop it to the survey area or resample it.")


def parse_ascii_grid(data: bytes) -> ParsedGrid:
    """ESRI ASCII grid: six header lines (ncols, nrows, xll…, yll…, cellsize, optional nodata_value), then rows
    from north to south."""
    try:
        text = data.decode("ascii")
    except UnicodeDecodeError as exc:
        raise TerrainFileError("An ASCII grid must contain only ASCII text.") from exc
    tokens_by_line = [line.split() for line in text.splitlines() if line.strip()]
    header: dict[str, str] = {}
    first_data = 0
    for i, tokens in enumerate(tokens_by_line[:8]):
        if len(tokens) == 2 and re.fullmatch(r"[A-Za-z_]+", tokens[0]):
            key = tokens[0].lower()
            if key in header:
                raise TerrainFileError(f"Header key “{key}” appears twice.")
            header[key] = tokens[1]
            first_data = i + 1
        else:
            break
    allowed = {"ncols", "nrows", "xllcorner", "yllcorner", "xllcenter", "yllcenter", "cellsize", "nodata_value"}
    unknown = sorted(set(header) - allowed)
    if unknown:
        raise TerrainFileError(f"Unknown header key “{unknown[0]}”.")
    for key in ("ncols", "nrows", "cellsize"):
        if key not in header:
            raise TerrainFileError(f"The header has no “{key}”.")
    corner = "xllcorner" in header and "yllcorner" in header
    center = "xllcenter" in header and "yllcenter" in header
    if corner == center:
        raise TerrainFileError("The header needs either xllcorner/yllcorner or xllcenter/yllcenter.")
    if not re.fullmatch(r"\d{1,7}", header["ncols"]) or not re.fullmatch(r"\d{1,7}", header["nrows"]):
        raise TerrainFileError("ncols and nrows must be whole numbers.")
    cols, rows = int(header["ncols"]), int(header["nrows"])
    _check_size(rows, cols)
    cell = _number(header["cellsize"], "cellsize")
    if not (cell > 0 and math.isfinite(cell)):
        raise TerrainFileError("cellsize must be positive.")
    nodata = _number(header["nodata_value"], "nodata_value") if "nodata_value" in header else None
    body = [tok for tokens in tokens_by_line[first_data:] for tok in tokens]
    if len(body) != rows * cols:
        raise TerrainFileError(f"Expected {rows} × {cols} = {rows * cols:,} heights, found {len(body):,}.")
    try:
        values = np.array(body, dtype=np.float64)
    except ValueError as exc:
        raise TerrainFileError("The grid contains a value that is not a number.") from exc
    if not np.all(np.isfinite(values)):
        raise TerrainFileError("The grid contains NaN or infinite values; use nodata_value for missing cells.")
    heights = values.reshape(rows, cols)
    if nodata is not None:
        heights = np.where(heights == nodata, np.nan, heights)
    if corner:
        x0 = _number(header["xllcorner"], "xllcorner") + cell / 2.0
        y_south = _number(header["yllcorner"], "yllcorner") + cell / 2.0
    else:
        x0 = _number(header["xllcenter"], "xllcenter")
        y_south = _number(header["yllcenter"], "yllcenter")
    y0 = y_south + (rows - 1) * cell  # first row is the northernmost
    return ParsedGrid(heights=heights.astype(np.float32), x0=x0, y0=y0, dx=cell, dy=-cell, crs=None, utm_zone=None,
                      hemisphere=None, datum=None)


def _geokeys(directory: tuple[int, ...]) -> dict[int, int]:
    """Short (inline) values of a GeoKeyDirectory."""
    if len(directory) < 4:
        raise TerrainFileError("The GeoTIFF key directory is malformed.")
    count = directory[3]
    keys: dict[int, int] = {}
    for n in range(count):
        base = 4 + 4 * n
        if base + 3 >= len(directory):
            raise TerrainFileError("The GeoTIFF key directory is malformed.")
        key, location, _, value = directory[base:base + 4]
        if location == 0:
            keys[key] = value
    return keys


def _crs_from_geokeys(keys: dict[int, int]) -> tuple[Crs, int | None, Literal["north", "south"] | None, str]:
    model = keys.get(1024)
    if model == 2:
        code = keys.get(2048)
        if code in GEOGRAPHIC_EPSG:
            return "geographic", None, None, GEOGRAPHIC_EPSG[code]
        raise TerrainFileError(f"Geographic coordinate system EPSG:{code} is not supported; "
                               "reproject to WGS 84 (EPSG:4326) or UTM.")
    if model == 1:
        code = keys.get(3072)
        if code is not None:
            if 32601 <= code <= 32660:
                return "utm", code - 32600, "north", "WGS 84"
            if 32701 <= code <= 32760:
                return "utm", code - 32700, "south", "WGS 84"
            if 26901 <= code <= 26923:
                return "utm", code - 26900, "north", "NAD83"
            if 25828 <= code <= 25838:
                return "utm", code - 25800, "north", "ETRS89"
        raise TerrainFileError(f"Projected coordinate system EPSG:{code} is not supported; reproject to a UTM zone "
                               "(WGS 84, NAD83 or ETRS89) or to WGS 84 latitude/longitude.")
    raise TerrainFileError("The GeoTIFF does not state its coordinate system.")


def parse_geotiff(data: bytes) -> ParsedGrid:
    import tifffile  # imported here: only needed for uploads

    try:
        tif = tifffile.TiffFile(io.BytesIO(data))
    except Exception as exc:  # noqa: BLE001 - any parser failure means the file is unusable
        raise TerrainFileError("The file is not a readable TIFF.") from exc
    with tif:
        if len(tif.pages) < 1:
            raise TerrainFileError("The TIFF contains no image.")
        page = tif.pages.first
        if page.samplesperpixel != 1 or len(page.shape) != 2:
            raise TerrainFileError("The GeoTIFF must have a single band of heights.")
        rows, cols = int(page.shape[0]), int(page.shape[1])
        _check_size(rows, cols)
        if int(page.compression) not in SUPPORTED_COMPRESSION:
            raise TerrainFileError("The GeoTIFF compression is not supported; use none, LZW or deflate.")
        if page.dtype is None or page.dtype.kind not in "iuf":
            raise TerrainFileError("Heights must be stored as integers or floating-point numbers.")
        tags = page.tags
        if 34264 in tags:
            raise TerrainFileError("Rotated or sheared GeoTIFF grids are not supported; use a north-up grid.")
        if 33550 not in tags or 33922 not in tags or 34735 not in tags:
            raise TerrainFileError("The TIFF has no georeferencing (pixel scale, tie point and GeoKeys are required).")
        scale = tuple(float(v) for v in tags[33550].value)
        tie = tuple(float(v) for v in tags[33922].value)
        keys = _geokeys(tuple(int(v) for v in tags[34735].value))
        nodata = None
        if 42113 in tags:
            raw = str(tags[42113].value).strip().rstrip("\x00")
            if raw:
                nodata = _number(raw, "The GDAL no-data value") if raw.lower() != "nan" else math.nan
        try:
            values = page.asarray().astype(np.float64)
        except Exception as exc:  # noqa: BLE001
            raise TerrainFileError("The GeoTIFF image data could not be decoded.") from exc
    if len(scale) < 2 or len(tie) < 6 or not (scale[0] > 0 and scale[1] > 0):
        raise TerrainFileError("The GeoTIFF pixel scale or tie point is malformed.")
    crs, zone, hemisphere, datum = _crs_from_geokeys(keys)
    i, j, x_tie, y_tie = tie[0], tie[1], tie[3], tie[4]
    pixel_is_point = keys.get(1025) == 2
    shift = 0.0 if pixel_is_point else 0.5
    x0 = x_tie + (shift - i) * scale[0]
    y0 = y_tie - (shift - j) * scale[1]
    if nodata is not None:
        values = np.where(np.isnan(values) if math.isnan(nodata) else values == nodata, np.nan, values)
    values = np.where(np.isfinite(values), values, np.nan)
    return ParsedGrid(heights=values.astype(np.float32), x0=x0, y0=y0, dx=scale[0], dy=-scale[1], crs=crs,
                      utm_zone=zone, hemisphere=hemisphere, datum=datum)


def parse_file(data: bytes, filename: str) -> ParsedGrid:
    if len(data) > MAX_FILE_BYTES:
        raise TerrainFileError(f"The file is larger than {MAX_FILE_BYTES // (1024 * 1024)} MB.")
    name = filename.lower()
    if name.endswith((".tif", ".tiff")):
        return parse_geotiff(data)
    if name.endswith((".asc", ".txt")):
        return parse_ascii_grid(data)
    raise TerrainFileError("Upload an ESRI ASCII grid (.asc) or a GeoTIFF (.tif).")


def build_model(parsed: ParsedGrid, crs: Crs | None, utm_zone: int | None,
                hemisphere: Literal["north", "south"] | None) -> tuple[Georeference, dict[str, object]]:
    """Combine the file with the coordinate system the user stated (needed for ASCII grids; must agree
    with a GeoTIFF's own). Returns the georeference and summary metadata."""
    if parsed.crs is not None:
        if crs is not None and (crs != parsed.crs or (crs == "utm" and (utm_zone, hemisphere)
                                                       != (parsed.utm_zone, parsed.hemisphere))):
            raise TerrainFileError("The coordinate system you selected differs from the one in the GeoTIFF.")
        crs, utm_zone, hemisphere = parsed.crs, parsed.utm_zone, parsed.hemisphere
    if crs is None:
        raise TerrainFileError("Select the grid's coordinate system (latitude/longitude or a UTM zone).")
    if crs == "utm" and (utm_zone is None or not 1 <= utm_zone <= 60 or hemisphere is None):
        raise TerrainFileError("Select the UTM zone (1–60) and hemisphere.")
    heights = parsed.heights
    finite = heights[np.isfinite(heights)]
    if finite.size == 0:
        raise TerrainFileError("The grid has no valid heights.")
    lo, hi = float(finite.min()), float(finite.max())
    if lo < HEIGHT_RANGE_M[0] or hi > HEIGHT_RANGE_M[1]:
        raise TerrainFileError(f"Heights range from {lo:.0f} m to {hi:.0f} m; expected metres above sea level between "
                               f"{HEIGHT_RANGE_M[0]:.0f} and {HEIGHT_RANGE_M[1]:.0f} m. Check the units and the no-data value.")
    rows, cols = heights.shape
    if crs == "geographic":
        lat_n, lat_s = parsed.y0, parsed.y0 + (rows - 1) * parsed.dy
        lon_w, lon_e = parsed.x0, parsed.x0 + (cols - 1) * parsed.dx
        if not (-90 <= lat_s <= lat_n <= 90 and -180 <= lon_w <= lon_e <= 180):
            raise TerrainFileError("The grid's corners are not valid latitudes/longitudes; is it in UTM metres?")
        if parsed.dx > 1.0:
            raise TerrainFileError("Cells larger than 1° are too coarse for terrain corrections.")
    else:
        if not (100_000 <= parsed.x0 <= 900_000 and -100 <= parsed.y0 <= 10_000_100):
            raise TerrainFileError("The grid's corners are not valid UTM coordinates; is it in latitude/longitude?")
        if parsed.dx > 5000.0:
            raise TerrainFileError("Cells larger than 5 km are too coarse for terrain corrections.")
    georef = Georeference(crs=crs, utm_zone=utm_zone if crs == "utm" else None,
                          hemisphere=hemisphere if crs == "utm" else None, x0=parsed.x0, y0=parsed.y0, dx=parsed.dx,
                          dy=parsed.dy)
    summary = {
        "rows": rows, "columns": cols, "cell_size": parsed.dx,
        "cell_unit": "degree" if crs == "geographic" else "m",
        "datum": parsed.datum, "min_height_m": lo, "max_height_m": hi,
        "no_data_fraction": float(1.0 - finite.size / heights.size),
        "extent": _extent(georef, rows, cols),
    }
    return georef, summary


def _extent(georef: Georeference, rows: int, cols: int) -> dict[str, float]:
    half_x, half_y = georef.dx / 2.0, abs(georef.dy) / 2.0
    ys = (georef.y0, georef.y0 + (rows - 1) * georef.dy)
    return {"x_min": georef.x0 - half_x, "x_max": georef.x0 + (cols - 1) * georef.dx + half_x,
            "y_min": min(ys) - half_y, "y_max": max(ys) + half_y}


def grid_bytes(heights: NDArray[np.float32]) -> bytes:
    return np.ascontiguousarray(heights, dtype="<f4").tobytes()


def file_checksum(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# ---------------------------------------------------------------------------- sampling


class CoverageError(ValueError):
    pass


def _local_to_grid(grid: ElevationGrid, lat0: float, lon0: float, x: FloatArray, y: FloatArray):
    from .site import local_offsets_to_latlon

    lat, lon = local_offsets_to_latlon(lat0, lon0, np.asarray(x, dtype=np.float64), np.asarray(y, dtype=np.float64))
    g = grid.georef
    if g.crs == "geographic":
        gx, gy = lon, lat
    else:
        assert g.utm_zone is not None
        gx, gy = utm_forward(lat, lon, g.utm_zone, g.hemisphere == "south")
    return (gy - g.y0) / g.dy, (gx - g.x0) / g.dx  # fractional row, column


def sample_heights(grid: ElevationGrid, lat0: float, lon0: float, x: FloatArray, y: FloatArray) -> FloatArray:
    """Heights above sea level (m) at local offsets; CoverageError if any point lies outside the data."""
    rows, cols = _local_to_grid(grid, lat0, lon0, x, y)
    n_rows, n_cols = grid.heights.shape
    inside = (rows >= 0) & (rows <= n_rows - 1) & (cols >= 0) & (cols <= n_cols - 1)
    if not np.all(inside):
        raise CoverageError("The elevation model does not cover the whole survey area.")
    values = map_coordinates(grid.heights, [np.ravel(rows), np.ravel(cols)], order=1, mode="nearest",
                             prefilter=False).reshape(np.shape(rows)).astype(np.float64)
    if not np.all(np.isfinite(values)):
        raise CoverageError("The elevation model has no data at some survey positions.")
    return values


def block_mean_heights(grid: ElevationGrid, lat0: float, lon0: float, centers_x: FloatArray, centers_y: FloatArray,
                       dx: float, dy: float) -> FloatArray:
    """Mean height over each dx × dy cell (BLOCK_SAMPLES² samples per cell)."""
    offsets = ((np.arange(BLOCK_SAMPLES) + 0.5) / BLOCK_SAMPLES - 0.5)
    ox, oy = np.meshgrid(offsets * dx, offsets * dy)
    px = centers_x[:, None] + ox.ravel()[None, :]
    py = centers_y[:, None] + oy.ravel()[None, :]
    return sample_heights(grid, lat0, lon0, px, py).mean(axis=1)


# ---------------------------------------------------------------------------- registry

_loader: Callable[[str], ElevationGrid | None] | None = None
_cache: OrderedDict[str, ElevationGrid] = OrderedDict()
_lock = threading.Lock()


def set_loader(loader: Callable[[str], ElevationGrid | None] | None) -> None:
    """Install the function that loads a stored model by id (models are immutable, so they are cached)."""
    global _loader
    with _lock:
        _loader = loader
        _cache.clear()


def get_grid(terrain_id: str) -> ElevationGrid | None:
    with _lock:
        cached = _cache.get(terrain_id)
        if cached is not None:
            _cache.move_to_end(terrain_id)
            return cached
        loader = _loader
    if loader is None:
        return None
    grid = loader(terrain_id)
    if grid is not None:
        with _lock:
            _cache[terrain_id] = grid
            while len(_cache) > CACHE_SIZE:
                _cache.popitem(last=False)
    return grid


def forget(terrain_id: str) -> None:
    with _lock:
        _cache.pop(terrain_id, None)


def require_grid(terrain_id: str | None) -> ElevationGrid:
    grid = get_grid(terrain_id) if terrain_id else None
    if grid is None:
        raise CoverageError("The elevation model was not found.")
    return grid

