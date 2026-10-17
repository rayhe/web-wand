import { MagicCasterWand, Macro, LED } from './wand.js';
import { startDemo } from './demo.js';

const $ = (sel) => document.querySelector(sel);
const wand = new MagicCasterWand();
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
async function autoConnect() {
  if (demo || wand.connected) return;
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
  demo = startDemo(wand);
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
  setStatus('Connected', 'connected');
  setInfo({ name: e.detail.name });
  refreshControls();
  if ($('#imu').checked) wand.startImu();
});

wand.addEventListener('disconnect', (e) => {
  setStatus('Disconnected', 'idle');
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

let casting = false;

function showButtons(pressed, all) {
  document.querySelectorAll('.btn-dot').forEach((dot, i) => dot.classList.toggle('on', pressed[i]));
  $('#buttons').classList.toggle('all', all);
}

wand.addEventListener('buttons', (e) => {
  const { pressed, all } = e.detail;
  showButtons(pressed, all);
  if (all && !casting) startStroke();
  casting = all;
});

// ---------- Motion + trail ----------

const canvas = $('#trail');
const ctx = canvas.getContext('2d');
let strokes = [];
let pen = { x: 0, y: 0 };
let lastImuAt = 0;
let sampleCount = 0;

function startStroke() {
  pen = { x: 0, y: 0 };
  strokes.push([{ ...pen }]);
  if (strokes.length > 6) strokes.shift();
}

$('#clear-trail').addEventListener('click', () => { strokes = []; draw(); });

$('#imu').addEventListener('change', async (e) => {
  if (!wand.connected) return;
  try {
    if (e.target.checked) await wand.startImu();
    else await wand.stopImu();
  } catch (err) { log(`! ${err.message}`); }
});

wand.addEventListener('imu', (e) => {
  const now = performance.now();
  const samples = e.detail.samples;
  // Sample timing isn't in the packet, so spread the gap since the last
  // packet across its samples (clamped for the first packet and for stalls).
  const dt = Math.min(Math.max((now - lastImuAt) / 1000 / samples.length, 0.002), 0.05);
  lastImuAt = now;
  sampleCount += samples.length;

  const tracing = casting || $('#trace-always').checked;
  if (tracing && strokes.length === 0) startStroke();
  for (const s of samples) {
    if (!tracing) continue;
    // Yaw moves the tip left/right, pitch moves it up/down.
    pen.x -= s.gyro[2] * dt;
    pen.y -= s.gyro[1] * dt;
    strokes[strokes.length - 1].push({ ...pen });
  }

  const last = samples[samples.length - 1];
  $('#gyro').textContent = last.gyro.map(fmt).join(' ');
  $('#accel').textContent = last.accel.map(fmt).join(' ');
});

setInterval(() => { $('#rate').textContent = `${sampleCount} /s`; sampleCount = 0; }, 1000);

function fmt(n) { return (n >= 0 ? '+' : '') + n.toFixed(2); }

function draw() {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const color = getComputedStyle(document.documentElement).getPropertyValue('--trail').trim();
  const scale = Math.min(w, h) * 0.9; // ~1 radian of swing fills the box
  strokes.forEach((pts, si) => {
    if (pts.length < 2) return;
    // Centre each stroke on its own bounding box so drift doesn't push it off-canvas.
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    ctx.globalAlpha = si === strokes.length - 1 ? 1 : 0.25;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = w / 2 + (p.x - cx) * scale, y = h / 2 + (p.y - cy) * scale;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
}
(function loop() { draw(); requestAnimationFrame(loop); })();

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
