// THE WORLD TODAY — front page for Sunday 22 November 2026.
// A from-scratch newspaper renderer: stroke-based vector glyphs drawn
// onto an RGB canvas, then encoded to PNG with a hand-rolled encoder
// (node:zlib for deflate, own CRC32). Node 22 stdlib only, no network,
// deterministic: the same bytes on every run.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------- palette
type RGB = [number, number, number];
const PAPER: RGB = [248, 244, 233];
const INK: RGB = [24, 24, 24];
const RED: RGB = [176, 32, 32];
const NAVY: RGB = [16, 40, 64];
const GOLD: RGB = [188, 138, 40];
const GREY: RGB = [96, 92, 84];
const WHITE: RGB = [252, 250, 244];

// ------------------------------------------------------------------ canvas
class Sheet {
  px: Uint8Array;
  w: number;
  h: number;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h * 3);
  }
  fill(c: RGB): void {
    for (let i = 0; i < this.px.length; i += 3) {
      this.px[i] = c[0];
      this.px[i + 1] = c[1];
      this.px[i + 2] = c[2];
    }
  }
  dot(x: number, y: number, c: RGB): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.px[i] = c[0];
    this.px[i + 1] = c[1];
    this.px[i + 2] = c[2];
  }
  // solid rectangle, inclusive of x0/y0, exclusive of x1/y1
  rect(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
    for (let y = Math.max(0, y0); y < Math.min(this.h, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(this.w, x1); x++) {
        this.dot(x, y, c);
      }
    }
  }
  // rectangle outline of given thickness
  frame(x0: number, y0: number, x1: number, y1: number, t: number, c: RGB): void {
    this.rect(x0, y0, x1, y0 + t, c);
    this.rect(x0, y1 - t, x1, y1, c);
    this.rect(x0, y0, x0 + t, y1, c);
    this.rect(x1 - t, y0, x1, y1, c);
  }
  hline(x0: number, x1: number, y: number, t: number, c: RGB): void {
    this.rect(x0, y - Math.floor(t / 2), x1, y - Math.floor(t / 2) + t, c);
  }
  vline(x: number, y0: number, y1: number, t: number, c: RGB): void {
    this.rect(x - Math.floor(t / 2), y0, x - Math.floor(t / 2) + t, y1, c);
  }
  // square-brush segment (Bresenham), thickness t
  stroke(x0: number, y0: number, x1: number, y1: number, t: number, c: RGB): void {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let x = x0;
    let y = y0;
    const r = Math.floor(t / 2);
    for (;;) {
      this.rect(x - r, y - r, x - r + t, y - r + t, c);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
  }
  // polyline through points
  polyline(pts: Array<[number, number]>, t: number, c: RGB): void {
    for (let i = 0; i + 1 < pts.length; i++) {
      this.stroke(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], t, c);
    }
  }
  // filled circle
  disc(cx: number, cy: number, r: number, c: RGB): void {
    for (let y = cy - r; y <= cy + r; y++) {
      const half = Math.floor(Math.sqrt(Math.max(0, r * r - (y - cy) * (y - cy))));
      for (let x = cx - half; x <= cx + half; x++) this.dot(x, y, c);
    }
  }
  ring(cx: number, cy: number, r: number, t: number, c: RGB): void {
    for (let a = 0; a < 360; a += 1) {
      const rad = (a * Math.PI) / 180;
      const x = Math.round(cx + r * Math.cos(rad));
      const y = Math.round(cy + r * Math.sin(rad));
      this.rect(x - Math.floor(t / 2), y - Math.floor(t / 2), x - Math.floor(t / 2) + t, y - Math.floor(t / 2) + t, c);
    }
  }
  // filled polygon, scanline
  polyFill(pts: Array<[number, number]>, c: RGB): void {
    let minY = pts[0][1];
    let maxY = pts[0][1];
    for (const p of pts) {
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
    for (let y = minY; y <= maxY; y++) {
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
          const t = (y - a[1]) / (b[1] - a[1]);
          xs.push(Math.round(a[0] + t * (b[0] - a[0])));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = xs[k]; x <= xs[k + 1]; x++) this.dot(x, y, c);
      }
    }
  }
}

