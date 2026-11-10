// =============================================================================
// scene.js  -  renderer, camera, floating origin, scale modes, links, labels
// Scene unit = 1000 km. Every frame the focused object is placed at the origin
// ("floating origin"), so a 5 m satellite and a 1 AU distance render together.
// =============================================================================
import * as THREE from 'three';
import { OrbitControls } from './OrbitControls.js';
import { EffectComposer } from './EffectComposer.js';
import { RenderPass } from './RenderPass.js';
import { UnrealBloomPass } from './UnrealBloomPass.js';
import { OutputPass } from './OutputPass.js';
import { CSS2DRenderer, CSS2DObject } from './CSS2DRenderer.js';
import { RoomEnvironment } from './RoomEnvironment.js';
import * as PH from './physics.js';
import * as MD from './models.js';

const UNIT = 1000;                 // km per scene unit
const M_TO_UNIT = 1e-6;            // metres -> scene units
const K_CINE = 20000;              // cinematic log-compression scale (km)
export const STATUS_COLOR = { secure: '#5dff9b', entangled: '#4fd1ff', weak: '#ffb84d', blocked: '#ff5d6c', blinded: '#ff9d3d' };

const v3 = (a) => new THREE.Vector3(a[0], a[2], -a[1]);       // EQJ (km) -> three axes
const ease = (t) => (t >= 1 ? 1 : 1 - Math.pow(1 - t, 3));

