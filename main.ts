// news-image-20261122 — "The World Today": one front page summing up
// Sunday 22 November 2026. Written fresh in this session for @nax.
// Node 22, standard library only, no network, fully deterministic:
// the same bytes come out of every run.
//
// Layout: masthead, lead story (COP31 overtime in Antalya) with the
// headline on the left and a drawn dawn scene on the right, then six
// story cards in a 3 x 2 grid with an icon at the top right of each,
// and a bottom strip with two more items. Every letter comes from a
// small 5x7 bitmap font defined below, and the PNG bytes are encoded
// by hand (zlib deflate + CRC32), so the program needs nothing but node.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------- font --
// A 5x7 bitmap font, '#' = ink, '.' = blank. Uppercase, digits and the
// punctuation the page needs. All page text is set in capitals.
const FONT: Record<string, string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.####', '#....', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '##..#', '#.#.#', '#..##', '#..##', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '0': ['.###.', '#..##', '#.#.#', '##..#', '#...#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '...#.', '..#..', '..#..', '..#..'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ',': ['.....', '.....', '.....', '.....', '.##..', '.##..', '.#...'],
  ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
  ';': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.#...'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  "'": ['..#..', '..#..', '.#...', '.....', '.....', '.....', '.....'],
  '"': ['.#.#.', '.#.#.', '.#.#.', '.....', '.....', '.....', '.....'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '(': ['...##', '..#..', '.#...', '.#...', '.#...', '..#..', '...##'],
  ')': ['##...', '..#..', '...#.', '...#.', '...#.', '..#..', '##...'],
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
  '%': ['##..#', '##.#.', '...#.', '..#..', '.#...', '#.##.', '#..##'],
  '&': ['.##..', '#..#.', '#..#.', '.#...', '#.#.#', '#..#.', '.##.#'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  '=': ['.....', '.....', '#####', '.....', '#####', '.....', '.....'],
  $: ['..#..', '.####', '#.#..', '.###.', '..#.#', '####.', '..#..'],
  '*': ['.....', '.#.#.', '..#..', '#####', '..#..', '.#.#.', '.....'],
  '#': ['.#.#.', '.#.#.', '#####', '.#.#.', '#####', '.#.#.', '.#.#.'],
  '\u2022': ['.....', '.....', '.###.', '.###.', '.###.', '.....', '.....'],
};

type RGB = [number, number, number];

// -------------------------------------------------------------- canvas --
class Page {
  readonly w: number;
  readonly h: number;
  private readonly buf: Buffer; // RGBA, row-major

  constructor(w: number, h: number, bg: RGB) {
    this.w = w;
    this.h = h;
    this.buf = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      this.buf[i * 4] = bg[0];
      this.buf[i * 4 + 1] = bg[1];
      this.buf[i * 4 + 2] = bg[2];
      this.buf[i * 4 + 3] = 255;
    }
  }

  put(x: number, y: number, c: RGB): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.buf[i] = c[0];
    this.buf[i + 1] = c[1];
    this.buf[i + 2] = c[2];
  }

  fill(x: number, y: number, w: number, h: number, c: RGB): void {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) this.put(xx, yy, c);
    }
  }

  frame(x: number, y: number, w: number, h: number, c: RGB, t = 1): void {
    this.fill(x, y, w, t, c);
    this.fill(x, y + h - t, w, t, c);
    this.fill(x, y, t, h, c);
    this.fill(x + w - t, y, t, h, c);
  }

  hline(x0: number, x1: number, y: number, c: RGB, t = 1): void {
    for (let k = 0; k < t; k++) {
      for (let x = x0; x <= x1; x++) this.put(x, y + k, c);
    }
  }

  // Bresenham segment with a square brush of side t.
  seg(x0: number, y0: number, x1: number, y1: number, c: RGB, t = 1): void {
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let x = x0;
    let y = y0;
    for (;;) {
      this.fill(x - Math.floor(t / 2), y - Math.floor(t / 2), t, t, c);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  // Quadratic bezier as a polyline of 40 steps.
  curve(x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, c: RGB, t = 1): void {
    let px = x0;
    let py = y0;
    for (let i = 1; i <= 40; i++) {
      const s = i / 40;
      const x = Math.round((1 - s) * (1 - s) * x0 + 2 * (1 - s) * s * cx + s * s * x1);
      const y = Math.round((1 - s) * (1 - s) * y0 + 2 * (1 - s) * s * cy + s * s * y1);
      this.seg(px, py, x, y, c, t);
      px = x;
      py = y;
    }
  }

  disc(cx: number, cy: number, r: number, c: RGB): void {
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        if (x * x + y * y <= r * r) this.put(cx + x, cy + y, c);
      }
    }
  }

  ring(cx: number, cy: number, r: number, c: RGB, t = 2): void {
    for (let a = 0; a < 360; a += 2) {
      const rad = (a * Math.PI) / 180;
      for (let k = 0; k < t; k++) {
        this.put(Math.round(cx + (r + k) * Math.cos(rad)), Math.round(cy + (r + k) * Math.sin(rad)), c);
      }
    }
  }

  // Filled polygon by scanline.
  poly(points: Array<[number, number]>, c: RGB): void {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, y] of points) {
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const xs: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const [x0, y0] = points[i];
        const [x1, y1] = points[(i + 1) % points.length];
        if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
          xs.push(Math.round(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0)));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = xs[k]; x <= xs[k + 1]; x++) this.put(x, y, c);
      }
    }
  }

  // ---- text ----
  measure(s: string, scale: number): number {
    return s.length * 6 * scale - scale;
  }

  glyph(x: number, y: number, ch: string, scale: number, c: RGB): void {
    const g = FONT[ch] ?? FONT['?'];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (g[row][col] === '#') {
          this.fill(x + col * scale, y + row * scale, scale, scale, c);
        }
      }
    }
  }

  text(x: number, y: number, s: string, scale: number, c: RGB): void {
    const up = s.toUpperCase();
    for (let i = 0; i < up.length; i++) {
      this.glyph(x + i * 6 * scale, y, up[i], scale, c);
    }
  }

  centred(cx: number, y: number, s: string, scale: number, c: RGB): void {
    this.text(cx - Math.floor(this.measure(s, scale) / 2), y, s, scale, c);
  }

  // Word-wrap to lines of at most maxW pixels; returns the lines.
  // When maxLines cuts the text, the last kept line gains an ellipsis
  // so a cut is visible instead of words vanishing silently.
  wrap(s: string, maxW: number, scale: number, maxLines?: number): string[] {
    const words = s.toUpperCase().split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      const cand = cur ? cur + ' ' + w : w;
      if (this.measure(cand, scale) <= maxW || !cur) {
        cur = cand;
      } else {
        lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    if (maxLines !== undefined && lines.length > maxLines) {
      const kept = lines.slice(0, maxLines);
      let last = kept[maxLines - 1];
      while (last.length > 0 && this.measure(last + '...', scale) > maxW) {
        const sp = last.lastIndexOf(' ');
        last = sp > 0 ? last.slice(0, sp) : '';
      }
      kept[maxLines - 1] = last ? last + '...' : '...';
      return kept;
    }
    return lines;
  }

  raw(): Buffer {
    return this.buf;
  }
}

