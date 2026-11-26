"""Rebuild the paper (with Section XI) as a single-column document.

    python single_column.py <original.pdf> <output.pdf>

Body text is re-flowed from the original PDF. Display equations, figures, tables and the code listing are carried
over from the original pages as vector graphics. Section XI and the new conclusion come from build_paper.py.
"""
from __future__ import annotations

import collections
import json
import os
import re
import sys
from pathlib import Path

import pymupdf

HERE = Path(__file__).resolve().parent
WORK = HERE / "_build_sc"
WORK.mkdir(exist_ok=True)
os.environ["TMPDIR_TS"] = str(WORK)
SRC, OUT = Path(sys.argv[1]), Path(sys.argv[2])

# single-column geometry
PW, PH = 612.0, 792.0
ML, MR, MT, MB = 72.0, 72.0, 72.0, 72.0
TW = PW - ML - MR  # 468
EQ_SIZE = 11.0
os.environ["EQ_W"] = str(TW)
os.environ["EQ_SIZE"] = str(EQ_SIZE)

import typeset as ts  # noqa: E402

CSS = """
@font-face {font-family: stix; src: url(STIXGeneral.ttf);}
@font-face {font-family: stix; src: url(STIXGeneralItalic.ttf); font-style: italic;}
@font-face {font-family: stix; src: url(STIXGeneralBol.ttf); font-weight: bold;}
@font-face {font-family: stix; src: url(STIXGeneralBolIta.ttf); font-weight: bold; font-style: italic;}
* {font-family: stix;}
body {font-size: 11pt; line-height: 14.2pt; text-align: justify; margin: 0;}
p {margin: 0; text-indent: 15pt;}
p.ni {text-indent: 0;}
sup, sub {font-size: 7.7pt;}
h2 {text-align: center; font-size: 11pt; font-weight: normal; margin: 15pt 0 6pt 0; line-height: 14pt;}
h3 {font-style: italic; font-weight: normal; font-size: 11pt; margin: 9pt 0 3pt 0; text-align: left; line-height: 14pt;}
.sc {font-size: 8.8pt;}
.cap {font-size: 9pt; line-height: 11pt; text-align: justify; text-indent: 0;}
.capc {font-size: 9pt; line-height: 11pt; text-align: center; text-indent: 0;}
.li {text-indent: -11pt; margin-left: 22pt;}
.ref {font-size: 9.5pt; line-height: 12pt; text-indent: -22pt; margin: 0 0 2.5pt 22pt; text-align: left;}
.fl {text-align: center; text-indent: 0; margin: 9pt 0 9pt 0;}
.eq {text-align: center; text-indent: 0; margin: 5pt 0 5pt 0;}
.title {font-size: 21pt; line-height: 25pt; text-align: center; text-indent: 0; margin: 0 0 10pt 0;}
.author {font-size: 12pt; text-align: center; text-indent: 0; margin: 0 0 4pt 0;}
.aff {font-size: 10pt; line-height: 12.5pt; text-align: center; text-indent: 0;}
.abs {font-size: 10pt; line-height: 12.8pt; text-indent: 0; margin: 16pt 0 0 0;}
.kw {font-size: 10pt; line-height: 12.8pt; text-indent: 0; margin: 4pt 0 4pt 0;}
.code {font-family: monospace; font-size: 7.5pt;}
"""
ts.CSS = CSS  # floats and captions use the single-column style
ts.story_height.__defaults__ = (CSS,)
ARCH = ts.archive([WORK, ts.WORK if hasattr(ts, "WORK") else WORK])

# ----------------------------------------------------------------------------- content of Section XI
src_bp = (HERE / "build_paper.py").read_text(encoding="utf-8")
NS: dict = {"__file__": str(HERE / "build_paper.py"), "__name__": "content"}
sys_argv = sys.argv
sys.argv = [sys.argv[0]]
exec(src_bp[:src_bp.index("# ----------------------------------------------------------------------------- floats")], NS)
a = src_bp.index("ABSTRACT = (")
b = src_bp.index("spare = html_box(p1, pymupdf.Rect(46.8, 177.6")
exec(src_bp[a:b], NS)
# capture the float definitions (captions, table rows) without building them
CAPT: dict = {}


