// =============================================================================
// physics.js  -  ephemeris, orbits, line of sight and the quantum link model
// All positions are TRUE heliocentric J2000-equatorial (EQJ) coordinates in km.
// =============================================================================

export const C_KMS = 299792.458;          // speed of light, km/s
export const AU_KM = 149597870.7;         // astronomical unit, km
const J2000_UNIX = 946727935.816;         // 2000-01-01 12:00 TT in Unix seconds
const DEG = Math.PI / 180;

// Radius (km), GM (km^3/s^2), atmosphere height that blocks a beam (km),
// IAU rotation model: pole RA/Dec (deg), prime meridian W = w0 + w1 * days
export const BODIES = {
  Sun:   { radius: 695700, gm: 132712440018, atmo: 0 },
  Earth: { radius: 6371.0, gm: 398600.4418, atmo: 100, pole: [0, 90],            w: [190.147, 360.9856235] },
  Moon:  { radius: 1737.4, gm: 4902.800,    atmo: 0,   pole: [269.9949, 66.5392], w: [38.3213, 13.17635815] },
  Mars:  { radius: 3389.5, gm: 42828.37,    atmo: 30,  pole: [317.681, 52.887],   w: [176.630, 350.89198226] },
};
export const ORBITABLE = ['Earth', 'Moon', 'Mars'];

// ---------- small vector helpers ----------
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.sqrt(dot(a, a));
export const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export const unixSec = (date) => date.getTime() / 1000;
export const daysSinceJ2000 = (date) => (unixSec(date) - J2000_UNIX) / 86400;

// ---------- planetary ephemeris (astronomy-engine, VSOP87 / ELP) ----------
export function bodyPositions(date) {
  const A = window.Astronomy;
  const toKm = (v) => [v.x * AU_KM, v.y * AU_KM, v.z * AU_KM];
  const earth = toKm(A.HelioVector(A.Body.Earth, date));
  const moon = add(earth, toKm(A.GeoMoon(date)));
  const mars = toKm(A.HelioVector(A.Body.Mars, date));
  return { Sun: [0, 0, 0], Earth: earth, Moon: moon, Mars: mars };
}

// Body-fixed frame (pole, prime meridian, east) in EQJ, from the IAU rotation model
export function bodyFrame(name, date) {
  const b = BODIES[name];
  const d = daysSinceJ2000(date);
  const ra = b.pole[0] * DEG, dec = b.pole[1] * DEG;
  const pole = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
  const node = [Math.cos(ra + Math.PI / 2), Math.sin(ra + Math.PI / 2), 0];
  const q = cross(pole, node);
  const W = ((b.w[0] + b.w[1] * d) % 360) * DEG;
  const pm = add(mul(node, Math.cos(W)), mul(q, Math.sin(W)));
  const east = cross(pole, pm);
  return { pole, pm, east };
}

// ---------- satellite orbits (circular Keplerian) ----------
export function orbitPeriod(node) {
  const b = BODIES[node.parent];
  const r = b.radius + node.alt;
  return 2 * Math.PI * Math.sqrt(r ** 3 / b.gm);
}

// Offset of a node from its parent body's centre (km, EQJ)
export function nodeOffset(node, date, frames) {
  const b = BODIES[node.parent];
  const f = frames[node.parent];
  if (node.type === 'ground') {
    const lat = node.lat * DEG, lon = node.lon * DEG;
    const r = b.radius + (node.altKm || 0);
    const horiz = add(mul(f.pm, Math.cos(lon)), mul(f.east, Math.sin(lon)));
    return mul(add(mul(horiz, Math.cos(lat)), mul(f.pole, Math.sin(lat))), r);
  }
  const r = b.radius + node.alt;
  if (node.geoLon !== undefined && node.geoLon !== null && node.geoLon !== '') {
    // stationary above a fixed longitude (geostationary / areostationary)
    const lon = node.geoLon * DEG;
    return mul(add(mul(f.pm, Math.cos(lon)), mul(f.east, Math.sin(lon))), r);
  }
  const n = Math.sqrt(b.gm / r ** 3);
  const t = unixSec(date) - (node.epoch ?? J2000_UNIX);
  const u = node.phase * DEG + n * t;
  const i = node.inc * DEG, O = node.raan * DEG;
  const cu = Math.cos(u), su = Math.sin(u), ci = Math.cos(i), si = Math.sin(i), cO = Math.cos(O), sO = Math.sin(O);
  return [r * (cO * cu - sO * su * ci), r * (sO * cu + cO * su * ci), r * su * si];
}

// Points of one full orbit relative to the parent (km), for drawing
export function orbitPath(node, date, frames, n = 256) {
  if (node.type === 'ground') return [];
  if (node.geoLon !== undefined && node.geoLon !== null && node.geoLon !== '') {
    const r = BODIES[node.parent].radius + node.alt, f = frames[node.parent];
    const pts = [];
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * 2 * Math.PI;
      const c = Math.cos(a), s = Math.sin(a);
      pts.push(add(mul(f.pm, r * c), mul(f.east, r * s)));
    }
    return pts;
  }
  const T = orbitPeriod(node), pts = [];
  for (let k = 0; k <= n; k++) pts.push(nodeOffset(node, new Date(date.getTime() + (k / n) * T * 1000), frames));
  return pts;
}

