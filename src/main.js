import './styles.css';
import { R, S, dims, view } from './state.js';
import { bindEvents, buildControls, fitView } from './controls.js';
import { initMap } from './map.js';
import { tick } from './playback.js';
import { exportVideo, fontsReady } from './exporter.js';
import { composite } from './hud.js';
import { applyFrame, settle } from './frames.js';
import { setTrack } from './activity.js';

{ const d0 = dims(); view.width = d0.W; view.height = d0.H; }
buildControls();
bindEvents();
fitView();
initMap();
requestAnimationFrame(tick);
fontsReady().then(() => { if (R.map) composite(); });

window.flyover = { S, applyFrame, setTrack, exportVideo, settle, dims, get map() { return R.map; }, get plan() { return R.plan; } };
