# Real-time campaign simulation (paper Section XI)

Adds a time-domain, real-time simulation of the clock survey to the paper PDF.

```
python realtime_sim.py            # simulation, ~25 min; writes results_realtime.json and fig/
python realtime_sim.py --quick    # smoke test, ~3 min
python build_paper.py <in.pdf> <out.pdf>     # two-column: inserts Section XI, Figs. 24-30, Tables XXIV-XXVI
python single_column.py <in.pdf> <out.pdf>   # single-column rebuild of the whole paper (the delivered version)
```

- `realtime_sim.py`: packet-level campaign generator (white + continuous flicker noise, height error, differential
  tide from `engine/engine/site.py`, link outages, drift), sequential template-bank detection with jointly calibrated
  thresholds, live inversion, tide/session-length study, fixed-site monitoring check of Eq. (27).
- `typeset.py`: STIX text, equations and booktabs tables that match the paper's layout.
- `build_paper.py`: section text (filled from `results_realtime.json`), page layout (`layout.json`) and the small
  edits to existing pages (abstract, organisation paragraph, Sec. X-B sentence, limitations, Table XXIV -> XXVII,
  page numbers).

- `single_column.py`: re-flows the original text into one column; equations, figures, tables and code are carried
  over as vector clips stamped into reserved slots.

All data are synthetic.
