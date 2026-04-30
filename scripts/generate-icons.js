const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const outDir = path.resolve(__dirname, "../public/icons");
const colors = {
  green: [7, 21, 17, 255],
  greenLight: [18, 54, 44, 255],
  playLight: [143, 210, 111, 255],
  playDark: [63, 156, 85, 255],
  shadow: [16, 48, 39, 120],
  white: [255, 255, 255, 255]
};

function setPixel(data, size, x, y, color) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const index = (y * size + x) * 4;
  data[index] = color[0];
  data[index + 1] = color[1];
  data[index + 2] = color[2];
  data[index + 3] = color[3];
}

function inPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function drawCircle(data, size, cx, cy, radius, color) {
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) setPixel(data, size, x, y, color);
    }
  }
}

function drawRect(data, size, x0, y0, x1, y1, color) {
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
    for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) setPixel(data, size, x, y, color);
  }
}

function drawRoundedRect(data, size, x0, y0, x1, y1, radius, color) {
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
    for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
      const dx = x < x0 + radius ? x0 + radius - x : x > x1 - radius ? x - (x1 - radius) : 0;
      const dy = y < y0 + radius ? y0 + radius - y : y > y1 - radius ? y - (y1 - radius) : 0;
      if (dx * dx + dy * dy <= radius * radius) setPixel(data, size, x, y, color);
    }
  }
}

function drawPolygon(data, size, points, color) {
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
    for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
      if (inPolygon(x, y, points)) setPixel(data, size, x, y, color);
    }
  }
}

function makeIcon(size) {
  const data = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = (x + y) / (size * 2);
      const color = [
        Math.round(colors.greenLight[0] * (1 - t) + colors.green[0] * t),
        Math.round(colors.greenLight[1] * (1 - t) + colors.green[1] * t),
        Math.round(colors.greenLight[2] * (1 - t) + colors.green[2] * t),
        255
      ];
      setPixel(data, size, x, y, color);
    }
  }

  drawRoundedRect(data, size, 0.31 * size, 0.24 * size, 0.49 * size, 0.75 * size, 0.045 * size, colors.white);
  drawRoundedRect(data, size, 0.40 * size, 0.24 * size, 0.86 * size, 0.54 * size, 0.15 * size, colors.white);
  drawRoundedRect(data, size, 0.50 * size, 0.40 * size, 0.64 * size, 0.62 * size, 0.05 * size, colors.white);
  drawRoundedRect(data, size, 0.50 * size, 0.40 * size, 0.72 * size, 0.51 * size, 0.035 * size, colors.shadow);
  drawPolygon(data, size, [
    [0.46 * size, 0.38 * size],
    [0.75 * size, 0.50 * size],
    [0.46 * size, 0.64 * size]
  ], colors.playLight);
  drawPolygon(data, size, [
    [0.51 * size, 0.42 * size],
    [0.68 * size, 0.50 * size],
    [0.51 * size, 0.58 * size]
  ], colors.playDark);

  return encodePng(size, data);
}

function encodePng(size, rgba) {
  const scanlines = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    scanlines[rowStart] = 0;
    rgba.copy(scanlines, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr(size)),
    chunk("IDAT", zlib.deflateSync(scanlines)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function ihdr(size) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(size, 0);
  data.writeUInt32BE(size, 4);
  data[8] = 8;
  data[9] = 6;
  return data;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "icon-192.png"), makeIcon(192));
fs.writeFileSync(path.join(outDir, "icon-512.png"), makeIcon(512));