def _cap_fig(path, caption, width, arch, fig_width=None, gap=5.0):
    return ("fig", path, caption, width > 300)


def _cap_tab(number, title, header, rows, width, arch, **kw):
    return ("tab", number, title, header, rows, kw)


NS_F = dict(NS)
NS_F["ts"] = type("T", (), {"figure_float": staticmethod(_cap_fig), "table_float": staticmethod(_cap_tab),
                            "COLW": ts.COLW, "FULLW": ts.FULLW})
fl_src = src_bp[src_bp.index("# ----------------------------------------------------------------------------- floats"):
                src_bp.index("LAYOUT = json.loads")]
exec(fl_src, NS_F)
NEW_FLOATS = NS_F["FL"]
sys.argv = sys_argv
BODY_NEW = NS["BODY"]
ABSTRACT = NS["ABSTRACT"]
# the Section XI body was written with equations at the single-column width (EQ_W); move its SVGs where we look
for f in (HERE / "_build").glob("eq3*.svg"):
    (WORK / f.name).write_bytes(f.read_bytes())

# ----------------------------------------------------------------------------- helpers
doc = pymupdf.open(str(SRC))
COLS = {"L": (46.0, 300.5), "R": (312.5, 567.5)}
FULL = (46.0, 567.5)
MINOR = {"and", "of", "the", "for", "to", "in", "on", "a", "an", "with", "from", "as", "at", "by", "or", "versus",
         "against"}
LIG = {"ﬁ": "fi", "ﬂ": "fl", "ﬀ": "ff", "ﬃ": "ffi", "ﬄ": "ffl"}
_n = collections.Counter()


def esc(t):
    return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def fix(t, font):
    for k, v in LIG.items():
        t = t.replace(k, v)
    if "CMEX" in font:
        t = "".join({"p": "√", "q": "√", "r": "√", "\x12": "(", "\x13": ")", "\x10": "(",
                     "\x11": ")"}.get(c, "") for c in t)
    return "".join(c for c in t if c >= " " or c == "\t")


def get_lines(page):
    out = []
    for blk in page.get_text("dict")["blocks"]:
        if blk["type"] != 0:
            continue
        for ln in blk["lines"]:
            sp = [s for s in ln["spans"] if s["text"].strip()]
            if not sp:
                continue
            bb = pymupdf.Rect(ln["bbox"])
            if bb.y0 > 742:
                continue
            out.append(dict(bbox=bb, spans=sp, text="".join(s["text"] for s in ln["spans"]).strip(),
                            size=max(sp, key=lambda s: len(s["text"].strip()))["size"],
                            font=max(sp, key=lambda s: len(s["text"].strip()))["font"]))
    return out


def in_x(bb, xr, frac=0.5):
    w = max(bb.width, 1e-3)
    ov = min(bb.x1, xr[1]) - max(bb.x0, xr[0])
    return ov / w >= frac


def col_of(bb):
    cx = (bb.x0 + bb.x1) / 2
    return "L" if cx < 306 else "R"


_DRAW: dict = {}


def drawings(page):
    if page.number not in _DRAW:
        _DRAW[page.number] = page.get_drawings()
    return _DRAW[page.number]


def tight(page, rect):
    """Union of drawings, images and text inside rect (the visible content of a float)."""
    u = pymupdf.Rect()
    for d in drawings(page):
        r = d["rect"]
        if r.intersects(rect) and rect.contains((r.tl + r.br) / 2):
            u |= r & rect
    for img in page.get_image_info():
        r = pymupdf.Rect(img["bbox"])
        if r.intersects(rect):
            u |= r & rect
    for blk in page.get_text("dict", clip=rect)["blocks"]:
        if blk["type"] == 0:
            for ln in blk["lines"]:
                r = pymupdf.Rect(ln["bbox"])
                if rect.contains((r.tl + r.br) / 2):
                    u |= r
    return u if not u.is_empty else rect


