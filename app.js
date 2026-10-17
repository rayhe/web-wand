import { MagicCasterWand, Macro, LED } from './wand.js';
import { startDemo, castFromPolylines } from './demo.js';
import { setupMotion } from './motion.js';
import { applyMatrix, transpose } from './orientation.js';
import { setupGuide, shapeFor, renderShape, animate, sampleShape } from './guide.js';

const $ = (sel) => document.querySelector(sel);
const wand = new MagicCasterWand();
const SENS_KEY = 'web-wand-grip-sensitivity';
try { wand.buttonSensitivity = localStorage.getItem(SENS_KEY) || null; } catch { /* storage blocked */ }
let demo = null;

// ---------- Effects the wand can play (light + vibration sequences) ----------

const EFFECTS = {
  lumos: () => new Macro().buzz(150).ledHex(LED.TIP, 'ffffff', 2000),
  nox: () => new Macro().buzz(100).ledHex(LED.TIP, '330033', 200).delay(100).clear(),
  incendio: () => new Macro().buzz(200).ledHex(LED.TIP, 'ff4500', 300).ledHex(LED.MID_UPPER, 'ff6600', 200).delay(100).ledHex(LED.TIP, 'ff0000', 300).delay(200).clear(),
  aguamenti: () => new Macro().buzz(200).ledHex(LED.TIP, '0066ff', 400).ledHex(LED.MID_UPPER, '00aaff', 300).delay(200).clear(),
  'expecto patronum': () => new Macro().buzz(400)
    .ledHex(LED.TIP, 'e0e0ff', 300).ledHex(LED.MID_UPPER, 'c0c0ff', 300).ledHex(LED.MID_LOWER, 'a0a0ff', 300).ledHex(LED.POMMEL, '8080ff', 300)
    .delay(500).ledHex(LED.TIP, 'ffffff', 1000).delay(500).clear(),
  expelliarmus: () => new Macro().buzz(300).ledHex(LED.TIP, 'ff0000', 200).ledHex(LED.MID_UPPER, 'ff0000', 150).ledHex(LED.POMMEL, 'ff0000', 100).delay(300).clear(),
  stupefy: () => new Macro().buzz(250).ledHex(LED.TIP, 'ff0000', 150).delay(50).ledHex(LED.TIP, '880000', 150).delay(50).ledHex(LED.TIP, 'ff0000', 150).delay(100).clear(),
  'wingardium leviosa': () => new Macro().buzz(150).ledHex(LED.TIP, 'ffffaa', 300).delay(200).ledHex(LED.TIP, 'ffff66', 300).delay(200).ledHex(LED.TIP, 'ffffaa', 300).delay(300).clear(),
  ascendio: () => new Macro().buzz(250)
    .ledHex(LED.POMMEL, '88aaff', 100).delay(50).ledHex(LED.MID_LOWER, '88aaff', 100).delay(50)
    .ledHex(LED.MID_UPPER, '88aaff', 100).delay(50).ledHex(LED.TIP, 'aaccff', 200).delay(100).clear(),
  colovaria: () => new Macro().buzz(200).ledHex(LED.TIP, 'ff0000', 200).delay(100).ledHex(LED.TIP, '00ff00', 200).delay(100).ledHex(LED.TIP, '0000ff', 200).delay(100).clear(),
  'avada kedavra': () => new Macro().buzz(500)
    .ledHex(LED.TIP, '00ff00', 100).ledHex(LED.MID_UPPER, '00ff00', 100).ledHex(LED.MID_LOWER, '00ff00', 100).ledHex(LED.POMMEL, '00ff00', 100)
    .delay(200).clear(),
};
const DEFAULT_EFFECT = () => new Macro().buzz(200).ledHex(LED.TIP, '00ff00', 300).delay(200).clear();

const effectSelect = $('#effect');
for (const name of Object.keys(EFFECTS)) effectSelect.add(new Option(name[0].toUpperCase() + name.slice(1), name));

// ---------- Status / connection ----------

function setStatus(text, state) {
  const el = $('#status');
  el.textContent = text;
  el.dataset.state = state;
}

function refreshControls() {
  const live = wand.connected;
  $('#connect').textContent = live ? 'Disconnect' : 'Connect wand';
  $('#forget').hidden = !wand.device || Boolean(demo);
  for (const id of ['#leds-on', '#leds-off', '#buzz', '#play', '#imu']) $(id).disabled = !live && !demo;
}

if (!MagicCasterWand.supported) $('#unsupported').hidden = false;
refreshControls();

$('#auto').innerHTML = MagicCasterWand.canAutoConnect
  ? 'On: reconnects whenever the wand wakes up'
  : 'This visit only. <a href="https://github.com/rayhe/web-wand#auto-connect">Turn on a Chrome flag</a> to remember the wand.';

