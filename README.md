# Web Wand 🪄

Connect a **Harry Potter: Magic Caster Wand** to your browser over Web Bluetooth. No app, install or server needed.

**Live:** https://rayhe.github.io/web-wand/

- **Spells.** The wand recognizes spells itself and reports their names. The page shows each spell and can answer with lights and a buzz on the wand.
- **Grip buttons.** Shows each of the four touch buttons as you press it, and marks when all four are held ("casting").
- **Motion.** Streams the gyroscope and accelerometer, and traces the tip's path while you cast.
- **Lights and vibration.** Set the four light groups (tip, upper, lower, handle), buzz the wand, and play built-in effects such as Lumos and Incendio.
- **Raw packets.** A log of every notification, for anyone exploring the protocol.
- **Auto-connect.** Reconnects on its own when the wand wakes up, including across page reloads (see below).
- **Battery.** Shows the level and a state (Critical, Low, Medium, High). A reading of 100% is shown as "Charging", which is what the wand reports on its charger.
- **Demo mode.** Fakes a wand by sending real-format packets, so you can try the page without the hardware.

## Requirements

- A browser with Web Bluetooth: Chrome or Edge on Windows, macOS, ChromeOS, Linux or Android. Safari, iOS browsers and Firefox don't support it.
- HTTPS or `localhost`. GitHub Pages provides HTTPS.
- The wand awake and not connected to a phone app. Its Bluetooth name starts with `MCW-`.

## Auto-connect

Within one visit, the page reconnects by itself whenever the wand drops out (asleep or out of range) and comes back.

Remembering the wand **across reloads** uses `navigator.bluetooth.getDevices()`, which Chrome keeps behind a flag for now:

1. Open `chrome://flags/#enable-web-bluetooth-new-permissions-backend` and set it to **Enabled**. On Edge the address starts with `edge://`.
2. Restart the browser and connect the wand once with **Connect wand**.

After that, opening the page connects as soon as the wand wakes up, with no picker. **Forget wand** removes the site's access.

## Use the driver in your own page

`wand.js` is a standalone ES module with no dependencies:

```js
import { MagicCasterWand, Macro, LED } from './wand.js';

const wand = new MagicCasterWand();
wand.addEventListener('spell', (e) => console.log('Cast:', e.detail.name));
wand.addEventListener('buttons', (e) => console.log(e.detail.pressed, e.detail.all));
wand.addEventListener('imu', (e) => console.log(e.detail.samples)); // after startImu()

// Reconnect to a wand picked on an earlier visit, no click needed (see Auto-connect).
wand.autoConnect();

button.onclick = async () => {
  await wand.connect();            // must run inside a user gesture
  await wand.startImu();
  await wand.setLed(LED.TIP, 255, 200, 50);
  await wand.runMacro(new Macro().buzz(150).ledHex(LED.TIP, 'ffffff', 1000).delay(500).clear());
};
```

| Event | `e.detail` |
| --- | --- |
| `connect` / `disconnect` | `{ name }` / `{ expected }` (false if the wand dropped out) |
| `waiting` | `{ name }` (auto-connect is waiting for the wand to wake) |
| `spell` | `{ name }` |
| `buttons` | `{ pressed: [b1, b2, b3, b4], all, mask }` |
| `imu` | `{ samples: [{ gyro: [x, y, z] (rad/s), accel: [x, y, z] (g) }] }` |
| `battery` | `{ level, state }` (percent; `charging` / `high` / `medium` / `low` / `critical`) |
| `info` | `{ firmware, deviceId, wandType, serial }` |
| `packet` | `{ bytes, parsed }` (every raw notification) |

## Protocol summary

| | UUID |
| --- | --- |
| Service | `57420001-587e-48a0-974c-544d6163c577` |
| Command (write) | `57420002-587e-48a0-974c-544d6163c577` |
| Notify | `57420003-587e-48a0-974c-544d6163c577` |
| Battery | standard `0x180F` / `0x2A19` |

Notifications start with an opcode: `0x24` spell, `0x10` buttons, `0x2C` IMU (12 bytes per sample: gyro xyz, then accel xyz, int16 little-endian), `0x00` firmware, `0x0E` product info. Commands include `0x30 00 80` (start IMU), `0x31` (stop IMU), `0x42 group r g b` (set LED), `0x40` (LEDs off), and `0x68 …` macros (`0x50 ms16` buzz, `0x22 group r g b ms16` LED, `0x10 ms16` delay, `0x20` clear). See [`wand.js`](wand.js) for details.

## Development

It's a static site with no build step:

```bash
python -m http.server 8000
```

Then open http://localhost:8000. To run the parser tests (Node 20+):

```bash
node --test test/
```

## Credits

The protocol comes from community reverse-engineering, mainly [eigger/hass-magic-caster-wand](https://github.com/eigger/hass-magic-caster-wand) (MIT). Thank you!

This is an unofficial fan project, not affiliated with or endorsed by Warner Bros., Wizarding World or the wand's makers. Harry Potter is a trademark of Warner Bros. Entertainment Inc.

## License

[MIT](LICENSE)