def clip_pdf(pno, rect, scale, name):
    d = pymupdf.open()
    pg = d.new_page(width=rect.width * scale, height=rect.height * scale)
    pg.show_pdf_page(pg.rect, doc, pno, clip=rect)
    path = WORK / f"{name}.pdf"
    d.save(str(path))
    return path


PLACE: dict = {}  # pixel digest of placeholder -> float PDF path


def to_svg(fdoc, name, cls="fl"):
    """Reserve space for a float: a unique, fully transparent 1x1 PNG of the float's size. The float itself is
    stamped onto the final page afterwards, so its clipping stays exact."""
    path = WORK / f"{name}_float.pdf"
    fdoc.save(str(path))
    k = len(PLACE) + 1
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, k, 1), 1)  # unique width -> unique digest
    pix.clear_with(0)
    pix.save(str(WORK / f"{name}.png"))
    PLACE[k] = path
    r = fdoc[0].rect
    return f"<p class={cls}><img src='{name}.png' width={r.width:.2f} height={r.height:.2f}/></p>"


def title_case(t):
    words = t.split()
    out = []
    for i, w in enumerate(words):
        core = w.strip("(),:;")
        if any(ch.isdigit() for ch in core) or (len(core) <= 4 and core.isupper() and core in {"SNR", "ROC", "CRLB"}):
            out.append(w)
        elif i > 0 and core.lower() in MINOR:
            out.append(w.lower())
        else:
            out.append(w[:1] + w[1:].lower() if not w.startswith("(") else w[:2] + w[2:].lower())
    return " ".join(out)


# ----------------------------------------------------------------------------- span/line to HTML
def line_html(spans):
    spans = sorted(spans, key=lambda s: s["bbox"][0])
    main = max(spans, key=lambda s: (s["size"], len(s["text"])))
    big = main["size"]
    base = main["origin"][1]
    parts, prev = [], None
    for s in spans:
        t = fix(s["text"], s["font"])
        if not t:
            continue
        h = esc(t)
        f = s["font"]
        small = s["size"] < 0.86 * big
        oy = s["origin"][1]
        if small and oy < base - 0.9:
            h = f"<sup>{h.strip()}</sup>"
        elif small and oy > base + 0.9:
            h = f"<sub>{h.strip()}</sub>"
        if ("Ital" in f or "Italic" in f or "Slant" in f or "CMMI" in f) and h.strip():
            h = f"<i>{h}</i>"
        if ("Medi" in f or "Bold" in f) and h.strip():
            h = f"<b>{h}</b>"
        if prev is not None and s["bbox"][0] - prev["bbox"][2] > 1.6 and not t.startswith(" ") \
                and not prev["text"].endswith(" "):
            parts.append(" ")
        parts.append(h)
        prev = s
    html = "".join(parts).strip()
    html = re.sub(r"</i><i>", "", html)
    return html


def visual_lines(lines):
    """Merge line objects that share a baseline (sub/superscript fragments, split spans)."""
    lines = sorted(lines, key=lambda l: (l["bbox"].y0 + l["bbox"].y1) / 2)
    groups = []
    def overlap(a, b):
        ov = min(a.y1, b.y1) - max(a.y0, b.y0)
        return ov / max(1e-3, min(a.height, b.height))

    for l in lines:
        cy = (l["bbox"].y0 + l["bbox"].y1) / 2
        if groups and (abs(cy - groups[-1]["cy"]) < 4.0 or overlap(l["bbox"], groups[-1]["bbox"]) > 0.55):
            g = groups[-1]
            g["parts"].append(l)
            g["bbox"] |= l["bbox"]
            if l["size"] > g["size"]:
                g["size"], g["font"], g["cy"] = l["size"], l["font"], cy
        else:
            groups.append(dict(parts=[l], bbox=pymupdf.Rect(l["bbox"]), size=l["size"], font=l["font"], cy=cy))
    # lone symbols (a radical sign drawn above its line) join the nearest line they sit over
    merged = []
    for i, g in enumerate(groups):
        t = " ".join(l["text"] for l in g["parts"]).strip()
        if len(t) <= 2 and not re.fullmatch(r"\(\d+\)", t):
            cands = [h for h in groups if h is not g and abs(h["cy"] - g["cy"]) < 10
                     and h["bbox"].x0 - 2 <= g["bbox"].x0 <= h["bbox"].x1 + 2]
            if cands:
                rest = [h for h in cands if h["bbox"].y0 - 1 <= g["bbox"].y1 <= h["bbox"].y1 + 2
                        and h["bbox"].y0 > g["bbox"].y0]
                h = min(rest or cands, key=lambda h: abs(h["cy"] - g["cy"]))
                h["parts"].extend(g["parts"])
                h["bbox"] |= g["bbox"]
                continue
        merged.append(g)
    groups = merged
    for g in groups:
        g["parts"].sort(key=lambda l: l["bbox"].x0)
        g["spans"] = [s for l in g["parts"] for s in l["spans"]]
        g["text"] = " ".join(l["text"] for l in g["parts"])
    return groups


