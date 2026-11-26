from pathlib import Path

p = Path(__file__).with_name("page.template.html")
s = p.read_text(encoding="utf-8")


def rep(old, new, count=1):
    global s
    n = s.count(old)
    assert n == count, (n, old[:70])
    s = s.replace(old, new)


# The name is real text fitted to the width, so it reads as the page's headline.
rep(""".hero-name svg, .foot-name svg { display: block; width: 100%; height: auto; overflow: visible; }
.hero-name text, .foot-name text {
  font-family: var(--display);
  font-size: 200px;
  letter-spacing: -0.01em;
  fill: currentColor;
}
.hero-name svg { transform-origin: 50% 50%; will-change: transform; }""", """.name-fit {
  display: block;
  font-family: var(--display);
  font-weight: 400;
  font-size: 9.2vw;
  line-height: 0.86;
  letter-spacing: -0.01em;
  text-transform: uppercase;
  white-space: nowrap;
  transform-origin: 50% 50%;
}""")
rep("""      <span class="sr">Clock vs gravimeter: can optical atomic clocks find buried mass?</span>
      <svg id="heroName" viewBox="0 0 2800 190" aria-hidden="true" focusable="false"><text x="0" y="170">CLOCK VS GRAVIMETER</text></svg>""",
    """      <span class="name-fit" data-fit>Clock vs gravimeter</span><span class="sr">: can optical atomic clocks find buried mass?</span>""")
rep("""      <svg viewBox="0 0 2800 190" focusable="false"><text x="0" y="170">CLOCK VS GRAVIMETER</text></svg>""",
    """      <span class="name-fit" data-fit>Clock vs gravimeter</span>""")
rep("""  /* Fit each wordmark's viewBox to its text once the display face has loaded. */
  function fit() {
    Array.prototype.forEach.call(document.querySelectorAll('.hero-name svg, .foot-name svg'), function (svg) {
      var t = svg.querySelector('text');
      try { var b = t.getBBox(); if (b.width > 0) svg.setAttribute('viewBox', [b.x, b.y, b.width, b.height].join(' ')); } catch (e) {}
    });
  }""", """  /* Fit each name to the full width of its container once the display face has loaded. */
  function fit() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-fit]'), function (name) {
      var width = name.parentElement.clientWidth;
      name.style.fontSize = '100px';
      var natural = name.scrollWidth;
      if (natural > 0) name.style.fontSize = (100 * width / natural).toFixed(2) + 'px';
    });
  }""")
rep("""  var hero = document.querySelector('.hero-name svg');""", """  var hero = document.querySelector('.hero-name .name-fit');""")
rep("""  .hero-name svg, .foot-name, .drift img { transform: none !important; }""", """  .name-fit, .foot-name, .drift img { transform: none !important; }""")

# Running text in the full ink at the body size; grey only for captions and notes.
rep(""".ledger td.study { width: 36%; }
.ledger td.study small { display: block; color: var(--muted); font-size: var(--s-small); margin-top: 2px; }""",
    """.ledger td.study { width: 36%; font-weight: 500; }
.ledger td.study small { display: block; font-weight: 400; font-size: var(--s-body); margin-top: 2px; }""")
rep("""column-gap: 36px; font-size: var(--s-small); }""", """column-gap: 36px; font-size: var(--s-body); }""")
rep("""border-collapse: collapse; font-size: var(--s-small); background: var(--bg);""", """border-collapse: collapse; font-size: var(--s-body); background: var(--bg);""")
rep(""".ledger td.result.agree { color: var(--accent); }""", """.ledger td.result.agree { color: var(--ink); }
.ledger td.result.agree::before { content: ""; display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: var(--accent); margin-right: 8px; }""")

# The precision field sizes to its content.
rep(""".dial { background: var(--field-1); color: var(--field-1-ink); min-height: 88svh; display: grid; align-content: center; }""",
    """.dial { background: var(--field-1); color: var(--field-1-ink); }""")

# The list keeps its narrow column; the anomaly map closes the right side.
rep(""".list { margin-left: 22%; width: min(520px, 100%); }""", """.list-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); column-gap: 18px; align-items: start; }
.list { grid-column: 2 / 7; min-width: 0; }
.list-shot { grid-column: 8 / 13; position: sticky; top: 24px; min-width: 0; }""")
rep(""".list-shot { margin-top: 56px; }\n""", "")
rep("""  .list { margin-left: 0; }""", """  .list, .list-shot { grid-column: 1 / -1; }
  .list-shot { position: static; margin-top: 40px; }""")
rep("""    <div class="list">
      <h2 id="changed-h">What changed in the project</h2>""", """    <div class="list-grid">
    <div class="list">
      <h2 id="changed-h">What changed in the project</h2>""")
rep("""      <figure class="list-shot">
        <img src="{{IMG:map}}" width="1240" height="700" loading="lazy" alt="Simulator gravity anomaly map: concentric rings of anomaly over the survey grid with the true and estimated source positions.">
        <figcaption>Gravity anomaly map from a completed simulation.</figcaption>
      </figure>
    </div>""", """    </div>
      <figure class="list-shot">
        <img src="{{IMG:map}}" width="1240" height="700" loading="lazy" alt="Simulator gravity anomaly map: concentric rings of anomaly over the survey grid with the true and estimated source positions.">
        <figcaption>Gravity anomaly map from a completed simulation.</figcaption>
      </figure>
    </div>""")
p.write_text(s, encoding="utf-8")
print("ok")
