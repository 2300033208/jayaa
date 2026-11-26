"""Real-time (time-domain) simulation of a clock survey campaign and of fixed-site monitoring.

Companion to Section XI of "Simulation Atomic Clock Based on Gravitational Sensing for Subsurface Mass".
All data are synthetic. Run from this folder:

    python realtime_sim.py            # full run (about 15-25 min on a laptop)
    python realtime_sim.py --quick    # reduced trial counts for a smoke test

Writes results_realtime.json and the figures in fig/ (PDF and PNG).
"""
from __future__ import annotations

import json
import math
import sys
import time
from datetime import date
from pathlib import Path

import numpy as np
from scipy.optimize import least_squares
from scipy.stats import norm

import matplotlib as mpl

mpl.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "engine"))
from engine.site import local_offsets_to_latlon, tidal_potential  # noqa: E402  (project tide model)

QUICK = "--quick" in sys.argv
FIG = HERE / "fig"
FIG.mkdir(exist_ok=True)

# ----------------------------------------------------------------------------- constants (as the paper)
G, C, G0 = 6.67430e-11, 299792458.0, 9.81
CL = {"C1": dict(s0=1e-15, fl=1e-17, h=0.010),
      "C2": dict(s0=3e-16, fl=1e-18, h=0.003),
      "C3": dict(s0=1e-16, fl=1e-19, h=0.001)}
X0, Y0, Z0 = 700.0, -500.0, 2000.0
M0 = 4.0 / 3.0 * math.pi * 1500.0**3 * 500.0
OFFSET = 3e-18                      # constant reference offset added to clock data (paper, Sec. VIII)
DRIFT_PER_DAY = 1e-19               # relative rover/reference drift in the drift scenarios
TIDE_RESID = 0.05                   # fraction of the differential tide left after model correction
LAT0, LON0 = 16.44, 80.62           # fixes the tidal geometry only (authors' campus)
REF_DIST, REF_BEARING = 100e3, 45.0 # reference clock 100 km to the north-east
START_2027 = date(2027, 1, 1)

gx = np.arange(-6000.0, 6001.0, 2000.0)
XX, YY = np.meshgrid(gx, gx)
SX, SY = XX.ravel(), YY.ravel()
NST = SX.size
T_SES, T_MOVE = 36000.0, 7200.0
CYCLE = T_SES + T_MOVE

# paper colours
COL = {"C1": "#1f5fa8", "C2": "#d1495b", "C3": "#2e8b57"}
PURPLE, GREY = "#8a5ac2", "#7f7f7f"
mpl.rcParams.update({
    "font.family": "STIXGeneral", "mathtext.fontset": "stix", "font.size": 8, "axes.labelsize": 8,
    "legend.fontsize": 6.8, "xtick.labelsize": 7, "ytick.labelsize": 7, "axes.linewidth": 0.6,
    "grid.color": "#d9d9d9", "grid.linewidth": 0.5, "lines.linewidth": 1.3, "legend.framealpha": 0.9,
    "legend.edgecolor": "#cccccc", "savefig.dpi": 300, "pdf.fonttype": 42,
})
W1, W2 = 3.45, 7.0  # column and page width (in)


def clock(x, y, x0, y0, z, m):
    return -G * m / (C**2 * np.sqrt((x - x0) ** 2 + (y - y0) ** 2 + z**2))


S_TRUE = clock(SX, SY, X0, Y0, Z0, M0)


def sig_model(k, teff=T_SES):
    p = CL[k]
    return np.sqrt(p["s0"] ** 2 / teff + p["fl"] ** 2 + (G0 * p["h"] / C**2) ** 2)


def serpentine(rows):
    out = []
    for i, r in enumerate(rows):
        cols = [c for c in range(7)]
        cols = cols if i % 2 == 0 else cols[::-1]
        out += [r * 7 + c for c in cols]
    return out


ORDER_SERP = np.array(serpentine(range(7)))
coarse = [r * 7 + c for i, r in enumerate([0, 2, 4, 6]) for c in ([0, 2, 4, 6] if i % 2 == 0 else [6, 4, 2, 0])]
rest = [s for s in serpentine(range(7)) if s not in coarse]
ORDER_COARSE = np.array(coarse + rest)
ORDERS = {"serpentine": ORDER_SERP, "coarse-first": ORDER_COARSE}

# ----------------------------------------------------------------------------- template bank (paper Sec. VII-B)
tp = np.arange(-4000.0, 4001.0, 500.0)
TPX, TPY = [a.ravel() for a in np.meshgrid(tp, tp)]
TZ = np.linspace(1000.0, 4500.0, 5)
TEMPL = np.vstack([-1.0 / np.sqrt((SX[None] - TPX[:, None]) ** 2 + (SY[None] - TPY[:, None]) ** 2 + z**2) for z in TZ])
KMIN = 9

# ----------------------------------------------------------------------------- noise generators
_FLK_SCALE: dict = {}


def _raw_flicker(rng, n_fft, size):
    f = np.fft.rfftfreq(n_fft)
    amp = np.zeros_like(f)
    amp[1:] = f[1:] ** -0.5
    spec = amp * (rng.standard_normal((size, f.size)) + 1j * rng.standard_normal((size, f.size)))
    return np.fft.irfft(spec, n=n_fft, axis=-1)


def oadev(y, m):
    """Overlapping Allan deviation of fractional-frequency samples at averaging factor m."""
    c = np.concatenate([[0.0], np.cumsum(y)])
    a = (c[m:] - c[:-m]) / m
    d = a[m:] - a[:-m]
    return math.sqrt(0.5 * np.mean(d**2))


