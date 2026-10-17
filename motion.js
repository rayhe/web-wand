// motion.js — the Motion card: sensor fusion, axis alignment, the 3D wand
// model and the auto-scaled 2D tip path.

import {
  AXES, AutoAligner, OrientationFilter, alignmentMatrix, applyMatrix, eulerOf, quatFromYaw,
  quatMultiply, rotate, upAxisFromAccel, validAlignment, wrapAngle,
} from './orientation.js';

const STORAGE_KEY = 'web-wand-alignment';
const AUTO_KEY = 'web-wand-auto-align';
const DEFAULT_ALIGNMENT = { tip: '+x', up: '+z' };
const MAX_STROKES = 6;
const MAX_POINTS = 3000;
const MIN_SPAN = 0.17; // ~10°: smaller strokes aren't blown up to fill the canvas
const GRID_STEPS = [1, 2, 5, 10, 15, 30, 45, 90];
const DEG = 180 / Math.PI;

function loadAlignment() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (validAlignment(saved ?? {})) return saved;
  } catch {
    // Storage blocked or corrupt: fall back to the default.
  }
  return { ...DEFAULT_ALIGNMENT };
}

function loadFlag(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

function saveFlag(key, on) {
  try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* not fatal */ }
}

function saveAlignment(a) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(a)); } catch { /* not fatal */ }
}

function bbox(pts) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
}

const fmt = (n) => (n >= 0 ? '+' : '') + n.toFixed(2);
const fmtDeg = (r) => `${Math.round(r * DEG)}°`;

