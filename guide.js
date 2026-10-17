// guide.js — the spell shape guide: vector drawings of each gesture, as seen
// by the caster, with a start dot and a direction arrow.

import { SPELL_SHAPES } from './spell-shapes.js';

const SVG = 'http://www.w3.org/2000/svg';
let markerCount = 0;

/** Look up a shape by the name the wand reports ("wingardium leviosa", "Expecto_Patronum", …). */
export function shapeFor(name) {
  return SPELL_SHAPES[name.toLowerCase().replace(/[\s-]+/g, '_')] ?? null;
}

function el(tag, attrs = {}) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/** An <svg> drawing of the shape. Strokes draw themselves on when `.drawing` is toggled on the svg. */
export function renderShape(shape, { title } = {}) {
  const [, , w, h] = shape.box;
  const unit = Math.max(w, h) / 100; // so line widths look the same at any size
  const svg = el('svg', { viewBox: shape.box.join(' '), class: 'shape', role: 'img', 'aria-label': title ?? `${shape.name} shape` });
  const id = `arrow-${++markerCount}`;
  const marker = el('marker', { id, viewBox: '0 0 10 10', refX: '6', refY: '5', markerWidth: '4', markerHeight: '4', orient: 'auto-start-reverse' });
  marker.append(el('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: 'shape-arrow' }));
  const defs = el('defs');
  defs.append(marker);
  svg.append(defs);

  shape.strokes.forEach((d, i) => {
    const path = el('path', {
      d,
      class: 'shape-stroke',
      pathLength: '1',
      'stroke-width': (3.2 * unit).toFixed(2),
      'marker-end': `url(#${id})`,
      style: `--delay:${i * 0.9}s`,
    });
    svg.append(path);
    const [sx, sy] = d.match(/-?\d+(\.\d+)?/g).slice(0, 2).map(Number);
    svg.append(el('circle', { cx: sx, cy: sy, r: (5 * unit).toFixed(2), class: 'shape-start' }));
  });
  return svg;
}

/** Restart the draw-on animation. */
export function animate(svg) {
  svg.classList.remove('drawing');
  void svg.getBoundingClientRect();
  svg.classList.add('drawing');
}

/** Points along each stroke, in the shape's own coordinates (for overlays). */
export function sampleShape(shape, step = 4) {
  return shape.strokes.map((d) => {
    const path = el('path', { d });
    const len = path.getTotalLength();
    const pts = [];
    for (let s = 0; s <= len; s += step) {
      const p = path.getPointAtLength(s);
      pts.push({ x: p.x, y: p.y });
    }
    const end = path.getPointAtLength(len);
    pts.push({ x: end.x, y: end.y });
    return pts;
  });
}

/**
 * Build the guide grid into `container`, with a search box `search`.
 * onPick(key | null) is called when a spell is chosen for practice (or cleared).
 */
export function setupGuide({ container, search, onPick }) {
  const tiles = new Map();
  let picked = null;

  const entries = Object.entries(SPELL_SHAPES).sort((a, b) => a[1].name.localeCompare(b[1].name));
  for (const [key, shape] of entries) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'tile';
    tile.dataset.key = key;
    tile.setAttribute('aria-pressed', 'false');
    const svg = renderShape(shape);
    const label = document.createElement('span');
    label.textContent = shape.name;
    tile.append(svg, label);
    tile.addEventListener('mouseenter', () => animate(svg));
    tile.addEventListener('focus', () => animate(svg));
    tile.addEventListener('click', () => pick(picked === key ? null : key));
    container.append(tile);
    tiles.set(key, tile);
  }

  function pick(key) {
    if (picked) tiles.get(picked)?.setAttribute('aria-pressed', 'false');
    picked = key;
    if (key) {
      const tile = tiles.get(key);
      tile.setAttribute('aria-pressed', 'true');
      animate(tile.querySelector('svg'));
    }
    onPick(key);
  }

  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    for (const [key, tile] of tiles) {
      const hit = !q || SPELL_SHAPES[key].name.toLowerCase().includes(q);
      tile.hidden = !hit;
      shown += hit;
    }
    container.dataset.empty = shown ? '' : 'No spell by that name';
  });

  return {
    pick,
    /** Briefly highlight the tile of a spell that was just cast. */
    flash(name) {
      const key = name.toLowerCase().replace(/[\s-]+/g, '_');
      const tile = tiles.get(key);
      if (!tile) return;
      tile.classList.remove('cast');
      void tile.offsetWidth;
      tile.classList.add('cast');
    },
    get count() { return tiles.size; },
  };
}
