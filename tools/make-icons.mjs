import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const ACCENT = [0xe1, 0x1d, 0x48];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
}

function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filtre "None"
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Coverage anti-aliasée : 1 à l'intérieur du disque de rayon r, chute linéaire sur 1 px.
function coverage(distance, r) {
  return Math.max(0, Math.min(1, r - distance + 0.5));
}

function drawIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const cx = size * 0.42;
  const cy = size * 0.4;
  const outerR = size * 0.34;
  const innerR = size * 0.24;
  const handleA = { x: size * 0.6, y: size * 0.58 };
  const handleB = { x: size * 0.84, y: size * 0.84 };
  const handleHalf = size * 0.075;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;

      const d = Math.hypot(px - cx, py - cy);
      const ring = Math.max(0, coverage(d, outerR) - coverage(d, innerR));

      const abx = handleB.x - handleA.x;
      const aby = handleB.y - handleA.y;
      const lenSq = abx * abx + aby * aby;
      const t = Math.max(0, Math.min(1, ((px - handleA.x) * abx + (py - handleA.y) * aby) / lenSq));
      const handleDistance = Math.hypot(px - (handleA.x + abx * t), py - (handleA.y + aby * t));
      const capsule = coverage(handleDistance, handleHalf);

      const alpha = Math.min(1, ring + capsule);
      if (alpha <= 0) continue;

      const i = (y * size + x) * 4;
      pixels[i] = ACCENT[0];
      pixels[i + 1] = ACCENT[1];
      pixels[i + 2] = ACCENT[2];
      pixels[i + 3] = Math.round(alpha * 255);
    }
  }
  return pixels;
}

mkdirSync("assets/icons", { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const file = `assets/icons/icon-${size}.png`;
  const png = encodePng(size, drawIcon(size));
  writeFileSync(file, png);
  console.log(file, png.length, "octets");
}
