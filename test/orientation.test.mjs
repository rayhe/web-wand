import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alignmentMatrix, applyMatrix, transpose, validAlignment, upAxisFromAccel,
  OrientationFilter, eulerOf, rotate,
} from '../orientation.js';

const DEG = 180 / Math.PI;
const near = (a, b, eps = 1) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test('alignment maps the chosen raw axes onto the body frame', () => {
  const m = alignmentMatrix({ tip: '+y', up: '-x' });
  assert.deepEqual(m, [[0, 1, 0], [0, 0, -1], [-1, 0, 0]]);
  assert.deepEqual(applyMatrix(m, [0, 1, 0]), [1, 0, 0]);
  const v = [0.3, -0.2, 0.9];
  applyMatrix(transpose(m), applyMatrix(m, v)).forEach((c, i) => near(c, v[i], 1e-9));
  assert.equal(validAlignment({ tip: '+x', up: '-x' }), false);
});

test('up axis is found from a still accelerometer reading', () => {
  assert.equal(upAxisFromAccel([0.05, 0.02, -0.99]).axis, '-z');
  assert.equal(upAxisFromAccel([0.1, 0.97, 0.2], '+y').axis, '+z');
});

test('filter levels itself from gravity', () => {
  const f = new OrientationFilter();
  f.update([0, 0, 0], [0.5, 0, Math.sqrt(3) / 2], 0.01);
  near(eulerOf(f.q).pitch * DEG, 30);
});

test('filter integrates a turn', () => {
  const f = new OrientationFilter();
  f.update([0, 0, 0], [0, 0, 1], 0.01);
  for (let i = 0; i < 50; i++) f.update([0, 0, 1], [0, 0, 1], 0.01);
  near(eulerOf(f.q).yaw * DEG, 28.6);
  const tip = rotate(f.q, [1, 0, 0]);
  near(tip[1], Math.sin(0.5), 0.01);
});

test('auto-aligner learns tip from swings + hold-up, top from level holds', async () => {
  const { AutoAligner } = await import('../orientation.js');
  const truth = alignmentMatrix({ tip: '-y', up: '+x' });
  const toRaw = (v) => applyMatrix(transpose(truth), v);
  const a = new AutoAligner();
  const dt = 0.01;
  // Swings: rotation about the body's y/z (sweeping the tip), little roll.
  for (let i = 0; i < 300; i++) {
    const t = i * dt;
    a.push(toRaw([0.2 * Math.sin(t * 11), 3 * Math.sin(t * 7), 3 * Math.cos(t * 5)]), toRaw([0, 0, 1]), dt);
  }
  assert.equal(a.status.longAxis, 'y');
  // Lying on a table (not just swung) must not vote for the top.
  for (let i = 0; i < 400; i++) a.push(toRaw([0, 0, 0]), toRaw([0, 1, 0]), dt);
  // Held straight up.
  for (let i = 0; i < 150; i++) a.push(toRaw([0, 0, 0]), toRaw([0.99, 0, 0.1]), dt);
  assert.deepEqual(a.result, { tip: '-y', up: null });
  // Two level holds right after moving, buttons up.
  for (let k = 0; k < 2; k++) {
    for (let i = 0; i < 20; i++) a.push(toRaw([0, 0, 3]), toRaw([0, 0, 1]), dt);
    for (let i = 0; i < 150; i++) a.push(toRaw([0, 0, 0]), toRaw([0.2, 0, 0.98]), dt);
  }
  assert.deepEqual(a.result, { tip: '-y', up: '+x' });
});
