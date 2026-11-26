from pathlib import Path

p = Path(__file__).with_name("page.template.html")
s = p.read_text(encoding="utf-8")


def rep(old, new, count=1):
    global s
    n = s.count(old)
    assert n == count, (n, old[:70])
    s = s.replace(old, new)


# tokens: five size steps, darker muted for 4.5:1 on the panel tone, code face only for real code
rep("""  --code: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;

  --step-small: clamp(0.8125rem, 0.79rem + 0.1vw, 0.875rem);
  --step-body: clamp(1.0625rem, 1rem + 0.25vw, 1.1875rem);
  --step-lead: clamp(1.25rem, 1.1rem + 0.7vw, 1.625rem);
  --step-head: clamp(2rem, 1.3rem + 3.2vw, 4rem);
""", """  --code: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; /* taste-skill-ignore: only for the literal code in <pre><code> */

  --s-small: 14px;
  --s-body: 17px;
  --s-lead: 22px;
  --s-head: clamp(28px, 2.6vw, 40px);
  --s-display: clamp(52px, 6.6vw, 108px);
""")
rep("--muted: #6b6763;", "--muted: #5b5753;")
rep("font-size: var(--step-body);\n  line-height: 1.55;", "font-size: var(--s-body);\n  line-height: 1.55;")
rep(".hero-lede { max-width: 38ch; font-size: 18px; line-height: 1.45; }", ".hero-lede { max-width: 42ch; font-size: var(--s-body); line-height: 1.45; }")
rep("  font-weight: 500;\n  font-size: 16px;\n  transition: background", "  font-weight: 500;\n  font-size: var(--s-body);\n  transition: background")
rep(".corner-links { display: flex; gap: 20px; font-size: 15px; flex-wrap: wrap; }", ".corner-links { display: flex; gap: 20px; font-size: var(--s-small); flex-wrap: wrap; }")
rep(".hero-bottom { align-items: flex-end; font-size: 16px; color: var(--muted); }", ".hero-bottom { align-items: flex-end; font-size: var(--s-small); color: var(--muted); }")
rep("font-size: clamp(44px, 5vw, 76px); line-height: 0.95; align-self: end; }", "font-size: var(--s-display); line-height: 0.95; align-self: end; }")
rep(".intro-note { grid-column: 10 / 13; align-self: end; font-size: 16px; }", ".intro-note { grid-column: 10 / 13; align-self: end; font-size: var(--s-body); }")
rep("font-size: clamp(40px, 4.4vw, 68px); line-height: 1; }", "font-size: var(--s-head); line-height: 1; }")
rep(".fact span { font-size: 14px;", ".fact span { font-size: var(--s-small);")
rep("figcaption { font-size: var(--step-small);", "figcaption { font-size: var(--s-small);")
rep("align-self: start; font-size: var(--step-lead);", "align-self: start; font-size: var(--s-lead);")
rep(".how-col h2 { font-size: 28px;", ".how-col h2 { font-size: var(--s-head);")
rep(".ex > p { font-size: 20px;", ".ex > p { font-size: var(--s-lead);")
rep("  font-family: var(--code);\n  font-size: 14px;", "  font-family: var(--code);\n  font-size: var(--s-small);")
rep("gap: 18px; font-size: 15px; }\n.resp-panel b { display: block; font-size: 22px;", "gap: 18px; font-size: var(--s-small); }\n.resp-panel b { display: block; font-size: var(--s-lead);")
rep("font-size: clamp(48px, 5.6vw, 92px); line-height: 0.92; }", "font-size: var(--s-display); line-height: 0.92; }")
rep("table.ledger { width: 100%; border-collapse: collapse; font-size: 16px; }", "table.ledger { width: 100%; border-collapse: collapse; font-size: var(--s-body); }")
rep(".ledger thead th { font-weight: 500; color: var(--muted); font-size: var(--step-small); }", ".ledger thead th { font-weight: 500; color: var(--muted); font-size: var(--s-small); }")
rep("color: var(--muted); font-size: 14px; margin-top: 2px; }", "color: var(--muted); font-size: var(--s-small); margin-top: 2px; }")