def flicker_scale(n_fft, m_cal):
    key = (n_fft, m_cal)
    if key not in _FLK_SCALE:
        rng = np.random.default_rng(99)
        raw = _raw_flicker(rng, n_fft, 64)
        _FLK_SCALE[key] = 1.0 / math.sqrt(np.mean([oadev(r, m_cal) ** 2 for r in raw]))
    return _FLK_SCALE[key]


def flicker(rng, n, fl, n_fft, m_cal, size=1):
    """Flicker-FM series (n samples) with Allan deviation fl at averaging factor m_cal (Appendix E method)."""
    raw = _raw_flicker(rng, n_fft, size)
    start = rng.integers(0, n_fft - n, size)
    seg = np.stack([raw[i, s:s + n] for i, s in enumerate(start)])
    return seg * fl * flicker_scale(n_fft, m_cal)


def outage_mask(rng, n, dt, size=1, mean_gap=6 * 3600.0, mean_len=900.0):
    """Two-state Markov link: True where data are valid. Loss fraction about 4%."""
    p_in, p_out = dt / mean_gap, dt / mean_len
    u = rng.random((size, n))
    ok = np.ones((size, n), bool)
    state = np.ones(size, bool)
    for i in range(n):
        state = np.where(state, u[:, i] >= p_in, u[:, i] < p_out)
        ok[:, i] = state
    return ok


# ----------------------------------------------------------------------------- tides (engine.site model)
lat_st, lon_st = local_offsets_to_latlon(LAT0, LON0, SX, SY)
br = math.radians(REF_BEARING)


def ref_latlon(dist):
    return local_offsets_to_latlon(LAT0, LON0, np.array([dist * math.sin(br)]), np.array([dist * math.cos(br)]))


DAYS_2027 = (START_2027 - date(2000, 1, 1)).days - 0.5  # days since J2000.0 at 2027-01-01 00:00 UTC


def phi_series(lat, lon, t_s):
    days = DAYS_2027 + np.asarray(t_s) / 86400.0
    return tidal_potential(np.full(days.size, lat), np.full(days.size, lon), days)


def tide_table(dt, span_days, dist=REF_DIST):
    """Differential tide y = (Phi_station - Phi_ref)/c^2 for every station on a time grid through 2027."""
    t = np.arange(0.0, span_days * 86400.0, dt) + dt / 2
    rl, rn = ref_latlon(dist)
    ref = phi_series(rl[0], rn[0], t)
    out = np.empty((NST, t.size))
    for i in range(NST):
        out[i] = (phi_series(lat_st[i], lon_st[i], t) - ref) / C**2
    return t, out


# ----------------------------------------------------------------------------- campaign generator (packet level)
PKT = 300.0
NPK = int(T_SES / PKT)
NCYC = int(CYCLE / PKT)
NTL = NST * NCYC
STATION_DAY = (np.arange(NST) * CYCLE + T_SES / 2) / 86400.0   # mid-session time of the j-th session
END_DAY = (np.arange(NST) * CYCLE + T_SES) / 86400.0
print("building tide table ...", flush=True)
_t0 = time.perf_counter()
TT, TIDE = tide_table(PKT, 365 + 30)
print(f"  {TIDE.shape} in {time.perf_counter() - _t0:.1f} s; rms station-centre tide {TIDE[24].std():.2e}", flush=True)


def campaign(rng, k, order, n, **kw):
    """Chunked wrapper around _campaign to bound memory."""
    parts = [_campaign(rng, k, order, min(400, n - a), **kw) for a in range(0, n, 400)]
    return tuple(np.concatenate([p_[i] for p_ in parts]) for i in range(3))


def _campaign(rng, k, order, n, *, static=False, signal=True, tide=None, outages=False, drift=False):
    """Simulate n campaigns. Returns station means y (n, NST) in visit order, sigmas, mid-times (days)."""
    p = CL[k]
    st = order
    if static:  # paper model: independent Gaussian station errors
        sg = np.full((n, NST), sig_model(k))
        y = rng.standard_normal((n, NST)) * sg + OFFSET + (S_TRUE[st] if signal else 0.0)
        return y, sg, np.tile(STATION_DAY, (n, 1))
    fl = flicker(rng, NTL, p["fl"], 16384, NPK, n)                  # continuous across the campaign
    white = rng.standard_normal((n, NTL)) * p["s0"] / math.sqrt(PKT)
    data = (fl + white).reshape(n, NST, NCYC)[:, :, :NPK]          # keep the measuring packets only
    data = data + G0 * p["h"] / C**2 * rng.standard_normal((n, NST, 1)) + OFFSET
    if signal:
        data = data + S_TRUE[st][None, :, None]
    tmid = (np.arange(NST)[:, None] * CYCLE + (np.arange(NPK)[None] + 0.5) * PKT)  # s since start
    if drift:
        data = data + DRIFT_PER_DAY * tmid[None] / 86400.0
    if tide is not None:
        s0 = rng.integers(0, TT.size - NTL - 1, n)
        idx = s0[:, None, None] + (np.arange(NST)[:, None] * NCYC + np.arange(NPK)[None])[None]
        tide_v = TIDE[st[None, :, None], idx]
        data = data + tide_v
        if tide == "corrected":
            data = data - (1.0 - TIDE_RESID) * tide_v
    if outages:
        ok = outage_mask(rng, NST * NPK, PKT, n).reshape(n, NST, NPK)
        ok[:, :, 0] = True
    else:
        ok = np.ones(data.shape, bool)
    cnt = ok.sum(-1)
    y = (data * ok).sum(-1) / cnt
    sg = sig_model(k, cnt * PKT)
    tday = (tmid[None] * ok).sum(-1) / cnt / 86400.0
    return y, sg, tday


