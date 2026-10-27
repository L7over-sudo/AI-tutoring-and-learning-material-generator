const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const input = process.argv[2];
if (!input) {
  console.error("Usage: node scripts/make-icon.cjs <source-image>");
  process.exit(1);
}

const outDir = path.resolve("build");
const png = path.join(outDir, "icon.png");
const ico = path.join(outDir, "icon.ico");
const source = path.join(outDir, "icon-source-new.png");

function icoFromPngs(items) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(items.length, 4);

  let offset = 6 + items.length * 16;
  const entries = items.map((item) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(item.size >= 256 ? 0 : item.size, 0);
    entry.writeUInt8(item.size >= 256 ? 0 : item.size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(item.buffer.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += item.buffer.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...items.map((item) => item.buffer)]);
}

async function main() {
  await fs.promises.mkdir(outDir, { recursive: true });
  await sharp(input).png().toFile(source);

  const meta = await sharp(input).metadata();
  const width = meta.width || 1024;
  const height = meta.height || 1024;
  const mask = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <filter id="feather"><feGaussianBlur stdDeviation="2.5"/></filter>
      <rect x="88" y="74" width="850" height="872" rx="132" ry="132" fill="white" filter="url(#feather)"/>
    </svg>
  `;

  await sharp(input)
    .ensureAlpha()
    .composite([{ input: Buffer.from(mask), blend: "dest-in" }])
    .resize(1024, 1024, { fit: "contain" })
    .png()
    .toFile(png);

  const sizes = [256, 128, 64, 48, 32, 16];
  const items = [];
  for (const size of sizes) {
    const buffer = await sharp(png).resize(size, size, { fit: "contain" }).png().toBuffer();
    items.push({ size, buffer });
  }
  await fs.promises.writeFile(ico, icoFromPngs(items));

  console.log(JSON.stringify({ png, ico, source, sizes }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
