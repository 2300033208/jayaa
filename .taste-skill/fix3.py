from pathlib import Path

from PIL import Image

root = Path(__file__).parent
# Tighter crop of the 3D reconstruction: the scene and its labels, without the app's blank margin.
shot = Image.open(root.parent / "frontend/test-results/responsive/analysis-1440x900.png").convert("RGB")
shot.crop((400, 750, 1140, 1180)).save(root / "img/ui-3d.png")

p = root / "page.template.html"
s = p.read_text(encoding="utf-8")


def rep(old, new, count=1):
    global s
    n = s.count(old)
    assert n == count, (n, old[:70])
    s = s.replace(old, new)


# Tighter rhythm between sections.
rep(".section { padding-block: clamp(96px, 12vw, 200px); }", ".section { padding-block: clamp(72px, 8vw, 136px); }")

# Each exchange runs across the full grid: words and the call on the left, what comes back on the right.
rep(""".how-col { grid-column: 4 / 10; display: grid; gap: 88px; min-width: 0; }
.how-col h2 { font-size: var(--s-head); font-weight: 500; margin-bottom: -32px; }
.ex { display: grid; gap: 16px; min-width: 0; }""", """.how-col { grid-column: 1 / -1; display: grid; gap: 72px; min-width: 0; }
.how-col h2 { font-size: var(--s-head); font-weight: 500; }
.ex { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); column-gap: 18px; row-gap: 16px; align-items: start; min-width: 0; }
.ex > p { grid-column: 1 / 6; }
.ex > .call { grid-column: 1 / 6; grid-row: 2; }""")
rep(""".resp { margin-left: 56px; min-width: 0; }""", """.resp { grid-column: 6 / 13; grid-row: 1 / span 3; min-width: 0; }""")
rep(""".ex.final .resp { margin-left: 56px; width: min(760px, calc(100vw - 2 * 18px - 56px)); max-width: none; }\n""", "")
rep("""  .how-col { grid-column: 1 / -1; }""", """  .ex > p, .ex > .call, .resp { grid-column: 1 / -1; grid-row: auto; }""")
rep("""  .resp, .ex.final .resp { margin-left: 0; width: 100%; }\n""", "")
rep("""<img src="{{IMG:recon}}" width="1240" height="620" loading="lazy\"""", """<img src="{{IMG:recon}}" width="740" height="430" loading="lazy\"""")
p.write_text(s, encoding="utf-8")
print("ok")