# ----------------------------------------------------------------------------- real-time detection
def _proj_basis(sg, td, fit_drift):
    w = 1.0 / sg
    cols = [w] if not fit_drift else [w, (td - td.mean(-1, keepdims=True)) * w]
    a = np.stack(cols, -1)
    q, _ = np.linalg.qr(a)
    return q


def stat_track(y, sg, td, order, fit_drift=False, chunk=150):
    """Template-bank statistic after each station k = KMIN..49, for many campaigns at once. Shape (n, 41)."""
    n = y.shape[0]
    out = np.empty((n, NST - KMIN + 1))
    tm_all = TEMPL[:, order]
    if np.ptp(sg) == 0 and np.ptp(td, axis=0).max() == 0:   # identical weights and times: one projection
        for k in range(KMIN, NST + 1):
            s = sg[0, :k]
            q = _proj_basis(s[None], td[:1, :k], fit_drift)[0]
            t = tm_all[:, :k] / s
            pt = t - (t @ q) @ q.T
            pt /= np.linalg.norm(pt, axis=1, keepdims=True)
            u = y[:, :k] / s
            pu = u - (u @ q) @ q.T
            out[:, k - KMIN] = (pu @ pt.T).max(1)
        return out
    for k in range(KMIN, NST + 1):
        for a in range(0, n, chunk):
            b = slice(a, a + chunk)
            s = sg[b, :k]
            u = y[b, :k] / s
            q = _proj_basis(s, td[b, :k], fit_drift)
            pu = u - np.einsum("nkp,np->nk", q, np.einsum("nkp,nk->np", q, u))
            t = tm_all[None, :, :k] / s[:, None, :]
            tq = np.einsum("njk,nkp->njp", t, q)
            pt = t - np.einsum("njp,nkp->njk", tq, q)
            num = np.einsum("njk,nk->nj", pt, pu)
            out[b, k - KMIN] = (num / np.linalg.norm(pt, axis=-1)).max(-1)
    return out


def calibrate(z_null, fa=0.05):
    """Per-look thresholds q_k with a common level chosen so that P(any crossing) = fa."""
    lo, hi = 1e-5, fa
    for _ in range(50):
        a = math.sqrt(lo * hi)
        q = np.quantile(z_null, 1 - a, axis=0)
        r = np.mean((z_null > q).any(1))
        lo, hi = (a, hi) if r < fa else (lo, a)
    return np.quantile(z_null, 1 - lo, axis=0)


def first_cross(z, q):
    hit = z > q
    anyh = hit.any(1)
    k = np.where(anyh, hit.argmax(1) + KMIN, -1)
    return anyh, k


# ----------------------------------------------------------------------------- real-time inversion
LB = np.array([-6000.0, -6000.0, 200.0, 0.1])
UB = np.array([6000.0, 6000.0, 10000.0, 1000.0])


def invert(y, sg, td, order, k, fit_drift=False):
    st = order[:k]
    sx, sy = SX[st], SY[st]
    s = sg[:k]
    u = y[:k] / s
    q = _proj_basis(s[None], td[None, :k], fit_drift)[0]
    proj = lambda v: v - q @ (q.T @ v)  # noqa: E731
    pu = proj(u)

    def res(th):
        return proj(clock(sx, sy, th[0], th[1], th[2], th[3] * 1e12) / s) - pu

    i0 = int(np.argmin(pu))
    best = None
    for z in (1000.0, 2500.0, 5000.0):
        g = proj(clock(sx, sy, sx[i0], sy[i0], z, 1e12) / s)
        m = float(np.clip(g @ pu / (g @ g), 0.2, 900.0))
        th0 = np.clip([sx[i0], sy[i0], z, m], LB + 1, UB - 1)
        r = least_squares(res, th0, bounds=(LB, UB), x_scale=[1000, 1000, 1000, 5], method="trf", max_nfev=300)
        if best is None or r.cost < best.cost:
            best = r
    th = best.x
    bound = th[2] < 210 or th[2] > 9900 or th[3] < 0.11 or th[3] > 990 or abs(th[0]) > 5990 or abs(th[1]) > 5990
    return th, bool(bound)


def errors(th):
    return math.hypot(th[0] - X0, th[1] - Y0), abs(th[2] - Z0), abs(th[3] * 1e12 / M0 - 1) * 100


def summarise(errs, bounds):
    e = np.array(errs)
    return dict(horiz_m=float(np.median(e[:, 0])), depth_m=float(np.median(e[:, 1])),
                mass_pct=float(np.median(e[:, 2])), at_bound_pct=float(100 * np.mean(bounds)))


# =============================================================================== studies
R: dict = {"settings": dict(packet_s=PKT, session_h=T_SES / 3600, move_h=T_MOVE / 3600, offset=OFFSET,
                            drift_per_day=DRIFT_PER_DAY, tide_residual=TIDE_RESID, ref_km=REF_DIST / 1e3,
                            campaign_days=float(END_DAY[-1]), quick=QUICK)}
N_NULL = 600 if QUICK else 3000
N_SIG = 150 if QUICK else 1000
N_INV = 60 if QUICK else 300
rng = np.random.default_rng(2026)

# -- flicker generator check
fl_chk = flicker(np.random.default_rng(7), 16384, 1.0, 16384 * 2, NPK, 40)
R["flicker_check"] = {f"{m * PKT / 3600:g} h": float(np.sqrt(np.mean([oadev(f, m) ** 2 for f in fl_chk])))
                      for m in (12, 60, 120, 288, 864)}
print("flicker ADEV / floor:", R["flicker_check"], flush=True)

# -- matched-filter SNR (paper check)
P = np.eye(NST) - 1.0 / NST
R["mf_snr"] = {k: float(np.linalg.norm(P @ S_TRUE) / sig_model(k)) for k in CL}
print("MF SNR:", R["mf_snr"], flush=True)

