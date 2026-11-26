# Atomic Gravity Simulator

Simulation of atomic-clock based gravitational sensing for subsurface mass detection.

A buried mass perturbs the gravitational potential; an optical clock above it ticks at a
slightly different rate (Δf/f₀ = ΔΦ/c²). The simulator scans a virtual clock over a survey area,
adds realistic noise, detects the anomaly, reconstructs the source by inversion and quantifies the
uncertainty — then compares the estimate with the configured ground truth.

```
engine/     Python reference simulation engine (FastAPI + NumPy/SciPy): physics, noise, streaming,
            inversion, bootstrap uncertainty, exports
frontend/   React + TypeScript + Vite interface (Three.js scene, Plotly charts)
contract/   Shared field limits, clock presets and default configuration (read by both sides)
```

The research question, related literature, validation against published experiments and the main findings are in
[RESEARCH.md](RESEARCH.md).

Every number shown in the interface is produced by the engine. The frontend validates, formats and
visualizes; it performs no physics.

## Running

Requirements: Python 3.11+, Node 22+.

```bash
# 1. Engine (http://127.0.0.1:8000)
cd engine
pip install -r requirements.txt
python -m uvicorn engine.main:app --port 8000

# 2. Frontend (http://127.0.0.1:5173, proxies /api and the WebSocket to the engine)
cd frontend
npm install
npm run dev
```

Set `ENGINE_URL` to proxy to an engine on another address. `VITE_API_BASE` (optional) points the
built app at an engine origin; by default it uses the same origin.

Production build: `npm run build`, then `npm run preview` (also proxies `/api`).

## Verification

| Check | Command |
|---|---|
| Engine tests (physics, validation, inversion, API, WebSocket) | `cd engine && python -m pytest` |
| TypeScript (strict) | `cd frontend && npm run typecheck` |
| ESLint (type-checked, hooks, jsx-a11y, zero warnings) | `npm run lint` |
| Unit, component and integration tests | `npm test` |
| End-to-end against the real engine | `npx playwright install chromium` once, then `npm run e2e` |
| E2E against the production build | `npm run build && E2E_PREVIEW=1 npm run e2e` |
| 100 000-point performance test | `E2E_LARGE=1 npx playwright test e2e/scale.spec.ts` |

E2E tests start their own engine on port 8765 with an isolated data directory and test-only hooks
(`ENGINE_TEST_HOOKS=1`: reset, failure injection, dropping WebSocket connections, injecting malformed
messages). The hooks do not exist unless that variable is set. A global setup signs in once with a dedicated
test account and every test reuses that session.

## Physical model (engine)

- **Normal field:** WGS84 Somigliana normal gravity with second-order height terms and the matching
  normal potential, or a non-rotating spherical Earth.
- **Bodies:** spheres (exact point-mass exterior field) and rectangular prisms (closed-form potential
  and gravity, Nagy et al. 2000; monopole far field beyond 50 body sizes). Size follows from
  mass ÷ density contrast. Dense bodies and cavities (mass deficit). Terrain changes sensor height;
  topographic mass is not modelled.
- **Observable:** Δf/f₀ = (Φ(sensor) − Φ(reference))/c², with a local reference clock at the first
  survey point or a remote reference at the reference surface.
- **Clock performance classes** (`contract/clock-presets.json`): for each species, *field-demonstrated*
  (transportable clocks operated outside the laboratory), *laboratory state of the art* (stationary
  clocks; not yet transportable) and *projected* (an assumption, not demonstrated). Each class fixes
  σᵧ(1 s), the systematic uncertainty per set-up and the uptime, with its literature basis shown in
  the UI. "Custom" unlocks the values.
- **Noise:** two-clock instability σᵧ(1 s)·√2/√τ (averages down), and two **per-station** errors that do
  not average down: the clock's residual systematic shift at each set-up, and the station-height
  uncertainty entering the normal-field correction (g·δh/c²; ~1 cm from GNSS ≈ 1.1 × 10⁻¹⁸). Also
  white readout noise, blackbody (temperature × sensitivity), vibration (g·δz/c²), correlated
  environmental noise (Gauss–Markov, 30 min; 90 % common-mode rejection with a local reference) and
  linear drift. Seeded and reproducible.
