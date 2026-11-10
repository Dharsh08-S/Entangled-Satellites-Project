// =============================================================================
// ui.js  -  panels, forms, telemetry, chart, quantum experiments, code lab
// =============================================================================
import * as PH from './physics.js';
import { STATUS_COLOR } from './scene.js';

const $ = (s, r = document) => r.querySelector(s);
const TOKEN = new URLSearchParams(location.search).get('token') || '';
const WARPS = [1, 10, 60, 300, 1800, 3600, 21600, 86400, 604800];

const ORBIT_PRESETS = {
  'LEO 550 km': { parent: 'Earth', alt: 550, inc: 53 },
  'Sun-synchronous 600 km': { parent: 'Earth', alt: 600, inc: 97.8 },
  'MEO 20,200 km (GPS)': { parent: 'Earth', alt: 20200, inc: 55 },
  'GEO stationary': { parent: 'Earth', alt: 35786, inc: 0, geoLon: 80 },
  'Low lunar orbit 100 km': { parent: 'Moon', alt: 100, inc: 90 },
  'Lunar 3,000 km': { parent: 'Moon', alt: 3000, inc: 60 },
  'Low Mars orbit 400 km': { parent: 'Mars', alt: 400, inc: 93 },
  'Areostationary': { parent: 'Mars', alt: 17032, inc: 0, geoLon: 0 },
};
const GROUND_PRESETS = {
  'Hanle, India (IAO)': [32.78, 78.96, 4.5],
  'Mount Abu, India': [24.65, 72.78, 1.7],
  'Devasthal, India': [29.36, 79.68, 2.45],
  'Tenerife, Spain': [28.30, -16.51, 2.4],
  'Matera, Italy': [40.65, 16.70, 0.54],
  'Xinglong, China': [40.39, 117.57, 0.9],
  'Table Mountain, USA': [34.38, -117.68, 2.2],
  'Mount Stromlo, Australia': [-35.32, 149.01, 0.77],
};
const PALETTE = ['#ffc94d', '#c58cff', '#5ad1ff', '#ff7a59', '#7dff9b', '#ff6fb5', '#9fe7ff', '#ffe08a'];

const PHYS_SLIDERS = [
  ['detEff', 'Detector efficiency', 0.1, 0.95, 0.01, (v) => `${(v * 100).toFixed(0)} %`],
  ['opticsEff', 'Optics transmission', 0.2, 1, 0.01, (v) => `${(v * 100).toFixed(0)} %`],
  ['visibility', 'Source visibility', 0.8, 1, 0.005, (v) => `${(v * 100).toFixed(1)} %`],
  ['darkCounts', 'Dark counts', 1, 5000, 1, (v) => `${v.toFixed(0)} /s`, true],
  ['coincWindow_ns', 'Coincidence window', 0.05, 10, 0.05, (v) => `${v.toFixed(2)} ns`, true],
  ['jitter_urad', 'Pointing jitter', 0.05, 20, 0.05, (v) => `${v.toFixed(2)} µrad`, true],
  ['spaceBackground', 'Space stray light', 1, 1e5, 1, (v) => `${fmtSI(v)} /s`, true],
  ['atmZenith', 'Sky transmission', 0.3, 0.95, 0.01, (v) => `${(v * 100).toFixed(0)} %`],
  ['minElevation', 'Min. elevation', 0, 45, 1, (v) => `${v.toFixed(0)}°`],
  ['sunExclusion', 'Sun exclusion', 0, 30, 0.5, (v) => `${v.toFixed(1)}°`],
];

