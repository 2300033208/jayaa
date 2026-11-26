"""One alignment system: every section snaps to the halves of the 12-column grid (columns 1 and 7);
the facts row snaps to its quarters (1, 4, 7, 10); the ledger's columns follow the same lines."""
from pathlib import Path

p = Path(__file__).with_name("page.template.html")
s = p.read_text(encoding="utf-8")


def rep(old, new, count=1):
    global s
    n = s.count(old)
    assert n == count, (n, old[:70])
    s = s.replace(old, new)


# Intro: heading over the left half, note in the last quarter, facts on the quarters, text and photo on the halves.
rep(".intro-head { grid-column: 1 / 7;", ".intro-head { grid-column: 1 / 10;")
rep(""".facts {
  grid-column: 1 / -1;
  margin-top: 120px;
  display: flex;
  justify-content: space-between;
  gap: 32px;
  flex-wrap: wrap;
}""", """.facts {
  grid-column: 1 / -1;
  margin-top: 96px;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  column-gap: 18px;
  row-gap: 32px;
}""")
rep(".intro-photo { grid-column: 8 / 13; margin-top: 72px; }", ".intro-photo { grid-column: 7 / 13; margin-top: 72px; }")

# How a survey runs: words and call on the left half, the response on the right half.
rep(".ex > p { grid-column: 1 / 6; }\n.ex > .call { grid-column: 1 / 6; grid-row: 2; }",
    ".ex > p { grid-column: 1 / 7; }\n.ex > .call { grid-column: 1 / 7; grid-row: 2; }")
rep(".resp { grid-column: 6 / 13; grid-row: 1 / span 3; min-width: 0; }", ".resp { grid-column: 7 / 13; grid-row: 1 / span 3; min-width: 0; }")

# Picture band on the same halves.
rep(".band { display: grid; grid-template-columns: 5fr 7fr; gap: 18px; align-items: start; }",
    ".band { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; align-items: start; }")

# Ledger: both heading lines on the left edge; columns on the grid lines (1 · 2–6 · 7–9 · 10–12).
rep(".proof-head span { display: block; padding-left: calc(2 * (100% / 12)); }", ".proof-head span { display: block; }")
rep(".ledger th, .ledger td { padding: 14px 12px;", ".ledger th, .ledger td { padding: 14px 18px 14px 0;")
rep(".ledger td.year { width: 7%;", ".ledger td.year { width: 8.333%; padding-left: 12px;")
rep(".ledger td.study { width: 36%; font-weight: 500; }", ".ledger td.study { width: 41.667%; font-weight: 500; }")
rep(".ledger td.where { width: 25%; }", ".ledger td.where { width: 25%; }\n.ledger thead th:first-child { padding-left: 12px; }")
rep(".ledger td.result { width: 22%; text-align: right;", ".ledger td.result { width: 25%; padding-right: 12px; text-align: right;")

# Precision dial and its chart on the halves.
rep(".dial-left { grid-column: 1 / 8; min-width: 0; }\n.dial-chart { grid-column: 8 / 13; min-width: 0; }",
    ".dial-left { grid-column: 1 / 7; min-width: 0; }\n.dial-chart { grid-column: 7 / 13; min-width: 0; }")

# Stats: heading on the left half, figures on the right; the two pictures below on the same halves.
rep(".stats-head { grid-column: 1 / 6;", ".stats-head { grid-column: 1 / 7;")
rep(".stats-shot { grid-column: 1 / -1; margin-top: 120px; display: grid; grid-template-columns: 7fr 5fr; gap: 18px; align-items: start; }",
    ".stats-shot { grid-column: 1 / -1; margin-top: 96px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; align-items: start; }")

# What changed: list on the left half, map on the right.
rep(".list { grid-column: 2 / 7; min-width: 0; }\n.list-shot { grid-column: 8 / 13;",
    ".list { grid-column: 1 / 7; min-width: 0; max-width: 620px; }\n.list-shot { grid-column: 7 / 13;")

# Viva notes: heading on top, two text columns whose second starts on column 7.
rep(".faq-head { grid-column: 1 / 4; font-size: var(--s-head); font-weight: 500; }",
    ".faq-head { grid-column: 1 / -1; font-size: var(--s-head); font-weight: 500; margin-bottom: 40px; }")
rep(".faq-text { grid-column: 5 / 13; columns: 2; column-gap: 56px; }", ".faq-text { grid-column: 1 / -1; columns: 2; column-gap: 18px; }")
rep("break-inside: avoid; margin-bottom: 20px; font-size: var(--s-body); }", "break-inside: avoid; margin-bottom: 20px; font-size: var(--s-body); padding-right: clamp(0px, 4vw, 72px); }")

# Footer: places on the left half, references on the right (unchanged lines kept explicit).
rep(".places { grid-column: 1 / 6;", ".places { grid-column: 1 / 7;")

# Narrow screens: the facts keep a two-by-two grid from 1000px down.
rep("  .intro-head { grid-column: 1 / -1; }", "  .intro-head { grid-column: 1 / -1; }\n  .facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }")
rep("  .faq-head { grid-column: 1 / -1; margin-bottom: 28px; }\n", "")
p.write_text(s, encoding="utf-8")
print("ok")
