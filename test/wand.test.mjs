import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePacket, Macro, MagicCasterWand, LED } from '../wand.js';

test('spell packet', () => {
  const name = new TextEncoder().encode('wingardium_leviosa\0');
  assert.deepEqual(parsePacket([0x24, 0, 0, name.length, ...name]), { type: 'spell', name: 'wingardium leviosa' });
});

test('button mask', () => {
  assert.deepEqual(parsePacket([0x10, 0x05]), { type: 'buttons', mask: 5, pressed: [true, false, true, false], all: false });
  assert.equal(parsePacket([0x10, 0x0f]).all, true);
});

test('imu samples are scaled', () => {
  const v = new DataView(new ArrayBuffer(4 + 12));
  v.setUint8(0, 0x2c); v.setUint16(1, 7, true); v.setUint8(3, 1);
  [1000, -1000, 0, 2048, 0, -2048].forEach((n, i) => v.setInt16(4 + i * 2, n, true));
  const p = parsePacket(new Uint8Array(v.buffer));
  assert.equal(p.type, 'imu');
  assert.equal(p.start, 7);
  assert.ok(Math.abs(p.samples[0].gyro[0] - 1.0908308) < 1e-6);
  assert.deepEqual(p.samples[0].accel, [1, 0, -1]);
});

test('truncated imu packet is rejected', () => {
  assert.equal(parsePacket([0x2c, 0, 0, 2, 1, 2, 3]), null);
});

test('device id maps to wand type', () => {
  const id = new TextEncoder().encode('WBMC22G1SHNW');
  assert.deepEqual(parsePacket([0x0e, 0x04, ...id]), { type: 'deviceId', deviceId: 'WBMC22G1SHNW', wandType: 'Honourable' });
});

test('firmware and serial', () => {
  assert.deepEqual(parsePacket([0x00, 1, 2, 3]), { type: 'firmware', version: '1.2.3' });
  assert.deepEqual(parsePacket([0x0e, 0x01, 0x4e, 0x61, 0xbc, 0x00]), { type: 'serial', serial: '12345678' });
});

test('macro encoding matches the reference implementation', () => {
  const bytes = new Macro().buzz(200).ledHex(LED.TIP, 'FF8000', 300).delay(500).clear().bytes();
  assert.deepEqual([...bytes], [0x68, 0x50, 200, 0, 0x22, 0, 0xff, 0x80, 0x00, 0x2c, 0x01, 0x10, 0xf4, 0x01, 0x20]);
});

test('inject dispatches typed events', () => {
  const wand = new MagicCasterWand();
  const seen = [];
  wand.addEventListener('buttons', (e) => seen.push(e.detail.all));
  wand.addEventListener('info', (e) => seen.push(e.detail.firmware));
  wand.inject([0x10, 0x0f]);
  wand.inject([0x00, 0, 3]);
  assert.deepEqual(seen, [true, '0.3']);
});