export function setupMotion({ wand, log, $ }) {
  let alignment = loadAlignment();
  let matrix = alignmentMatrix(alignment);
  const filter = new OrientationFilter();
  let yawOffset = 0;
  let recenterNext = true;
  let q = [1, 0, 0, 0]; // displayed orientation, after recentring
  let period = 0.01; // seconds per sample, re-measured every second
  let samplesThisSecond = 0;
  let lastSampleAt = 0;
  const streaming = () => performance.now() - lastSampleAt < 1500;
  let casting = false;
  let strokes = [];
  let stroke = null;
  const recentAccel = []; // raw accel, for alignment capture
  let view3d = null;
  let tipDistance = 0.92;
  const aligner = new AutoAligner();
  let autoLearn = loadFlag(AUTO_KEY, true);
  let statusShownAt = 0;

  // ---------- 3D model (three.js loads from a CDN; the page works without it) ----------

  import('./wand3d.js')
    .then(({ createWandView, TIP_DISTANCE }) => {
      tipDistance = TIP_DISTANCE;
      view3d = createWandView($('#wand3d'));
      view3d.setOrientation(q);
    })
    .catch((err) => {
      $('#wand3d').classList.add('unavailable');
      $('#wand3d').textContent = '3D view unavailable: three.js could not be loaded.';
      log(`! 3D view: ${err.message}`);
    });

  // ---------- Samples ----------

  function tracing() {
    return casting || $('#trace-always').checked;
  }

  wand.addEventListener('imu', (e) => {
    const samples = e.detail.samples;
    samplesThisSecond += samples.length;
    lastSampleAt = performance.now();
    const trace = tracing();
    let body;
    for (const s of samples) {
      recentAccel.push(s.accel);
      if (recentAccel.length > 40) recentAccel.shift();
      if (autoLearn && aligner.push(s.gyro, s.accel, period)) applyLearned();
      body = { gyro: applyMatrix(matrix, s.gyro), accel: applyMatrix(matrix, s.accel) };
      filter.update(body.gyro, body.accel, period);
      if (recenterNext && filter.ready) {
        yawOffset = -eulerOf(filter.q).yaw;
        recenterNext = false;
      }
      q = quatMultiply(quatFromYaw(yawOffset), filter.q);
      if (trace) addPoint();
    }
    view3d?.setOrientation(q);

    if (autoLearn && performance.now() - statusShownAt > 500) showAutoStatus();

    const { yaw, pitch, roll } = eulerOf(q);
    $('#gyro').textContent = body.gyro.map(fmt).join(' ');
    $('#accel').textContent = body.accel.map(fmt).join(' ');
    $('#attitude').textContent = `${fmtDeg(yaw)} / ${fmtDeg(pitch)} / ${fmtDeg(roll)}`;
  });

  setInterval(() => {
    $('#rate').textContent = `${samplesThisSecond} /s`;
    // The packets carry no timestamps, so derive the sample period from the rate.
    if (samplesThisSecond >= 10) period = 1 / samplesThisSecond;
    samplesThisSecond = 0;
  }, 1000);

  // ---------- Tip path ----------

  function addPoint() {
    const tip = rotate(q, [1, 0, 0]);
    const yaw = Math.atan2(tip[1], tip[0]);
    const el = Math.asin(Math.max(-1, Math.min(1, tip[2])));
    if (!stroke) {
      stroke = { yaw0: yaw, pts: [] };
      strokes.push(stroke);
      if (strokes.length > MAX_STROKES) strokes.shift();
      view3d?.clearTrail();
    }
    // Left/right is heading change (scaled so the shape isn't stretched when
    // pointing high or low); up/down is elevation.
    stroke.pts.push({ x: -wrapAngle(yaw - stroke.yaw0) * Math.cos(el), y: el });
    if (stroke.pts.length > MAX_POINTS) stroke.pts.shift();
    view3d?.addTrailPoint(tip.map((c) => c * tipDistance));
  }

  const canvas = $('#trail');
  const ctx = canvas.getContext('2d');
  const view = { scale: 0, cx: 0, cy: 0, stroke: null };

  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const drawn = strokes.filter((s) => s.pts.length > 1);
    const latest = drawn[drawn.length - 1];
    if (!latest) {
      ctx.fillStyle = css('--muted');
      ctx.font = '14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(streaming() ? 'Hold all four grip buttons and draw' : 'Turn on Stream motion to trace', w / 2, h / 2);
      $('#trail-caption').textContent = 'Tip path';
      return;
    }

    // Auto-scale: fit the newest stroke, easing so the view doesn't jump.
    // Older strokes share the scale and may spill past the edges.
    const boxes = new Map(drawn.map((s) => [s, bbox(s.pts)]));
    const lb = boxes.get(latest);
    const target = Math.min((w * 0.8) / Math.max(MIN_SPAN, lb.w), (h * 0.8) / Math.max(MIN_SPAN, lb.h));
    const ease = view.scale ? 0.15 : 1;
    if (view.stroke !== latest) {
      // New stroke: jump to it rather than sliding over from the last one.
      view.stroke = latest;
      view.cx = lb.cx;
      view.cy = lb.cy;
    }
    view.scale += (target - view.scale) * ease;
    view.cx += (lb.cx - view.cx) * ease;
    view.cy += (lb.cy - view.cy) * ease;
    const toScreen = (p, b) => [w / 2 + (p.x - b.cx) * view.scale, h / 2 - (p.y - b.cy) * view.scale];

    // Grid in degrees, fixed to the latest stroke's angles.
    const stepDeg = GRID_STEPS.find((s) => (s / DEG) * view.scale >= 36) ?? 90;
    const step = stepDeg / DEG;
    ctx.lineWidth = 1;
    ctx.strokeStyle = css('--line');
    ctx.beginPath();
    for (let gx = Math.ceil((view.cx - w / 2 / view.scale) / step) * step; gx <= view.cx + w / 2 / view.scale; gx += step) {
      const x = w / 2 + (gx - view.cx) * view.scale;
      ctx.moveTo(x, 0); ctx.lineTo(x, h);
    }
    for (let gy = Math.ceil((view.cy - h / 2 / view.scale) / step) * step; gy <= view.cy + h / 2 / view.scale; gy += step) {
      const y = h / 2 - (gy - view.cy) * view.scale;
      ctx.moveTo(0, y); ctx.lineTo(w, y);
    }
    ctx.stroke();
    // Horizon (level) line.
    const horizon = h / 2 + view.cy * view.scale;
    if (horizon > 0 && horizon < h) {
      ctx.strokeStyle = css('--muted');
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(0, horizon); ctx.lineTo(w, horizon); ctx.stroke();
      ctx.setLineDash([]);
    }

    // Strokes: older ones faded and centred on themselves so they overlay.
    ctx.strokeStyle = css('--trail');
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    for (const s of drawn) {
      const b = s === latest ? { cx: view.cx, cy: view.cy } : boxes.get(s);
      ctx.globalAlpha = s === latest ? 1 : 0.22;
      ctx.beginPath();
      s.pts.forEach((p, i) => { const [x, y] = toScreen(p, b); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Live tip.
    if (tracing() && stroke === latest) {
      const [x, y] = toScreen(latest.pts[latest.pts.length - 1], { cx: view.cx, cy: view.cy });
      ctx.fillStyle = css('--gold');
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
    }
    $('#trail-caption').textContent = `Tip path · auto-scaled · grid ${stepDeg}°`;
  }
  (function loop() { draw(); requestAnimationFrame(loop); })();

  // ---------- Controls ----------

  function recenter() {
    if (!filter.ready) { recenterNext = true; return; }
    yawOffset = -eulerOf(filter.q).yaw;
    q = quatMultiply(quatFromYaw(yawOffset), filter.q);
    view3d?.setOrientation(q);
  }

  function clear() {
    strokes = [];
    stroke = null;
    view.scale = 0;
    view3d?.clearTrail();
  }

  $('#recenter').addEventListener('click', recenter);
  $('#clear-trail').addEventListener('click', clear);
  $('#reset-view').addEventListener('click', () => view3d?.resetView());
  $('#trace-always').addEventListener('change', () => { stroke = null; });

  // ---------- Axis alignment ----------

  const tipSel = $('#axis-tip'), upSel = $('#axis-up');
  for (const sel of [tipSel, upSel]) for (const a of AXES) sel.add(new Option(a.toUpperCase(), a));

  function showAlignment() {
    tipSel.value = alignment.tip;
    upSel.value = alignment.up;
    $('#align-summary').textContent = `Tip ${alignment.tip.toUpperCase()}, top ${alignment.up.toUpperCase()}`;
  }

  function applyAlignment(next, why) {
    if (!validAlignment(next)) {
      $('#align-msg').textContent = 'The tip and top must be different axes.';
      showAlignment();
      return;
    }
    alignment = { tip: next.tip, up: next.up };
    matrix = alignmentMatrix(alignment);
    saveAlignment(alignment);
    filter.reset();
    recenterNext = true;
    clear();
    showAlignment();
    $('#align-msg').textContent = why;
  }

  /** Average of the last few raw accel readings, or null if the wand isn't held still. */
  function stillAccel() {
    if (recentAccel.length < 10) return null;
    const avg = [0, 1, 2].map((i) => recentAccel.reduce((s, a) => s + a[i], 0) / recentAccel.length);
    const jitter = Math.max(...recentAccel.map((a) => Math.hypot(a[0] - avg[0], a[1] - avg[1], a[2] - avg[2])));
    return jitter < 0.15 ? avg : null;
  }

  // ---- Learning automatically ----

  function applyLearned() {
    const { tip, up } = aligner.result;
    showAutoStatus();
    if (!tip) return;
    const top = up && up[1] !== tip[1] ? up
      : alignment.up[1] !== tip[1] ? alignment.up
      : AXES.find((a) => a[1] !== tip[1]);
    if (tip === alignment.tip && top === alignment.up) return;
    applyAlignment({ tip, up: top }, `Learned automatically: tip ${tip.toUpperCase()}, top ${top.toUpperCase()}.`);
    log(`motion: auto-aligned to tip ${tip}, top ${top}`);
  }

  function showAutoStatus() {
    statusShownAt = performance.now();
    const el = $('#auto-status');
    if (!autoLearn) { el.textContent = ''; return; }
    const st = aligner.status;
    if (!st.longAxis) {
      el.textContent = st.swingProgress < 1
        ? `Learning: swing the wand around as if casting (${Math.round(st.swingProgress * 100)}%).`
        : 'Learning: keep swinging; sweep the tip around rather than twisting the handle.';
    } else if (!st.tip) {
      el.textContent = `Found the wand's long axis (${st.longAxis.toUpperCase()}). Now hold the wand straight up and still for a second.`;
    } else if (!st.up) {
      el.textContent = `Tip is ${st.tip.toUpperCase()}. Holding it level and still a couple of times will confirm which side is the top.`;
    } else {
      el.textContent = `Learned: tip ${st.tip.toUpperCase()}, top ${st.up.toUpperCase()}. Still learning in the background.`;
    }
  }

  function setAutoLearn(on) {
    autoLearn = on;
    $('#auto-align').checked = on;
    saveFlag(AUTO_KEY, on);
    if (on) aligner.reset();
    showAutoStatus();
  }

  // ---- Guided capture: waits until the wand is held still in position ----

  let pending = null;

  async function capture(kind) {
    const button = kind === 'tip' ? $('#capture-tip') : $('#capture-up');
    if (pending) {
      const same = pending.kind === kind;
      pending.cancelled = true;
      if (same) return; // a second click cancels
    }
    if (!streaming()) {
      $('#align-msg').textContent = 'Turn on Stream motion first.';
      return;
    }
    const job = (pending = { kind, cancelled: false });
    const label = button.textContent;
    button.textContent = 'Cancel';
    $('#align-msg').textContent = kind === 'tip'
      ? 'Point the wand straight up and hold it still…'
      : 'Hold the wand level, pointing away, grip buttons up, and keep it still…';

    let message = 'Timed out. Press the button to try again.';
    let stillSince = 0;
    for (const end = performance.now() + 20000; performance.now() < end && !job.cancelled;) {
      await new Promise((r) => setTimeout(r, 100));
      const accel = stillAccel();
      if (!accel) { stillSince = 0; continue; }
      stillSince ||= performance.now();
      if (performance.now() - stillSince < 1000) continue;

      const { axis, confidence } = kind === 'tip' ? upAxisFromAccel(accel) : upAxisFromAccel(accel, alignment.tip);
      if (confidence < 0.85) { stillSince = 0; continue; } // not in position yet
      setAutoLearn(false); // the user is taking control
      if (kind === 'tip') {
        const up = axis[1] === alignment.up[1] ? AXES.find((a) => a[1] !== axis[1]) : alignment.up;
        applyAlignment({ tip: axis, up }, '');
        message = `Tip is raw ${axis.toUpperCase()}. Now do step 2.`;
      } else {
        applyAlignment({ tip: alignment.tip, up: axis }, '');
        message = `Top is raw ${axis.toUpperCase()}. Aligned: the model should now follow your wand.`;
      }
      break;
    }
    if (pending === job) pending = null;
    button.textContent = label;
    if (!job.cancelled) $('#align-msg').textContent = message;
  }

  $('#align-toggle').addEventListener('click', () => {
    const panel = $('#align');
    panel.hidden = !panel.hidden;
    $('#align-toggle').setAttribute('aria-expanded', String(!panel.hidden));
  });
  $('#capture-tip').addEventListener('click', () => capture('tip'));
  $('#capture-up').addEventListener('click', () => capture('up'));
  $('#auto-align').addEventListener('change', (e) => setAutoLearn(e.target.checked));
  tipSel.addEventListener('change', () => {
    setAutoLearn(false);
    applyAlignment({ tip: tipSel.value, up: alignment.up }, 'Tip axis set.');
  });
  upSel.addEventListener('change', () => {
    setAutoLearn(false);
    applyAlignment({ tip: alignment.tip, up: upSel.value }, 'Top axis set.');
  });
  $('#axis-reset').addEventListener('click', () => {
    applyAlignment({ ...DEFAULT_ALIGNMENT }, 'Back to the default axes. Learning again from scratch.');
    setAutoLearn(true);
  });
  $('#auto-align').checked = autoLearn;
  showAutoStatus();
  showAlignment();

  return {
    /** Start fresh, e.g. when a stream (re)starts. */
    reset() {
      filter.reset();
      recenterNext = true;
      period = 0.01;
    },
    onButtons(pressed, all) {
      view3d?.setButtons(pressed, all);
      view3d?.setTipGlow(all);
      if (all && !casting) stroke = null; // a new cast starts a new stroke
      casting = all;
    },
    /** Raw -> body matrix currently in use (for the demo to generate matching data). */
    get matrix() { return matrix; },
  };
}
