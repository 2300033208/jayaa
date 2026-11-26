"""Small typesetting toolkit used by build_paper.py: STIX text via PyMuPDF Story, matplotlib equations,
booktabs-style tables and figure floats that match the IEEE-style layout of the original paper."""
from __future__ import annotations

import os
from pathlib import Path

import matplotlib
import pymupdf

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

MPL_FONTS = os.path.join(os.path.dirname(matplotlib.__file__), "mpl-data", "fonts", "ttf")
matplotlib.rcParams.update({"mathtext.fontset": "stix", "font.family": "STIXGeneral", "svg.fonttype": "path"})

# geometry of the original pages (points)
PAGE = pymupdf.Rect(0, 0, 612, 792)
LX0, LX1 = 46.8, 297.9
RX0, RX1 = 313.9, 565.2
TOP, BOT = 52.0, 730.0
COLW = LX1 - LX0
FULLW = RX1 - LX0

FONT = {k: pymupdf.Font(fontfile=os.path.join(MPL_FONTS, f)) for k, f in
        (("r", "STIXGeneral.ttf"), ("i", "STIXGeneralItalic.ttf"), ("b", "STIXGeneralBol.ttf"))}

CSS = """
@font-face {font-family: stix; src: url(STIXGeneral.ttf);}
@font-face {font-family: stix; src: url(STIXGeneralItalic.ttf); font-style: italic;}
@font-face {font-family: stix; src: url(STIXGeneralBol.ttf); font-weight: bold;}
@font-face {font-family: stix; src: url(STIXGeneralBolIta.ttf); font-weight: bold; font-style: italic;}
* {font-family: stix;}
body {font-size: 10pt; line-height: 11.96pt; text-align: justify; margin: 0;}
p {margin: 0; text-indent: 10pt;}
p.ni {text-indent: 0;}
sup, sub {font-size: 7pt;}
h2 {text-align: center; font-size: 10pt; font-weight: normal; margin: 8pt 0 3.5pt 0; line-height: 12pt;}
h3 {font-style: italic; font-weight: normal; font-size: 10pt; margin: 5pt 0 2.2pt 0; text-align: left; line-height: 12pt;}
.sc {font-size: 8pt;}
.cap {font-size: 8pt; line-height: 9.4pt; text-align: justify; text-indent: 0;}
.capc {font-size: 8pt; line-height: 9.4pt; text-align: center; text-indent: 0;}
ul {margin: 0 0 0 0; padding-left: 10pt;}
li {margin: 0; text-indent: 0;}
.eq {text-indent: 0; margin: 4pt 0 4pt 0; text-align: center;}
.code {font-family: monospace; font-size: 7.5pt;}
"""


def archive(extra_dirs=()):
    a = pymupdf.Archive(MPL_FONTS)
    for d in extra_dirs:
        a.add(str(d))
    return a


def smallcaps(text):
    """IEEE section-title small caps: first letter of each word 10 pt, rest 8 pt upper case."""
    def one(word):
        if "-" in word:
            return "-".join(one(w) for w in word.split("-"))
        if word[:1].isalpha() and len(word) > 1:
            return word[0].upper() + f"<span class=sc>{word[1:].upper()}</span>"
        return word

    return " ".join(one(w) for w in text.split(" ") if w)
    out = []
    for word in text.split(" "):
        if not word:
            continue
        if word[0].isalpha() and len(word) > 1 and not word.isupper():
            out.append(word[0].upper() + f"<span class=sc>{word[1:].upper()}</span>")
        elif word.isupper() and len(word) > 1 and word.isalpha():
            out.append(word[0] + f"<span class=sc>{word[1:]}</span>")
        else:
            out.append(word)
    return " ".join(out)


def smallcaps_title(text, big=8.0, small=6.4):
    """Table title style used by the paper (8 pt capitals, 6.4 pt small capitals)."""
    parts = []
    for word in text.split(" "):
        segs = []
        for j, ch in enumerate(word):
            if ch.isalpha() and ch.islower():
                segs.append(f"<span style='font-size:{small}pt'>{ch.upper()}</span>")
            else:
                segs.append(ch)
        parts.append("".join(segs))
    return " ".join(parts)


def equation(path: Path, tex: str, number: str | None, width_pt=COLW, size=10, height_pt=None):
    """Render a display equation (mathtext) at full column width with the number at the right edge."""
    h = height_pt or (26 if ("frac" in tex or "sum" in tex or "sqrt" in tex) else 15)
    fig = plt.figure(figsize=(width_pt / 72, h / 72))
    fig.text(0.5, 0.5, tex, ha="center", va="center", fontsize=size)
    if number:
        fig.text(1.0, 0.5, f"({number})", ha="right", va="center", fontsize=size)
    fig.savefig(path, transparent=True)
    plt.close(fig)
    return f"<img src='{path.name}' width={width_pt:.1f} height={h:.1f}/>"


def story_height(html, width, arch, css=CSS):
    st = pymupdf.Story(html=html, user_css=css, archive=arch)
    more, filled = st.place(pymupdf.Rect(0, 0, width, 5000))
    return pymupdf.Rect(filled).y1


def draw_story(page_or_writer, html, rect, arch, css=CSS):
    st = pymupdf.Story(html=html, user_css=css, archive=arch)
    return st


# ----------------------------------------------------------------------------- floats as one-page PDFs
def float_doc(width, height, painter):
    doc = pymupdf.open()
    pg = doc.new_page(width=width, height=height)
    painter(pg)
    return doc