# ----------------------------------------------------------------------------- vocabulary for hyphenation
VOCAB, HYPH = set(), set()
for pg in doc:
    for l in get_lines(pg):
        for w in re.findall(r"[A-Za-z][A-Za-z\-]*[A-Za-z]", l["text"]):
            (HYPH if "-" in w else VOCAB).add(w.lower())
KEEP = {"co", "non", "self", "two", "one", "three", "single", "multi", "high", "low", "well", "time", "noise",
        "false", "least", "matched", "long", "short", "real", "post", "pre", "semi", "weak", "slow", "full",
        "end", "free", "station", "survey", "template", "depth", "mass", "clock", "model", "sub", "near", "far",
        "first", "second", "known", "bound", "metre", "millimetre", "centimetre", "point", "trust", "ground",
        "geo", "sill", "dyke", "row", "best", "worst", "fixed", "wide", "narrow", "potential", "noise-only"}


def join_lines(chunks):
    out = ""
    for html in chunks:
        if not out:
            out = html
            continue
        m1 = re.search(r"([A-Za-z]+)-$", out)
        m2 = re.match(r"([a-z]+)", html)
        if m1 and m2:
            f1, f2 = m1.group(1), m2.group(1)
            joined = (f1 + f2).lower()
            if joined in VOCAB:
                out = out[:-1] + html
            elif f"{f1}-{f2}".lower() in HYPH or f1.lower() in KEEP:
                out = out + html
            else:
                out = out[:-1] + html
        else:
            out += " " + html
    return out