// ------------------------------------------------------- vector glyph font
// Each glyph is a set of strokes on a 5-wide, 7-tall grid (y 0..6, with
// descenders reaching 7). A stroke is a list of "x,y" points joined by
// spaces; strokes are separated by "|". Drawn as thick polylines, so the
// type has a hand-drawn, engraved feel quite unlike a bitmap font.
const GLYPHS: Record<string, string> = {
  A: "0,6 2,0 4,6|1,4 3,4",
  B: "0,0 0,6|0,0 3,0 4,1 4,2 3,3 0,3|0,3 3,3 4,4 4,5 3,6 0,6",
  C: "4,1 3,0 1,0 0,1 0,5 1,6 3,6 4,5",
  D: "0,0 0,6|0,0 3,0 4,1 4,5 3,6 0,6",
  E: "4,0 0,0 0,6 4,6|0,3 3,3",
  F: "0,6 0,0 4,0|0,3 3,3",
  G: "4,1 3,0 1,0 0,1 0,5 1,6 3,6 4,5 4,3 2,3",
  H: "0,0 0,6|4,0 4,6|0,3 4,3",
  I: "2,0 2,6|0,0 4,0|0,6 4,6",
  J: "4,0 4,5 3,6 1,6 0,5",
  K: "0,0 0,6|4,0 0,3 4,6",
  L: "0,0 0,6 4,6",
  M: "0,6 0,0 2,3 4,0 4,6",
  N: "0,6 0,0 4,6 4,0",
  O: "1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0",
  P: "0,6 0,0 3,0 4,1 4,2 3,3 0,3",
  Q: "1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0|2,4 4,6",
  R: "0,6 0,0 3,0 4,1 4,2 3,3 0,3|2,3 4,6",
  S: "4,1 3,0 1,0 0,1 0,2 1,3 3,3 4,4 4,5 3,6 1,6 0,5",
  T: "0,0 4,0|2,0 2,6",
  U: "0,0 0,5 1,6 3,6 4,5 4,0",
  V: "0,0 2,6 4,0",
  W: "0,0 1,6 2,3 3,6 4,0",
  X: "0,0 4,6|4,0 0,6",
  Y: "0,0 2,3 4,0|2,3 2,6",
  Z: "0,0 4,0 0,6 4,6",
  "0": "1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0",
  "1": "2,0 2,6|1,1 2,0",
  "2": "0,1 1,0 3,0 4,1 4,2 3,3 0,6 4,6",
  "3": "0,1 1,0 3,0 4,1 4,5 3,6 1,6 0,5|1,3 3,3",
  "4": "0,0 0,3 4,3|3,0 3,6",
  "5": "4,0 0,0 0,3 3,3 4,4 4,5 3,6 0,6",
  "6": "4,1 3,0 1,0 0,1 0,5 1,6 3,6 4,5 4,4 3,3 0,3",
  "7": "0,0 4,0 2,6",
  "8": "1,0 3,0 4,1 4,2 3,3 1,3 0,2 0,1 1,0|1,3 3,3 4,4 4,5 3,6 1,6 0,5 0,4 1,3",
  "9": "0,5 1,6 3,6 4,5 4,1 3,0 1,0 0,1 0,2 1,3 4,3",
  ".": "2,6 2,6",
  ",": "2,5 2,6 1,7",
  ":": "2,1 2,1|2,5 2,5",
  ";": "2,1 2,1|2,5 2,6 1,7",
  "-": "0,3 4,3",
  "'": "2,0 2,2",
  "!": "2,0 2,4|2,6 2,6",
  "?": "1,1 2,0 3,0 4,1 4,2 3,3 2,3|2,5 2,5",
  "%": "0,0 4,6|0,1 2,1 2,2 0,2 0,1|2,4 4,4 4,5 2,5 2,4",
  "(": "3,0 2,1 1,3 2,5 3,6",
  ")": "1,0 2,1 3,3 2,5 1,6",
  "/": "4,0 0,6",
  "&": "3,0 2,0 1,1 1,2 2,3 4,4 4,5 3,6 1,6 0,5 1,4 2,3|2,3 4,1",
  "+": "2,1 2,5|0,3 4,3",
  "=": "0,2 4,2|0,4 4,4",
};

