// =============================================================================
// models.js  -  planets, Sun, star field, satellite and ground-station 3D models
// Model dimensions are in METRES; scene.js scales them into scene units.
// =============================================================================
import * as THREE from 'three';

const loader = new THREE.TextureLoader();
function tex(path, srgb = true) {
  const t = loader.load(path);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

// ---------------------------------------------------------------------------
// Shaders (all include log-depth chunks so they work across 1 m ... 1 AU)
// ---------------------------------------------------------------------------
const PLANET_VERT = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec2 vUv; varying vec3 vN; varying vec3 vW;
  void main() {
    vUv = uv;
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
    #include <logdepthbuf_vertex>
  }`;

const PLANET_FRAG = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D map; uniform vec3 sunDir; uniform vec3 rimColor;
  uniform float rimStrength; uniform float ambient;
  #ifdef HAS_NIGHT
  uniform sampler2D nightMap;
  #endif
  #ifdef HAS_SPEC
  uniform sampler2D specMap;
  #endif
  varying vec2 vUv; varying vec3 vN; varying vec3 vW;
  void main() {
    #include <logdepthbuf_fragment>
    vec3 N = normalize(vN);
    vec3 V = normalize(cameraPosition - vW);
    float ndl = dot(N, sunDir);
    float dayMask = smoothstep(-0.10, 0.12, ndl);
    vec3 base = texture2D(map, vUv).rgb;
    vec3 col = base * (max(ndl, 0.0) * 0.95 + ambient);
    #ifdef HAS_SPEC
      vec3 H = normalize(sunDir + V);
      col += vec3(1.0, 0.92, 0.8) * pow(max(dot(N, H), 0.0), 70.0) * texture2D(specMap, vUv).r * 0.45 * dayMask;
    #endif
    #ifdef HAS_NIGHT
      vec3 lights = texture2D(nightMap, vUv).rgb;
      col += lights * vec3(1.0, 0.70, 0.40) * 1.25 * (1.0 - dayMask);
    #endif
    float rim = pow(1.0 - max(dot(N, V), 0.0), 2.5);
    col += rimColor * rim * rimStrength * smoothstep(-0.25, 0.4, ndl);
    gl_FragColor = vec4(col, 1.0);
  }`;

const CLOUD_FRAG = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D cloudMap; uniform vec3 sunDir;
  varying vec2 vUv; varying vec3 vN; varying vec3 vW;
  void main() {
    #include <logdepthbuf_fragment>
    float a = texture2D(cloudMap, vUv).r;
    float ndl = dot(normalize(vN), sunDir);
    vec3 col = vec3(0.92) * (max(ndl, 0.0) * 0.9 + 0.012);
    gl_FragColor = vec4(col, a * 0.85 * smoothstep(-0.3, 0.1, ndl) + a * 0.05);
  }`;

// Atmosphere glow from the real geometry: how close does the view ray pass to the
// planet surface? Rays grazing the limb glow; rays far above it fade out.
const ATMO_VERT = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vW; varying vec3 vC;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    vC = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
    #include <logdepthbuf_vertex>
  }`;

const ATMO_FRAG = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 color; uniform vec3 sunDir; uniform float innerR; uniform float outerR;
  uniform float power; uniform float strength;
  varying vec3 vW; varying vec3 vC;
  void main() {
    #include <logdepthbuf_fragment>
    vec3 d = vW - cameraPosition; float L = length(d); d /= L;
    float t = clamp(dot(vC - cameraPosition, d), 0.0, L);
    vec3 P = cameraPosition + d * t;
    float h = length(P - vC);
    float a = clamp((h - innerR) / (outerR - innerR), 0.0, 1.0);
    float glow = pow(1.0 - a, power);
    float sun = smoothstep(-0.3, 0.35, dot(normalize(P - vC), sunDir));
    gl_FragColor = vec4(color * glow * strength * (0.03 + 1.2 * sun), 1.0);
  }`;

function planetMaterial({ map, night, spec, rimColor = [0.3, 0.55, 1.0], rimStrength = 0, ambient = 0.012 }) {
  const defines = {};
  const uniforms = {
    map: { value: map }, sunDir: { value: new THREE.Vector3(1, 0, 0) },
    rimColor: { value: new THREE.Vector3(...rimColor) }, rimStrength: { value: rimStrength },
    ambient: { value: ambient },
  };
  if (night) { defines.HAS_NIGHT = ''; uniforms.nightMap = { value: night }; }
  if (spec) { defines.HAS_SPEC = ''; uniforms.specMap = { value: spec }; }
  return new THREE.ShaderMaterial({ vertexShader: PLANET_VERT, fragmentShader: PLANET_FRAG, uniforms, defines });
}

function atmosphere(R, scale, color, power, strength) {
  const radius = R * scale;
  const mat = new THREE.ShaderMaterial({
    vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG,
    uniforms: { color: { value: new THREE.Vector3(...color) }, sunDir: { value: new THREE.Vector3(1, 0, 0) },
      innerR: { value: R }, outerR: { value: radius }, power: { value: power }, strength: { value: strength } },
    side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 64), mat);
}

// ---------------------------------------------------------------------------
// Bodies (radius given in scene units)
// ---------------------------------------------------------------------------
export function makeEarth(R) {
  const group = new THREE.Group();
  const mat = planetMaterial({
    map: tex('earth_atmos_2048.jpg'), night: tex('earth_lights_2048.png'),
    spec: tex('earth_specular_2048.jpg', false), rimStrength: 0.55,
  });
  const surface = new THREE.Mesh(new THREE.SphereGeometry(R, 160, 100), mat);
  group.add(surface);
  const cloudMat = new THREE.ShaderMaterial({
    vertexShader: PLANET_VERT, fragmentShader: CLOUD_FRAG, transparent: true, depthWrite: false,
    uniforms: { cloudMap: { value: tex('earth_clouds_1024.png', false) }, sunDir: { value: new THREE.Vector3(1, 0, 0) } },
  });
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(R * 1.004, 128, 80), cloudMat);
  group.add(clouds);
  const atmo = atmosphere(R, 1.025, [0.28, 0.55, 1.0], 2.4, 0.85);
  group.add(atmo);
  const sunMats = [mat, cloudMat, atmo.material];
  return { group, surface, clouds, setSun: (v) => sunMats.forEach((m) => m.uniforms.sunDir.value.copy(v)) };
}

export function makeMoon(R) {
  const group = new THREE.Group();
  const mat = planetMaterial({ map: tex('moon_1024.jpg'), ambient: 0.008 });
  group.add(new THREE.Mesh(new THREE.SphereGeometry(R, 128, 80), mat));
  return { group, setSun: (v) => mat.uniforms.sunDir.value.copy(v) };
}

export function makeMars(R) {
  const group = new THREE.Group();
  const mat = planetMaterial({ map: tex('marsmap1k.jpg'), rimColor: [0.9, 0.55, 0.35], rimStrength: 0.25 });
  group.add(new THREE.Mesh(new THREE.SphereGeometry(R, 128, 80), mat));
  const atmo = atmosphere(R, 1.012, [0.95, 0.55, 0.35], 2.6, 0.45);
  group.add(atmo);
  return { group, setSun: (v) => { mat.uniforms.sunDir.value.copy(v); atmo.material.uniforms.sunDir.value.copy(v); } };
}

export function glowTexture(inner = 'rgba(255,240,210,1)', mid = 'rgba(255,170,70,0.35)') {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, inner); grd.addColorStop(0.18, mid); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeSun() {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ map: tex('sunmap.jpg'), color: new THREE.Color(2.4, 1.9, 1.3) });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 40), mat);
  group.add(sphere);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color: new THREE.Color(1.6, 1.2, 0.8), blending: THREE.AdditiveBlending,
    depthWrite: false, transparent: true,
  }));
  glow.scale.setScalar(9);
  group.add(glow);
  return { group, sphere };
}

// Star field + Milky Way band, drawn at a fixed huge radius around the camera
export function makeStars() {
  const pos = [], col = [];
  const rand = mulberry32(7);
  const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(2 * Math.PI * rand());
  const radec = (ra, dec) => { ra *= Math.PI / 180; dec *= Math.PI / 180; return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)]; };
  const zg = radec(192.85948, 27.12825);
  let xg = radec(266.405, -28.936);
  const k = zg[0] * xg[0] + zg[1] * xg[1] + zg[2] * xg[2];
  xg = [xg[0] - k * zg[0], xg[1] - k * zg[1], xg[2] - k * zg[2]];
  const xl = Math.hypot(...xg); xg = xg.map((v) => v / xl);
  const yg = [zg[1] * xg[2] - zg[2] * xg[1], zg[2] * xg[0] - zg[0] * xg[2], zg[0] * xg[1] - zg[1] * xg[0]];
  const R = 4e6;
  const push = (v, c) => { pos.push(v[0] * R, v[2] * R, -v[1] * R); col.push(...c); };
  const tint = () => { const t = rand(); return t < 0.15 ? [1.0, 0.8, 0.6] : t < 0.35 ? [0.7, 0.8, 1.0] : [1, 1, 1]; };
  for (let i = 0; i < 7000; i++) {           // field stars
    const z = rand() * 2 - 1, a = rand() * 2 * Math.PI, r = Math.sqrt(1 - z * z);
    const b = Math.min(0.88, Math.pow(rand(), 3.5) * 1.1 + 0.10);
    push([r * Math.cos(a), r * Math.sin(a), z], tint().map((c) => c * b));
  }
  for (let i = 0; i < 20000; i++) {          // Milky Way
    const l = rand() * 2 * Math.PI;
    const bulge = Math.exp(-((((l + Math.PI) % (2 * Math.PI)) - Math.PI) ** 2) / 1.2);
    const b = gauss() * (0.06 + 0.1 * bulge);
    const d = [0, 1, 2].map((j) => Math.cos(b) * Math.cos(l) * xg[j] + Math.cos(b) * Math.sin(l) * yg[j] + Math.sin(b) * zg[j]);
    const br = (0.05 + rand() * 0.16) * (0.6 + 0.8 * bulge);
    push(d, [br * 0.95, br * 0.9, br * 1.0]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.PointsMaterial({ size: 1.5, sizeAttenuation: false, vertexColors: true, depthWrite: false, transparent: true });
  const pts = new THREE.Points(g, m);
  pts.renderOrder = -10; pts.frustumCulled = false;
  return pts;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Procedural materials for spacecraft
// ---------------------------------------------------------------------------
let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  // crinkled gold multi-layer insulation foil
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d'); const r = mulberry32(3);
  g.fillStyle = '#b8862b'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 900; i++) {
    const x = r() * 512, y = r() * 512, s = 10 + r() * 60, l = 35 + r() * 35;
    g.fillStyle = `hsla(${38 + r() * 10}, ${65 + r() * 25}%, ${l}%, ${0.25 + r() * 0.35})`;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 4; k++) g.lineTo(x + (r() - 0.5) * s, y + (r() - 0.5) * s);
    g.closePath(); g.fill();
  }
  const foil = new THREE.CanvasTexture(c); foil.colorSpace = THREE.SRGBColorSpace;

  // solar cell array
  const s = document.createElement('canvas'); s.width = 1024; s.height = 384;
  const h = s.getContext('2d');
  h.fillStyle = '#c9ced8'; h.fillRect(0, 0, 1024, 384);
  const cols = 16, rows = 6, pad = 5, cw = 1024 / cols, ch = 384 / rows;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const x = i * cw + pad, y = j * ch + pad, w = cw - 2 * pad, hh = ch - 2 * pad;
    const grd = h.createLinearGradient(x, y, x + w, y + hh);
    grd.addColorStop(0, '#1d3f97'); grd.addColorStop(0.5, '#0e2463'); grd.addColorStop(1, '#162f78');
    h.fillStyle = grd; h.fillRect(x, y, w, hh);
    h.strokeStyle = 'rgba(190,200,220,0.35)'; h.lineWidth = 1;
    for (let k = 1; k < 6; k++) { h.beginPath(); h.moveTo(x + (w * k) / 6, y); h.lineTo(x + (w * k) / 6, y + hh); h.stroke(); }
  }
  const cells = new THREE.CanvasTexture(s); cells.colorSpace = THREE.SRGBColorSpace; cells.anisotropy = 8;

  SHARED = {
    gold: new THREE.MeshStandardMaterial({ map: foil, metalness: 0.95, roughness: 0.36, envMapIntensity: 1.1 }),
    white: new THREE.MeshStandardMaterial({ color: 0xc9cfd6, roughness: 0.6, metalness: 0.05 }),
    grey: new THREE.MeshStandardMaterial({ color: 0x8b929c, roughness: 0.6, metalness: 0.3 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x0d0f14, roughness: 0.5, metalness: 0.2, side: THREE.DoubleSide }),
    silver: new THREE.MeshStandardMaterial({ color: 0xdfe5ec, metalness: 1.0, roughness: 0.12 }),
    solar: new THREE.MeshStandardMaterial({ map: cells, metalness: 0.55, roughness: 0.25, envMapIntensity: 1.3 }),
    panelBack: new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.7, metalness: 0.2 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0x7c7f84, roughness: 0.95 }),
  };
  return SHARED;
}

function cyl(rt, rb, h, mat, seg = 24, open = false) { return new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), mat); }
function box(x, y, z, mat) { return new THREE.Mesh(new THREE.BoxGeometry(x, y, z), mat); }

function dishGeometry(radius, focal, seg = 40) {
  const pts = [];
  for (let i = 0; i <= 12; i++) { const r = (radius * i) / 12; pts.push(new THREE.Vector2(r, (r * r) / (4 * focal))); }
  return new THREE.LatheGeometry(pts, seg);
}

// Optical telescope tube pointing along +Z of the returned pivot
function telescope(radius, length, accent, beaconColor) {
  const M = shared();
  const pivot = new THREE.Group();
  const tube = cyl(radius, radius, length, M.white, 40, true); tube.rotation.x = Math.PI / 2; tube.position.z = length / 2;
  const inner = cyl(radius * 0.97, radius * 0.97, length, M.dark, 40, true); inner.rotation.x = Math.PI / 2; inner.position.z = length / 2;
  const mirror = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.92, 40), M.silver); mirror.position.z = length * 0.06;
  const back = new THREE.Mesh(new THREE.CircleGeometry(radius, 40), M.white); back.position.z = 0; back.rotation.y = Math.PI;
  const secondary = cyl(radius * 0.22, radius * 0.22, radius * 0.12, M.dark); secondary.rotation.x = Math.PI / 2; secondary.position.z = length * 0.88;
  pivot.add(tube, inner, mirror, back, secondary);
  for (let k = 0; k < 4; k++) {
    const vane = box(radius * 1.9, radius * 0.03, radius * 0.03, M.dark);
    vane.rotation.z = (k * Math.PI) / 4; vane.position.z = length * 0.88; pivot.add(vane);
  }
  const lip = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.01, radius * 0.06, 12, 48),
    new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.6, roughness: 0.4 }));
  lip.position.z = length; pivot.add(lip);
  // beacon laser used for pointing / acquisition / tracking
  const bx = radius * 1.35;
  const laser = cyl(radius * 0.14, radius * 0.14, length * 0.35, M.grey); laser.rotation.x = Math.PI / 2; laser.position.set(bx, 0, length * 0.55);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.13, 16, 12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(beaconColor).multiplyScalar(2.5) }));
  beacon.position.set(bx, 0, length * 0.74);
  pivot.add(laser, beacon);
  return { pivot, beacon };
}

// ---------------------------------------------------------------------------
// Satellite: ~7 m span. +Z of the group points to the parent body (nadir).
// ---------------------------------------------------------------------------
export function makeSatellite(color = '#ffc94d') {
  const M = shared();
  const accent = new THREE.Color(color);
  const group = new THREE.Group();

  const bus = box(1.4, 1.4, 1.8, M.gold); group.add(bus);
  const band = box(1.43, 1.43, 0.14, new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.25, roughness: 0.4, metalness: 0.3 }));
  band.position.z = -0.55; group.add(band);
  const radiator = box(1.3, 0.04, 1.6, M.white); radiator.position.y = -0.72; group.add(radiator);
  const deck = box(1.3, 0.04, 1.6, M.white); deck.position.y = 0.72; group.add(deck);

  // nadir communications dish
  const dish = new THREE.Mesh(dishGeometry(0.5, 0.32), M.white);
  dish.material = M.white.clone(); dish.material.side = THREE.DoubleSide;
  dish.rotation.x = Math.PI / 2; dish.position.z = 1.05; group.add(dish);
  const feed = cyl(0.02, 0.02, 0.32, M.grey, 8); feed.rotation.x = Math.PI / 2; feed.position.z = 1.2; group.add(feed);
  const feedHorn = cyl(0.05, 0.03, 0.08, M.grey, 12); feedHorn.rotation.x = Math.PI / 2; feedHorn.position.z = 1.36; group.add(feedHorn);
  const mast = cyl(0.06, 0.06, 0.2, M.grey, 12); mast.rotation.x = Math.PI / 2; mast.position.z = 0.95; group.add(mast);

  // two sun-tracking solar wings
  const wings = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.x = s * 0.7;
    const yoke = cyl(0.035, 0.035, 0.75, M.grey, 8); yoke.rotation.z = Math.PI / 2; yoke.position.x = s * 0.37; pivot.add(yoke);
    const drive = cyl(0.09, 0.09, 0.12, M.dark, 16); drive.rotation.z = Math.PI / 2; drive.position.x = s * 0.06; pivot.add(drive);
    for (let k = 0; k < 2; k++) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.035, 1.25),
        [M.panelBack, M.panelBack, M.solar, M.panelBack, M.panelBack, M.panelBack]);
      panel.position.x = s * (0.78 + 0.85 + k * 1.7); pivot.add(panel);
    }
    group.add(pivot); wings.push(pivot);
  }

  // quantum optical terminal on a gimbal (zenith side)
  const mount = cyl(0.28, 0.32, 0.22, M.grey, 24); mount.position.y = 0.84; group.add(mount);
  const gimbal = new THREE.Group(); gimbal.position.y = 1.05; group.add(gimbal);
  const scope = telescope(0.3, 1.15, accent, '#6dff9e');
  scope.pivot.position.z = -0.35;
  gimbal.add(scope.pivot);

  // star trackers, thrusters, whip antenna
  for (const s of [-1, 1]) {
    const st = box(0.18, 0.18, 0.22, M.dark); st.position.set(s * 0.45, 0.45, -0.98); group.add(st);
    const baffle = cyl(0.07, 0.1, 0.18, M.dark, 16); baffle.rotation.x = Math.PI / 2; baffle.position.set(s * 0.45, 0.45, -1.15); group.add(baffle);
  }
  for (const [x, y] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
    const n = cyl(0.03, 0.08, 0.16, M.silver, 16); n.rotation.x = Math.PI / 2; n.position.set(x, y, -0.98); group.add(n);
  }
  const whip = cyl(0.008, 0.008, 1.0, M.grey, 6); whip.position.set(-0.55, -0.55 - 0.5, 0.5); group.add(whip);

  return { group, gimbal, wings, beacon: scope.beacon };
}

function terrainTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d'); const r = mulberry32(11);
  g.fillStyle = '#6b5d4a'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2600; i++) {
    const x = r() * 512, y = r() * 512, s = 2 + r() * 22;
    g.fillStyle = `hsla(${25 + r() * 25}, ${18 + r() * 20}%, ${24 + r() * 22}%, ${0.25 + r() * 0.4})`;
    g.beginPath(); g.ellipse(x, y, s, s * (0.4 + r() * 0.6), r() * 3, 0, Math.PI * 2); g.fill();
  }
  g.strokeStyle = 'rgba(210,200,180,0.45)'; g.lineWidth = 3;       // access road
  g.beginPath(); g.moveTo(256, 256); g.bezierCurveTo(300, 330, 380, 360, 512, 420); g.stroke();
  const mask = g.createRadialGradient(256, 256, 120, 256, 256, 256);  // fade out at the edge
  mask.addColorStop(0, 'rgba(0,0,0,1)'); mask.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalCompositeOperation = 'destination-in'; g.fillStyle = mask; g.fillRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------
// Optical ground station: observatory dome with an open telescope. +Y = up.
// ---------------------------------------------------------------------------
export function makeGroundStation(color = '#7dff9b') {
  const M = shared();
  const group = new THREE.Group();
  const pad = cyl(13, 13, 0.6, M.concrete, 48); pad.position.y = 0.3; group.add(pad);
  const building = cyl(5, 5, 4, M.white, 48); building.position.y = 2.6; group.add(building);
  const ring = cyl(5.05, 5.05, 0.25, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4 }), 48);
  ring.position.y = 4.5; group.add(ring);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(5.2, 48, 24, 0.5, Math.PI * 2 - 1.0, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xc4cad1, metalness: 0.3, roughness: 0.45, side: THREE.DoubleSide }));
  dome.position.y = 4.6; group.add(dome);
  const gimbal = new THREE.Group(); gimbal.position.y = 6.2; group.add(gimbal);
  const scope = telescope(1.0, 4.2, new THREE.Color(color), '#6dff9e');
  scope.pivot.position.z = -1.6; gimbal.add(scope.pivot);
  const pier = cyl(0.6, 0.9, 2.0, M.grey, 16); pier.position.y = 5.0; group.add(pier);

  // radio dish for the classical link
  const dishBase = cyl(0.8, 1.2, 3.5, M.white, 16); dishBase.position.set(12, 2.0, 4); group.add(dishBase);
  const dish = new THREE.Mesh(dishGeometry(3.2, 1.6), new THREE.MeshStandardMaterial({ color: 0xf2f4f7, roughness: 0.5, side: THREE.DoubleSide }));
  dish.position.set(12, 4.2, 4); dish.rotation.x = -0.7; group.add(dish);
  const shed = box(6, 3, 4, M.white); shed.position.set(-11, 1.8, -3); group.add(shed);
  // local terrain patch (only shown in close-up; the global Earth texture is ~10 km per pixel)
  const site = new THREE.Mesh(new THREE.CircleGeometry(600, 64),
    new THREE.MeshStandardMaterial({ map: terrainTexture(), transparent: true, roughness: 1, depthWrite: false }));
  site.rotation.x = -Math.PI / 2; site.position.y = 0.02; site.renderOrder = -1;
  group.add(site);
  return { group, gimbal, beacon: scope.beacon, site };
}