# ----------------------------------------------------------------------------- floats on a page
def find_floats(pno, page, lines):
    floats = []  # dict(kind, rect(full region), col, y, html)
    used = set()
    # tables
    for i, l in enumerate(lines):
        if re.fullmatch(r"Table [IVXL]+", l["text"]) and l["size"] < 9:
            cx = (l["bbox"].x0 + l["bbox"].x1) / 2
            xr = FULL if abs(cx - 306) < 20 else COLS["L" if cx < 306 else "R"]
            num = l["text"].split()[1]
            title, y = [], l["bbox"].y1
            tb = y
            cand = sorted([m for m in lines if m["bbox"].y0 > l["bbox"].y0 + 1 and in_x(m["bbox"], xr)],
                          key=lambda m: m["bbox"].y0)
            body_last = None
            for m in cand:
                if m["bbox"].y0 - y > 16:
                    break
                if not body_last and m["size"] < 7.5 and m["bbox"].y0 - y < 12:
                    title.append(m["text"])
                    used.add(id(m))
                    y = m["bbox"].y1
                    tb = y
                    continue
                title_like = m["size"] < 7.0 and m["text"].isupper() and len(m["text"]) > 6
                if re.fullmatch(r"Table [IVXL]+", m["text"]) or (body_last and title_like) or \
                        re.match(r"Fig\. \d+\. ", m["text"]):
                    break
                if m["size"] < 9.3 and "F398" not in m["font"]:
                    body_last = m
                    used.add(id(m))
                    y = m["bbox"].y1
                else:
                    break
            used.add(id(l))
            region = pymupdf.Rect(xr[0], tb + 0.5, xr[1], (body_last["bbox"].y1 if body_last else tb) + 7)
            body = tight(page, region)
            floats.append(dict(kind="tab", num=num, title=title_case(" ".join(title)), col="F" if xr == FULL else
                               col_of(l["bbox"]), y=l["bbox"].y0, block=pymupdf.Rect(xr[0], l["bbox"].y0, xr[1],
                                                                                    body.y1), body=body))
    # code listing
    code = [l for l in lines if "F398" in l["font"]]
    if code:
        r = pymupdf.Rect()
        for l in code:
            r |= l["bbox"]
            used.add(id(l))
        floats.append(dict(kind="code", col=col_of(r), y=r.y0, block=r, body=r + (-2, -2, 2, 2)))
    # figures
    for l in lines:
        if re.match(r"Fig\. \d+\. ", l["text"]) and l["size"] < 9:
            full = l["bbox"].x0 < 100 and l["bbox"].x1 > 420
            xr = FULL if full else COLS[col_of(l["bbox"])]
            caps = [l]
            y = l["bbox"].y1
            for m in sorted(lines, key=lambda m: m["bbox"].y0):
                if m is l or m["bbox"].y0 <= l["bbox"].y0 or not in_x(m["bbox"], xr):
                    continue
                if m["size"] < 9 and m["bbox"].y0 - y < 6:
                    caps.append(m)
                    y = m["bbox"].y1
                elif m["bbox"].y0 > y:
                    break
            for m in caps:
                used.add(id(m))
            top = 44.0
            for m in lines:
                if id(m) in used or m["size"] < 9.4 or "TeXGyre" in m["font"] or not in_x(m["bbox"], xr, 0.3):
                    continue
                if m["bbox"].y1 < l["bbox"].y0 - 1:
                    top = max(top, m["bbox"].y1)
            for f in floats:
                if f["block"].y1 < l["bbox"].y0 and in_x(f["block"], xr, 0.3):
                    top = max(top, f["block"].y1 + 1)
            region = pymupdf.Rect(xr[0], top + 0.5, xr[1], l["bbox"].y0 - 0.5)
            body = tight(page, region)
            cap_html = join_lines([line_html(m["spans"]) for m in caps])
            floats.append(dict(kind="fig", col="F" if full else col_of(l["bbox"]), y=body.y0,
                               block=pymupdf.Rect(xr[0], body.y0, xr[1], caps[-1]["bbox"].y1), body=body,
                               cap=cap_html))
    # anything inside a float block is not body text
    for f in floats:
        for l in lines:
            if f["block"].contains((l["bbox"].tl + l["bbox"].br) / 2):
                used.add(id(l))
    return floats, used


# ----------------------------------------------------------------------------- build float HTML
def float_html(pno, f):
    _n["f"] += 1
    name = f"p{pno}_{f['kind']}_{_n['f']}"
    w = f["body"].width
    if f["col"] == "F":
        scale = min(1.0, TW / w)
    else:
        scale = 1.12 if f["kind"] == "tab" else 1.0
    if f["kind"] == "code":
        scale = 1.3
    clip = clip_pdf(pno, f["body"], scale, name)
    if f["kind"] == "fig":
        fd, _ = ts.figure_float(clip, f["cap"], TW, ARCH, fig_width=w * scale, gap=6)
        return to_svg(fd, name)
    if f["kind"] == "code":
        fd = pymupdf.open(str(clip))
        return to_svg(fd, name)
    num = "XXVII" if (pno == 13 and f["num"] == "XXIV") else f["num"]
    cap_html = f"<p class=capc>Table {num}</p><p class=capc>{ts.smallcaps_title(f['title'], 9, 7.2)}</p>"
    caph = ts.story_height(cap_html, TW, ARCH) + 3
    src = pymupdf.open(str(clip))
    bw, bh = src[0].rect.width, src[0].rect.height
    fd = pymupdf.open()
    pg = fd.new_page(width=TW, height=caph + 4 + bh)
    ts.story_into_page(pg, cap_html, pymupdf.Rect(0, 0, TW, caph), ARCH)
    pg.show_pdf_page(pymupdf.Rect((TW - bw) / 2, caph + 4, (TW + bw) / 2, caph + 4 + bh), src, 0)
    return to_svg(fd, name)