# -- 1. sequential detection, three classes, two visit orders, time-domain noise
print("sequential detection ...", flush=True)
det = {}
thr_store = {}
for k in CL:
    for oname, order in ORDERS.items():
        zc = stat_track(*campaign(rng, k, order, N_NULL, signal=False), order)
        q = calibrate(zc)
        zv = stat_track(*campaign(rng, k, order, N_NULL, signal=False), order)
        zs = stat_track(*campaign(rng, k, order, N_SIG), order)
        hit, kk = first_cross(zs, q)
        pd_day = [float(np.mean(hit & (kk <= j))) for j in range(KMIN, NST + 1)]
        det[f"{k}|{oname}"] = dict(fa_validation=float(np.mean((zv > q).any(1))), pd_final=float(hit.mean()),
                                  median_day=float(np.median(END_DAY[kk[hit] - 1])) if hit.any() else None,
                                  median_station=float(np.median(kk[hit])) if hit.any() else None,
                                  pd_curve=pd_day, q_final=float(q[-1]))
        thr_store[(k, oname, False)] = q
        print(f"  {k} {oname:12s} FA={det[f'{k}|{oname}']['fa_validation']:.3f} Pd={hit.mean():.3f}", flush=True)
R["sequential"] = det

# -- 2. scenario table (C3, serpentine), detection + final inversion
print("scenarios ...", flush=True)
SCEN = [
    ("S0", "Batch model of Sec. IX (independent noise)", dict(static=True), False),
    ("S1", "Time-domain noise (white + continuous flicker)", dict(), False),
    ("S2", "S1 + link outages (about 4 % loss)", dict(outages=True), False),
    ("S3", "S1 + differential tide, uncorrected", dict(tide="raw"), False),
    ("S4", "S1 + tide corrected (5 % residual)", dict(tide="corrected"), False),
    ("S5", "S1 + drift 1e-19/day, offset only", dict(drift=True), False),
    ("S6", "S1 + drift, drift fitted in time", dict(drift=True), True),
    ("S7", "All of S2, S4 and S6", dict(outages=True, tide="corrected", drift=True), True),
]
order = ORDER_SERP
q_static = calibrate(stat_track(*campaign(rng, "C3", order, N_NULL, static=True, signal=False), order))
# paper threshold check: single look at 49 stations, 5 % false alarm
z49 = stat_track(*campaign(rng, "C3", order, 4 * N_NULL if not QUICK else N_NULL, static=True, signal=False),
                 order)[:, -1]
R["single_look_threshold_49"] = float(np.quantile(z49, 0.95))
q_drift = calibrate(stat_track(*campaign(rng, "C3", order, N_NULL, signal=False), order, fit_drift=True))
scen_out = {}
for sid, label, kw, fitd in SCEN:
    q = q_static if sid == "S0" else (q_drift if fitd else thr_store[("C3", "serpentine", False)])
    zv = stat_track(*campaign(rng, "C3", order, N_NULL, signal=False, **kw), order, fit_drift=fitd)
    ys, ss, ts = campaign(rng, "C3", order, N_SIG, **kw)
    hit, kk = first_cross(stat_track(ys, ss, ts, order, fit_drift=fitd), q)
    errs, bnds = [], []
    for i in range(N_INV):
        th, bd = invert(ys[i], ss[i], ts[i], order, NST, fitd)
        errs.append(errors(th))
        bnds.append(bd)
    scen_out[sid] = dict(label=label, fa=float(np.mean((zv > q).any(1))), pd=float(hit.mean()),
                         median_day=float(np.median(END_DAY[kk[hit] - 1])) if hit.any() else None,
                         **summarise(errs, bnds))
    print(f"  {sid}: {scen_out[sid]}", flush=True)
R["scenarios"] = scen_out

# -- 3. convergence of the live inversion (C3), S1 and S7, both visit orders
print("convergence ...", flush=True)
KS = [16, 21, 28, 35, 42, 49]
conv = {}
for sid, kw, fitd in (("S1", dict(), False), ("S7", dict(outages=True, tide="corrected", drift=True), True)):
    for oname, od in ORDERS.items():
        ys, ss, ts = campaign(rng, "C3", od, N_INV)
        rows = {kk: [] for kk in KS}
        for i in range(N_INV):
            for kk in KS:
                th, _ = invert(ys[i], ss[i], ts[i], od, kk, fitd)
                rows[kk].append(errors(th))
        conv[f"{sid}|{oname}"] = {kk: dict(zip(["horiz", "depth", "mass"],
                                               [list(map(float, np.percentile(np.array(v)[:, j], [25, 50, 75])))
                                                for j in range(3)])) for kk, v in rows.items()}
        print(f"  {sid} {oname}: depth median at 49 = {conv[f'{sid}|{oname}'][49]['depth'][1]:.0f}", flush=True)
R["convergence"] = conv

# -- 4. tide error against reference distance and session length
print("tide study ...", flush=True)
sess_h = [2.0, 10.0, 12.42, 24.84]
dists = [5e3, 10e3, 20e3, 50e3, 100e3, 200e3, 500e3]
tgrid = np.arange(0.0, 366 * 86400.0, 300.0) + 150.0
phi_c = phi_series(LAT0, LON0, tgrid)
tide_rms = {}
for d in dists:
    rl, rn = ref_latlon(d)
    diff = (phi_c - phi_series(rl[0], rn[0], tgrid)) / C**2
    cs = np.concatenate([[0.0], np.cumsum(diff)])
    row = {}
    for h in sess_h:
        m = int(round(h * 3600 / 300))
        means = (cs[m:] - cs[:-m]) / m
        row[f"{h:g}"] = float(np.sqrt(np.mean(means**2)))
    row["peak_to_peak"] = float(diff.max() - diff.min())
    tide_rms[f"{d / 1e3:g}"] = row
