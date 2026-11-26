"""Assemble the artifact: embed pictures as JPEG data URIs, the engine sweeps as JSON, and the no-script answer rows."""
import base64, io, json, math, sys
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent
proj = root.parent
out = Path(sys.argv[1])
IMAGES = {
    "clock": (proj / "assets/optical-atomic-clock-5881387757.jpg", 1200, 78),
    "tubes": (proj / "assets/atomic-clock-optical-tubes-5940426959.jpg", 900, 78),
    "skytree": (proj / "assets/20181123-tokyo-skytree-2.jpg", 1200, 76),
    "tunnel": (proj / "assets/bardonecchia-to-portale-sud-del-traforo-ferroviario.jpg", 1200, 76),
    "detect": (root / "img/ui-detect.png", 1720, 86),
    "recon": (root / "img/ui-3d.png", 1240, 84),
    "instruments": (root / "img/ui-instruments.png", 1720, 86),
    "map": (root / "img/ui-map.png", 1240, 84),
}

def data_uri(path, long_edge, quality):
    im = Image.open(path).convert("RGB")
    scale = min(1.0, long_edge / max(im.size))
    if scale < 1.0:
        im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=quality, optimize=True, progressive=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()

SHORT = {"regional-field": "Regional, field clocks", "ore-field": "Ore, field clocks",
         "ore-laboratory": "Ore, laboratory clocks", "ore-projected": "Ore, projected clocks",
         "aquifer-projected": "Aquifer, projected clocks"}

def group(n):
    r = round(n) if n >= 100 else round(n, 1) if n >= 10 else round(n, 2)
    whole, _, frac = f"{r}".partition(".")
    whole = f"{int(whole):,}".replace(",", "\u2009")
    return whole + ("." + frac if frac and r < 100 else "")

def gain_at(row, sigma):
    xs, ys = row["sweep_sigma"], row["gain"]
    if sigma <= xs[0]: return ys[0]
    if sigma >= xs[-1]: return ys[-1]
    for i in range(len(xs) - 1):
        if xs[i] <= sigma <= xs[i + 1] and ys[i] is not None and ys[i + 1] is not None:
            f = (math.log(sigma) - math.log(xs[i])) / (math.log(xs[i + 1]) - math.log(xs[i]))
            return math.exp(math.log(ys[i]) + f * (math.log(ys[i + 1]) - math.log(ys[i])))
    return None

data = json.loads((root / "sweeps.json").read_text(encoding="utf-8"))
sigma = 8e-19
rows = []
for row in data:
    clock = row["clock_snr"] * row["sigma"] / sigma
    ratio = row["grav_snr"] / clock
    ahead = f"×{group(ratio)}" if ratio >= 1 else f"Clock ahead ×{group(1 / ratio)}"
    g = gain_at(row, sigma)
    joint = "Unavailable" if g is None else "Unchanged" if g > 0.999 else f"−{round((1 - g) * 100)} %"
    rows.append(f'<tr><td>{SHORT[row["id"]]}</td><td class="n">{group(clock)}</td><td class="n">{group(row["grav_snr"])}</td>'
                f'<td class="n">{ahead}</td><td class="n">{joint}</td></tr>')

html = (root / "page.template.html").read_text(encoding="utf-8")
for key, (path, edge, q) in IMAGES.items():
    html = html.replace("{{IMG:%s}}" % key, data_uri(path, edge, q))
html = html.replace("{{DATA}}", json.dumps(data, ensure_ascii=False)).replace("{{ROWS}}", "".join(rows))
assert "{{" not in html, "unfilled placeholder"
out.write_text(html, encoding="utf-8")
# Local preview with the head the Artifact skeleton adds at publish time, so phone widths render as they will live.
preview = root / "preview.html"
preview.write_text('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>'
                   + html + "</body></html>", encoding="utf-8")
print(out, round(len(html.encode()) / 1e6, 2), "MB")