- **Field logistics:** each station costs transport (5 m/s) + set-up time + averaging time ÷ uptime, so
  campaign durations are realistic (weeks for tens of stations). Campaigns over 90 days are flagged.
- **Detection:** a matched-filter scan over a grid of trial point sources (positions × depths): the
  largest χ² reduction over an offset-and-drift-only model, in units of the instrument's nominal σ.
  The look-elsewhere effect is calibrated by Monte Carlo (effective number of trials) and converted to
  a one-sided Gaussian significance; an anomaly is detected at ≥ 3σ. Mass/σ is reported separately as
  a *mass constraint*, because mass and depth trade off: an anomaly can be clearly present while its
  mass is poorly determined.
- **Inversion:** point masses + offset + linear drift, bounded least squares (SciPy TRF) started from
  the best trials of a coarse grid search (linear in mass for a fixed position). Depth is bounded below
  by the survey's resolution limit (half the station spacing). Uses observables only (positions,
  times, measurements, reference location, analyst-chosen source count) — never the ground truth.
- **Uncertainty:** moving-block residual bootstrap (percentile 95 % intervals and distributions) and
  the linearized covariance.
- **Detectability study** (`POST /api/experiments/detectability`): before running, the expected
  significance of the same detection test for a point source at the first body's position, across
  masses 10⁸–10¹⁵ kg and depths from the resolution limit to 20 km, with the minimum detectable mass
  per depth.
- **Site physics** (`site.py`): the terrain's own mass (prisms between the datum and the terrain
  surface at the true rock density; removed by the analyst with an *assumed* density, so a density
  error leaves a systematic residual) and the solid Earth tide (Moon and Sun from low-precision
  analytical ephemerides, Love numbers 1 + k₂ − h₂, averaged over each measurement window from the
  campaign start date). The analyst removes a tide model; unmodelled ocean and atmospheric loading is
  a configurable percentage of the tide. Tides matter mainly for a distant (fibre-linked) reference,
  whose distance is now configurable.
- **Monte Carlo studies** (`studies.py`, `study_runner.py`; Study page): *repeat* — the campaign with
  many noise realizations: detection rate with its 95 % Wilson interval, estimation bias and RMSE,
  and how often the 95 % intervals contain the truth (coverage); *sweep* — detection probability over
  a mass × depth grid next to the analytic prediction; *time-lapse* — two surveys of the same stations
  with a mass change in between (e.g. groundwater depletion), where station-height errors cancel
  (same benchmarks) but clock set-up errors do not. Studies run in the background with progress and
  cancellation, are stored with the configuration hash and are marked out of date when it changes.
- **Survey design assistant** (`design.py`): for a target mass, depth and fieldwork budget, searches
  station spacing and averaging time over the configured area and recommends the fastest design that
  detects the target in at least 90 % of campaigns (or the best achievable one).
- **Clock vs gravimeter** (`instruments.py`, `POST /api/experiments/instruments`; Experiment page): the same
  stations surveyed by the clock, by a field relative gravimeter (5 µGal, offset and drift estimated) or an
  absolute gravimeter (2 µGal), and by both jointly, as proposed by Bondarescu et al. (2012). The station-height
  uncertainty enters both (g·δh/c² and 3.086 µGal/cm × δh). Reports expected SNR and Cramér–Rao bounds of mass and
  depth with their correlation, checked by Monte Carlo nonlinear fits, and sweeps over clock accuracy and depth.
  Result: for every built-in scenario the gravimeter is 690–13 000× more sensitive, and clocks would need about
  10⁻²¹ per station before the joint survey improves the depth estimate. See [RESEARCH.md](RESEARCH.md).