R["tide_rms"] = tide_rms
print("  100 km:", tide_rms["100"], flush=True)

# -- 5. fixed-site monitoring of a changing mass
print("monitoring ...", flush=True)
HR = 3600.0
EP = 100  # days per epoch


def sigma_epoch(k, days):
    return math.sqrt(CL[k]["s0"] ** 2 / (days * 86400.0) + CL[k]["fl"] ** 2)


def mmin(k, days, z0=2000.0):
    return 3 * math.sqrt(2) * sigma_epoch(k, days) * C**2 * z0 / G


mon = {"mmin_eq27": {k: mmin(k, EP) for k in CL}}
n_mon = 400 if QUICK else 2000
ndays = 2 * EP + 730
rl, rn = ref_latlon(REF_DIST)
th_h = np.arange(0.0, ndays * 86400.0, HR) + HR / 2
tide_fixed = (phi_series(LAT0, LON0, th_h) - phi_series(rl[0], rn[0], th_h)) / C**2 * TIDE_RESID
mon_rng = np.random.default_rng(2031)
for k in ("C2", "C3"):
    p = CL[k]
    nh = ndays * 24
    fl = flicker(mon_rng, nh, p["fl"], 65536, 240, n_mon)
    noise = fl + mon_rng.standard_normal((n_mon, nh)) * p["s0"] / math.sqrt(HR) + tide_fixed[None]
    base = noise[:, :EP * 24].mean(1)
    gaps = {}
    for gap in (0, 100, 365, 730):
        a = (EP + gap) * 24
        d = noise[:, a:a + EP * 24].mean(1) - base
        gaps[str(gap)] = float(d.std() / (math.sqrt(2) * sigma_epoch(k, EP)))
    d0 = noise[:, EP * 24:2 * EP * 24].mean(1) - base
    ratios = np.linspace(0, 2, 9)
    shift = G * mmin(k, EP) / (C**2 * 2000.0)
    pd_sim = [float(np.mean((-(d0 - r * shift)) / (math.sqrt(2) * sigma_epoch(k, EP)) > 3)) for r in ratios]
    pd_th = [float(norm.sf(3 - 3 * r)) for r in ratios]
    mon[k] = dict(gap_sigma_ratio=gaps, ratios=list(map(float, ratios)), pd_sim=pd_sim, pd_theory=pd_th,
                  fa_sim=pd_sim[0], sigma_ratio_adjacent=gaps["0"])
    print(f"  {k}: gaps {gaps}  Pd(1x)={pd_sim[4]:.3f}", flush=True)
R["monitoring"] = mon