// Full world state (true km) for a date
export function worldState(date, nodes) {
  const bodies = bodyPositions(date);
  const frames = { Earth: bodyFrame('Earth', date), Moon: bodyFrame('Moon', date), Mars: bodyFrame('Mars', date) };
  const pos = {};
  for (const n of nodes) pos[n.id] = add(bodies[n.parent], nodeOffset(n, date, frames));
  return { date, bodies, frames, pos };
}

// ---------- geometry ----------
function segmentHitsSphere(p, q, c, r) {
  const d = sub(q, p), dd = dot(d, d);
  let t = dd > 0 ? dot(sub(c, p), d) / dd : 0;
  t = Math.max(0, Math.min(1, t));
  return len(sub(add(p, mul(d, t)), c)) < r;
}

// first intersection distance of a ray with a sphere (or null)
function rayHitsSphere(o, dir, c, r) {
  const oc = sub(o, c), b = dot(oc, dir), cc = dot(oc, oc) - r * r, h = b * b - cc;
  if (h < 0) return null;
  const t = -b - Math.sqrt(h);
  return t > 0 ? t : null;
}

// Is a point (km) in the shadow of any body? (simple cylinder-free sphere test)
export function inShadow(point, state, liftFrom = null) {
  let p = point;
  if (liftFrom) p = add(p, mul(norm(sub(p, state.bodies[liftFrom])), 0.5));
  for (const name of ['Earth', 'Moon', 'Mars']) {
    if (segmentHitsSphere(p, state.bodies.Sun, state.bodies[name], BODIES[name].radius)) return name;
  }
  return null;
}

const binH = (x) => (x <= 0 || x >= 1) ? 0 : -x * Math.log2(x) - (1 - x) * Math.log2(1 - x);

// ---------- default global hardware / environment parameters ----------
export const DEFAULT_PARAMS = {
  wavelength_nm: 810,     // SPDC photon wavelength
  detEff: 0.60,           // single-photon detector efficiency
  opticsEff: 0.80,        // telescope + analyser transmission
  darkCounts: 500,        // dark counts per detector per second
  coincWindow_ns: 1.0,    // coincidence window
  visibility: 0.98,       // source entanglement visibility
  jitter_urad: 1.0,       // pointing jitter (rms)
  spaceBackground: 100,   // stray-light counts/s for a space receiver
  atmZenith: 0.80,        // clear-sky transmission at zenith
  minElevation: 15,       // ground telescopes cannot track below this
  sunExclusion: 3,        // receiver blinded if Sun is within this angle (deg)
};

