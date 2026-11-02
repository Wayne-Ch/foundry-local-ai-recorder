import { writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";

const width = 1280;
const height = 720;
const pixels = new Uint8Array(width * height * 4);

const palette = {
  background: [7, 18, 26, 255],
  panel: [15, 35, 45, 255],
  panelLine: [50, 93, 104, 255],
  text: [238, 247, 247, 255],
  muted: [145, 168, 173, 255],
  cyan: [103, 232, 213, 255],
  blue: [112, 167, 255, 255],
  amber: [255, 203, 107, 255],
};

async function generate() {
  fillRect(0, 0, width, height, palette.background);
  fillRect(38, 32, 1204, 656, palette.panel);
  strokeRect(38, 32, 1204, 656, palette.panelLine, 3);
  drawText("ORDINARY DIFFERENTIAL EQUATIONS", 70, 62, 5, palette.text);
  drawText("ORIGINAL LOCAL VISION TEST FIXTURE", 72, 112, 2, palette.cyan);
  drawText("FIRST ORDER DECAY MODEL", 72, 145, 2, palette.muted);

  fillRect(70, 190, 520, 430, [9, 25, 34, 255]);
  strokeRect(70, 190, 520, 430, palette.panelLine, 2);
  drawText("MODEL", 100, 220, 3, palette.cyan);
  drawText("DY/DT = -2Y", 100, 285, 5, palette.text);
  drawText("SEPARATE AND INTEGRATE", 100, 365, 2, palette.muted);
  drawText("Y(T) = Y0 E^-2T", 100, 415, 4, palette.amber);
  drawText("INITIAL VALUE Y(0) = Y0", 100, 495, 2, palette.text);
  drawText("THE SOLUTION DECAYS TO ZERO", 100, 555, 2, palette.muted);

  fillRect(630, 190, 580, 430, [9, 25, 34, 255]);
  strokeRect(630, 190, 580, 430, palette.panelLine, 2);
  drawText("SLOPE FIELD AND SOLUTION CURVE", 660, 220, 2, palette.cyan);

  const plotLeft = 690;
  const plotTop = 280;
  const plotWidth = 450;
  const plotHeight = 270;
  line(plotLeft, plotTop + plotHeight, plotLeft + plotWidth, plotTop + plotHeight, palette.text, 2);
  line(plotLeft, plotTop, plotLeft, plotTop + plotHeight, palette.text, 2);
  arrow(
    plotLeft + plotWidth,
    plotTop + plotHeight,
    plotLeft + plotWidth + 18,
    plotTop + plotHeight,
    palette.text,
  );
  arrow(plotLeft, plotTop, plotLeft, plotTop - 18, palette.text);

  for (let column = 0; column <= 8; column += 1) {
    for (let row = 1; row <= 6; row += 1) {
      const x = plotLeft + 35 + column * 48;
      const y = plotTop + row * 37;
      const normalizedY = 1 - row / 7;
      const slope = -2 * normalizedY;
      const dx = 13;
      const dy = Math.max(-15, Math.min(15, slope * 8));
      line(x - dx, y + dy, x + dx, y - dy, [79, 120, 132, 255], 1);
    }
  }

  let previousX = plotLeft;
  let previousY = plotTop + 20;
  for (let step = 1; step <= plotWidth; step += 1) {
    const t = (step / plotWidth) * 3;
    const value = Math.exp(-2 * t);
    const x = plotLeft + step;
    const y = plotTop + plotHeight - value * (plotHeight - 20);
    line(previousX, previousY, x, y, palette.amber, 3);
    previousX = x;
    previousY = y;
  }

  drawText("Y", 655, 270, 2, palette.text);
  drawText("TIME T", 1040, 575, 2, palette.text);
  drawText("EXPONENTIAL DECAY", 790, 325, 2, palette.amber);
  arrow(590, 405, 630, 405, palette.blue);
  drawText("EQUATION TO GRAPH", 470, 370, 1, palette.blue);

  const fixturePath = path.resolve("fixtures", "ode-slide.png");
  await writeFile(fixturePath, encodePng(width, height, pixels));
  console.log(`Generated ${fixturePath}`);
}

function fillRect(x, y, rectWidth, rectHeight, color) {
  for (let row = Math.max(0, y); row < Math.min(height, y + rectHeight); row += 1) {
    for (let column = Math.max(0, x); column < Math.min(width, x + rectWidth); column += 1) {
      setPixel(column, row, color);
    }
  }
}

function strokeRect(x, y, rectWidth, rectHeight, color, thickness) {
  fillRect(x, y, rectWidth, thickness, color);
  fillRect(x, y + rectHeight - thickness, rectWidth, thickness, color);
  fillRect(x, y, thickness, rectHeight, color);
  fillRect(x + rectWidth - thickness, y, thickness, rectHeight, color);
}

function setPixel(x, y, color) {
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return;
  }
  const offset = (Math.floor(y) * width + Math.floor(x)) * 4;
  pixels.set(color, offset);
}

