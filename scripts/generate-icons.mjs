import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const SCALE = 4;

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data = Buffer.alloc(0)) {
  const name = Buffer.from(type, "ascii");
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  name.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return output;
}

function insideRoundedSquare(x, y, size) {
  const radius = (28 / 128) * size;
  const nearestX = Math.max(radius, Math.min(size - radius, x));
  const nearestY = Math.max(radius, Math.min(size - radius, y));
  return Math.hypot(x - nearestX, y - nearestY) <= radius;
}

function insidePolygon(x, y, points) {
  let inside = false;
  for (let current = 0, previous = points.length - 1; current < points.length; previous = current++) {
    const [currentX, currentY] = points[current];
    const [previousX, previousY] = points[previous];
    const intersects =
      currentY > y !== previousY > y &&
      x < ((previousX - currentX) * (y - currentY)) / (previousY - currentY) + currentX;
    if (intersects) inside = !inside;
  }
  return inside;
}

function renderIcon(size) {
  const highSize = size * SCALE;
  const pixels = new Uint8Array(highSize * highSize * 4);
  const coordinate = (value) => (value / 128) * highSize;
  const vShape = [
    [36, 40], [49, 40], [64, 80], [79, 40], [92, 40], [71, 94], [57, 94],
  ].map(([x, y]) => [coordinate(x), coordinate(y)]);

  for (let y = 0; y < highSize; y += 1) {
    for (let x = 0; x < highSize; x += 1) {
      const sampleX = x + 0.5;
      const sampleY = y + 0.5;
      let color;
      if (insideRoundedSquare(sampleX, sampleY, highSize)) {
        const diagonal = Math.max(0, Math.min(1, (sampleX * 0.42 + sampleY * 0.58) / highSize));
        const start = [80, 221, 178];
        const end = [22, 181, 121];
        const highlight = Math.max(0, 1 - Math.hypot(sampleX - highSize * 0.22, sampleY - highSize * 0.17) / (highSize * 0.82));
        color = [
          Math.round(start[0] + (end[0] - start[0]) * diagonal + highlight * 8),
          Math.round(start[1] + (end[1] - start[1]) * diagonal + highlight * 8),
          Math.round(start[2] + (end[2] - start[2]) * diagonal + highlight * 8),
          255,
        ];
      }
      if (color && insidePolygon(sampleX, sampleY, vShape)) color = [255, 255, 255, 255];
      if (!color) continue;
      const offset = (y * highSize + x) * 4;
      pixels.set(color, offset);
    }
  }

  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const rowOffset = y * (size * 4 + 1);
    for (let x = 0; x < size; x += 1) {
      let alpha = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let sampleY = 0; sampleY < SCALE; sampleY += 1) {
        for (let sampleX = 0; sampleX < SCALE; sampleX += 1) {
          const offset = (((y * SCALE + sampleY) * highSize) + x * SCALE + sampleX) * 4;
          const sampleAlpha = pixels[offset + 3];
          alpha += sampleAlpha;
          red += pixels[offset] * sampleAlpha;
          green += pixels[offset + 1] * sampleAlpha;
          blue += pixels[offset + 2] * sampleAlpha;
        }
      }
      const output = rowOffset + 1 + x * 4;
      const outputAlpha = Math.round(alpha / (SCALE * SCALE));
      rows[output] = alpha === 0 ? 0 : Math.round(red / alpha);
      rows[output + 1] = alpha === 0 ? 0 : Math.round(green / alpha);
      rows[output + 2] = alpha === 0 ? 0 : Math.round(blue / alpha);
      rows[output + 3] = outputAlpha;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND"),
  ]);
}

export async function generateIcons(outputDirectory) {
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all(
    [16, 32, 48, 128].map((size) => writeFile(resolve(outputDirectory, `icon${size}.png`), renderIcon(size))),
  );
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  await generateIcons(resolve(dirname(scriptPath), "..", "static"));
}