// -------------------------------------------------------------- PNG out --
const CRC: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}

function encodePng(p: Page): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(p.w, 0);
  ihdr.writeUInt32BE(p.h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(p.h * (1 + p.w * 4));
  const px = p.raw();
  for (let y = 0; y < p.h; y++) {
    raw[y * (1 + p.w * 4)] = 0; // filter: none
    px.copy(raw, y * (1 + p.w * 4) + 1, y * p.w * 4, (y + 1) * p.w * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// -------------------------------------------------------------- palette --
const PAPER: RGB = [247, 243, 234];
const PANEL: RGB = [255, 253, 246];
const INK: RGB = [22, 22, 22];
const RED: RGB = [176, 30, 30];
const NAVY: RGB = [31, 58, 95];
const GREY: RGB = [90, 86, 76];
const ORANGE: RGB = [232, 120, 32];
const YELLOW: RGB = [245, 196, 66];
const WHITE: RGB = [255, 255, 255];
const TEAL: RGB = [18, 110, 110];
const SEA: RGB = [24, 96, 116];
const DAWN: RGB = [250, 224, 158];
const BODY: RGB = [52, 50, 44];

// ---------------------------------------------------------------- icons --
// Each icon is drawn inside a 56x56 box at (ox, oy).
function iconColumns(p: Page, ox: number, oy: number): void {
  p.fill(ox, oy, 56, 56, [226, 236, 246]);
  // pediment
  p.poly(
    [
      [ox + 6, oy + 18],
      [ox + 28, oy + 6],
      [ox + 50, oy + 18],
    ],
    NAVY,
  );
  p.fill(ox + 6, oy + 18, 44, 3, NAVY);
  // three columns
  for (const cx of [12, 25, 38]) {
    p.fill(ox + cx, oy + 23, 6, 20, WHITE);
    p.frame(ox + cx, oy + 23, 6, 20, NAVY, 1);
  }
  p.fill(ox + 6, oy + 44, 44, 4, NAVY);
}

function iconCurve(p: Page, ox: number, oy: number): void {
  p.fill(ox, oy, 56, 56, [250, 238, 220]);
  p.seg(ox + 6, oy + 8, ox + 6, oy + 48, INK, 2);
  p.seg(ox + 6, oy + 48, ox + 50, oy + 48, INK, 2);
  // rising curve with a dip, like a zeta graph
  p.curve(ox + 8, oy + 40, ox + 18, oy + 12, ox + 28, oy + 30, RED, 3);
  p.curve(ox + 28, oy + 30, ox + 38, oy + 44, ox + 48, oy + 14, RED, 3);
  p.text(ox + 40, oy + 4, '?', 2, RED);
}

function iconBallot(p: Page, ox: number, oy: number): void {
  p.fill(ox, oy, 56, 56, [238, 232, 220]);
  // ballot slip going into the box
  p.poly(
    [
      [ox + 14, oy + 6],
      [ox + 30, oy + 6],
      [ox + 26, oy + 24],
      [ox + 10, oy + 24],
    ],
    WHITE,
  );
  p.frame(ox + 14, oy + 6, 16, 18, INK, 1);
  p.seg(ox + 17, oy + 15, ox + 21, oy + 19, RED, 2);
  p.seg(ox + 21, oy + 19, ox + 27, oy + 10, RED, 2);
  // box
  p.fill(ox + 8, oy + 26, 40, 22, NAVY);
  p.fill(ox + 20, oy + 26, 16, 3, WHITE);
  p.text(ox + 18, oy + 33, 'HK', 2, WHITE);
}

function iconSeismo(p: Page, ox: number, oy: number): void {
  p.fill(ox, oy, 56, 56, [226, 240, 238]);
  p.seg(ox + 4, oy + 28, ox + 14, oy + 28, TEAL, 3);
  p.seg(ox + 14, oy + 28, ox + 18, oy + 10, TEAL, 3);
  p.seg(ox + 18, oy + 10, ox + 22, oy + 46, TEAL, 3);
  p.seg(ox + 22, oy + 46, ox + 26, oy + 18, TEAL, 3);
  p.seg(ox + 26, oy + 18, ox + 30, oy + 36, TEAL, 3);
  p.seg(ox + 30, oy + 36, ox + 34, oy + 28, TEAL, 3);
  p.seg(ox + 34, oy + 28, ox + 52, oy + 28, TEAL, 3);
}

function iconPlacard(p: Page, ox: number, oy: number): void {
  p.fill(ox, oy, 56, 56, [250, 232, 228]);
  // stick
  p.fill(ox + 26, oy + 28, 4, 24, INK);
  // placard
  p.fill(ox + 10, oy + 6, 36, 24, WHITE);
  p.frame(ox + 10, oy + 6, 36, 24, RED, 2);
  p.text(ox + 24, oy + 11, '!', 2, RED);
  // small crowd heads below
  p.disc(ox + 12, oy + 50, 4, NAVY);
  p.disc(ox + 28, oy + 50, 4, NAVY);
  p.disc(ox + 44, oy + 50, 4, NAVY);
}

function iconTennis(p: Page, ox: number, oy: number): void {
  p.fill(ox, oy, 56, 56, [226, 236, 246]);
  // ball
  p.disc(ox + 28, oy + 30, 20, [196, 214, 74]);
  p.ring(ox + 28, oy + 30, 20, WHITE, 2);
  p.curve(ox + 12, oy + 18, ox + 22, oy + 28, ox + 12, oy + 42, WHITE, 3);
  p.curve(ox + 44, oy + 18, ox + 34, oy + 28, ox + 44, oy + 42, WHITE, 3);
  // motion ticks
  p.seg(ox + 4, oy + 12, ox + 10, oy + 16, ORANGE, 2);
  p.seg(ox + 52, oy + 12, ox + 46, oy + 16, ORANGE, 2);
}

// ----------------------------------------------------------- lead scene --
// Dawn over Antalya bay: low sun, mountains, sea, and a thermometer
// rising at the right edge — the climate summit running into overtime.
function drawAntalya(p: Page, x: number, y: number, w: number, h: number): void {
  p.fill(x, y, w, h, DAWN);
  // sun with a glow ring, low on the horizon
  const sunX = x + Math.floor(w * 0.62);
  const sunY = y + 118;
  p.disc(sunX, sunY, 52, [250, 200, 110]);
  p.disc(sunX, sunY, 40, ORANGE);
  p.ring(sunX, sunY, 46, [255, 255, 255], 2);
  // mountains along the left horizon
  p.poly(
    [
      [x, y + 150],
      [x + 70, y + 96],
      [x + 130, y + 132],
      [x + 190, y + 104],
      [x + 250, y + 150],
    ],
    [64, 74, 96],
  );
  // sea
  p.fill(x, y + 150, w, h - 150, SEA);
  // wave lines
  for (const [wy, wx0, wx1] of [
    [176, 20, 180],
    [196, 240, 420],
    [216, 60, 260],
    [236, 300, 480],
  ] as const) {
    p.hline(x + wx0, x + wx1, y + wy, [150, 200, 210], 2);
  }
  // sun reflection on the water
  for (let k = 0; k < 5; k++) {
    const ww = 90 - k * 12;
    p.hline(sunX - Math.floor(ww / 2), sunX + Math.floor(ww / 2), y + 162 + k * 16, [245, 196, 66], 3);
  }
  // thermometer at the right edge
  const tx = x + w - 34;
  const ty = y + 18;
  p.fill(tx, ty, 16, 150, WHITE);
  p.frame(tx, ty, 16, 150, INK, 2);
  p.fill(tx + 3, ty + 42, 10, 108, RED);
  p.disc(tx + 8, ty + 150, 13, RED);
  p.ring(tx + 8, ty + 150, 13, INK, 2);
  // OVERTIME tag
  p.fill(x + 12, y + 12, 216, 26, RED);
  p.text(x + 20, y + 18, 'OVERTIME - DAY 14', 2, WHITE);
  // place label
  p.text(x + 16, y + h - 26, 'ANTALYA, TURKIYE', 2, WHITE);
}

// ------------------------------------------------------------ story card --
interface Card {
  kicker: string;
  headline: string;
  deck: string;
  icon: (p: Page, ox: number, oy: number) => void;
}

function drawCard(p: Page, x: number, y: number, w: number, h: number, s: Card): void {
  p.fill(x, y, w, h, PANEL);
  p.frame(x, y, w, h, [214, 206, 188], 1);
  p.text(x + 12, y + 12, s.kicker, 2, RED);
  s.icon(p, x + w - 68, y + 10);
  // Headline sits below the icon row so the two never overlap.
  const headLines = p.wrap(s.headline, w - 24, 3, 2);
  let cy = y + 70;
  for (const ln of headLines) {
    p.text(x + 12, cy, ln, 3, INK);
    cy += 24;
  }
  const deckLines = p.wrap(s.deck, w - 24, 2, 4);
  cy += 4;
  for (const ln of deckLines) {
    p.text(x + 12, cy, ln, 2, BODY);
    cy += 15;
  }
}

// ----------------------------------------------------------------- page --
function buildPage(): Page {
  const p = new Page(W, H, PAPER);
  p.frame(8, 8, W - 16, H - 16, INK, 3);
  p.frame(15, 15, W - 30, H - 30, INK, 1);

  // ---- masthead ----
  p.centred(512, 30, 'THE WORLD TODAY', 7, INK);
  p.hline(60, 964, 92, INK, 2);
  p.centred(512, 102, 'SUNDAY 22 NOVEMBER 2026', 3, RED);
  p.hline(60, 964, 132, INK, 1);
  p.hline(60, 964, 135, INK, 3);

  // ---- lead story: COP31 ----
  const leadY = 148;
  const leadH = 272;
  drawAntalya(p, 492, leadY, 508, leadH);
  const lx = 24;
  const lw = 452;
  p.text(lx, leadY + 8, 'ANTALYA - CLIMATE TALKS', 2, RED);
  const leadHead = ['COP31 NEARS', 'A DEAL', 'AT DAWN'];
  let hy = leadY + 38;
  for (const ln of leadHead) {
    p.text(lx, hy, ln, 4, INK);
    hy += 32;
  }
  const deck =
    'AFTER TWO DAYS OF OVERTIME, THE SUMMIT PRESIDENT SAYS A TEXT ALL SIDES CAN ACCEPT IS READY FOR A SUNDAY VOTE. FOSSIL FUELS AND AID FOR POOR NATIONS WERE THE LAST FIGHTS.';
  const deckLines = p.wrap(deck, lw, 2, 6);
  let dy = hy + 8;
  for (const ln of deckLines) {
    p.text(lx, dy, ln, 2, BODY);
    dy += 16;
  }
  p.text(lx, leadY + leadH - 22, 'REPORTED 22 NOVEMBER', 2, GREY);

  // ---- divider ----
  p.hline(24, 1000, 436, INK, 2);

  // ---- six story cards, 3 x 2 ----
  const cards: Card[] = [
    {
      kicker: 'ISRAEL',
      headline: 'EISENKOT TAPPED TO LEAD',
      deck: 'PRESIDENT HERZOG ASKS EX-ARMY CHIEF EISENKOT TO FORM A GOVERNMENT, PASSING OVER NETANYAHU.',
      icon: iconColumns,
    },
    {
      kicker: 'MATHEMATICS',
      headline: 'RIEMANN PROOF QUESTIONED',
      deck: 'A DAY AFTER LEAN CERTIFIED THE AI-MADE PROOF, A NEW PAPER SAYS ITS GEOMETRY IS TRIVIAL.',
      icon: iconCurve,
    },
    {
      kicker: 'HONG KONG',
      headline: 'HONG KONG VOTES',
      deck: "POLLS OPEN TO ELECT THE ELECTION COMMITTEE, THE SMALL BODY THAT CHOOSES THE CITY'S LEADER.",
      icon: iconBallot,
    },
    {
      kicker: 'MYANMAR',
      headline: 'QUAKE SHAKES MYANMAR',
      deck: 'A MAGNITUDE 4.1 QUAKE STRIKES IN THE EARLY HOURS OF SUNDAY, THE SEISMOLOGY CENTRE SAYS.',
      icon: iconSeismo,
    },
    {
      kicker: 'FRANCE',
      headline: 'FOURTH WEEKEND OF PROTESTS',
      deck: 'STREETS FILL AGAIN ACROSS FRANCE AS LIVING COSTS KEEP RISING. THE FOURTH WEEKEND IN A ROW.',
      icon: iconPlacard,
    },
    {
      kicker: 'SPORT',
      headline: 'ALCARAZ V ZVEREV FOR TITLE',
      deck: 'CARLOS ALCARAZ FACES WORLD NO. 1 ALEXANDER ZVEREV IN THE ATP FINALS DECIDER IN TURIN.',
      icon: iconTennis,
    },
  ];
  const cardW = 317;
  const cardH = 196;
  const gapX = 12;
  const gapY = 12;
  const gridY = 450;
  for (let i = 0; i < cards.length; i++) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    drawCard(p, 24 + col * (cardW + gapX), gridY + row * (cardH + gapY), cardW, cardH, cards[i]);
  }

  // ---- bottom strip: two more items ----
  const stripY = 868;
  p.fill(24, stripY, 976, 62, NAVY);
  p.text(40, stripY + 12, "ALSO TODAY: PERU - 1 DEAD, 152 HOMES UNINHABITABLE AFTER THE M6.8 QUAKE", 2, WHITE);
  p.text(40, stripY + 34, 'ZELENSKY: NATO MEMBERSHIP IS THE CLEAREST SECURITY GUARANTEE FOR UKRAINE', 2, WHITE);
  p.hline(24, 1000, 944, INK, 1);
  p.centred(512, 954, 'THE WORLD TODAY  -  SUNDAY 22 NOVEMBER 2026', 2, GREY);

  return p;
}

// ------------------------------------------------------------------ main --
function main(): void {
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(outDir, { recursive: true });
  const png = encodePng(buildPage());
  writeFileSync(join(outDir, 'entry.png'), png);
}

main();