// Reconnect to a wand this site was allowed to use before, as soon as it wakes up.
// Only one tab may hold the wand, and a connected wand stops advertising, so a
// forgotten background tab would leave the picker in this one finding nothing.
// Tabs therefore auto-connect only while visible, and hand the wand over when
// another tab connects.
const tabs = 'BroadcastChannel' in window ? new BroadcastChannel('web-wand') : null;
let inOtherTab = false;

tabs?.addEventListener('message', (e) => {
  if (e.data?.type !== 'claim' && e.data?.type !== 'connected') return;
  inOtherTab = true;
  if (wand.connected) log('wand handed over to another tab');
  wand.disconnect(); // also stops waiting for it
  setStatus('In use in another tab', 'idle');
  refreshControls();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (!wand.connected) wand.stopAutoConnect();
  } else {
    autoConnect();
  }
});

async function autoConnect() {
  if (demo || wand.connected || document.hidden || inOtherTab) return;
  try {
    await wand.autoConnect();
  } catch (err) {
    log(`! auto-connect: ${err.message}`);
  }
  refreshControls();
}
autoConnect();

$('#connect').addEventListener('click', async () => {
  if (wand.connected) return wand.disconnect();
  stopDemo();
  try {
    setStatus('Connecting…', 'idle');
    if (tabs) {
      // Ask other tabs to let go, and give the wand a moment to start advertising.
      tabs.postMessage({ type: 'claim' });
      await new Promise((r) => setTimeout(r, 700));
    }
    inOtherTab = false;
    await wand.connect();
  } catch (err) {
    // The user closing the picker is not an error worth shouting about.
    if (err.name === 'NotFoundError') setStatus('Not connected', 'idle');
    else { setStatus('Connection failed', 'error'); log(`! ${err.message}`); }
    refreshControls();
    autoConnect();
  }
});

$('#forget').addEventListener('click', async () => {
  await wand.forget().catch((err) => log(`! ${err.message}`));
  setStatus('Not connected', 'idle');
  refreshControls();
});

$('#demo').addEventListener('click', () => {
  if (demo) return stopDemo();
  wand.disconnect();
  motion.reset();
  // The demo speaks in body axes; convert to raw so the current alignment maps it back.
  // Cast real guide shapes where we have them.
  const casts = ['lumos', 'incendio', 'wingardium_leviosa', 'expecto_patronum', 'alohomora', 'stupefy']
    .map((key) => shapeFor(key))
    .filter(Boolean)
    .map((shape) => castFromPolylines(shape.name.toLowerCase(), sampleShape(shape, 8)));
  demo = startDemo(wand, {
    toRaw: (v) => applyMatrix(transpose(motion.matrix), v),
    ...(casts.length ? { casts } : {}),
  });
  $('#demo').textContent = 'Stop demo';
  setStatus('Demo mode', 'demo');
  $('#imu').checked = true;
  setInfo({ name: 'MCW-DEMO', wandType: 'Honourable', firmware: '0.3', serial: '12345678' });
  refreshControls();
});

function stopDemo() {
  if (!demo) return;
  demo.stop();
  demo = null;
  $('#demo').textContent = 'Try demo';
  $('#battery').hidden = true;
  setStatus('Not connected', 'idle');
  refreshControls();
  autoConnect();
}

wand.addEventListener('waiting', (e) => {
  setStatus(`Waiting for ${e.detail.name || 'wand'} — wake it up`, 'waiting');
  refreshControls();
});

wand.addEventListener('connect', (e) => {
  inOtherTab = false;
  tabs?.postMessage({ type: 'connected' });
  setStatus('Connected', 'connected');
  setInfo({ name: e.detail.name });
  refreshControls();
  if ($('#imu').checked) startMotion();
});

wand.addEventListener('disconnect', (e) => {
  setStatus(inOtherTab ? 'In use in another tab' : 'Disconnected', 'idle');
  $('#battery').hidden = true;
  showButtons([false, false, false, false], false);
  refreshControls();
  // The wand dropped out (asleep, out of range): pick it back up when it returns.
  if (!e.detail.expected) autoConnect();
});

const BATTERY_LABELS = { charging: 'Charging', high: 'High', medium: 'Medium', low: 'Low', critical: 'Critical' };

wand.addEventListener('battery', (e) => {
  const { level, state } = e.detail;
  const b = $('#battery');
  b.hidden = false;
  b.dataset.battery = state;
  b.textContent = state === 'charging' ? '⚡ Charging' : `🔋 ${level}% · ${BATTERY_LABELS[state]}`;
  b.title = state === 'charging'
    ? 'The wand reports 100%, which it does while on the charger (or when fully charged).'
    : `Battery ${level}%`;
});

wand.addEventListener('info', (e) => setInfo(e.detail));