# showcase: two columns, the answer on the left and a live chart on the right
rep(".dial h2 { font-size: 28px; font-weight: 500; margin-bottom: 28px; }", """.dial-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); column-gap: 18px; align-items: center; }
.dial-left { grid-column: 1 / 8; min-width: 0; }
.dial-chart { grid-column: 8 / 13; min-width: 0; }
.dial-chart svg { width: 100%; height: auto; display: block; }
.dial-chart .axis { stroke: var(--muted); stroke-width: 1; fill: none; }
.dial-chart .tick { fill: var(--field-1-ink); font-size: 13px; font-family: var(--text); }
.dial-chart .label { fill: var(--field-1-ink); font-size: 14px; font-family: var(--text); }
.dial-chart .parity { stroke: var(--accent); stroke-width: 2; stroke-dasharray: 6 5; fill: none; }
.dial-chart .line { fill: none; stroke: var(--ink); stroke-width: 2.25; }
.dial-chart .marker { stroke: var(--accent); stroke-width: 3; }
.dial-chart .dot { fill: var(--accent); stroke: var(--field-1); stroke-width: 2; }
.legend { margin-top: 12px; display: grid; gap: 4px; font-size: var(--s-small); list-style: none; padding: 0; }
.legend li { display: flex; align-items: center; gap: 10px; }
.legend svg { width: 34px; height: 8px; flex: none; }
.dial h2 { font-size: var(--s-head); font-weight: 500; margin-bottom: 28px; }""")
rep("  font-size: clamp(48px, 8vw, 132px);\n  line-height: 1;", "  font-size: var(--s-display);\n  line-height: 1;")
rep(".dial-read { margin-top: 48px; font-size: 17px;", ".dial-read { margin-top: 40px; font-size: var(--s-body);")
rep("border-collapse: collapse; font-size: 15px; background: var(--bg);", "border-collapse: collapse; font-size: var(--s-small); background: var(--bg);")
rep(".answer thead th { font-weight: 500; color: var(--muted); font-size: 14px; }", ".answer thead th { font-weight: 500; color: var(--muted); font-size: var(--s-small); }")
rep(".examples { margin-top: 40px; display: flex; gap: 12px 28px; flex-wrap: wrap; font-size: 17px; }", ".examples { margin-top: 32px; display: flex; gap: 12px 28px; flex-wrap: wrap; font-size: var(--s-body); }")
rep(".dial-note { margin-top: 28px; font-size: var(--step-small);", ".dial-note { margin-top: 28px; font-size: var(--s-small);")
rep("align-self: center; font-size: clamp(32px, 3.2vw, 52px); line-height: 1.1; }", "align-self: center; font-size: var(--s-head); line-height: 1.1; }")
rep("font-family: var(--display); font-size: clamp(64px, 7vw, 112px); line-height: 1;", "font-family: var(--display); font-size: var(--s-display); line-height: 1;")
rep(".fig p { font-size: 16px; padding-left: 20px;", ".fig p { font-size: var(--s-body); padding-left: 20px;")
rep(".list h2 { font-size: 28px;", ".list h2 { font-size: var(--s-head);")
rep(".group > p { color: var(--muted); font-size: 16px;", ".group > p { color: var(--muted); font-size: var(--s-body);")
rep("align-items: baseline; font-size: 16px; min-width: 0; }", "align-items: baseline; font-size: var(--s-body); min-width: 0; }")
rep(".group.added .dot { background: var(--field-1); box-shadow: inset 0 0 0 2px var(--accent); }", ".group.added .dot { background: var(--field-1); border: 2px solid var(--accent); box-sizing: border-box; }")
rep(".row .v { flex: none; font-size: 14px;", ".row .v { flex: none; font-size: var(--s-small);")
rep(".faq-head { grid-column: 1 / 4; font-size: 30px;", ".faq-head { grid-column: 1 / 4; font-size: var(--s-head);")
rep("break-inside: avoid; margin-bottom: 20px; font-size: 16.5px; }", "break-inside: avoid; margin-bottom: 20px; font-size: var(--s-body); }")
rep(".foot-invite { margin-top: 24px; font-size: var(--step-lead);", ".foot-invite { margin-top: 24px; font-size: var(--s-lead);")
rep(".places a { font-size: clamp(24px, 2.4vw, 34px);", ".places a { font-size: var(--s-head);")
rep("column-gap: 36px; font-size: 15px; }", "column-gap: 36px; font-size: var(--s-small); }")
rep("flex-wrap: wrap; font-size: 13px; }", "flex-wrap: wrap; font-size: var(--s-small); }")