def baseline(g):
    main = max(g["spans"], key=lambda s: (s["size"], len(s["text"])))
    return main["origin"][1]


def equation_html(pno, glines, col, prev_g=None, next_g=None):
    _n["e"] += 1
    name = f"p{pno}_eq_{_n['e']}"
    xr = COLS[col]
    nums = []
    body = pymupdf.Rect()
    for g in glines:
        for s in g["spans"]:
            r = pymupdf.Rect(s["bbox"])
            if re.fullmatch(r"\(\d+\)", s["text"].strip()) and r.x0 > xr[1] - 30:
                nums.append((s["text"].strip(), s["origin"][1]))
            else:
                body |= r
    y0, y1 = body.y0 - 2.0, body.y1 + 2.0
    if prev_g is not None:
        y0 = max(y0, baseline(prev_g) + 2.7)
    if next_g is not None:
        y1 = min(y1, baseline(next_g) - 7.6)
    body = pymupdf.Rect(xr[0], y0, (xr[1] - 26) if nums else body.x1 + 2, y1)
    # include drawings (fraction bars, radicals) inside the equation band
    page = doc[pno]
    for d in drawings(page):
        r = d["rect"]
        if r.y0 >= body.y0 - 1 and r.y1 <= body.y1 + 1 and r.x0 >= xr[0] - 1 and r.x1 <= xr[1] + 1:
            body |= r
    s = EQ_SIZE / 9.96
    clip = clip_pdf(pno, body, s, name)
    src = pymupdf.open(str(clip))
    ew, eh = src[0].rect.width, src[0].rect.height
    fd = pymupdf.open()
    pg = fd.new_page(width=TW, height=eh)
    x0 = (TW - ew) / 2
    pg.show_pdf_page(pymupdf.Rect(x0, 0, x0 + ew, eh), src, 0)
    pg.insert_font(fontname="stx", fontfile=os.path.join(ts.MPL_FONTS, "STIXGeneral.ttf"))
    for t, oy in nums:
        wdt = ts.FONT["r"].text_length(t, fontsize=EQ_SIZE)
        pg.insert_text((TW - wdt, (oy - body.y0) * s), t, fontname="stx", fontsize=EQ_SIZE)
    return to_svg(fd, name, "eq")


# ----------------------------------------------------------------------------- walk the pages
html: list[str] = []
para: list[str] = []
para_cls = "ni"
queue: list[str] = []
mode = "body"
eqbuf: list = []
eqcol = "L"


def close_para(flush=True):
    global para
    if para:
        txt = join_lines(para)
        html.append(f"<p class={para_cls}>{txt}</p>" if para_cls else f"<p>{txt}</p>")
        para = []
    if flush and queue:
        html.extend(queue)
        queue.clear()


prev_body = None


def flush_eq(pno, next_g=None):
    global eqbuf
    if eqbuf:
        pg_ = prev_body if (prev_body is not None and prev_body.get("pno") == pno and col_of(prev_body["bbox"]) == eqcol
                            and prev_body["bbox"].y1 <= eqbuf[0]["bbox"].y1) else None
        ng_ = next_g if (next_g is not None and col_of(next_g["bbox"]) == eqcol
                         and next_g["bbox"].y0 >= eqbuf[-1]["bbox"].y0) else None
        html.append(equation_html(pno, eqbuf, eqcol, pg_, ng_))
        eqbuf = []


def heading_html(text):
    m = re.match(r"^((?:[IVX]+)\.|APPENDIX [A-E]\.)\s*(.*)$", text)
    if text.strip() == "REFERENCES":
        return f"<h2>{ts.smallcaps('References')}</h2>"
    lab, rest = m.group(1), m.group(2)
    words = title_case(rest)
    sc = []
    for w in words.split(" "):
        if w.lower() in MINOR:
            sc.append(f"<span class=sc>{w.upper()}</span>")
        else:
            sc.append(ts.smallcaps(w))
    if lab.startswith("APPENDIX"):
        lab = ts.smallcaps("Appendix") + " " + lab.split()[1]
    return f"<h2>{lab} {' '.join(sc)}</h2>"