// ---------- Grip sensitivity ----------

const sensSelect = $('#sensitivity');
sensSelect.value = wand.buttonSensitivity || '';

wand.addEventListener('thresholds', (e) => {
  const v = e.detail.values;
  const pair = (i) => (v[i] === null || v[i + 4] === null ? '?' : `${v[i]}/${v[i + 4]}`);
  $('#thresholds').textContent = [0, 1, 2, 3].map(pair).join(' · ');
});

sensSelect.addEventListener('change', async () => {
  const preset = sensSelect.value || null;
  wand.buttonSensitivity = preset;
  try { preset ? localStorage.setItem(SENS_KEY, preset) : localStorage.removeItem(SENS_KEY); } catch { /* not fatal */ }
  if (!preset || !wand.connected) return;
  log(`grip: writing sensitivity ${preset}`);
  try { await wand.setButtonSensitivity(preset); } catch (err) { log(`! ${err.message}`); }
});

function setInfo(patch) {
  for (const [k, v] of Object.entries(patch)) {
    const dd = document.querySelector(`#info dd[data-k="${k}"]`);
    if (dd && v) dd.textContent = v;
  }
}

// ---------- Spells ----------

wand.addEventListener('spell', (e) => {
  const name = e.detail.name;
  const el = $('#spell');
  el.textContent = name;
  el.classList.remove('cast', 'empty');
  void el.offsetWidth; // restart the animation
  el.classList.add('cast');

  const shape = shapeFor(name);
  const holder = $('#spell-shape');
  holder.replaceChildren();
  if (shape) {
    const svg = renderShape(shape);
    holder.append(svg);
    animate(svg);
  }
  guide.flash(name);

  const li = document.createElement('li');
  const t = document.createElement('time');
  t.textContent = new Date().toLocaleTimeString();
  li.append(t, name);
  $('#history').prepend(li);

  if ($('#react').checked && wand.connected) {
    wand.runMacro((EFFECTS[name.toLowerCase()] || DEFAULT_EFFECT)());
  }
});

// ---------- Buttons ----------

function showButtons(pressed, all) {
  document.querySelectorAll('.btn-dot').forEach((dot, i) => dot.classList.toggle('on', pressed[i]));
  $('#buttons').classList.toggle('all', all);
  motion.onButtons(pressed, all);
}

wand.addEventListener('buttons', (e) => showButtons(e.detail.pressed, e.detail.all));

// ---------- Motion ----------

const motion = setupMotion({ wand, log: (line) => log(line), $ });

$('#imu').addEventListener('change', async (e) => {
  if (!wand.connected) return;
  try {
    if (e.target.checked) await startMotion();
    else await wand.stopImu();
  } catch (err) { log(`! ${err.message}`); }
});

async function startMotion() {
  motion.reset();
  log('motion: starting stream…');
  const flowing = await wand.startImu().catch((err) => { log(`! motion: ${err.message}`); return null; });
  if (flowing) log('motion: samples arriving');
  else if (flowing === false && wand.imuStreaming) log('motion: no samples after 3 tries. Move the wand; if the counter stays at 0, untick and tick Stream motion.');
}

// ---------- Spell guide ----------

const guide = setupGuide({
  container: $('#guide'),
  search: $('#guide-search'),
  onPick(key) {
    const shape = key && shapeFor(key);
    motion.setGhost(shape ? { name: shape.name, polylines: sampleShape(shape) } : null);
    if (shape) document.querySelector('.motion').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  },
});

// ---------- Lights / vibration ----------

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

async function guarded(fn) {
  if (!wand.connected) { log('(demo) command not sent — no real wand connected'); return; }
  try { await fn(); } catch (err) { log(`! ${err.message}`); }
}

$('#leds-on').addEventListener('click', () => guarded(async () => {
  for (const input of document.querySelectorAll('.leds input')) {
    await wand.setLed(Number(input.dataset.group), ...hexToRgb(input.value));
  }
}));
$('#leds-off').addEventListener('click', () => guarded(() => wand.clearLeds()));
$('#buzz').addEventListener('click', () => guarded(() => wand.buzz(300)));
$('#play').addEventListener('click', () => guarded(() => wand.runMacro(EFFECTS[effectSelect.value]())));

// ---------- Raw packet log ----------

const logEl = $('#log');
const logLines = [];

function log(line) {
  logLines.push(line);
  if (logLines.length > 300) logLines.shift();
  logEl.textContent = logLines.join('\n');
  logEl.scrollTop = logEl.scrollHeight;
}

wand.addEventListener('packet', (e) => {
  const { bytes, parsed } = e.detail;
  if (parsed?.type === 'imu' && !$('#log-imu').checked) return;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');
  log(`${new Date().toLocaleTimeString()}  ${parsed?.type ?? '?'}  ${hex}`);
});
