// demo.js — fakes a wand by injecting packets in the real wire format, so the
// whole parsing + UI path runs without hardware.

import { MSG } from './wand.js';

const GYRO_SCALE = 0.0010908308;
const ACCEL_SCALE = 0.00048828125;
const TICK_MS = 20; // one IMU packet per tick
const PER_PACKET = 2; // samples per packet

// Each shape maps t in [0,1] to a tip position in radians.
const CASTS = [
  { spell: 'lumos', shape: (t) => [0.05 * Math.sin(t * 6), 0.3 - 0.6 * t] },
  { spell: 'incendio', shape: (t) => [-0.35 + 0.7 * t, 0.2 * (Math.abs(((t * 4) % 2) - 1) * 2 - 1)] },
  {
    spell: 'wingardium leviosa',
    shape: (t) => (t < 0.75
      ? [-0.35 + 0.6 * (t / 0.75), 0.18 * Math.sin((t / 0.75) * Math.PI)]
      : [0.25 + 0.1 * ((t - 0.75) / 0.25), -0.3 * ((t - 0.75) / 0.25)]),
  },
  { spell: 'expecto patronum', shape: (t) => [0.35 * t * Math.cos(t * 14), 0.35 * t * Math.sin(t * 14)] },
];

const buttons = (mask) => [MSG.BUTTONS, mask];

function spellPacket(name) {
  const bytes = new TextEncoder().encode(name.replace(/ /g, '_'));
  return [MSG.SPELL, 0, 0, bytes.length, ...bytes];
}

function imuPacket(index, samples) {
  const buf = new DataView(new ArrayBuffer(4 + samples.length * 12));
  buf.setUint8(0, MSG.IMU);
  buf.setUint16(1, index, true);
  buf.setUint8(3, samples.length);
  samples.forEach(([gx, gy, gz], i) => {
    const o = 4 + i * 12;
    const clamp = (v) => Math.max(-32768, Math.min(32767, Math.round(v)));
    buf.setInt16(o, clamp(gx / GYRO_SCALE), true);
    buf.setInt16(o + 2, clamp(gy / GYRO_SCALE), true);
    buf.setInt16(o + 4, clamp(gz / GYRO_SCALE), true);
    buf.setInt16(o + 6, 0, true);
    buf.setInt16(o + 8, 0, true);
    buf.setInt16(o + 10, clamp(1 / ACCEL_SCALE), true); // 1 g of gravity
  });
  return new Uint8Array(buf.buffer);
}

export function startDemo(wand) {
  let stopped = false;
  let index = 0;
  const timers = new Set();
  const wait = (ms) => new Promise((r) => { const id = setTimeout(() => { timers.delete(id); r(); }, ms); timers.add(id); });

  async function idle(ms) {
    // Small wobble so the gyro readout looks alive between casts.
    for (let t = 0; t < ms && !stopped; t += TICK_MS) {
      const jitter = () => [(Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.04];
      wand.inject(imuPacket(index++ & 0xffff, [jitter(), jitter()]));
      await wait(TICK_MS);
    }
  }

  async function cast({ spell, shape }) {
    wand.inject(buttons(0x01));
    await wait(80);
    wand.inject(buttons(0x0f));
    const steps = 140;
    const dt = TICK_MS / 1000 / PER_PACKET;
    let prev = shape(0);
    for (let i = 1; i <= steps && !stopped; i += PER_PACKET) {
      const samples = [];
      for (let k = 0; k < PER_PACKET; k++) {
        const cur = shape(Math.min(1, (i + k) / steps));
        // The app integrates x -= gz*dt, y -= gy*dt; invert that here.
        samples.push([0, -(cur[1] - prev[1]) / dt, -(cur[0] - prev[0]) / dt]);
        prev = cur;
      }
      wand.inject(imuPacket(index++ & 0xffff, samples));
      await wait(TICK_MS);
    }
    wand.inject(buttons(0x00));
    await wait(250);
    if (!stopped) wand.inject(spellPacket(spell));
  }

  (async () => {
    wand.inject(new Uint8Array([MSG.FIRMWARE_VERSION, 0, 3]));
    for (let n = 0; !stopped; n++) {
      await idle(1200);
      if (!stopped) await cast(CASTS[n % CASTS.length]);
    }
  })();

  return {
    stop() {
      stopped = true;
      timers.forEach(clearTimeout);
      wand.inject(buttons(0x00));
    },
  };
}