- **Published benchmarks** (`benchmarks.py`, `GET /api/benchmarks`; Validation page): the Tokyo Skytree redshift
  (Takamoto et al. 2020), the Modane–Torino potential difference (Grotti et al. 2018) and the buried-sphere case of
  Bondarescu et al. (2012), recomputed with the engine's physics — 9 of 9 checks agree.
- **Comparison** (Compare page): two or three experiments side by side — settings (differences
  highlighted), expected and achieved results, and their minimum-detectable-mass curves.
- **Research scenarios** (`contract/scenarios.json`): regional density anomaly with today's field
  clocks (detected, ~4–5σ); mineral ore body with field (not detectable), laboratory-grade (marginal)
  and projected clocks (> 20σ); groundwater aquifer with projected clocks (below sensitivity). Expected
  outcomes were checked over eight noise seeds each and are covered by tests.
- **Comparison:** optimal assignment of estimates to configured bodies; depth, mass and position
  errors, field RMSE and SNR are computed by the engine.

## API (summary)

REST under `/api`: `GET /health`, `GET /defaults` (config, clock presets, limits, research scenarios),
`POST /experiments/validate`, `POST /experiments/detectability`, `POST /experiments/design`,
`POST /experiments/instruments`, `GET /benchmarks`,
`POST|GET /experiments/{id}/studies`, `GET /studies/{id}`, `POST /studies/{id}/cancel`,
`POST|GET /experiments`, `GET|PUT|DELETE /experiments/{id}`, `GET /experiments/{id}/plan`,
`POST /experiments/{id}/simulations` (`Idempotency-Key`, `expected_configuration_hash`),
`GET /simulations/{id}`, `POST /simulations/{id}/pause|resume|cancel`, `GET /simulations/{id}/plan`,
`GET /simulations/{id}/measurements?after_index=`, `GET /simulations/{id}/results`,
`GET /simulations/{id}/results/{signals|anomaly-map|inversion|uncertainty}`,
`GET /simulations/{id}/export?format=csv|json`, `GET /simulations/{id}/report`.

WebSocket `/api/simulations/{id}/stream?after_index=N` sends `snapshot`, `simulation_started`,
`phase_changed`, `simulation_progress`, `measurement` / `measurement_batch`, `simulation_paused`,
`simulation_resumed`, `simulation_cancelling`, `simulation_cancelled`, `simulation_completed`,
`simulation_failed` and `heartbeat`. Reconnecting with `after_index` replays only missing data.

Errors are `{"error": {"code", "message", "fields": [{"field", "message"}]}}` with field paths such as
`bodies.0.depth_m`.

## Known limitations

- Experiments saved before the realism update are migrated on engine start: the new fields get the
  values that reproduce the old behaviour exactly (custom performance, no per-station error, 100 %
  uptime, no set-up time), so stored results stay valid and are not marked out of date.
- Ocean and atmospheric loading are represented as a fraction of the body tide, not modelled
  explicitly; the tide uses a spherical Earth and ephemerides accurate to a few arcminutes.
- Terrain mass is included only inside the survey area (24 × 24 prisms). Terrain is a built-in smooth shape
  (flat, slope, hills) or an uploaded elevation model (ESRI ASCII grid or single-band GeoTIFF).
- Monte Carlo study runs use at most 60 bootstrap samples each to bound run time.
- Performance-class values are representative of published results (see the basis text for each
  class), not of one specific instrument.
- Accounts use Argon2id password hashes and HttpOnly session cookies; data is stored in SQLite (one
  workstation) or PostgreSQL (`DATABASE_URL`), with schema migrations applied by Alembic at start-up.
  There is no e-mail verification or password reset by e-mail.
- The clock vs gravimeter comparison treats the first body as a point mass and gives both instruments
  independent white per-station errors (see RESEARCH.md, *Threats to validity*).
- Bootstrap intervals for multi-source fits assume sources keep their identity across resamples.
- `three` logs a deprecation notice for `THREE.Clock`, which is used inside `@react-three/fiber`.