# motion: nothing is hidden at rest; a part rises only once it is about to scroll into view
rep(".js .pending { opacity: 0; transform: translateY(24px); }\n", "")
rep("  .js .pending { opacity: 1; transform: none; }\n", "")

# phone: drop the extra sizes
rep("  .hero-lede { font-size: 17px; }\n", "")
rep("  .fact b { font-size: 34px; }\n", "")
rep("  .proof-head { font-size: 11vw; }\n", "")
rep("  .dial input { font-size: 11vw; }\n", "")
rep("  .fig .whole, .fig .dec { font-size: 15vw; }\n", "")
rep("margin-top: 4px; font-size: 15px; }", "margin-top: 4px; font-size: var(--s-small); }")
rep(".ledger td.year { font-size: 22px; padding-top: 6px; }", ".ledger td.year { font-size: var(--s-lead); padding-top: 6px; }")
rep("  .faq-text { grid-column: 1 / -1; }\n", "  .faq-text { grid-column: 1 / -1; }\n  .dial-left, .dial-chart { grid-column: 1 / -1; }\n  .dial-chart { margin-top: 48px; }\n")

# hero sentence: say the one thing
rep("""<p class="hero-lede">A final-year simulation study asks whether optical atomic clocks can find buried mass. <strong>On the same stations, a gravimeter is 690 to 13 000 times more sensitive.</strong></p>""",
    """<p class="hero-lede">Can optical atomic clocks find buried mass? <strong>A gravimeter on the same stations is 690 to 13 000 times more sensitive.</strong></p>""")

# showcase markup
rep("""    <h2 id="dial-h">How good must the clock be?</h2>
    <div class="dial-line" data-ui>""", """    <div class="dial-grid">
    <div class="dial-left">
    <h2 id="dial-h">How good must the clock be?</h2>
    <div class="dial-line" data-ui>""")
rep("""    <p class="dial-note">Engine output""", """    </div>
    <figure class="dial-chart" data-ui>
      <svg id="dialChart" viewBox="0 0 560 400" role="img" aria-labelledby="dialChartTitle"><title id="dialChartTitle">How far the gravimeter is ahead of the clock, for each scenario, as clock precision improves</title></svg>
      <ul class="legend" id="dialLegend"></ul>
    </figure>
    </div>
    <p class="dial-note">Engine output""")