# title block
html.append("<p class=title>Simulation Atomic Clock Based on Gravitational Sensing for Subsurface Mass</p>")
html.append("<p class=author>P. Jaivardhan</p>")
html.append("<p class=aff><i>Department of Electronics and Communication Engineering</i></p>")
html.append("<p class=aff><i>KLEF (Koneru Lakshmaiah Education Foundation)</i></p>")
html.append("<p class=aff>Vaddeswaram, Andhra Pradesh, India</p>")
html.append(ABSTRACT.replace("<p>", "<p class=abs>", 1))
html.append("<p class=kw><b><i>Index Terms</i>&#x2014;Atomic clock, gravitational redshift, chronometric geodesy, "
            "subsurface mass detection, gravity potential, Allan deviation, matched filter, inversion, "
            "simulation.</b></p>")

ORG_NEW = ("Section II reviews related work. Sections III and IV give the relativistic and clock theory, Section V "
           "the subsurface forward model, and Sections VI and VII noise and signal processing. Section VIII gives "
           "the simulation design, Section IX the results and Section X the discussion. Section XI runs the "
           "campaign in real time; Section XII concludes.")


def process_page(pno, stop_right_at=None, skip_left_above=None):
    global para_cls, mode, eqcol, prev_body
    page = doc[pno]
    lines = get_lines(page)
    floats, used = find_floats(pno, page, lines)
    body = [l for l in lines if id(l) not in used]
    if skip_left_above:
        body = [l for l in body if not (l["bbox"].y0 < 170 or (col_of(l["bbox"]) == "L"
                                                                and l["bbox"].y0 < skip_left_above))]
    if stop_right_at:
        body = [l for l in body if not (col_of(l["bbox"]) == "R" and l["bbox"].y0 >= stop_right_at)]
    items = []
    for f in floats:
        if f["col"] == "F":
            items.append((0 if f["y"] < 300 else 3, f["y"], "float", f))
        else:
            items.append((1 if f["col"] == "L" else 2, f["y"], "float", f))
    for col in ("L", "R"):
        for g in visual_lines([l for l in body if col_of(l["bbox"]) == col]):
            items.append((1 if col == "L" else 2, g["bbox"].y0, "line", g))
    items.sort(key=lambda t: (t[0], t[1]))
    for zone, y, kind, obj in items:
        if kind == "float":
            flush_eq(pno)
            fh = float_html(pno, obj)
            if para:
                queue.append(fh)
            else:
                html.append(fh)
            continue
        g = obj
        col = col_of(g["bbox"])
        xl = COLS[col][0] + 0.8
        dx = g["bbox"].x0 - xl
        text = g["text"].strip()
        if re.match(r"^((?:[IVX]+)\.\s+[A-Z][A-Z]|APPENDIX [A-E]\.|REFERENCES$)", text) and dx > 15:
            flush_eq(pno)
            close_para()
            html.append(heading_html(text))
            mode = "refs" if text == "REFERENCES" else "body"
            para_cls = "ni"
            continue
        if mode == "refs":
            if re.match(r"^\[\d+\]", text):
                close_para()
                para_cls = "ref"
            para.append(line_html(g["spans"]))
            continue
        lh = line_html(g["spans"])
        is_sub = re.match(r"^[A-O]\. [A-Z]", text) and dx < 3 and any(
            ("Ital" in s["font"]) for s in g["spans"]) and len(text) < 60
        if is_sub:
            flush_eq(pno)
            close_para()
            html.append(f"<h3>{lh}</h3>")
            para_cls = "ni"
            continue
        has_num = any(re.fullmatch(r"\(\d+\)", s["text"].strip()) and s["bbox"][0] > COLS[col][1] - 30
                      for s in g["spans"])
        if dx > 22 or has_num:
            if not eqbuf:
                close_para(flush=False)
            eqcol = col
            eqbuf.append(g)
            continue
        g["pno"] = pno
        if eqbuf:
            flush_eq(pno, g)
            para_cls = "ni"
        prev_body = g
        if text.startswith("•") or (re.match(r"^\d\. ", text) and dx < 4):
            close_para()
            para_cls = "li"
            para.append(lh)
            continue
        if para_cls == "li" and 12 < dx < 17 and para:
            para.append(lh)
            continue
        if para_cls == "li" and para:
            close_para()
            para_cls = "ni"
        if 7 < dx < 12.5:
            close_para()
            para_cls = ""
            para.append(lh)
            continue
        if not para:
            para_cls = "ni" if para_cls in ("ni", "li", "ref") else para_cls
            if para_cls == "li":
                para_cls = "ni"
        para.append(lh)
    flush_eq(pno)