// ---------- the quantum link model ----------
// link = { id, from, to }  (from = node carrying the entangled-photon source)
export function computeLink(link, nodesById, state, stateNext, P) {
  const A = nodesById[link.from], B = nodesById[link.to];
  const out = { id: link.id, name: `${A.name} → ${B.name}`, from: A.name, to: B.name };
  const pA = state.pos[A.id], pB = state.pos[B.id];
  const dVec = sub(pB, pA), d = len(dVec);
  const dNext = len(sub(stateNext.pos[B.id], stateNext.pos[A.id]));
  out.distance_km = d;
  out.light_time_s = d / C_KMS;
  out.radial_velocity_kms = (dNext - d) / 1.0;
  const lam = P.wavelength_nm * 1e-9;
  out.doppler_ppm = out.radial_velocity_kms / C_KMS * 1e6;          // timing drift ns per ms
  out.doppler_ghz = (out.radial_velocity_kms * 1e3) / lam / 1e9;
  out.timing_drift_ns_per_s = out.radial_velocity_kms / C_KMS * 1e9;

  // --- line of sight ---
  let blockedBy = null;
  const groundEnds = [A, B].filter((n) => n.type === 'ground');
  out.elevation_deg = null;
  for (const g of groundEnds) {
    const gp = state.pos[g.id], other = g === A ? pB : pA;
    const up = norm(sub(gp, state.bodies[g.parent]));
    const el = Math.asin(dot(up, norm(sub(other, gp)))) / DEG;
    out.elevation_deg = el;
    if (el < P.minElevation) blockedBy = `${g.parent} horizon`;
  }
  if (!blockedBy) {
    for (const name of ['Earth', 'Moon', 'Mars', 'Sun']) {
      const isGroundBody = groundEnds.some((g) => g.parent === name);
      const R = BODIES[name].radius + (isGroundBody ? 0 : BODIES[name].atmo);
      if (isGroundBody) {
        // nudge ground endpoints upward so the station's own surface doesn't count
        const lift = (n, p) => n.type === 'ground' && n.parent === name ? add(p, mul(norm(sub(p, state.bodies[name])), 1)) : p;
        if (segmentHitsSphere(lift(A, pA), lift(B, pB), state.bodies[name], R)) { blockedBy = name; break; }
      } else if (segmentHitsSphere(pA, pB, state.bodies[name], R)) { blockedBy = name; break; }
    }
  }
  out.los = !blockedBy;
  out.blocked_by = blockedBy;

  // --- background light seen by the receiver B ---
  const look = norm(sub(pA, pB));                          // B looks toward A
  const toSun = norm(sub(state.bodies.Sun, pB));
  out.sun_angle_deg = Math.acos(Math.max(-1, Math.min(1, dot(look, toSun)))) / DEG;
  const rxArea = (B.rx / 0.3) ** 2;
  let bg = P.spaceBackground * rxArea;
  out.background_source = 'deep space';
  if (B.type === 'ground') {
    const up = norm(sub(pB, state.bodies[B.parent]));
    const sunEl = Math.asin(dot(up, toSun)) / DEG;
    if (sunEl > -6) { bg = 2e6 * rxArea; out.background_source = 'daylight sky'; }
    else { bg = 2e3 * rxArea; out.background_source = 'night sky'; }
  } else {
    // planet-shine: is a sunlit planet right behind the transmitter?
    for (const [name, glow] of [['Earth', 2e5], ['Moon', 2e4], ['Mars', 5e4]]) {
      const t = rayHitsSphere(pB, look, state.bodies[name], BODIES[name].radius);
      if (t !== null && t > d) {
        const hit = add(pB, mul(look, t));
        if (dot(norm(sub(hit, state.bodies[name])), norm(sub(state.bodies.Sun, hit))) > 0) {
          bg += glow * rxArea; out.background_source = `sunlit ${name} behind source`;
        }
        break;
      }
    }
  }
  out.sun_blinded = out.sun_angle_deg < P.sunExclusion;
  if (out.sun_blinded) { bg += 1e9; out.background_source = 'Sun in field of view'; }
  out.background_cps = bg;

  // --- photon budget ---
  const L = d * 1e3, w0 = A.tx / 2;
  const theta = lam / (Math.PI * w0);
  const w = Math.sqrt(w0 * w0 + (theta * L) ** 2);
  const a = B.rx / 2;
  const etaGeo = 1 - Math.exp(-2 * a * a / (w * w));
  const sig = P.jitter_urad * 1e-6;
  const etaPoint = (w * w) / (w * w + 4 * (sig * L) ** 2);
  let etaAtm = 1;
  out.channel = 'vacuum';
  if (groundEnds.length && out.elevation_deg !== null) {
    const el = Math.max(out.elevation_deg, 1) * DEG;
    const airmass = 1 / Math.sin(el);
    etaAtm = P.atmZenith ** airmass;
    if (B.type === 'ground') { etaAtm *= 0.5; out.channel = 'downlink (atmosphere + turbulence)'; }
    else { etaAtm *= 0.05; out.channel = 'uplink (atmosphere + beam wander)'; }
  }
  const etaDet = P.detEff * P.opticsEff;
  const etaLink = out.los ? etaGeo * etaPoint * etaAtm * etaDet : 0;
  out.beam_radius_m = w;
  out.eta_geo = etaGeo; out.eta_point = etaPoint; out.eta_atm = etaAtm;
  out.eta_link = etaLink;
  out.loss_db = etaLink > 0 ? -10 * Math.log10(etaLink) : Infinity;

  const tau = P.coincWindow_ns * 1e-9;
  const singlesA = A.pairRate * etaDet + P.darkCounts;
  const singlesB = A.pairRate * etaLink + P.darkCounts + bg;
  const coinc = A.pairRate * etaDet * etaLink;
  const acc = out.los ? singlesA * singlesB * tau : 0;
  out.pairs_per_s = coinc;
  out.false_pairs_per_s = acc;
  const p = out.los && coinc + acc > 0 ? (coinc / (coinc + acc)) * P.visibility : 0;
  out.p = p;
  out.S = 2 * Math.SQRT2 * p;
  out.qber = out.los ? (1 - p) / 2 : 0.5;
  out.fidelity = (3 * p + 1) / 4;
  out.sifted_key_bps = out.los ? 0.5 * (coinc + acc) : 0;
  out.secure_key_bps = out.sifted_key_bps * Math.max(0, 1 - 2 * binH(out.qber));

  // --- status ---
  if (!out.los) out.status = 'blocked';
  else if (out.sun_blinded) out.status = 'blinded';
  else if (coinc < 0.01 || out.S <= 2) out.status = 'weak';
  else if (out.qber >= 0.11) out.status = 'entangled';
  else out.status = 'secure';
  return out;
}

export const STATUS_TEXT = {
  blocked: 'NO LINE OF SIGHT',
  blinded: 'SUN IN RECEIVER VIEW',
  weak: 'NO PROVABLE ENTANGLEMENT',
  entangled: 'ENTANGLED (S > 2)',
  secure: 'ENTANGLED · SECURE KEY',
};
