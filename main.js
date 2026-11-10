// =============================================================================
// main.js  -  app state, simulation clock, main loop
// =============================================================================
import * as PH from './physics.js';
import { SpaceScene } from './scene.js';
import { UI } from './ui.js';

const J2000_UNIX = 946727935.816;

export const DEFAULT_SCENARIO = {
  nodes: [
    { id: 'qs-alpha', type: 'sat', name: 'QS-Alpha', parent: 'Earth', alt: 550, inc: 0, raan: 0, phase: 0, epoch: J2000_UNIX, tx: 0.10, rx: 0.30, pairRate: 1e8, color: '#ffc94d' },
    { id: 'qs-beta', type: 'sat', name: 'QS-Beta', parent: 'Earth', alt: 550, inc: 20, raan: 0, phase: 40, epoch: J2000_UNIX, tx: 0.10, rx: 0.30, pairRate: 1e8, color: '#c58cff' },
    { id: 'qs-geo', type: 'sat', name: 'QS-Geo', parent: 'Earth', alt: 35786, inc: 0, raan: 0, phase: 0, geoLon: 80, epoch: J2000_UNIX, tx: 0.30, rx: 0.60, pairRate: 1e8, color: '#5ad1ff' },
    { id: 'luna-relay', type: 'sat', name: 'Luna Relay', parent: 'Moon', alt: 500, inc: 80, raan: 30, phase: 0, epoch: J2000_UNIX, tx: 0.40, rx: 1.00, pairRate: 1e8, color: '#e8e8e8' },
    { id: 'ares-relay', type: 'sat', name: 'Ares Relay', parent: 'Mars', alt: 400, inc: 45, raan: 0, phase: 0, epoch: J2000_UNIX, tx: 0.50, rx: 1.00, pairRate: 1e8, color: '#ff7a59' },
    { id: 'gs-hanle', type: 'ground', name: 'Hanle OGS', parent: 'Earth', lat: 32.78, lon: 78.96, altKm: 4.5, tx: 0.30, rx: 1.00, pairRate: 1e8, color: '#7dff9b' },
    { id: 'gs-tenerife', type: 'ground', name: 'Tenerife OGS', parent: 'Earth', lat: 28.30, lon: -16.51, altKm: 2.4, tx: 0.30, rx: 1.00, pairRate: 1e8, color: '#ffd27d' },
  ],
  links: [
    { id: 'l-isl', from: 'qs-alpha', to: 'qs-beta' },
    { id: 'l-down', from: 'qs-geo', to: 'gs-hanle' },
    { id: 'l-moon', from: 'luna-relay', to: 'qs-geo' },
    { id: 'l-mars', from: 'ares-relay', to: 'qs-geo' },
  ],
};

class App {
  constructor() {
    this.nodes = []; this.links = [];
    this.params = { ...PH.DEFAULT_PARAMS };
    this.simTime = new Date();
    this.warp = 60; this.paused = false;
    this.telemetry = {}; this.history = {};
    this.scene = new SpaceScene(document.getElementById('viewport'), {
      onFocusRequest: (f) => this.setFocus(f),
      onNodeClick: (id) => this.ui.selectNode(id),
    });
    this.ui = new UI(this);
    this.lastHist = 0; this.lastUi = 0; this.lastFrame = performance.now();
  }

  async start() {
    const saved = await this.ui.loadScenario();
    this.loadScenario(saved || DEFAULT_SCENARIO);
    this.ui.selectLink(this.links[0]?.id || null);
    requestAnimationFrame((t) => this.loop(t));
    document.getElementById('loading').classList.add('done');
  }

  loadScenario(sc) {
    this.nodes = structuredClone(sc.nodes);
    this.links = structuredClone(sc.links);
    if (sc.params) this.params = { ...PH.DEFAULT_PARAMS, ...sc.params };
    this.history = {};
    this.changed();
  }
  scenario() { return { nodes: this.nodes, links: this.links, params: this.params }; }

  changed() {
    this.nodesById = Object.fromEntries(this.nodes.map((n) => [n.id, n]));
    this.links = this.links.filter((l) => this.nodesById[l.from] && this.nodesById[l.to]);
    this.scene.syncNodes(this.nodes);
    this.scene.syncLinks(this.links);
    this.ui.refreshLists();
  }

  setFocus(f) { this.scene.setFocus(f); this.ui.setFocusValue(f); }

  loop(now) {
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (!this.paused) this.simTime = new Date(this.simTime.getTime() + dt * this.warp * 1000);

    const st = PH.worldState(this.simTime, this.nodes);
    const stNext = PH.worldState(new Date(this.simTime.getTime() + 1000), this.nodes);
    this.state = st;
    for (const l of this.links) this.telemetry[l.id] = PH.computeLink(l, this.nodesById, st, stNext, this.params);

    if (now - this.lastHist > 200) {
      this.lastHist = now;
      for (const l of this.links) {
        const t = this.telemetry[l.id];
        (this.history[l.id] ??= []).push({ t: this.simTime.getTime(), S: t.S, loss: t.loss_db, pairs: t.pairs_per_s });
        if (this.history[l.id].length > 500) this.history[l.id].shift();
      }
    }
    this.scene.update(st, this.telemetry, this.nodesById, this.links);
    if (now - this.lastUi > 100) { this.lastUi = now; this.ui.tick(); }
    requestAnimationFrame((t) => this.loop(t));
  }
}

const app = new App();
window.app = app;
app.start();