for pno in range(0, 13):
    process_page(pno, stop_right_at=463.0 if pno == 12 else None,
                 skip_left_above=455.0 if pno == 0 else None)
close_para()

# new Section XI, XII and the Appendix A sentence
fl_html = {}
for key, spec in NEW_FLOATS.items():
    if spec[0] == "fig":
        _, path, caption, full = spec
        w = TW if full else 270.0
        fd, _ = ts.figure_float(path, caption, TW, ARCH, fig_width=w, gap=6)
        fl_html[key] = to_svg(fd, f"new_{key}")
    else:
        _, number, title, header, rows, kw = spec
        fd, _ = ts.table_float(number, title, header, rows, TW, ARCH, **{**kw, "size": 9.0, "pitch": 11.0})
        fl_html[key] = to_svg(fd, f"new_{key}")
body_new = re.sub(r"<!--F:(\w+)-->", lambda m: fl_html[m.group(1)], BODY_NEW)
html.append(body_new)
para_cls = "ni"
for pno in range(13, 15):
    process_page(pno)
close_para()

HTML = "\n".join(html)
# text updates that the two-column version also carries
HTML = re.sub(r"Section II reviews related work\..*?conclusion\.", ORG_NEW, HTML, flags=re.S)
HTML = HTML.replace("This paper does not simulate time-varying sources.",
                    "Section XI-G simulates such a time-varying source.")
HTML = HTML.replace("changes assumed perfectly removed.", "changes assumed perfectly removed outside Section XI.")
HTML = HTML.replace("link noise not modelled separately.", "link noise not modelled separately (relaxed in Section XI).")
(WORK / "paper.html").write_text(HTML, encoding="utf-8")

# ----------------------------------------------------------------------------- render
story = pymupdf.Story(html=HTML, user_css=CSS, archive=ARCH)
RAW = WORK / "raw.pdf"
writer = pymupdf.DocumentWriter(str(RAW))
more, n = True, 0
while more:
    dev = writer.begin_page(pymupdf.Rect(0, 0, PW, PH))
    more, _ = story.place(pymupdf.Rect(ML, MT, PW - MR, PH - MB))
    story.draw(dev)
    writer.end_page()
    n += 1
writer.close()
out = pymupdf.open(str(RAW))
stamped = 0
for i, pg in enumerate(out):
    todo = []
    for info in pg.get_image_info(xrefs=True):
        path = PLACE.get(info.get("width")) if info.get("height") == 1 else None
        if path:
            todo.append((info, path))
    for info, path in todo:
        pg.delete_image(info["xref"])
    for info, path in todo:
        pg.show_pdf_page(pymupdf.Rect(info["bbox"]), pymupdf.open(str(path)), 0)
        stamped += 1
    t = str(i + 1)
    w = pymupdf.Font("tiro").text_length(t, fontsize=10)
    pg.insert_text(((PW - w) / 2, PH - 40), t, fontname="tiro", fontsize=10)
out.set_metadata({"title": "Simulation Atomic Clock Based on Gravitational Sensing for Subsurface Mass",
                  "author": "P. Jaivardhan", "creator": "single_column.py", "producer": "PyMuPDF"})
out.save(str(OUT), garbage=4, deflate=True, use_objstms=1)
out.close()
print("pages:", n, "floats stamped:", stamped, "of", len(PLACE))