const GLYPH_ADVANCE = 6; // grid units per character, including the gap
const GLYPH_HEIGHT = 7; // grid units tall

type StrokeSet = Array<Array<[number, number]>>;
const glyphCache = new Map<string, StrokeSet>();
function strokesFor(ch: string): StrokeSet {
  const hit = glyphCache.get(ch);
  if (hit) return hit;
  const def = GLYPHS[ch];
  const out: StrokeSet = [];
  if (def) {
    for (const stroke of def.split("|")) {
      const pts: Array<[number, number]> = [];
      for (const tok of stroke.trim().split(/\s+/)) {
        const [xs, ys] = tok.split(",");
        pts.push([Number(xs), Number(ys)]);
      }
      if (pts.length) out.push(pts);
    }
  }
  glyphCache.set(ch, out);
  return out;
}

function textWidth(text: string, scale: number): number {
  return text.length * GLYPH_ADVANCE * scale;
}

// Draw one line of text at (x, y); returns the x just past the last glyph.
function drawLine(s: Sheet, x: number, y: number, text: string, scale: number, c: RGB): number {
  const thick = Math.max(1, Math.round(scale * 0.85));
  let cx = x;
  for (const ch of text) {
    for (const stroke of strokesFor(ch)) {
      const pts = stroke.map(([gx, gy]): [number, number] => [
        Math.round(cx + gx * scale),
        Math.round(y + gy * scale),
      ]);
      if (pts.length === 1) {
        s.rect(pts[0][0] - Math.floor(thick / 2), pts[0][1] - Math.floor(thick / 2),
          pts[0][0] - Math.floor(thick / 2) + thick, pts[0][1] - Math.floor(thick / 2) + thick, c);
      } else {
        s.polyline(pts, thick, c);
      }
    }
    cx += GLYPH_ADVANCE * scale;
  }
  return cx;
}

// Greedy word wrap. Long words are split across lines rather than dropped.
function wrapLines(text: string, maxWidth: number, scale: number): string[] {
  const lines: string[] = [];
  const words = text.split(/\s+/).filter(Boolean);
  let cur = "";
  const push = (line: string) => {
    if (line) lines.push(line);
  };
  for (const word of words) {
    const trial = cur ? cur + " " + word : word;
    if (textWidth(trial, scale) <= maxWidth) {
      cur = trial;
      continue;
    }
    push(cur);
    if (textWidth(word, scale) > maxWidth) {
      // split the overlong word itself
      const per = Math.max(1, Math.floor(maxWidth / (GLYPH_ADVANCE * scale)));
      let rest = word;
      while (rest.length > per) {
        lines.push(rest.slice(0, per));
        rest = rest.slice(per);
      }
      cur = rest;
    } else {
      cur = word;
    }
  }
  push(cur);
  return lines.length ? lines : [""];
}

function drawPara(
  s: Sheet,
  x: number,
  y: number,
  text: string,
  scale: number,
  maxWidth: number,
  c: RGB,
  lineGap = 2,
): number {
  const lines = wrapLines(text, maxWidth, scale);
  const lh = Math.round(GLYPH_HEIGHT * scale) + lineGap;
  for (let i = 0; i < lines.length; i++) {
    drawLine(s, x, y + i * lh, lines[i], scale, c);
  }
  return y + lines.length * lh;
}