function line(x0, y0, x1, y1, color, thickness = 1) {
  let startX = Math.round(x0);
  let startY = Math.round(y0);
  const endX = Math.round(x1);
  const endY = Math.round(y1);
  const deltaX = Math.abs(endX - startX);
  const stepX = startX < endX ? 1 : -1;
  const deltaY = -Math.abs(endY - startY);
  const stepY = startY < endY ? 1 : -1;
  let error = deltaX + deltaY;
  while (true) {
    fillRect(
      startX - Math.floor(thickness / 2),
      startY - Math.floor(thickness / 2),
      thickness,
      thickness,
      color,
    );
    if (startX === endX && startY === endY) {
      break;
    }
    const doubled = 2 * error;
    if (doubled >= deltaY) {
      error += deltaY;
      startX += stepX;
    }
    if (doubled <= deltaX) {
      error += deltaX;
      startY += stepY;
    }
  }
}

function arrow(x0, y0, x1, y1, color) {
  line(x0, y0, x1, y1, color, 3);
  const angle = Math.atan2(y1 - y0, x1 - x0);
  const head = 14;
  line(
    x1,
    y1,
    x1 - head * Math.cos(angle - Math.PI / 6),
    y1 - head * Math.sin(angle - Math.PI / 6),
    color,
    3,
  );
  line(
    x1,
    y1,
    x1 - head * Math.cos(angle + Math.PI / 6),
    y1 - head * Math.sin(angle + Math.PI / 6),
    color,
    3,
  );
}

function drawText(text, x, y, scale, color) {
  let cursor = x;
  for (const rawCharacter of text) {
    const character = rawCharacter.toUpperCase();
    const glyph = font[character] ?? font["?"];
    if (character === " ") {
      cursor += 4 * scale;
      continue;
    }
    for (let row = 0; row < glyph.length; row += 1) {
      for (let column = 0; column < glyph[row].length; column += 1) {
        if (glyph[row][column] === "1") {
          fillRect(cursor + column * scale, y + row * scale, scale, scale, color);
        }
      }
    }
    cursor += 6 * scale;
  }
}

function encodePng(pngWidth, pngHeight, rgba) {
  const scanlines = new Uint8Array((pngWidth * 4 + 1) * pngHeight);
  for (let row = 0; row < pngHeight; row += 1) {
    const target = row * (pngWidth * 4 + 1);
    scanlines[target] = 0;
    scanlines.set(rgba.subarray(row * pngWidth * 4, (row + 1) * pngWidth * 4), target + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", uint32(pngWidth), uint32(pngHeight), Buffer.from([8, 6, 0, 0, 0])),
    pngChunk("IDAT", deflateSync(scanlines, { level: 9 })),
    pngChunk("IEND"),
  ]);
}

function pngChunk(type, ...parts) {
  const data = Buffer.concat(parts);
  const typeBytes = Buffer.from(type, "ascii");
  return Buffer.concat([
    uint32(data.length),
    typeBytes,
    data,
    uint32(crc32(Buffer.concat([typeBytes, data]))),
  ]);
}

function uint32(value) {
  const output = Buffer.alloc(4);
  output.writeUInt32BE(value >>> 0);
  return output;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const font = {
  " ": ["000", "000", "000", "000", "000", "000", "000"],
  "?": ["11110", "00001", "00010", "00100", "00100", "00000", "00100"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  0: ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  1: ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  2: ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "=": ["00000", "11111", "00000", "11111", "00000", "00000", "00000"],
  "/": ["00001", "00010", "00100", "01000", "10000", "00000", "00000"],
  "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
  ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
  "^": ["00100", "01010", "10001", "00000", "00000", "00000", "00000"],
};

await generate();
