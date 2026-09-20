// The SVG is the editable master; commit outputs so desktop launch needs no image tools.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../', import.meta.url));
const master = await readFile(path.join(root, 'public/brand/news-desk.svg'));
const assets = path.join(root, 'desktop/assets');
await mkdir(assets, { recursive: true });
await writeFile(path.join(root, 'public/favicon.svg'), master);
await sharp(master).resize(512, 512).png().toFile(path.join(root, 'public/brand/news-desk-512.png'));
await sharp(master).resize(180, 180).png().toFile(path.join(root, 'public/apple-touch-icon.png'));

// A transparent margin matches the visual size of macOS icons in the Dock.
const macMaster = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#00000000' } })
  .composite([{ input: await sharp(master).resize(880, 880).png().toBuffer(), left: 72, top: 72 }]).png().toBuffer();
const chunk = (type, bytes) => {
  const header = Buffer.alloc(8);
  header.write(type, 0, 4, 'ascii'); header.writeUInt32BE(bytes.length + 8, 4);
  return Buffer.concat([header, bytes]);
};
const icns = [];
for (const [type, size] of [['icp4',16],['icp5',32],['icp6',64],['ic07',128],['ic08',256],['ic09',512],['ic10',1024],['ic11',32],['ic12',64],['ic13',256],['ic14',512]]) {
  icns.push(chunk(type, await sharp(macMaster).resize(size, size).png().toBuffer()));
}
await writeFile(path.join(assets, 'app-icon.icns'), chunk('icns', Buffer.concat(icns)));

// PNG-backed ICO frames are supported by the Windows versions this app targets.
const sizes = [16, 24, 32, 48, 64, 128, 256];
const frames = await Promise.all(sizes.map(size => sharp(master).resize(size, size).png().toBuffer()));
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
frames.forEach((bytes, index) => {
  const entry = 6 + index * 16;
  header[entry] = header[entry + 1] = sizes[index] === 256 ? 0 : sizes[index];
  header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(bytes.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
  offset += bytes.length;
});
await writeFile(path.join(assets, 'app-icon.ico'), Buffer.concat([header, ...frames]));
await writeFile(path.join(root, 'public/favicon.ico'), Buffer.concat([header, ...frames]));
console.log('Updated SVG, PNG, ICO and ICNS app icons.');