// ------------------------------------------------------------ PNG encoding
const CRC_TABLE: Uint32Array = (() => {
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
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(s: Sheet): Buffer {
  const raw = Buffer.alloc((s.w * 3 + 1) * s.h);
  for (let y = 0; y < s.h; y++) {
    const off = y * (s.w * 3 + 1);
    raw[off] = 0; // filter: none
    raw.set(s.px.subarray(y * s.w * 3, (y + 1) * s.w * 3), off + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(s.w, 0);
  ihdr.writeUInt32BE(s.h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ stories
interface Card {
  kicker: string;
  headline: string;
  deck: string;
  icon: string;
}

const LEAD_KICKER = "ANTALYA - CLIMATE TALKS";
const LEAD_HEADLINE = "COP31 NEARS A DEAL AT DAWN";
const LEAD_DECK =
  "AFTER TWO DAYS OF OVERTIME, THE SUMMIT PRESIDENT SAYS A TEXT ALL SIDES CAN ACCEPT IS READY FOR A SUNDAY VOTE. FOSSIL FUELS AND AID FOR POOR NATIONS WERE THE LAST FIGHTS.";

const CARDS: Card[] = [
  {
    kicker: "ISRAEL",
    headline: "EISENKOT TAPPED TO LEAD",
    deck: "PRESIDENT HERZOG ASKS EX-ARMY CHIEF EISENKOT TO FORM A GOVERNMENT, PASSING OVER NETANYAHU.",
    icon: "columns",
  },
  {
    kicker: "MATHEMATICS",
    headline: "RIEMANN PROOF QUESTIONED",
    deck: "A DAY AFTER LEAN CERTIFIED THE AI-MADE PROOF, A NEW PAPER SAYS ITS GEOMETRY IS TRIVIAL.",
    icon: "proof",
  },
  {
    kicker: "HONG KONG",
    headline: "HONG KONG VOTES",
    deck: "POLLS OPEN TO ELECT THE ELECTION COMMITTEE, THE SMALL BODY THAT CHOOSES THE CITY'S LEADER.",
    icon: "ballot",
  },
  {
    kicker: "MYANMAR",
    headline: "QUAKE SHAKES MYANMAR",
    deck: "A MAGNITUDE 4.1 QUAKE STRIKES IN THE EARLY HOURS OF SUNDAY, THE SEISMOLOGY CENTRE SAYS.",
    icon: "seismo",
  },
  {
    kicker: "FRANCE",
    headline: "FOURTH WEEKEND OF PROTESTS",
    deck: "STREETS FILL AGAIN ACROSS FRANCE AS LIVING COSTS KEEP RISING. THE FOURTH WEEKEND IN A ROW.",
    icon: "placard",
  },
  {
    kicker: "SPORT",
    headline: "ALCARAZ V ZVEREV FOR TITLE",
    deck: "CARLOS ALCARAZ FACES WORLD NO. 1 ALEXANDER ZVEREV IN THE ATP FINALS DECIDER IN TURIN.",
    icon: "tennis",
  },
];

const STRIP_LEFT = "ALSO TODAY: PERU - 1 DEAD, 152 HOMES UNINHABITABLE AFTER THE M6.8 QUAKE";
const STRIP_RIGHT = "ZELENSKY: NATO MEMBERSHIP IS THE CLEAREST SECURITY GUARANTEE FOR UKRAINE";

// ------------------------------------------------------------ small icons
// Each icon is drawn in a 48x48 box whose top-left corner is (x, y).
function drawIcon(s: Sheet, kind: string, x: number, y: number, c: RGB): void {
  const t = 3;
  if (kind === "columns") {
    // government building: pediment, three columns, steps
    s.polyFill([[x + 4, y + 14], [x + 24, y + 2], [x + 44, y + 14]], c);
    s.vline(x + 10, y + 16, y + 36, t, c);
    s.vline(x + 24, y + 16, y + 36, t, c);
    s.vline(x + 38, y + 16, y + 36, t, c);
    s.hline(x + 4, x + 44, y + 38, t, c);
    s.hline(x + 2, x + 46, y + 43, t, c);
  } else if (kind === "proof") {
    // a square-root sign with a check mark: a proof under question
    s.polyline([[x + 4, y + 26], [x + 12, y + 34], [x + 20, y + 8]], t, c);
    s.hline(x + 20, x + 44, y + 8, t, c);
    s.polyline([[x + 26, y + 34], [x + 32, y + 40], [x + 44, y + 22]], t, c);
    s.polyline([[x + 28, y + 14], [x + 34, y + 14], [x + 34, y + 20]], 2, c);
  } else if (kind === "ballot") {
    // ballot box with a paper slip going in
    s.rect(x + 6, y + 20, x + 42, y + 44, c);
    s.rect(x + 12, y + 26, x + 36, y + 38, PAPER);
    s.polyline([[x + 18, y + 20], [x + 24, y + 8], [x + 30, y + 20]], t, c);
    s.hline(x + 20, x + 28, y + 22, 2, c);
  } else if (kind === "seismo") {
    // seismograph zig-zag with an epicentre dot
    s.polyline(
      [
        [x + 2, y + 24], [x + 10, y + 24], [x + 14, y + 10], [x + 18, y + 38],
        [x + 22, y + 16], [x + 26, y + 32], [x + 30, y + 24], [x + 38, y + 24],
        [x + 42, y + 18], [x + 46, y + 24],
      ],
      t,
      c,
    );
    s.disc(x + 24, y + 44, 3, RED);
  } else if (kind === "placard") {
    // a protest placard on a stick
    s.frame(x + 6, y + 4, x + 42, y + 26, t, c);
    s.hline(x + 12, x + 36, y + 12, 2, c);
    s.hline(x + 12, x + 30, y + 18, 2, c);
    s.vline(x + 24, y + 26, y + 46, t, c);
  } else if (kind === "tennis") {
    // tennis ball with its curved seams
    s.ring(x + 24, y + 24, 19, t, c);
    s.polyline([[x + 8, y + 12], [x + 16, y + 24], [x + 8, y + 36]], 2, c);
    s.polyline([[x + 40, y + 12], [x + 32, y + 24], [x + 40, y + 36]], 2, c);
  }
}

// ------------------------------------------------------------ lead scene
// Dawn over Antalya: banded sky, a low sun, mountain silhouettes, the sea,
// and a row of summit flags in the foreground.
function drawScene(s: Sheet, x0: number, y0: number, w: number, h: number): void {
  const skyBands: RGB[] = [
    [250, 176, 84],
    [251, 196, 110],
    [252, 216, 140],
    [253, 232, 172],
    [254, 244, 205],
  ];
  const bandH = Math.ceil((h * 0.52) / skyBands.length);
  for (let i = 0; i < skyBands.length; i++) {
    s.rect(x0, y0 + i * bandH, x0 + w, Math.min(y0 + h, y0 + (i + 1) * bandH), skyBands[i]);
  }
  // sun
  s.disc(x0 + 92, y0 + 62, 34, [255, 214, 92]);
  s.ring(x0 + 92, y0 + 62, 34, 3, [232, 120, 40]);
  // mountains
  const mTop = y0 + Math.floor(h * 0.52);
  s.polyFill(
    [
      [x0, mTop + 26], [x0 + 60, mTop - 18], [x0 + 130, mTop + 12],
      [x0 + 210, mTop - 30], [x0 + 290, mTop + 6], [x0 + w, mTop - 12],
      [x0 + w, mTop + 40], [x0, mTop + 40],
    ],
    [94, 104, 122],
  );
  // sea
  const seaTop = mTop + 40;
  s.rect(x0, seaTop, x0 + w, y0 + h, [44, 106, 132]);
  for (let i = 0; i < 5; i++) {
    const wy = seaTop + 12 + i * 14;
    s.hline(x0 + 18 + (i % 2) * 22, x0 + w - 18 - (i % 2) * 10, wy, 2, [214, 236, 242]);
  }
  // summit flags along the shore
  const flagCols: RGB[] = [[176, 32, 32], [16, 40, 64], [28, 110, 70], [188, 138, 40], [120, 60, 140]];
  const groundY = y0 + h - 6;
  for (let i = 0; i < 5; i++) {
    const fx = x0 + 34 + i * 68;
    s.vline(fx, groundY - 58, groundY, 3, INK);
    s.rect(fx + 2, groundY - 58, fx + 34, groundY - 38, flagCols[i]);
  }
  s.frame(x0, y0, x0 + w, y0 + h, 2, INK);
}

// ------------------------------------------------------------------ layout
function buildPage(): Sheet {
  const s = new Sheet(W, H);
  s.fill(PAPER);
  s.frame(22, 22, W - 22, H - 22, 3, INK);
  s.frame(30, 30, W - 30, H - 30, 1, INK);

  const MX = 44; // left margin of the text block
  const RX = W - 44; // right margin

  // ---- masthead
  const name = "THE WORLD TODAY";
  const nameScale = 6.4;
  drawLine(s, Math.round((W - textWidth(name, nameScale)) / 2), 52, name, nameScale, INK);
  s.hline(MX, RX, 116, 3, INK);
  s.hline(MX, RX, 122, 1, INK);
  const dateLine = "SUNDAY 22 NOVEMBER 2026";
  const dateScale = 2.6;
  drawLine(s, Math.round((W - textWidth(dateLine, dateScale)) / 2), 134, dateLine, dateScale, RED);
  s.hline(MX, RX, 166, 3, INK);

  // ---- lead story (left) + scene (right)
  const leadX = MX;
  const leadW = 548;
  const sceneX = leadX + leadW + 20;
  const sceneW = RX - sceneX;
  const leadTop = 186;

  drawLine(s, leadX, leadTop, LEAD_KICKER, 2.1, RED);
  s.hline(leadX, leadX + 120, leadTop + 24, 3, RED);
  const headEnd = drawPara(s, leadX, leadTop + 36, LEAD_HEADLINE, 4.1, leadW, INK, 4);
  drawPara(s, leadX, headEnd + 12, LEAD_DECK, 2.05, leadW, INK, 3);
  // a short rule and the vote line under the deck
  s.hline(leadX, leadX + leadW, 428, 1, GREY);
  drawLine(s, leadX, 440, "THE VOTE IS EXPECTED ON SUNDAY.", 1.9, GREY);

  drawScene(s, sceneX, leadTop, sceneW, 236);
  const capScale = 1.7;
  drawPara(s, sceneX, leadTop + 246, "ANTALYA AT DAWN - THE COP31 SUMMIT", capScale, sceneW, GREY, 2);

  s.hline(MX, RX, 486, 3, INK);

  // ---- six cards: 3 columns x 2 rows
  const gridTop = 502;
  const cardW = 300;
  const cardH = 178;
  const colGap = 14;
  const rowGap = 14;
  for (let i = 0; i < CARDS.length; i++) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const cx = MX + col * (cardW + colGap);
    const cy = gridTop + row * (cardH + rowGap);
    const card = CARDS[i];
    s.frame(cx, cy, cx + cardW, cy + cardH, 1, INK);
    // kicker on a thin red underline, icon top-right
    drawLine(s, cx + 12, cy + 12, card.kicker, 1.8, RED);
    drawIcon(s, card.icon, cx + cardW - 60, cy + 8, NAVY);
    s.hline(cx + 12, cx + cardW - 64, cy + 30, 1, GOLD);
    // headline wraps in the space left of the icon so it can never run under it
    const headEndY = drawPara(s, cx + 12, cy + 40, card.headline, 2.25, cardW - 88, INK, 3);
    drawPara(s, cx + 12, headEndY + 6, card.deck, 1.6, cardW - 24, INK, 2);
  }

  // ---- bottom strip: two items on a navy band
  const stripY = 902;
  const stripH = 56;
  s.rect(MX, stripY, RX, stripY + stripH, NAVY);
  const halfW = Math.floor((RX - MX - 48) / 2);
  drawPara(s, MX + 14, stripY + 8, STRIP_LEFT, 1.75, halfW, WHITE, 2);
  s.vline(MX + 14 + halfW + 10, stripY + 8, stripY + stripH - 8, 1, [120, 150, 180]);
  drawPara(s, MX + 14 + halfW + 34, stripY + 8, STRIP_RIGHT, 1.75, halfW, WHITE, 2);

  // ---- footer
  const foot = "THE WORLD TODAY - SUNDAY 22 NOVEMBER 2026";
  drawLine(s, Math.round((W - textWidth(foot, 1.7)) / 2), 972, foot, 1.7, GREY);
  return s;
}

// --------------------------------------------------------------------- main
function main(): void {
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  mkdirSync(outDir, { recursive: true });
  const png = encodePng(buildPage());
  writeFileSync(join(outDir, "entry.png"), png);
}

main();