def story_into_page(pg, html, rect, arch):
    """Render a Story into an existing page via a temporary PDF (keeps fonts and vector output)."""
    import io
    buf = io.BytesIO()
    w = pymupdf.DocumentWriter(buf)
    dev = w.begin_page(pymupdf.Rect(0, 0, rect.width, rect.height))
    st = pymupdf.Story(html=html, user_css=CSS, archive=arch)
    more, filled = st.place(pymupdf.Rect(0, 0, rect.width, rect.height))
    st.draw(dev)
    w.end_page()
    w.close()
    src = pymupdf.open("pdf", buf.getvalue())
    pg.show_pdf_page(rect, src, 0)
    return more, filled


def figure_float(fig_pdf: Path, caption_html: str, width: float, arch, fig_width=None, gap=5.0):
    src = pymupdf.open(str(fig_pdf))
    r = src[0].rect
    fw = fig_width or width
    fh = r.height * fw / r.width
    ch = story_height(f"<p class=cap>{caption_html}</p>", width, arch)
    total = fh + gap + ch + 1
    doc = pymupdf.open()
    pg = doc.new_page(width=width, height=total)
    x0 = (width - fw) / 2
    pg.show_pdf_page(pymupdf.Rect(x0, 0, x0 + fw, fh), src, 0)
    story_into_page(pg, f"<p class=cap>{caption_html}</p>", pymupdf.Rect(0, fh + gap, width, total), arch)
    return doc, total


def text_width(s, font="r", size=8.0):
    return FONT[font].text_length(s, fontsize=size)


import re

_SEG = re.compile(r"<(sup|sub|i)>(.*?)</(?:sup|sub|i)>")


def _segments(cell):
    out, pos = [], 0
    for m in _SEG.finditer(cell):
        if m.start() > pos:
            out.append((cell[pos:m.start()], "n"))
        out.append((m.group(2), m.group(1)))
        pos = m.end()
    if pos < len(cell):
        out.append((cell[pos:], "n"))
    return out


def _seg_width(cell, size):
    w = 0.0
    for t, st in _segments(cell):
        f = FONT["i"] if st == "i" else FONT["r"]
        w += f.text_length(t, fontsize=size * (0.7 if st in ("sup", "sub") else 1.0))
    return w


def _draw_cell(pg, x, yb, cell, size):
    for t, st in _segments(cell):
        sz = size * (0.7 if st in ("sup", "sub") else 1.0)
        dy = -0.36 * size if st == "sup" else (0.18 * size if st == "sub" else 0.0)
        fn = "stxi" if st == "i" else "stx"
        pg.insert_text((x, yb + dy), t, fontname=fn, fontsize=sz)
        x += (FONT["i"] if st == "i" else FONT["r"]).text_length(t, fontsize=sz)


def table_float(number: str, title: str, header: list[str], rows: list[list[str]], width: float, arch,
                align=None, colgap=10.0, size=8.0, pitch=9.45, note: str | None = None, rule_after=()):
    """Booktabs table: caption (Table N + small-caps title) above, top/mid/bottom rules. Cells accept <sup>,
    <sub> and <i> markup."""
    ncol = len(header)
    align = align or (["l"] + ["r"] * (ncol - 1))
    while True:  # shrink the type until the table fits the float width
        cw = [max(_seg_width(r[j], size) for r in [header] + rows) for j in range(ncol)]
        tw = sum(cw) + colgap * (ncol - 1) + 2 * 3
        if tw <= width - 2 or size <= 6.0:
            break
        size -= 0.25
        pitch = max(pitch - 0.3, 7.6)
        colgap = max(colgap - 0.3, 5.0)
    cap_html = (f"<p class=capc>Table {number}</p><p class=capc>{smallcaps_title(title)}</p>")
    caph = story_height(cap_html, width, arch) + 2
    y_top = caph + 5
    y_mid = y_top + pitch + 1.2
    y_bot = y_mid + pitch * len(rows) + 2.6
    note_h = story_height(f"<p class=cap>{note}</p>", tw, arch) + 2 if note else 0
    total = y_bot + (3 + note_h if note else 1.5)
    doc = pymupdf.open()
    pg = doc.new_page(width=width, height=total)
    story_into_page(pg, cap_html, pymupdf.Rect(0, 1, width, caph + 1), arch)
    x0 = (width - tw) / 2
    pg.insert_font(fontname="stx", fontfile=os.path.join(MPL_FONTS, "STIXGeneral.ttf"))
    pg.insert_font(fontname="stxi", fontfile=os.path.join(MPL_FONTS, "STIXGeneralItalic.ttf"))

    def put_row(cells, yb):
        x = x0 + 3
        for j, c in enumerate(cells):
            w = _seg_width(c, size)
            xx = x + (cw[j] - w if align[j] == "r" else (cw[j] - w) / 2 if align[j] == "c" else 0)
            _draw_cell(pg, xx, yb, c, size)
            x += cw[j] + colgap

    pg.draw_line((x0, y_top), (x0 + tw, y_top), width=0.8)
    put_row(header, y_top + pitch - 1.6)
    pg.draw_line((x0, y_mid), (x0 + tw, y_mid), width=0.5)
    yb = y_mid + pitch - 0.8
    for i, r in enumerate(rows):
        put_row(r, yb)
        if i in rule_after:
            pg.draw_line((x0, yb + 2.6), (x0 + tw, yb + 2.6), width=0.3)
        yb += pitch
    pg.draw_line((x0, y_bot), (x0 + tw, y_bot), width=0.8)
    if note:
        story_into_page(pg, f"<p class=cap>{note}</p>", pymupdf.Rect(x0, y_bot + 3, x0 + tw, total), arch)
    return doc, total
