import { writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

const width = 1001;
const height = 501;
const output = process.argv[2];
if (output) await generate(output);

async function generate(path) {
  const scanlines = Buffer.alloc((width * 4 + 1) * height, 255);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    scanlines[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 4;
      const border = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      const grid = x % 100 === 0 || y % 100 === 0;
      const scaleBar = y >= 438 && y <= 462 && x >= 100 && x <= 900;
      const tick = y >= 425 && y <= 475 && (x === 100 || x === 900);
      const colour = border || scaleBar || tick ? [26, 55, 65] : grid ? [188, 207, 214] : [246, 249, 250];
      scanlines[offset] = colour[0];
      scanlines[offset + 1] = colour[1];
      scanlines[offset + 2] = colour[2];
      scanlines[offset + 3] = 255;
    }
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(scanlines)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  await writeFile(path, png);
}

function chunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const body = Buffer.concat([name, data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
