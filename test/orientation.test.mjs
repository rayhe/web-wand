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