// ---------- formatting ----------
export function fmtSI(v, digits = 3) {
  if (!isFinite(v)) return '∞';
  if (v === 0) return '0';
  const a = Math.abs(v);
  const units = [[1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n']];
  for (const [f, u] of units) if (a >= f) return `${+(v / f).toPrecision(digits)}${u}`;
  return v.toExponential(1);
}
const fmtDist = (km) => km >= 3e6 ? `${(km / PH.AU_KM).toFixed(4)} AU` : `${Math.round(km).toLocaleString()} km`;
const fmtTime = (s) => s < 1e-3 ? `${(s * 1e6).toFixed(1)} µs` : s < 1 ? `${(s * 1e3).toFixed(2)} ms` : s < 120 ? `${s.toFixed(2)} s` : `${(s / 60).toFixed(2)} min`;
const fmtRate = (v) => v < 1e-3 && v > 0 ? `1 per ${fmtTime(1 / v).replace(' min', ' min')}` : `${fmtSI(v)} /s`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = (p) => `${p}-${Math.random().toString(36).slice(2, 8)}`;

// ---------- backend API ----------
async function api(path, body) {
  if (!TOKEN) throw new Error('web version: no local backend');   // e.g. GitHub Pages
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Lab-Token': TOKEN },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

const DEFAULT_CODE = `# ===== Quantum Code Lab =====
# Runs on your computer with Qiskit. Ready to use:
#   link             live telemetry of the SELECTED link (dict)
#   noisy_simulator  Qiskit simulator with that link's noise
#   correlation, run_chsh, QuantumCircuit, transpile, np
#
# Example: measure the correlation E(a,b) for many angles
# through the real space channel, and compare with theory.

print("Link:", link["name"])
print(f"Distance {link['distance_km']:,.0f} km | p = {link['p']:.3f} | S = {link['S']:.3f}")
sim = noisy_simulator(link["p"])

print("\\n angle    measured E    theory p*cos")
for deg in range(0, 181, 30):
    th = np.radians(deg)
    qc = QuantumCircuit(2)
    qc.h(0)
    qc.cx(0, 1)          # entangled pair |Phi+>
    qc.ry(-th, 1)        # Bob rotates his analyser
    qc.measure_all()
    counts = sim.run(transpile(qc, sim), shots=2000).result().get_counts()
    print(f"{deg:5d}°   {correlation(counts):+10.3f}   {link['p'] * np.cos(th):+12.3f}")
`;

export class UI {
  constructor(app) {
    this.app = app;
    this.backend = null;
    this.selectedLink = null;
    this._buildTopbar();
    this._buildTabs();
    this._buildAddForms();
    this._buildPhysics();
    this._buildTelemetry();
    this._buildLab();
    this._checkBackend();
    document.addEventListener('keydown', (e) => {
      if (e.target.matches('input, textarea, select')) return;
      if (e.code === 'Space') { e.preventDefault(); this.togglePause(); }
      if (e.key === '+' || e.key === '=') this.changeWarp(1);
      if (e.key === '-') this.changeWarp(-1);
    });
  }

  // ======================================================== top bar
  _buildTopbar() {
    const a = this.app;
    $('#btn-play').onclick = () => this.togglePause();
    $('#btn-slower').onclick = () => this.changeWarp(-1);
    $('#btn-faster').onclick = () => this.changeWarp(1);
    $('#btn-reverse').onclick = () => { a.warp = -a.warp; this._showWarp(); };
    $('#btn-now').onclick = () => { a.simTime = new Date(); };
    $('#clock').onclick = () => {
      const inp = $('#clock-input');
      inp.value = new Date(a.simTime.getTime() - a.simTime.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      inp.showPicker?.(); inp.focus();
    };
    $('#clock-input').onchange = (e) => { if (e.target.value) a.simTime = new Date(e.target.value); };
    $('#focus').onchange = (e) => { const [kind, id] = e.target.value.split(':'); a.setFocus({ kind, id }); };
    for (const b of document.querySelectorAll('[data-scale]')) b.onclick = () => {
      a.scene.mode = b.dataset.scale;
      document.querySelectorAll('[data-scale]').forEach((x) => x.classList.toggle('on', x === b));
      a.scene.setFocus(a.scene.focus);
    };
    const toggle = (id, key) => { const b = $(id); b.onclick = () => { a.scene[key] = !a.scene[key]; b.classList.toggle('on', a.scene[key]); }; };
    toggle('#tg-labels', 'showLabels'); toggle('#tg-orbits', 'showOrbits'); toggle('#tg-big', 'exaggerate');
    $('#btn-lab').onclick = () => document.body.classList.toggle('lab-open');
    // phone tab bar: one bottom sheet at a time
    for (const b of document.querySelectorAll('#mnav button')) b.onclick = () => {
      const m = b.dataset.m, body = document.body;
      const wasOn = b.classList.contains('on') && m !== 'view';
      body.classList.remove('m-fleet', 'm-link', 'lab-open');
      document.querySelectorAll('#mnav button').forEach((x) => x.classList.remove('on'));
      const target = wasOn ? 'view' : m;
      if (target === 'fleet') body.classList.add('m-fleet');
      if (target === 'link') body.classList.add('m-link');
      if (target === 'lab') body.classList.add('lab-open');
      document.querySelector(`#mnav [data-m="${target}"]`).classList.add('on');
    };
    $('#btn-panels').onclick = () => document.body.classList.toggle('panels-hidden');
    this._showWarp();
  }
  togglePause() { this.app.paused = !this.app.paused; $('#btn-play').textContent = this.app.paused ? '▶' : '❚❚'; }
  changeWarp(dir) {
    const a = this.app, sign = Math.sign(a.warp) || 1, abs = Math.abs(a.warp);
    let i = WARPS.findIndex((w) => w >= abs); if (i < 0) i = WARPS.length - 1;
    i = Math.max(0, Math.min(WARPS.length - 1, i + dir));
    a.warp = sign * WARPS[i]; this._showWarp();
  }
  _showWarp() {
    const w = this.app.warp, abs = Math.abs(w);
    const txt = abs >= 86400 ? `${abs / 86400} d/s` : abs >= 3600 ? `${abs / 3600} h/s` : abs >= 60 ? `${abs / 60} min/s` : `${abs}×`;
    $('#warp').textContent = (w < 0 ? '◀ ' : '') + txt;
  }
  setFocusValue(f) { $('#focus').value = `${f.kind}:${f.id}`; }

  // ======================================================== left tabs
  _buildTabs() {
    for (const t of document.querySelectorAll('.tab')) t.onclick = () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x === t));
      document.querySelectorAll('.tabpage').forEach((p) => p.classList.toggle('on', p.id === t.dataset.page));
    };
    $('#btn-save').onclick = () => this.saveScenario();
    $('#btn-reset').onclick = async () => {
      if (!confirm('Reset to the default scenario? Your satellites and links will be replaced.')) return;
      const { DEFAULT_SCENARIO } = await import('./main.js');
      this.app.loadScenario(DEFAULT_SCENARIO); this.selectLink(this.app.links[0]?.id); this.toast('Default scenario restored');
    };
    $('#btn-export').onclick = () => {
      const blob = new Blob([JSON.stringify(this.app.scenario(), null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'quantum-space-scenario.json'; a.click();
    };
    $('#file-import').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { this.app.loadScenario(JSON.parse(await f.text())); this.selectLink(this.app.links[0]?.id); this.toast('Scenario imported'); }
      catch (err) { this.toast('Could not read that file: ' + err.message, true); }
      e.target.value = '';
    };
  }

  refreshLists() {
    const a = this.app;
    const sats = a.nodes.filter((n) => n.type !== 'ground'), gs = a.nodes.filter((n) => n.type === 'ground');
    const nodeRow = (n) => `
      <div class="row ${this.selectedNode === n.id ? 'sel' : ''}" data-node="${n.id}">
        <span class="dot" style="background:${n.color}"></span>
        <div class="grow"><div class="name">${esc(n.name)}</div>
          <div class="sub">${n.type === 'ground' ? `${n.parent} · ${n.lat.toFixed(2)}°, ${n.lon.toFixed(2)}° · Ø ${n.rx} m`
            : `${n.parent} · ${fmtSI(n.alt)} km${n.geoLon !== undefined && n.geoLon !== null && n.geoLon !== '' ? ` · stationary ${n.geoLon}°` : ` · i ${n.inc}°`} · Ø ${n.tx}/${n.rx} m`}</div></div>
        <button class="icon" data-focus="${n.id}" title="Fly to">◎</button>
        <button class="icon danger" data-del="${n.id}" title="Delete">✕</button>
      </div>`;
    $('#list-sats').innerHTML = sats.map(nodeRow).join('') || '<div class="empty">No satellites yet</div>';
    $('#list-ground').innerHTML = gs.map(nodeRow).join('') || '<div class="empty">No ground stations</div>';
    $('#list-links').innerHTML = a.links.map((l) => `
      <div class="row ${this.selectedLink === l.id ? 'sel' : ''}" data-link="${l.id}">
        <span class="dot status" data-status-dot="${l.id}"></span>
        <div class="grow"><div class="name">${esc(a.nodesById[l.from].name)} → ${esc(a.nodesById[l.to].name)}</div>
        <div class="sub" data-link-sub="${l.id}">…</div></div>
        <button class="icon danger" data-dellink="${l.id}" title="Delete link">✕</button>
      </div>`).join('') || '<div class="empty">No links. Create one in the Add tab.</div>';

    for (const r of document.querySelectorAll('[data-node]')) r.onclick = (e) => { if (!e.target.closest('button')) this.selectNode(r.dataset.node); };
    for (const b of document.querySelectorAll('[data-focus]')) b.onclick = () => a.setFocus({ kind: 'node', id: b.dataset.focus });
    for (const b of document.querySelectorAll('[data-del]')) b.onclick = () => {
      const n = a.nodesById[b.dataset.del];
      if (!confirm(`Delete ${n.name}? Its links will be removed too.`)) return;
      a.nodes = a.nodes.filter((x) => x.id !== n.id);
      if (a.scene.focus.id === n.id) a.setFocus({ kind: 'body', id: n.parent });
      a.changed();
    };
    for (const r of document.querySelectorAll('[data-link]')) r.onclick = (e) => { if (!e.target.closest('button')) this.selectLink(r.dataset.link); };
    for (const b of document.querySelectorAll('[data-dellink]')) b.onclick = () => {
      a.links = a.links.filter((l) => l.id !== b.dataset.dellink);
      if (this.selectedLink === b.dataset.dellink) this.selectLink(a.links[0]?.id || null);
      a.changed();
    };

    // focus dropdown + link form selects
    const f = $('#focus'), cur = f.value;
    f.innerHTML = `<optgroup label="Bodies">${['Earth', 'Moon', 'Mars', 'Sun'].map((b) => `<option value="body:${b}">${b}</option>`).join('')}</optgroup>
      <optgroup label="Satellites">${sats.map((n) => `<option value="node:${n.id}">${esc(n.name)}</option>`).join('')}</optgroup>
      <optgroup label="Ground stations">${gs.map((n) => `<option value="node:${n.id}">${esc(n.name)}</option>`).join('')}</optgroup>`;
    f.value = cur || 'body:Earth'; if (!f.value) f.value = 'body:Earth';
    const opts = a.nodes.map((n) => `<option value="${n.id}">${esc(n.name)} (${n.type === 'ground' ? 'ground' : n.parent})</option>`).join('');
    $('#ln-from').innerHTML = opts; $('#ln-to').innerHTML = opts;
    if (a.nodes[1]) $('#ln-to').value = a.nodes[1].id;
  }

  selectNode(id) {
    this.selectedNode = id; this.app.scene.selectedNode = id;
    document.querySelectorAll('[data-node]').forEach((r) => r.classList.toggle('sel', r.dataset.node === id));
    const link = this.app.links.find((l) => l.from === id || l.to === id);
    if (link) this.selectLink(link.id);
  }

  selectLink(id) {
    this.selectedLink = id; this.app.scene.selectedLink = id;
    document.querySelectorAll('[data-link]').forEach((r) => r.classList.toggle('sel', r.dataset.link === id));
    $('#exp-out').textContent = 'Run a Bell test or an E91 key exchange on this link.';
    this.tick();
  }

  // ======================================================== add forms
  _buildAddForms() {
    const a = this.app;
    const op = $('#sat-preset');
    op.innerHTML = Object.keys(ORBIT_PRESETS).map((k) => `<option>${k}</option>`).join('') + '<option>Custom</option>';
    const applyPreset = () => {
      const p = ORBIT_PRESETS[op.value]; if (!p) return;
      $('#sat-parent').value = p.parent; $('#sat-alt').value = p.alt; $('#sat-inc').value = p.inc;
      $('#sat-geolon').value = p.geoLon ?? '';
    };
    op.onchange = applyPreset; applyPreset();
    $('#sat-color').value = PALETTE[a.nodes.length % PALETTE.length];
    $('#form-sat').onsubmit = (e) => {
      e.preventDefault();
      const num = (id) => parseFloat($(id).value);
      const geo = $('#sat-geolon').value.trim();
      const n = {
        id: uid('sat'), type: 'sat', name: $('#sat-name').value.trim() || `QS-${a.nodes.length + 1}`,
        parent: $('#sat-parent').value, alt: num('#sat-alt'), inc: num('#sat-inc'), raan: num('#sat-raan'),
        phase: num('#sat-phase'), epoch: a.simTime.getTime() / 1000, tx: num('#sat-tx'), rx: num('#sat-rx'),
        pairRate: num('#sat-rate') * 1e6, color: $('#sat-color').value,
      };
      if (geo !== '') n.geoLon = parseFloat(geo);
      if (!(n.alt > 0) || !(n.tx > 0) || !(n.rx > 0)) return this.toast('Please enter a positive altitude and apertures', true);
      a.nodes.push(n); a.changed();
      $('#sat-name').value = ''; $('#sat-color').value = PALETTE[a.nodes.length % PALETTE.length];
      this.toast(`${n.name} launched into ${n.parent} orbit`);
      a.setFocus({ kind: 'node', id: n.id });
    };

    const gp = $('#gs-preset');
    gp.innerHTML = Object.keys(GROUND_PRESETS).map((k) => `<option>${k}</option>`).join('') + '<option>Custom</option>';
    const applyGs = () => {
      const p = GROUND_PRESETS[gp.value]; if (!p) return;
      $('#gs-lat').value = p[0]; $('#gs-lon').value = p[1]; $('#gs-altkm').value = p[2];
      $('#gs-name').placeholder = gp.value.split(',')[0] + ' OGS';
    };
    gp.onchange = applyGs; applyGs();
    $('#form-gs').onsubmit = (e) => {
      e.preventDefault();
      const num = (id) => parseFloat($(id).value);
      const n = {
        id: uid('gs'), type: 'ground', name: $('#gs-name').value.trim() || $('#gs-name').placeholder,
        parent: 'Earth', lat: num('#gs-lat'), lon: num('#gs-lon'), altKm: num('#gs-altkm') || 0,
        tx: num('#gs-tx'), rx: num('#gs-rx'), pairRate: 1e8, color: $('#gs-color').value,
      };
      if (Math.abs(n.lat) > 90 || Math.abs(n.lon) > 180) return this.toast('Latitude must be ±90°, longitude ±180°', true);
      a.nodes.push(n); a.changed(); $('#gs-name').value = '';
      this.toast(`${n.name} built`); a.setFocus({ kind: 'node', id: n.id });
    };

    $('#form-link').onsubmit = (e) => {
      e.preventDefault();
      const from = $('#ln-from').value, to = $('#ln-to').value;
      if (from === to) return this.toast('Pick two different nodes', true);
      if (a.links.some((l) => l.from === from && l.to === to)) return this.toast('That link already exists', true);
      const l = { id: uid('link'), from, to };
      a.links.push(l); a.changed(); this.selectLink(l.id);
      this.toast('Quantum link created');
    };
  }

  // ======================================================== physics sliders
  _buildPhysics() {
    const box = $('#physics-sliders');
    box.innerHTML = PHYS_SLIDERS.map(([k, label, min, max, step, , log]) => `
      <label class="slider"><span>${label}</span><b id="pv-${k}"></b>
        <input type="range" id="ps-${k}" min="${log ? Math.log10(min) : min}" max="${log ? Math.log10(max) : max}"
          step="${log ? 0.01 : step}"></label>`).join('');
    const sync = () => {
      for (const [k, , , , , fmt, log] of PHYS_SLIDERS) {
        const v = this.app.params[k];
        $(`#ps-${k}`).value = log ? Math.log10(v) : v; $(`#pv-${k}`).textContent = fmt(v);
      }
    };
    for (const [k, , , , , fmt, log] of PHYS_SLIDERS) $(`#ps-${k}`).oninput = (e) => {
      const v = log ? 10 ** parseFloat(e.target.value) : parseFloat(e.target.value);
      this.app.params[k] = v; $(`#pv-${k}`).textContent = fmt(v);
    };
    $('#btn-phys-reset').onclick = () => { this.app.params = { ...PH.DEFAULT_PARAMS }; sync(); };
    this._syncPhysics = sync; sync();
  }

  // ======================================================== telemetry
  _buildTelemetry() {
    $('#btn-bell').onclick = () => this.runBell();
    $('#btn-e91').onclick = () => this.runE91();
    this.chart = $('#chart'); this.ctx = this.chart.getContext('2d');
  }

  tick() {
    const a = this.app;
    const d = a.simTime;
    $('#clock').textContent = d.toISOString().replace('T', '  ').slice(0, 21) + ' UTC';
    for (const l of a.links) {
      const t = a.telemetry[l.id]; if (!t) continue;
      const dot = document.querySelector(`[data-status-dot="${l.id}"]`);
      if (dot) dot.style.background = STATUS_COLOR[t.status];
      const sub = document.querySelector(`[data-link-sub="${l.id}"]`);
      if (sub) sub.textContent = `${fmtDist(t.distance_km)} · S ${t.S.toFixed(2)} · ${PH.STATUS_TEXT[t.status].toLowerCase()}`;
    }
    const t = a.telemetry[this.selectedLink];
    const panel = $('#telemetry');
    if (!t) { panel.classList.add('none'); return; }
    panel.classList.remove('none');
    $('#tl-name').textContent = t.name;
    const pill = $('#tl-status');
    pill.textContent = PH.STATUS_TEXT[t.status]; pill.style.setProperty('--c', STATUS_COLOR[t.status]);
    $('#tl-S').textContent = t.S.toFixed(3);
    $('#tl-S').style.color = STATUS_COLOR[t.status];
    $('#gauge-fill').style.width = `${Math.min(100, (t.S / (2 * Math.SQRT2)) * 100)}%`;
    $('#gauge-fill').style.background = STATUS_COLOR[t.status];
    const rows = [
      ['Distance', fmtDist(t.distance_km)],
      ['Light travel time', fmtTime(t.light_time_s)],
      ['Channel', t.channel],
      ['Line of sight', t.los ? 'clear' : `blocked by ${t.blocked_by}`, !t.los],
      ...(t.elevation_deg !== null ? [['Ground elevation', `${t.elevation_deg.toFixed(1)}°`]] : []),
      ['Sun angle at receiver', `${t.sun_angle_deg.toFixed(1)}°`, t.sun_blinded],
      ['Background', `${fmtSI(t.background_cps)} /s · ${t.background_source}`],
      ['Beam radius at receiver', t.beam_radius_m >= 1000 ? `${(t.beam_radius_m / 1000).toFixed(2)} km` : `${t.beam_radius_m.toFixed(1)} m`],
      ['Total link loss', isFinite(t.loss_db) ? `${t.loss_db.toFixed(1)} dB` : '—'],
      ['Entangled pairs', fmtRate(t.pairs_per_s)],
      ['False coincidences', `${fmtSI(t.false_pairs_per_s)} /s`],
      ['Good-pair fraction p', t.p.toFixed(4)],
      ['Fidelity to |Φ⁺⟩', t.fidelity.toFixed(4)],
      ['QBER', `${(t.qber * 100).toFixed(2)} %`, t.qber >= 0.11],
      ['Sifted key rate', `${fmtSI(t.sifted_key_bps)} bit/s`],
      ['Secure key rate', `${fmtSI(t.secure_key_bps)} bit/s`],
      ['Radial velocity', `${t.radial_velocity_kms >= 0 ? '+' : ''}${t.radial_velocity_kms.toFixed(3)} km/s`],
      ['Doppler shift', `${t.doppler_ghz >= 0 ? '+' : ''}${t.doppler_ghz.toFixed(3)} GHz`],
      ['Clock drift (Doppler)', `${t.timing_drift_ns_per_s.toFixed(1)} ns/s`],
    ];
    $('#tl-rows').innerHTML = rows.map(([k, v, bad]) => `<div class="k">${k}</div><div class="v${bad ? ' bad' : ''}">${esc(v)}</div>`).join('');
    this._drawChart(a.history[this.selectedLink] || []);
  }

  _drawChart(h) {
    const c = this.chart, ctx = this.ctx, dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth, H = c.clientHeight;
    if (c.width !== W * dpr) { c.width = W * dpr; c.height = H * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const pad = { l: 28, r: 8, t: 8, b: 16 };
    const y = (S) => pad.t + (H - pad.t - pad.b) * (1 - S / 3);
    ctx.font = '10px var(--mono)'; ctx.fillStyle = 'rgba(180,200,230,0.6)';
    for (const [S, col, lab] of [[2, 'rgba(255,93,108,0.7)', '2.00'], [2 * Math.SQRT2, 'rgba(93,255,155,0.6)', '2.83'], [1, 'rgba(255,255,255,0.08)', '1'], [0, 'rgba(255,255,255,0.08)', '0']]) {
      ctx.strokeStyle = col; ctx.setLineDash(S === 2 || S > 2.5 ? [4, 4] : []);
      ctx.beginPath(); ctx.moveTo(pad.l, y(S)); ctx.lineTo(W - pad.r, y(S)); ctx.stroke();
      ctx.fillText(lab, 2, y(S) + 3);
    }
    ctx.setLineDash([]);
    if (h.length < 2) return;
    const x = (i) => pad.l + ((W - pad.l - pad.r) * i) / (h.length - 1);
    const grd = ctx.createLinearGradient(0, pad.t, 0, H);
    grd.addColorStop(0, 'rgba(79,209,255,0.35)'); grd.addColorStop(1, 'rgba(79,209,255,0)');
    ctx.beginPath(); ctx.moveTo(x(0), y(0));
    h.forEach((p, i) => ctx.lineTo(x(i), y(p.S)));
    ctx.lineTo(x(h.length - 1), y(0)); ctx.fillStyle = grd; ctx.fill();
    ctx.beginPath(); h.forEach((p, i) => (i ? ctx.lineTo(x(i), y(p.S)) : ctx.moveTo(x(i), y(p.S))));
    ctx.strokeStyle = '#4fd1ff'; ctx.lineWidth = 1.6; ctx.stroke();
    const span = (h[h.length - 1].t - h[0].t) / 1000;
    ctx.fillStyle = 'rgba(180,200,230,0.6)';
    ctx.fillText(`last ${fmtTime(Math.abs(span))} of mission time`, pad.l + 4, H - 3);
  }

  // ======================================================== experiments
  async runBell() {
    const t = this.app.telemetry[this.selectedLink]; if (!t) return;
    const out = $('#exp-out');
    if (t.status === 'blocked') { out.textContent = `No photons arrive: the line of sight is blocked by ${t.blocked_by}.`; return; }
    const shots = Math.round(Math.max(50, Math.min(20000, t.pairs_per_s + t.false_pairs_per_s)));
    out.textContent = 'Running CHSH Bell test…';
    let r;
    try {
      r = this.backend ? await api('/api/bell', { p: t.p, shots }) : localBell(t.p, shots);
    } catch (err) { out.textContent = 'Backend error: ' + err.message; return; }
    const lines = [
      `CHSH Bell test on ${t.name}${this.backend ? ' (Qiskit Aer)' : ' (built-in simulator)'}`,
      `${shots.toLocaleString()} measured pairs per angle setting  ≈  1 s of real link time`, '',
      ...r.rows.map((x) => `  E(${x.a.padEnd(2)}, ${x.b.padEnd(2)}) = ${x.E >= 0 ? '+' : ''}${x.E.toFixed(3)}   ${fmtCounts(x.counts)}`),
      '', `  S = ${r.S.toFixed(3)}   (model ${t.S.toFixed(3)}, classical limit 2, quantum max 2.828)`,
      `  ${r.S > 2 ? '✔ S > 2: entanglement between the satellites is CONFIRMED' : '✘ S ≤ 2: entanglement cannot be proven on this link right now'}`,
    ];
    out.textContent = lines.join('\n');
  }

  async runE91() {
    const t = this.app.telemetry[this.selectedLink]; if (!t) return;
    const out = $('#exp-out');
    if (t.status === 'blocked') { out.textContent = `No photons arrive: the line of sight is blocked by ${t.blocked_by}.`; return; }
    const pairs = parseInt($('#e91-pairs').value, 10) || 4000, eve = parseFloat($('#e91-eve').value) || 0;
    out.textContent = `Running E91 with ${pairs.toLocaleString()} pairs${eve ? `, eavesdropper on ${Math.round(eve * 100)} % of photons` : ''}…`;
    try {
      await new Promise((res) => setTimeout(res, 30));
      const r = this.backend ? await api('/api/e91', { p: t.p, pairs, eve }) : localE91(t.p, pairs, eve);
      const secs = t.pairs_per_s + t.false_pairs_per_s > 0 ? pairs / (t.pairs_per_s + t.false_pairs_per_s) : Infinity;
      out.textContent = [
        `E91 entanglement-based key exchange on ${t.name} (${this.backend ? 'Qiskit Aer' : 'built-in quantum simulator'})`,
        `${pairs.toLocaleString()} pairs ≈ ${isFinite(secs) ? fmtTime(secs) : '∞'} of link time${eve ? ` · Eve intercepts ${Math.round(eve * 100)} %` : ''}`, '',
        `  Basis choices      Alice {0°, 45°, 90°}  ·  Bob {45°, 90°, 135°}  (Bloch angles)`,
        `  CHSH pairs         ${r.n_chsh}   →  S = ${r.S.toFixed(3)}`,
        `  Key pairs (sifted) ${r.n_sift}   →  QBER = ${(r.qber * 100).toFixed(2)} %`,
        `  Discarded          ${r.n_discard}`,
        `  Error correction   leaks ≈ ${r.leak_bits} bits  ·  privacy amplification (Toeplitz hash)`,
        '', r.secure ? `  ✔ SECURE: ${r.final_bits} secret bits shared` : `  ✘ ABORT: ${r.reason}`,
        ...(r.secure ? [`  Alice key  ${r.key_alice}`, `  Bob key    ${r.key_bob}`, `  Keys match: ${r.key_alice === r.key_bob ? 'YES' : 'NO'}`] : []),
      ].join('\n');
    } catch (err) { out.textContent = 'Backend error: ' + err.message; }
  }

  // ======================================================== code lab
  _buildLab() {
    const ed = $('#code');
    ed.value = DEFAULT_CODE;
    ed.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') { e.preventDefault(); const s = ed.selectionStart; ed.setRangeText('    ', s, ed.selectionEnd, 'end'); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.runCode(); }
    });
    $('#btn-run').onclick = () => this.runCode();
    $('#btn-lab-close').onclick = () => {
      document.body.classList.remove('lab-open');
      document.querySelectorAll('#mnav button').forEach((x) => x.classList.toggle('on', x.dataset.m === 'view'));
    };
  }

  async runCode() {
    const out = $('#lab-out');
    if (!this.backend) {
      out.textContent = 'The Code Lab runs real Qiskit code, which needs Python on your own computer.\n\n' +
        'Download the desktop version from the GitHub repository and start it with:\n\n    python app.py\n\n' +
        'Everything else (3D view, link physics, Bell test, E91) works right here in the browser.';
      return;
    }
    const t = this.app.telemetry[this.selectedLink];
    out.textContent = 'Running…'; $('#lab-status').textContent = 'running';
    const t0 = performance.now();
    try {
      const r = await api('/api/run', { code: $('#code').value, link: t || {} });
      out.textContent = (r.stdout || '') + (r.stderr ? `\n${r.stderr}` : '') || '(no output)';
      out.classList.toggle('err', !!r.stderr && !r.ok);
      $('#lab-status').textContent = `${r.ok ? 'done' : 'error'} in ${((performance.now() - t0) / 1000).toFixed(1)} s`;
    } catch (err) { out.textContent = 'Backend error: ' + err.message; $('#lab-status').textContent = 'error'; }
  }

  // ======================================================== backend & storage
  async _checkBackend() {
    try {
      this.backend = await api('/api/status');
      $('#backend').innerHTML = `<span class="dot" style="background:#5dff9b"></span>Qiskit ${esc(this.backend.qiskit)}`;
    } catch {
      this.backend = null;
      $('#backend').innerHTML = `<span class="dot" style="background:#4fd1ff"></span>Web version`;
      $('#backend').title = 'Bell test and E91 use the built-in simulator. The desktop version (python app.py) adds Qiskit and the Code Lab.';
    }
  }

  async loadScenario() {
    try { const r = await api('/api/scenario'); if (r && r.nodes) return r; } catch { /* no backend */ }
    try { const s = localStorage.getItem('qsl-scenario'); if (s) return JSON.parse(s); } catch { /* storage blocked */ }
    return null;
  }

  async saveScenario() {
    const sc = this.app.scenario();
    try { await api('/api/scenario', sc); this.toast('Scenario saved to scenarios/current.json'); return; } catch { /* fall through */ }
    try { localStorage.setItem('qsl-scenario', JSON.stringify(sc)); this.toast('Scenario saved in this browser'); }
    catch { this.toast('Could not save. Use Export instead.', true); }
  }

  toast(msg, bad = false) {
    const t = $('#toast'); t.textContent = msg; t.classList.toggle('bad', bad); t.classList.add('show');
    clearTimeout(this._tt); this._tt = setTimeout(() => t.classList.remove('show'), 2600);
  }
}

function fmtCounts(c) {
  return ['00', '01', '10', '11'].map((k) => `${k}:${String(c[k] || 0).padStart(5)}`).join('  ');
}

// Simple local CHSH simulation for browser mode (Werner state statistics)
function localBell(p, shots) {
  const ang = { a: 0, "a'": Math.PI / 2, b: Math.PI / 4, "b'": -Math.PI / 4 };
  const rows = [['a', 'b'], ['a', "b'"], ["a'", 'b'], ["a'", "b'"]].map(([x, y]) => {
    const pSame = (1 + p * Math.cos(ang[x] - ang[y])) / 2, counts = { '00': 0, '01': 0, '10': 0, '11': 0 };
    for (let i = 0; i < shots; i++) {
      const same = Math.random() < pSame, bitA = Math.random() < 0.5 ? 0 : 1, bitB = same ? bitA : 1 - bitA;
      counts[`${bitB}${bitA}`]++;
    }
    const E = (counts['00'] + counts['11'] - counts['01'] - counts['10']) / shots;
    return { a: x, b: y, counts, E };
  });
  return { rows, S: rows[0].E + rows[1].E + rows[2].E - rows[3].E };
}

// ---------------------------------------------------------------------------
// Browser-mode E91 (same protocol as quantum_backend.run_e91).
// Werner state: Alice's result is random; Eve (if present) agrees with Alice
// with probability (1 + p cos(da)) / 2 and resends a pure state; Bob agrees
// with the photon he receives with probability (1 + c cos(db)) / 2.
// ---------------------------------------------------------------------------
const binH2 = (x) => (x <= 0 || x >= 1) ? 0 : -x * Math.log2(x) - (1 - x) * Math.log2(1 - x);

function localE91(p, pairs, eve) {
  pairs = Math.max(200, Math.min(50000, pairs | 0));
  const A = [0, Math.PI / 4, Math.PI / 2], B = [Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4], E = [0, Math.PI / 2];
  const ai = new Uint8Array(pairs), bi = new Uint8Array(pairs), ra = new Uint8Array(pairs), rb = new Uint8Array(pairs);
  for (let i = 0; i < pairs; i++) {
    ai[i] = (Math.random() * 3) | 0; bi[i] = (Math.random() * 3) | 0;
    const a = Math.random() < 0.5 ? 1 : 0;
    let bit = a, ang = A[ai[i]], corr = p;
    if (Math.random() < eve) {                      // intercept-resend
      const th = E[(Math.random() * 2) | 0];
      bit = Math.random() < (1 + corr * Math.cos(ang - th)) / 2 ? bit : 1 - bit;
      ang = th; corr = 1;
    }
    const b = Math.random() < (1 + corr * Math.cos(ang - B[bi[i]])) / 2 ? bit : 1 - bit;
    ra[i] = a; rb[i] = b;
  }
  const Ecorr = (x, y) => {
    let n = 0, s = 0;
    for (let i = 0; i < pairs; i++) if (ai[i] === x && bi[i] === y) { n++; s += ra[i] === rb[i] ? 1 : -1; }
    return n ? s / n : 0;
  };
  const S = Ecorr(0, 0) - Ecorr(0, 2) + Ecorr(2, 0) + Ecorr(2, 2);
  let nChsh = 0; const ka = [], kb = [];
  for (let i = 0; i < pairs; i++) {
    if (Math.abs(A[ai[i]] - B[bi[i]]) < 1e-9) { ka.push(ra[i]); kb.push(rb[i]); }
    else if ((ai[i] === 0 || ai[i] === 2) && (bi[i] === 0 || bi[i] === 2)) nChsh++;
  }
  const nSift = ka.length;
  let errs = 0, nSample = 0; const keyA = [];
  for (let i = 0; i < nSift; i++) {
    if (Math.random() < 0.2) { nSample++; if (ka[i] !== kb[i]) errs++; } else keyA.push(ka[i]);
  }
  const qber = nSample ? errs / nSample : 0, nRaw = keyA.length;
  const leak = Math.ceil(1.16 * binH2(qber) * nRaw);
  const finalLen = Math.floor(nRaw * (1 - binH2(qber)) - leak);
  const out = { S, qber, n_pairs: pairs, n_sift: nSift, n_chsh: nChsh, n_discard: pairs - nSift - nChsh,
    leak_bits: leak, final_bits: Math.max(finalLen, 0) };
  if (Math.abs(S) <= 2) return { ...out, secure: false, reason: `|S| = ${Math.abs(S).toFixed(3)} <= 2: no proof of entanglement (noise or eavesdropper).` };
  if (qber >= 0.11 || finalLen <= 0) return { ...out, secure: false, reason: `QBER ${(qber * 100).toFixed(1)} % is too high: no secret key can be extracted.` };
  // error correction (ideal, cost counted in leak) + Toeplitz privacy amplification
  const n = keyA.length, diag = Array.from({ length: n + finalLen - 1 }, () => (Math.random() < 0.5 ? 1 : 0));
  const fin = [];
  for (let r = 0; r < finalLen; r++) { let v = 0; for (let c = 0; c < n; c++) v ^= diag[r - c + n - 1] & keyA[c]; fin.push(v); }
  let hex = '';
  for (let i = 0; i < Math.min(fin.length, 128); i += 4) hex += parseInt(fin.slice(i, i + 4).join('').padEnd(4, '0'), 2).toString(16);
  if (finalLen > 128) hex += '…';
  return { ...out, secure: true, key_alice: hex, key_bob: hex };
}
