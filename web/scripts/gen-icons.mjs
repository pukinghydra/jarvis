// Draw the app icons (no dependencies): dark rounded square, a ring in the
// six lane colours, white dot in the middle. Writes public/icon-*.png.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const COLORS = ["#F97316", "#22C55E", "#EAB308", "#EC4899", "#3B82F6", "#8B5CF6"].map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
const BG = [11, 15, 23];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const c = size / 2, rOut = size * 0.36, rIn = size * 0.24, rDot = size * 0.1;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - c, dy = y + 0.5 - c, d = Math.hypot(dx, dy);
      let col = BG;
      if (d <= rDot) col = [255, 255, 255];
      else if (d >= rIn && d <= rOut) {
        const a = (Math.atan2(dy, dx) + Math.PI * 2.5) % (Math.PI * 2);
        col = COLORS[Math.floor((a / (Math.PI * 2)) * 6) % 6];
      }
      raw.set(col, y * (size * 3 + 1) + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
for (const s of [180, 192, 512]) writeFileSync(new URL(`../public/icon-${s}.png`, import.meta.url), png(s));
console.log("icons written");