export class SpaceScene {
  constructor(container, callbacks = {}) {
    this.cb = callbacks;
    this.container = container;
    this.mode = 'cinematic';
    this.showLabels = true; this.showOrbits = true; this.exaggerate = true;
    this.nodeObjs = new Map(); this.linkObjs = new Map();
    this.selectedLink = null; this.selectedNode = null;

    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, window.matchMedia('(max-width: 820px)').matches ? 1.5 : 2));
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    container.appendChild(r.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000004);
    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;

    this.camera = new THREE.PerspectiveCamera(45, 1, 1e-7, 1e8);
    this.camera.position.set(14, 9, 22);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
    this.controls.zoomSpeed = 1.4; this.controls.rotateSpeed = 0.6;
    this.controls.minDistance = 1e-6; this.controls.maxDistance = 6e6;

    this.sunLight = new THREE.DirectionalLight(0xffffff, 2.4);
    this.scene.add(this.sunLight, this.sunLight.target);
    this.ambient = new THREE.AmbientLight(0x31445e, 0.12); this.scene.add(this.ambient);

    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.85, 0.55, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = 'label-layer';
    container.appendChild(this.labelRenderer.domElement);

    // --- celestial bodies ---
    this.stars = MD.makeStars(); this.scene.add(this.stars);
    this.bodies = {
      Earth: MD.makeEarth(PH.BODIES.Earth.radius / UNIT),
      Moon: MD.makeMoon(PH.BODIES.Moon.radius / UNIT),
      Mars: MD.makeMars(PH.BODIES.Mars.radius / UNIT),
    };
    this.sun = MD.makeSun();
    this.scene.add(this.sun.group, ...Object.values(this.bodies).map((b) => b.group));
    this.bodyLabels = {};
    for (const name of ['Sun', 'Earth', 'Moon', 'Mars']) {
      const el = document.createElement('div'); el.className = 'label body'; el.textContent = name;
      el.addEventListener('dblclick', () => this.cb.onFocusRequest?.({ kind: 'body', id: name }));
      const obj = new CSS2DObject(el); this.scene.add(obj); this.bodyLabels[name] = obj;
    }

    // --- orbit lines of the Moon and planets ---
    const lineMat = (c, o) => new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false });
    this.moonOrbit = new THREE.Line(new THREE.BufferGeometry(), lineMat(0x8899aa, 0.35));
    this.earthOrbit = new THREE.Line(new THREE.BufferGeometry(), lineMat(0x4f8cff, 0.35));
    this.marsOrbit = new THREE.Line(new THREE.BufferGeometry(), lineMat(0xff7a59, 0.35));
    for (const l of [this.moonOrbit, this.earthOrbit, this.marsOrbit]) { l.frustumCulled = false; this.scene.add(l); }
    this._orbitCacheT = null; this._orbitCacheMode = null;

    // --- focus & camera transitions ---
    this.focus = { kind: 'body', id: 'Earth' };
    this._prevUp = new THREE.Vector3(0, 1, 0);
    this.prevFocus = this.focus;
    this.transition = null;

    // --- picking ---
    this.raycaster = new THREE.Raycaster();
    r.domElement.addEventListener('dblclick', (e) => this._pick(e, true));
    r.domElement.addEventListener('click', (e) => this._pick(e, false));

    this.clock = new THREE.Clock();
    this.photonTime = 0;
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h); this.composer.setSize(w, h); this.labelRenderer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ nodes
  syncNodes(nodes) {
    const ids = new Set(nodes.map((n) => n.id));
    for (const [id, o] of this.nodeObjs) if (!ids.has(id)) { this._disposeNode(o); this.nodeObjs.delete(id); }
    for (const n of nodes) {
      const key = JSON.stringify([n.type, n.color, n.alt, n.inc, n.raan, n.phase, n.epoch, n.geoLon, n.parent, n.name]);
      const old = this.nodeObjs.get(n.id);
      if (old && old.key === key) continue;
      if (old) this._disposeNode(old);
      const model = n.type === 'ground' ? MD.makeGroundStation(n.color) : MD.makeSatellite(n.color);
      model.group.traverse((o) => { o.userData.nodeId = n.id; });
      this.scene.add(model.group);
      const el = document.createElement('div'); el.className = 'label node';
      el.innerHTML = `<span class="dot" style="background:${n.color}"></span>${n.name}`;
      el.addEventListener('click', () => this.cb.onNodeClick?.(n.id));
      el.addEventListener('dblclick', () => this.cb.onFocusRequest?.({ kind: 'node', id: n.id }));
      const label = new CSS2DObject(el); this.scene.add(label);
      let orbit = null;
      if (n.type !== 'ground') {
        orbit = new THREE.Line(new THREE.BufferGeometry(),
          new THREE.LineBasicMaterial({ color: n.color, transparent: true, opacity: 0.55, depthWrite: false }));
        orbit.frustumCulled = false; this.scene.add(orbit);
      }
      this.nodeObjs.set(n.id, { key, node: n, model, label, orbit, orbitBuilt: false });
    }
    for (const n of nodes) this.nodeObjs.get(n.id).node = n;
  }

  _disposeNode(o) {
    this.scene.remove(o.model.group, o.label);
    o.label.element.remove();
    if (o.orbit) this.scene.remove(o.orbit);
  }

  // ------------------------------------------------------------------ links
  syncLinks(links) {
    const ids = new Set(links.map((l) => l.id));
    for (const [id, o] of this.linkObjs) if (!ids.has(id)) { this.scene.remove(o.group); this.linkObjs.delete(id); }
    for (const l of links) {
      if (this.linkObjs.has(l.id)) continue;
      const group = new THREE.Group();
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]),
        new THREE.LineDashedMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, dashSize: 1, gapSize: 1, depthWrite: false }));
      line.frustumCulled = false;
      const beamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10, 1, true), beamMat);
      beam.frustumCulled = false;
      const N = 18;
      const photons = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), N);
      photons.frustumCulled = false;
      group.add(line, beam, photons);
      this.scene.add(group);
      this.linkObjs.set(l.id, { link: l, group, line, beam, photons, N });
    }
  }

  // ------------------------------------------------------------------ focus
  setFocus(f) {
    this.prevFocus = this.focus; this.focus = f;
    const startDist = this.camera.position.length();
    let endDist;
    if (f.kind === 'body') endDist = (f.id === 'Sun' ? this._sunRadiusKm() : PH.BODIES[f.id].radius) * 3.2 / UNIT;
    else endDist = this.nodeObjs.get(f.id)?.node.type === 'ground' ? 9e-5 : 1.5e-5;
    this.transition = { t0: performance.now(), dur: 1800, startDist, endDist,
      startDir: this.camera.position.clone().normalize(), targetDir: null, startUp: this.camera.up.clone() };
  }

  _setCamUp(v) {
    this.camera.up.copy(v);
    this.controls._quat.setFromUnitVectors(this.camera.up, new THREE.Vector3(0, 1, 0));
    this.controls._quatInverse.copy(this.controls._quat).invert();
  }

  // local vertical of the focused object (Earth always "down" on screen near a spacecraft)
  _focusUp(f, st) {
    if (f.kind !== 'node') return new THREE.Vector3(0, 1, 0);
    const n = this.nodeObjs.get(f.id)?.node;
    return n ? v3(PH.norm(PH.sub(st.pos[n.id], st.bodies[n.parent]))) : new THREE.Vector3(0, 1, 0);
  }

  // pleasant camera direction for a fly-to
  _niceDir(f, st) {
    const sun = (name) => v3(PH.norm(PH.sub(st.bodies.Sun, st.bodies[name])));
    if (f.kind === 'body') {
      if (f.id === 'Sun') return this.camera.position.clone().normalize();
      const s = sun(f.id), side = new THREE.Vector3().crossVectors(s, new THREE.Vector3(0, 1, 0)).normalize();
      return s.multiplyScalar(0.9).add(side.multiplyScalar(0.75)).add(new THREE.Vector3(0, 0.3, 0)).normalize();
    }
    const n = this.nodeObjs.get(f.id)?.node;
    if (!n) return this.camera.position.clone().normalize();
    const up = v3(PH.norm(PH.sub(st.pos[n.id], st.bodies[n.parent])));
    const sn = sun(n.parent);
    const horiz = sn.clone().addScaledVector(up, -sn.dot(up));
    if (horiz.lengthSq() < 1e-6) horiz.set(1, 0, 0).addScaledVector(up, -up.x);
    horiz.normalize();
    const side = new THREE.Vector3().crossVectors(up, horiz).normalize();
    if (n.type === 'ground') return up.multiplyScalar(0.42).add(horiz.multiplyScalar(-0.7)).add(side.multiplyScalar(0.55)).normalize();
    return up.multiplyScalar(0.28).add(horiz.multiplyScalar(0.75)).add(side.multiplyScalar(0.6)).normalize();
  }

  _sunRadiusKm() { return this.mode === 'true' ? PH.BODIES.Sun.radius : 7000; }

  // display position (km) of a body centre, honouring cinematic compression
  _bodyDisp(name, st) {
    const b = st.bodies[name];
    if (this.mode === 'true' || name === 'Earth') return b;
    const e = st.bodies.Earth, d = PH.sub(b, e), dist = PH.len(d);
    return PH.add(e, PH.mul(d, (K_CINE * Math.log(1 + dist / K_CINE)) / dist));
  }
  _nodeDisp(node, st) { return PH.add(this._bodyDisp(node.parent, st), PH.sub(st.pos[node.id], st.bodies[node.parent])); }
  _focusDisp(f, st) {
    if (f.kind === 'body') return this._bodyDisp(f.id, st);
    const o = this.nodeObjs.get(f.id);
    return o ? this._nodeDisp(o.node, st) : this._bodyDisp('Earth', st);
  }

  // ------------------------------------------------------------------ frame
  update(st, telemetry, nodesById, links) {
    const dt = this.clock.getDelta();
    this.photonTime += dt;
    let origin = this._focusDisp(this.focus, st);
    if (this.transition) {
      const tr = this.transition, k = ease((performance.now() - tr.t0) / tr.dur);
      const from = this._focusDisp(this.prevFocus, st);
      origin = PH.add(from, PH.mul(PH.sub(origin, from), k));
      if (!tr.targetDir) tr.targetDir = this._niceDir(this.focus, st);
      const dir = tr.startDir.clone().lerp(tr.targetDir, k).normalize();
      const dist = Math.exp(Math.log(tr.startDist) + (Math.log(tr.endDist) - Math.log(tr.startDist)) * k);
      this.camera.position.copy(dir.multiplyScalar(dist));
      const up = tr.startUp.clone().lerp(this._focusUp(this.focus, st), k).normalize();
      this._setCamUp(up); this._prevUp.copy(up);
      if (k >= 1) this.transition = null;
    } else if (this.focus.kind === 'node') {
      // chase camera: ride along with the orbit / planet rotation
      const up = this._focusUp(this.focus, st);
      const q = new THREE.Quaternion().setFromUnitVectors(this._prevUp, up);
      this.camera.position.applyQuaternion(q);
      this._setCamUp(up); this._prevUp.copy(up);
    }
    const rel = (km) => v3(PH.mul(PH.sub(km, origin), 1 / UNIT));
    this._origin = origin;
    const focusBody = this.focus.kind === 'body' ? this.focus.id : (this.nodeObjs.get(this.focus.id)?.node.parent || 'Earth');

    // sun directions & lighting
    const sunDirOf = (name) => v3(PH.norm(PH.sub(st.bodies.Sun, st.bodies[name])));
    for (const name of ['Earth', 'Moon', 'Mars']) this.bodies[name].setSun(sunDirOf(name));
    const lightDir = focusBody === 'Sun' ? new THREE.Vector3(0, 1, 0) : sunDirOf(focusBody);
    this.sunLight.position.copy(lightDir).multiplyScalar(10); this.sunLight.target.position.set(0, 0, 0);
    // a spacecraft or station in a planet's shadow is lit only by faint planet-shine
    let shadow = null;
    if (this.focus.kind === 'node') {
      const fn = this.nodeObjs.get(this.focus.id)?.node;
      if (fn) shadow = PH.inShadow(st.pos[fn.id], st, fn.type === 'ground' ? fn.parent : null);
    }
    const lit = shadow ? 0 : 1;
    this.sunLight.intensity += ((lit ? 2.4 : 0) - this.sunLight.intensity) * 0.15;
    this.scene.environmentIntensity += ((lit ? 0.35 : 0.06) - this.scene.environmentIntensity) * 0.15;
    this.ambient.intensity = lit ? 0.12 : 0.45;
    this.inShadow = shadow;

    // bodies
    const bodyRel = {};
    for (const name of ['Earth', 'Moon', 'Mars']) {
      const g = this.bodies[name].group;
      bodyRel[name] = rel(this._bodyDisp(name, st));
      g.position.copy(bodyRel[name]);
      const f = st.frames[name];
      const x = v3(f.pm), y = v3(f.pole), z = new THREE.Vector3().crossVectors(x, y);
      g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    }
    this.bodies.Earth.clouds.rotation.y = (PH.daysSinceJ2000(st.date) * 0.35) % (Math.PI * 2);
    bodyRel.Sun = rel(this._bodyDisp('Sun', st));
    this.sun.group.position.copy(bodyRel.Sun);
    this.sun.group.scale.setScalar(this._sunRadiusKm() / UNIT);
    this.stars.position.copy(this.camera.position);

    // body labels
    const radii = { Sun: this._sunRadiusKm() / UNIT, Earth: 6.371, Moon: 1.7374, Mars: 3.3895 };
    for (const name of ['Sun', 'Earth', 'Moon', 'Mars']) {
      this.bodyLabels[name].position.copy(bodyRel[name]).add(new THREE.Vector3(0, radii[name] * 1.25, 0));
      this.bodyLabels[name].visible = this.showLabels;
    }

    this._updateBodyOrbits(st, bodyRel);

    // nodes
    const partnerOf = {};
    for (const l of links) { partnerOf[l.from] ??= l.to; partnerOf[l.to] ??= l.from; }
    const nodeRel = {};
    for (const [id, o] of this.nodeObjs) nodeRel[id] = rel(this._nodeDisp(o.node, st));
    const camPos = this.camera.position;
    for (const [id, o] of this.nodeObjs) {
      const n = o.node, g = o.model.group, p = nodeRel[id];
      g.position.copy(p);
      const camDist = camPos.distanceTo(p);
      const boost = this.exaggerate ? camDist * (n.type === 'ground' ? 0.0011 : 0.0032) : 0;
      g.scale.setScalar(Math.max(M_TO_UNIT, boost));
      const parentRel = bodyRel[n.parent];
      if (n.type === 'ground') {
        const up = p.clone().sub(parentRel).normalize();
        g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
      } else {
        g.lookAt(parentRel);
        const sun = sunDirOf(n.parent).applyQuaternion(g.quaternion.clone().invert());
        const ang = Math.atan2(sun.z, sun.y);
        for (const w of o.model.wings) w.rotation.x = ang;
      }
      g.updateMatrixWorld();
      const partner = partnerOf[id];
      if (partner && nodeRel[partner]) o.model.gimbal.lookAt(nodeRel[partner]);
      else o.model.gimbal.lookAt(p.clone().add(p.clone().sub(parentRel)));
      o.model.beacon.visible = !!partner && camDist < 0.01;
      if (o.model.site) o.model.site.visible = camDist < 0.004;
      // orbit ring
      if (o.orbit) {
        if (!o.orbitBuilt) {
          const pts = PH.orbitPath(n, st.date, st.frames).map((q) => v3(PH.mul(q, 1 / UNIT)));
          o.orbit.geometry.dispose(); o.orbit.geometry = new THREE.BufferGeometry().setFromPoints(pts);
          o.orbitBuilt = true;
        }
        o.orbit.position.copy(parentRel); o.orbit.visible = this.showOrbits;
      }
      o.label.position.copy(p);
      o.label.element.classList.toggle('selected', this.selectedNode === id);
    }

    // links
    const tmpQ = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
    for (const [id, o] of this.linkObjs) {
      const l = o.link, t = telemetry[id];
      if (!t || !nodeRel[l.from] || !nodeRel[l.to]) { o.group.visible = false; continue; }
      o.group.visible = true;
      const a = nodeRel[l.from], b = nodeRel[l.to];
      const dir = b.clone().sub(a), length = dir.length();
      const col = new THREE.Color(STATUS_COLOR[t.status]);
      const selected = this.selectedLink === id;
      const pos = o.line.geometry.attributes.position;
      pos.setXYZ(0, a.x, a.y, a.z); pos.setXYZ(1, b.x, b.y, b.z); pos.needsUpdate = true;
      o.line.computeLineDistances();
      const camToLine = distPointSegment(camPos, a, b);
      o.line.material.color.copy(col);
      o.line.material.dashSize = t.status === 'blocked' ? camToLine * 0.02 : 1e12;
      o.line.material.gapSize = t.status === 'blocked' ? camToLine * 0.02 : 0;
      o.line.material.opacity = t.status === 'blocked' ? 0.45 : 0.7;
      const live = t.status !== 'blocked';
      o.beam.visible = live; o.photons.visible = live && t.pairs_per_s > 0.01;
      if (live) {
        const radius = camToLine * (selected ? 0.0022 : 0.0013);
        o.beam.position.copy(a).add(b).multiplyScalar(0.5);
        o.beam.quaternion.copy(tmpQ.setFromUnitVectors(Y, dir.clone().normalize()));
        o.beam.scale.set(radius, length, radius);
        o.beam.material.color.copy(col).multiplyScalar(selected ? 1.6 : 1.0);
        o.beam.material.opacity = t.status === 'weak' ? 0.18 : 0.38;
        const m = new THREE.Matrix4(), s = radius * 2.6;
        o.photons.material.color.copy(col).multiplyScalar(3.5);
        for (let k = 0; k < o.N; k++) {
          const f = ((this.photonTime * 0.45) + k / o.N) % 1;
          const pt = a.clone().addScaledVector(dir, f);
          const sc = s * (0.6 + 0.4 * Math.sin(f * Math.PI));
          m.makeScale(sc, sc, sc).setPosition(pt);
          o.photons.setMatrixAt(k, m);
        }
        o.photons.instanceMatrix.needsUpdate = true;
      }
    }

    // label occlusion behind bodies
    const spheres = ['Earth', 'Moon', 'Mars'].map((n) => [bodyRel[n], radii[n]]);
    const occluded = (pt, skipR = 0) => {
      const ray = new THREE.Ray(camPos.clone(), pt.clone().sub(camPos).normalize());
      const dist = camPos.distanceTo(pt), hit = new THREE.Vector3();
      return spheres.some(([c, r]) => r > skipR && ray.intersectSphere(new THREE.Sphere(c, r * 0.995), hit) && camPos.distanceTo(hit) < dist * 0.999);
    };
    for (const [id, o] of this.nodeObjs) {
      const close = this.focus.kind === 'node' && this.focus.id === id && camPos.distanceTo(o.label.position) < 2e-3;
      o.label.visible = this.showLabels && !close && !occluded(o.label.position);
    }
    for (const name of ['Sun', 'Earth', 'Moon', 'Mars'])
      this.bodyLabels[name].visible = this.showLabels && !occluded(bodyRel[name], radii[name] * 0.99);

    this.controls.update();
    this.composer.render();
    this.labelRenderer.render(this.scene, this.camera);
  }

  _updateBodyOrbits(st, bodyRel) {
    const t = st.date.getTime();
    const stale = this._orbitCacheT === null || Math.abs(t - this._orbitCacheT) > 86400e3 * 2 || this._orbitCacheMode !== this.mode;
    if (stale) {
      const A = window.Astronomy;
      const pts = [];
      for (let k = 0; k <= 180; k++) {
        const d = new Date(t + (k / 180) * 27.32 * 86400e3);
        const m = A.GeoMoon(d);
        let v = [m.x * PH.AU_KM, m.y * PH.AU_KM, m.z * PH.AU_KM];
        if (this.mode !== 'true') { const L = PH.len(v); v = PH.mul(v, (K_CINE * Math.log(1 + L / K_CINE)) / L); }
        pts.push(v3(PH.mul(v, 1 / UNIT)));
      }
      this.moonOrbit.geometry.dispose(); this.moonOrbit.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      const helio = (body, days) => {
        const out = [];
        for (let k = 0; k <= 360; k++) {
          const v = A.HelioVector(body, new Date(t + (k / 360) * days * 86400e3));
          out.push(v3([v.x * PH.AU_KM / UNIT, v.y * PH.AU_KM / UNIT, v.z * PH.AU_KM / UNIT]));
        }
        return out;
      };
      this.earthOrbit.geometry.dispose(); this.earthOrbit.geometry = new THREE.BufferGeometry().setFromPoints(helio(A.Body.Earth, 365.26));
      this.marsOrbit.geometry.dispose(); this.marsOrbit.geometry = new THREE.BufferGeometry().setFromPoints(helio(A.Body.Mars, 686.98));
      this._orbitCacheT = t; this._orbitCacheMode = this.mode;
    }
    this.moonOrbit.position.copy(bodyRel.Earth);
    this.earthOrbit.position.copy(bodyRel.Sun); this.marsOrbit.position.copy(bodyRel.Sun);
    this.moonOrbit.visible = this.showOrbits;
    this.earthOrbit.visible = this.marsOrbit.visible = this.showOrbits && this.mode === 'true';
  }

  _pick(e, dbl) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(mouse, this.camera);
    const targets = [...this.nodeObjs.values()].map((o) => o.model.group);
    const hit = this.raycaster.intersectObjects(targets, true)[0];
    if (hit) {
      const id = hit.object.userData.nodeId;
      if (dbl) this.cb.onFocusRequest?.({ kind: 'node', id }); else this.cb.onNodeClick?.(id);
      return;
    }
    if (dbl) {
      const hits = this.raycaster.intersectObjects(['Earth', 'Moon', 'Mars'].map((n) => this.bodies[n].group), true);
      if (hits[0]) {
        const name = ['Earth', 'Moon', 'Mars'].find((n) => { let o = hits[0].object; while (o) { if (o === this.bodies[n].group) return true; o = o.parent; } return false; });
        if (name) this.cb.onFocusRequest?.({ kind: 'body', id: name });
      }
    }
  }
}

function distPointSegment(p, a, b) {
  const ab = b.clone().sub(a), t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / (ab.lengthSq() || 1)));
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}