# JS: live chart and marker
rep("""  input.addEventListener('input', render);""", """  /* Live chart: gravimeter SNR over clock SNR against clock precision; one line per distinct survey. */
  var svgNS = 'http://www.w3.org/2000/svg';
  var chart = document.getElementById('dialChart');
  var W = 560, H = 400, L = 64, R = 16, T = 16, B = 56;
  var XMIN = -15, XMAX = -23, YMIN = -3, YMAX = 5;
  function X(lg) { return L + (XMIN - lg) / (XMIN - XMAX) * (W - L - R); }
  function Y(lg) { return T + (YMAX - lg) / (YMAX - YMIN) * (H - T - B); }
  function el(name, attrs, text) {
    var e = document.createElementNS(svgNS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }
  function pow10(n) { return '10' + String(n).split('').map(function (c) { return TOSUP[c] || c; }).join(''); }
  var LINES = [], seen = {};
  var DASH = ['', '8 5', '2 5', '12 4 2 4'];
  DATA.forEach(function (row) {
    var key = (row.grav_snr / (row.clock_snr * row.sigma)).toPrecision(4);
    if (seen[key]) { seen[key].names.push(SHORT[row.id]); return; }
    seen[key] = { per: row.grav_snr / (row.clock_snr * row.sigma), names: [SHORT[row.id]] };
    LINES.push(seen[key]);
  });
  var marker, dots = [];
  (function draw() {
    for (var g = YMIN; g <= YMAX; g += 2) {
      chart.appendChild(el('text', { x: L - 10, y: Y(g) + 4, 'text-anchor': 'end', class: 'tick' }, pow10(g)));
    }
    for (var x = -15; x >= -23; x -= 2) {
      chart.appendChild(el('text', { x: X(x), y: H - B + 22, 'text-anchor': 'middle', class: 'tick' }, pow10(x)));
    }
    chart.appendChild(el('path', { d: 'M' + L + ' ' + T + 'V' + (H - B) + 'H' + (W - R), class: 'axis' }));
    chart.appendChild(el('text', { x: L + (W - L - R) / 2, y: H - 8, 'text-anchor': 'middle', class: 'label' }, 'Clock precision per station (better to the right)'));
    chart.appendChild(el('text', { transform: 'translate(16 ' + (T + (H - T - B) / 2) + ') rotate(-90)', 'text-anchor': 'middle', class: 'label' }, 'Gravimeter ahead by (×)'));
    chart.appendChild(el('path', { d: 'M' + L + ' ' + Y(0) + 'H' + (W - R), class: 'parity' }));
    chart.appendChild(el('text', { x: W - R, y: Y(0) - 8, 'text-anchor': 'end', class: 'label' }, 'Clock catches up'));
    marker = el('path', { class: 'marker' });
    chart.appendChild(marker);
    LINES.forEach(function (line, i) {
      var pts = [];
      for (var lg = XMIN; lg >= XMAX - 1e-9; lg -= 0.25) {
        var y = Math.log10(line.per * Math.pow(10, lg));
        if (y >= YMIN && y <= YMAX) pts.push(X(lg).toFixed(1) + ',' + Y(y).toFixed(1));
      }
      chart.appendChild(el('polyline', { points: pts.join(' '), class: 'line', 'stroke-dasharray': DASH[i] || '' }));
      var d = el('circle', { r: 5.5, class: 'dot' });
      chart.appendChild(d);
      dots.push(d);
      var li = document.createElement('li');
      li.innerHTML = '<svg viewBox="0 0 34 8" aria-hidden="true"><path d="M0 4H34" stroke="currentColor" stroke-width="2.25" stroke-dasharray="' + (DASH[i] || '') + '"/></svg>' + line.names.join(' and ');
      document.getElementById('dialLegend').appendChild(li);
    });
  })();
  function moveMarker(sigma) {
    var lg = Math.max(XMAX, Math.min(XMIN, Math.log10(sigma)));
    marker.setAttribute('d', 'M' + X(lg).toFixed(1) + ' ' + T + 'V' + (H - B));
    LINES.forEach(function (line, i) {
      var y = Math.max(YMIN, Math.min(YMAX, Math.log10(line.per * Math.pow(10, lg))));
      dots[i].setAttribute('cx', X(lg).toFixed(1));
      dots[i].setAttribute('cy', Y(y).toFixed(1));
    });
  }
  var baseRender = render;
  render = function () { baseRender(); var v = parse(input.value); if (v >= 1e-25 && v <= 1e-12) moveMarker(v); };
  input.addEventListener('input', function () { render(); });""")
rep("""        en.target.classList.remove('pending');
        en.target.classList.add('in');""", """        en.target.classList.add('in');""")
rep("""    }, { rootMargin: '0px 0px -8% 0px' });""", """    }, { rootMargin: '0px 0px 15% 0px' });""")
rep("""      el.classList.add('pending');
      io.observe(el);""", """      io.observe(el);""")
p.write_text(s, encoding="utf-8")
print("ok")
