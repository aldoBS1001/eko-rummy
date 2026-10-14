// Genera un .ico (PNG embebido, multi-tamaño) a partir del ícono de la app.
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
const sharp = createRequire(import.meta.url)('/opt/npm-tools/node_modules/sharp');
const src = 'apps/web/public/icons/icon-512.png';
const sizes = [256, 64, 48, 32, 16];
const pngs = await Promise.all(sizes.map(s => sharp(src).resize(s, s).png().toBuffer()));
const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const entries = sizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(s === 256 ? 0 : s, 0); e.writeUInt8(s === 256 ? 0 : s, 1); e.writeUInt8(0, 2); e.writeUInt8(0, 3);
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(pngs[i].length, 8); e.writeUInt32LE(offset, 12);
  offset += pngs[i].length; return e;
});
await writeFile(process.argv[2], Buffer.concat([header, ...entries, ...pngs]));
console.log('ico ok');
