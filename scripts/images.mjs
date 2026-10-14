import { createRequire } from 'node:module';
const sharp = createRequire(import.meta.url)('/opt/npm-tools/node_modules/sharp');
const up = '/mnt/user-data/uploads/';
const out = 'apps/web/public/';
for (const f of ['IMG_2606.png','IMG_2613.png','IMG_2615.png','IMG_2619.png']) { const m = await sharp(up+f).metadata(); console.log(f, m.width, m.height, m.hasAlpha); }
// mascota (fondo transparente), logos
await sharp(up+'IMG_2606.png').trim().resize({ height: 640 }).webp({ quality: 82 }).toFile(out+'img/guia.webp');
await sharp(up+'IMG_2619.png').trim({ threshold: 20 }).resize({ width: 360 }).webp({ quality: 90 }).toFile(out+'img/eko-logo.webp');
await sharp(up+'IMG_2613.png').trim({ threshold: 20 }).resize({ width: 300 }).webp({ quality: 90 }).toFile(out+'img/business-shop.webp');
// ícono: la "e" de EKO (parte superior del logo) en marfil sobre verde
const logo = sharp(up+'IMG_2619.png');
const meta = await logo.metadata();
const eMark = await sharp(up+'IMG_2619.png').flatten({ background: '#ffffff' }).extract({ left: 95, top: 50, width: 690, height: 640 }).trim({ threshold: 20 }).png().toBuffer();
// recolor a marfil: usar la máscara de luminancia
const mono = await sharp(eMark).flatten({ background: '#ffffff' }).greyscale().negate().threshold(100).toColourspace('b-w').png().toBuffer();
async function icon(size, pad, file) {
  const inner = Math.round(size * (1 - pad * 2));
  const mask = await sharp(mono).resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 1 } }).flatten({ background: '#000' }).toColourspace('b-w').raw().toBuffer({ resolveWithObject: true });
  const ivory = await sharp({ create: { width: mask.info.width, height: mask.info.height, channels: 3, background: '#F4EBD3' } }).joinChannel(mask.data, { raw: { width: mask.info.width, height: mask.info.height, channels: 1 } }).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: '#123F2E' } })
    .composite([{ input: ivory, gravity: 'center' }]).png().toFile(out+'icons/'+file);
}
await icon(512, 0.2, 'icon-512-maskable.png');
await icon(192, 0.2, 'icon-192-maskable.png');
await icon(512, 0.12, 'icon-512.png');
await icon(192, 0.12, 'icon-192.png');
await icon(180, 0.14, 'apple-touch-icon.png');
await icon(64, 0.1, 'favicon-64.png');
console.log('ok');