# =============================================================================== showcase realisation (10 s stream)
print("showcase stream ...", flush=True)
DT = 10.0
srng = np.random.default_rng(4242)
K = "C3"
p = CL[K]
order = ORDER_COARSE
nsamp = int(NST * CYCLE / DT)
t_s = np.arange(nsamp) * DT + DT / 2
start_day = 37.0  # 2027-02-07
rlat, rlon = ref_latlon(REF_DIST)
phi_ref = phi_series(rlat[0], rlon[0], t_s + start_day * 86400)
sess = (t_s // CYCLE).astype(int)
in_ses = (t_s % CYCLE) < T_SES
true_tide = np.empty(nsamp)
for j in range(NST):
    m = sess == j
    st = order[j]
    true_tide[m] = (phi_series(lat_st[st], lon_st[st], t_s[m] + start_day * 86400) - phi_ref[m]) / C**2
stream = (flicker(srng, nsamp, p["fl"], 2**20, int(T_SES / DT))[0] + srng.standard_normal(nsamp) * p["s0"] / math.sqrt(DT)
          + OFFSET + DRIFT_PER_DAY * t_s / 86400 + true_tide)
hgt = G0 * p["h"] / C**2 * srng.standard_normal(NST)
stream += hgt[sess] + S_TRUE[order][sess]
valid = in_ses & outage_mask(srng, nsamp, DT)[0]
tide_model = (1 - TIDE_RESID) * true_tide


class RealTimeProcessor:
    """Consumes 10 s packets as they arrive; updates station values, detection and the inversion per station."""

    def __init__(self, q):
        self.q = q
        self.y, self.s, self.t = [], [], []
        self.acc = self.acc_t = 0.0
        self.n = 0
        self.packet_us, self.update_ms = [], []
        self.log = []

    def push(self, t, value, model):
        a = time.perf_counter()
        self.acc += value - model
        self.acc_t += t
        self.n += 1
        self.packet_us.append((time.perf_counter() - a) * 1e6)

    def running(self):
        return self.acc / max(self.n, 1), sig_model(K, max(self.n, 1) * DT)

    def close_station(self):
        a = time.perf_counter()
        self.y.append(self.acc / self.n)
        self.s.append(sig_model(K, self.n * DT))
        self.t.append(self.acc_t / self.n / 86400)
        self.acc = self.acc_t = 0.0
        self.n = 0
        k = len(self.y)
        y, s, t = np.array(self.y), np.array(self.s), np.array(self.t)
        entry = dict(k=k, day=float(t[-1]))
        if k >= KMIN:
            z = stat_track(y[None], s[None], t[None], order[:k], fit_drift=True)[0, -1]
            entry["stat"], entry["thr"] = float(z), float(self.q[k - KMIN])
        if k >= 12:
            th, bd = invert(y, s, t, order, k, fit_drift=True)
            entry["theta"] = list(map(float, th))
            entry["bound"] = bd
        self.update_ms.append((time.perf_counter() - a) * 1e3)
        self.log.append(entry)


proc = RealTimeProcessor(q_drift if order is ORDER_SERP else
                         calibrate(stat_track(*campaign(rng, "C3", ORDER_COARSE, N_NULL, signal=False), ORDER_COARSE,
                                              fit_drift=True)))
show_j = int(np.where(order == 24)[0][0])  # station at (0, 0)
run_trace = []
for i in range(nsamp):
    j = sess[i]
    if valid[i]:
        proc.push(t_s[i], stream[i], tide_model[i])
        if j == show_j:
            mu, sd = proc.running()
            run_trace.append((t_s[i], mu, sd))
    if (i == nsamp - 1 or sess[i + 1] != j) and proc.n > 0:
        proc.close_station()
log = proc.log
det_entry = next((e for e in log if "stat" in e and e["stat"] > e["thr"]), None)
R["showcase"] = dict(order="coarse-first", class_=K, start="2027-02-07", detect_station=det_entry and det_entry["k"],
                     detect_day=det_entry and det_entry["day"], final=log[-1].get("theta"),
                     final_errors=errors(log[-1]["theta"]), loss_pct=float(100 * (1 - valid[in_ses].mean())),
                     packet_us_median=float(np.median(proc.packet_us)),
                     update_ms_median=float(np.median(proc.update_ms[KMIN:])),
                     update_ms_max=float(np.max(proc.update_ms)), n_packets=int(valid.sum()))
print("showcase:", R["showcase"], flush=True)

# =============================================================================== figures
def save(fig, name):
    fig.savefig(FIG / f"{name}.pdf", bbox_inches="tight", pad_inches=0.02)
    fig.savefig(FIG / f"{name}.png", bbox_inches="tight", pad_inches=0.02, dpi=200)
    plt.close(fig)


E18 = 1e18
# Fig. 24 one station in real time
m = sess == show_j
t0 = t_s[m][0]
th_ = (t_s[m] - t0) / 3600
raw = np.where(valid[m], stream[m] - tide_model[m], np.nan)
truth_st = S_TRUE[24] + OFFSET + hgt[show_j] + DRIFT_PER_DAY * (t0 + T_SES / 2) / 86400
rt = np.array(run_trace)
fig, ax = plt.subplots(2, 1, figsize=(W1, 3.5), sharex=True, gridspec_kw=dict(height_ratios=[1, 1.25], hspace=0.08))
ax[0].plot(th_, raw * 1e16, ".", ms=0.6, color="#b0b0b0", rasterized=True, label="10 s packets")
blk = 60
with np.errstate(all="ignore"):
    mm = np.nanmean(raw[: raw.size // blk * blk].reshape(-1, blk), 1)
ax[0].plot((np.arange(mm.size) + 0.5) * blk * DT / 3600, mm * 1e16, "-", color=COL["C1"], lw=1.0, label="10 min mean")
ax[0].set_ylabel(r"$y$ ($10^{-16}$)")
ax[0].set_ylim(-1.3, 1.3)
ax[0].legend(loc="upper right", ncol=2, handlelength=1.2, markerscale=8)
ax[0].grid(True)
gap = ~valid[m]
rth = (rt[:, 0] - t0) / 3600
ax[1].fill_between(rth, (rt[:, 1] - rt[:, 2]) * E18, (rt[:, 1] + rt[:, 2]) * E18, color=COL["C3"], alpha=0.18, lw=0,
                   label=r"$\pm1\sigma$ (model)")
ax[1].plot(rth, rt[:, 1] * E18, color=COL["C3"], lw=1.1, label="running estimate")
ax[1].axhline(truth_st * E18, color="k", ls="--", lw=0.9, label="true station value")
ax[1].axhline(OFFSET * E18, color=GREY, ls=":", lw=0.9, label="offset alone (no body)")
ax[1].set_ylim(-1, 7.5)
ax[1].set_xlim(0, 10)
ax[1].set_ylabel(r"station value ($10^{-18}$)")
ax[1].set_xlabel("Time since start of session (h)")
ax[1].legend(loc="upper right", ncol=2, handlelength=1.4)
ax[1].grid(True)
for a_ in ax:
    idx = np.flatnonzero(np.diff(np.concatenate([[0], gap.astype(int), [0]])))
    for s_, e_ in zip(idx[::2], idx[1::2]):
        a_.axvspan(th_[s_], th_[min(e_, th_.size - 1)], color="#f2c4cb", lw=0, zorder=0)
save(fig, "fig24_station_stream")

# Fig. 25 campaign timeline
y_arr, s_arr, t_arr = np.array(proc.y), np.array(proc.s), np.array(proc.t)
fig, ax = plt.subplots(2, 1, figsize=(W1, 3.4), sharex=True, gridspec_kw=dict(height_ratios=[1.5, 1], hspace=0.08))
sc = ax[0].scatter(t_arr, y_arr * E18, c=S_TRUE[order] * E18, cmap="viridis", s=9, zorder=3, edgecolor="k", lw=0.2)
ax[0].errorbar(t_arr, y_arr * E18, s_arr * E18, fmt="none", ecolor="#999999", elinewidth=0.6, zorder=2)
tl = np.linspace(0, END_DAY[-1], 200)
ax[0].plot(tl, (OFFSET + DRIFT_PER_DAY * tl) * E18, color=PURPLE, ls="--", lw=0.9, label="offset + drift (true)")
ax[0].axvline(END_DAY[15], color=GREY, lw=0.7, ls=":")
ax[0].text(END_DAY[15] - 0.3, -2.2, "coarse grid\ncomplete", fontsize=6.5, color="#555555", ha="right")
if det_entry:
    ax[0].axvline(det_entry["day"], color=COL["C2"], lw=0.9)
    ax[0].text(det_entry["day"] + 0.3, -2.2, f"detection\n(station {det_entry['k']})", fontsize=6.5, color=COL["C2"])
ax[0].set_ylabel(r"station value ($10^{-18}$)")
ax[0].set_ylim(-2.5, 7.5)
ax[0].legend(loc="upper left", fontsize=6.3)
ax[0].grid(True)
cb = fig.colorbar(sc, ax=ax, pad=0.02, fraction=0.05, aspect=30)
cb.set_label(r"true body signal ($10^{-18}$)")
cb.ax.tick_params(labelsize=6.5)
td_ = t_s / 86400
ax[1].plot(td_[::30], np.where(in_ses, true_tide, np.nan)[::30] * E18, color=COL["C1"], lw=0.7, label="differential tide")
ax[1].plot(td_[::30], np.where(in_ses, true_tide - tide_model, np.nan)[::30] * E18, color=COL["C2"], lw=0.9,
           label="after correction")
ax[1].set_ylabel(r"tide ($10^{-18}$)")
ax[1].set_xlabel("Campaign time (days)")
ax[1].set_xlim(0, END_DAY[-1] + 0.3)
ax[1].legend(loc="lower right", ncol=2)
ax[1].grid(True)
save(fig, "fig25_campaign_timeline")

# Fig. 26 live maps
fig, axs = plt.subplots(1, 3, figsize=(W2, 2.35), sharey=True, gridspec_kw=dict(wspace=0.06))
gg = np.linspace(-6500, 6500, 131)
GX, GY = np.meshgrid(gg, gg)
vmin, vmax = -2.6, -0.4
for a_, k in zip(axs, (16, 28, 49)):
    e = log[k - 1]
    th = e["theta"]
    st = order[:k]
    yy, ss, tt = y_arr[:k], s_arr[:k], t_arr[:k]
    w = 1 / ss
    A = np.column_stack([w, (tt - tt.mean()) * w])
    mod = clock(SX[st], SY[st], *th[:3], th[3] * 1e12)
    coef = np.linalg.lstsq(A, (yy - mod) * w, rcond=None)[0]
    clean = yy - (coef[0] + coef[1] * (tt - tt.mean()))
    field = clock(GX, GY, *th[:3], th[3] * 1e12) * E18
    cs = a_.contourf(GX / 1e3, GY / 1e3, field, levels=np.linspace(vmin, vmax, 12), cmap="viridis_r", extend="both", alpha=0.55)
    a_.scatter(SX / 1e3, SY / 1e3, s=9, facecolor="white", edgecolor="#999999", lw=0.5)
    a_.scatter(SX[st] / 1e3, SY[st] / 1e3, c=clean * E18, cmap="viridis_r", vmin=vmin, vmax=vmax, s=24,
               edgecolor="black", lw=0.5, zorder=3)
    a_.plot(X0 / 1e3, Y0 / 1e3, "x", color="#e0303a", ms=7, mew=1.6, zorder=4)
    a_.plot(th[0] / 1e3, th[1] / 1e3, "+", color="black", ms=9, mew=1.5, zorder=5)
    ex = errors(th)
    a_.set_title(f"after {k} stations, day {e['day']:.1f}\n"
                 f"$\\hat z_0$ = {th[2] / 1e3:.2f} km, $\\hat M/M$ = {th[3] * 1e12 / M0:.2f}", fontsize=7.2)
    a_.set_xlabel("x (km)")
    a_.set_aspect("equal")
    a_.set_xlim(-6.8, 6.8)
    a_.set_ylim(-6.8, 6.8)
axs[0].set_ylabel("y (km)")
cb = fig.colorbar(mpl.cm.ScalarMappable(norm=mpl.colors.Normalize(vmin, vmax), cmap="viridis_r"), ax=axs, pad=0.015, fraction=0.03, aspect=25)
cb.set_label(r"$\Delta\nu/\nu$ ($10^{-18}$)")
cb.ax.tick_params(labelsize=6.5)
save(fig, "fig26_live_maps")

# Fig. 27 sequential detection
fig, ax = plt.subplots(figsize=(W1, 2.45))
days_k = END_DAY[KMIN - 1:]
for k in CL:
    for oname, ls in (("serpentine", "-"), ("coarse-first", "--")):
        d = det[f"{k}|{oname}"]
        ax.step(days_k, d["pd_curve"], where="post", color=COL[k], ls=ls, lw=1.2,
                label=f"{k} {oname}" if k == "C3" or oname == "serpentine" else None)
ax.axhline(0.05, color=GREY, lw=0.8, ls=":", label="5% false-alarm budget")
ax.set_xlabel("Campaign time (days)")
ax.set_ylabel("Cumulative detection probability")
ax.set_xlim(0, END_DAY[-1])
ax.set_ylim(0, 1.02)
h_, l_ = ax.get_legend_handles_labels()
ax.legend(h_, [s.replace("C1 serpentine", "C1").replace("C2 serpentine", "C2") for s in l_], loc="center right",
          fontsize=6.3)
ax.grid(True)
save(fig, "fig27_sequential_detection")

# Fig. 28 convergence
fig, ax = plt.subplots(2, 1, figsize=(W1, 3.3), sharex=True, gridspec_kw=dict(hspace=0.08))
for key, col, lab in (("S1|coarse-first", COL["C3"], "S1, coarse-first"), ("S1|serpentine", COL["C1"], "S1, serpentine"),
                      ("S7|coarse-first", COL["C2"], "S7, coarse-first")):
    cv = conv[key]
    for a_, par, sc_ in ((ax[0], "horiz", 1e-3), (ax[1], "depth", 1e-3)):
        lo = [cv[k][par][0] * sc_ for k in KS]
        md = [cv[k][par][1] * sc_ for k in KS]
        hi = [cv[k][par][2] * sc_ for k in KS]
        a_.fill_between(KS, lo, hi, color=col, alpha=0.09, lw=0)
        a_.plot(KS, md, "o-", color=col, ms=3, label=lab)
ax[0].set_ylabel("horizontal error (km)")
ax[1].set_ylabel("depth error (km)")
ax[1].set_xlabel("Stations processed")
ax[0].legend(loc="upper right")
for a_ in ax:
    a_.grid(True)
    a_.set_ylim(bottom=0)
save(fig, "fig28_live_inversion")

# Fig. 29 tide against distance
fig, ax = plt.subplots(figsize=(W1, 2.4))
dk = np.array([float(d) for d in tide_rms])
for h, col, ls in zip(["2", "10", "12.42", "24.84"], [GREY, COL["C1"], PURPLE, COL["C3"]], [":", "-", "--", "-."]):
    ax.loglog(dk, [tide_rms[f"{d:g}"][h] for d in dk], ls=ls, color=col, marker="o", ms=2.5,
              label=f"{h} h session")
for k, ls in (("C2", (0, (5, 2))), ("C3", (0, (2, 2)))):
    ax.axhline(sig_model(k), color=COL[k], lw=0.8, ls=ls)
    ax.text(5.3, sig_model(k) * (0.68 if k == "C2" else 1.12), f"{k} noise, 10 h", fontsize=6.3, color=COL[k])
ax.axhline(2.62e-18, color="k", lw=0.8, ls=":")
ax.text(5.3, 2.62e-18 * 0.84, "baseline peak signal", fontsize=6.3)
ax.set_xlabel("Distance to reference clock (km)")
ax.set_ylabel("RMS session-mean tide")
ax.legend(loc="lower right", ncol=2, fontsize=6.3)
ax.grid(True, which="both")
save(fig, "fig29_tide_distance")

# Fig. 30 monitoring
print("monitoring showcase ...", flush=True)
mrng = np.random.default_rng(77)
nd = 420
nh = nd * 24
th_h2 = np.arange(nh) * HR + HR / 2
dm = np.clip((th_h2 / 86400 - 150) / 150, 0, 1) * 3e12
sig_t = -G * dm / (C**2 * 2000.0)
tide_m = (phi_series(LAT0, LON0, th_h2) - phi_series(rl[0], rn[0], th_h2)) / C**2 * TIDE_RESID
yh = (flicker(mrng, nh, CL["C3"]["fl"], 65536, 240)[0] + mrng.standard_normal(nh) * CL["C3"]["s0"] / math.sqrt(HR)
      + sig_t + tide_m)
daily = yh.reshape(nd, 24).mean(1)
cs_ = np.concatenate([[0], np.cumsum(yh)])
base = yh[:EP * 24].mean()
zz = np.full(nd, np.nan)
for d in range(2 * EP, nd + 1):
    zz[d - 1] = -(cs_[d * 24] - cs_[(d - EP) * 24]) / (EP * 24) + base
zz /= math.sqrt(2) * sigma_epoch("C3", EP)
first = int(np.argmax(np.nan_to_num(zz) > 3)) + 1
R["monitoring"]["showcase"] = dict(ramp="0 to 3e12 kg, days 150-300", detect_day=first,
                                   mass_at_detect=float(np.clip((first - 150) / 150, 0, 1) * 3e12))
fig = plt.figure(figsize=(W2, 2.75))
gs = fig.add_gridspec(2, 2, width_ratios=[1.4, 1], height_ratios=[1.3, 1], wspace=0.25, hspace=0.08)
a0 = fig.add_subplot(gs[0, 0])
a1 = fig.add_subplot(gs[1, 0], sharex=a0)
ax = [a0, fig.add_subplot(gs[:, 1])]
dd = np.arange(nd) + 0.5
a0.plot(dd, daily * E18, ".", ms=1.6, color="#9a9a9a", label="daily mean")
wk = daily[: nd // 7 * 7].reshape(-1, 7).mean(1)
a0.plot(np.arange(wk.size) * 7 + 3.5, wk * E18, color=COL["C1"], lw=1.0, label="weekly mean")
a0.plot(dd, -G * np.clip((dd - 150) / 150, 0, 1) * 3e12 / (C**2 * 2000) * E18, "k--", lw=0.9, label="true signal")
a0.set_ylabel(r"$\Delta\nu/\nu$ ($10^{-18}$)")
a0.set_ylim(-2.2, 1.2)
a0.legend(loc="lower left", fontsize=6.2, ncol=3)
a0.grid(True)
plt.setp(a0.get_xticklabels(), visible=False)
a1.plot(dd, zz, color=COL["C2"], lw=1.1, label="sliding 100-day statistic")
a1.axhline(3, color="k", ls=":", lw=0.8, label="threshold (3)")
a1.axvline(first, color=COL["C2"], lw=0.7, alpha=0.7)
a1.text(first + 4, 8, f"detected day {first}", fontsize=6.3, color=COL["C2"])
a1.set_ylabel("statistic")
a1.set_xlabel("Time (days)")
a1.set_ylim(-3, 11)
a1.set_xlim(0, nd)
a1.legend(loc="upper left", fontsize=6.2)
a1.grid(True)
for k in ("C2", "C3"):
    mk = R["monitoring"][k]
    ax[1].plot(mk["ratios"], mk["pd_sim"], "o", color=COL[k], ms=3.2, label=f"{k} simulated")
rr = np.linspace(0, 2, 100)
ax[1].plot(rr, norm.sf(3 - 3 * rr), "k-", lw=1.0, label="theory, Eq. (27)")
ax[1].set_xlabel(r"Mass change / $\Delta M_{\min}$ of Eq. (27)")
ax[1].set_ylabel("Detection probability")
ax[1].legend(loc="upper left")
ax[1].grid(True)
save(fig, "fig30_monitoring")

(HERE / "results_realtime.json").write_text(json.dumps(R, indent=1, default=float))
print("done", flush=True)
