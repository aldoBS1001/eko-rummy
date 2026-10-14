// Compila el cliente web (dist/) y genera la versión de un solo archivo para vista previa.
import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'apps/web');
const dist = join(web, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(join(web, 'public'), dist, { recursive: true });

const common = { define: { __DEFAULT_SERVER__: JSON.stringify(process.env.EKO_SERVER_URL ?? '') }, bundle: true, minify: true, format: 'esm', target: 'es2020', sourcemap: false, legalComments: 'none', logLevel: 'warning' };
await build({ ...common, entryPoints: { app: join(web, 'src/main.ts'), admin: join(web, 'src/admin.ts'), kyc: join(web, 'src/kyc.ts') }, outdir: dist });

const html = await readFile(join(web, 'index.html'), 'utf8');
await writeFile(join(dist, 'index.html'), html);
await writeFile(join(dist, 'kyc.html'), html.replace('<title>EKO RUMMY</title>', '<title>Verificación de identidad · EKO RUMMY</title>').replace('app.css', 'kyc.css').replace('app.js', 'kyc.js').replace('<link rel="manifest" href="manifest.webmanifest">', ''));
await writeFile(join(dist, 'admin.html'), html.replace('<title>EKO RUMMY</title>', '<title>EKO RUMMY · Administración</title>').replace('app.css', 'admin.css').replace('app.js', 'admin.js').replace('<link rel="manifest" href="manifest.webmanifest">', ''));

// ---- versión de un solo archivo (imágenes en línea) para la vista previa publicada
const img = async f => `data:image/webp;base64,${(await readFile(join(web, 'public/img', f))).toString('base64')}`;
const assets = { 'guia.webp': await img('guia.webp'), 'eko-logo.webp': await img('eko-logo.webp'), 'business-shop.webp': await img('business-shop.webp') };
const single = await build({ ...common, entryPoints: [join(web, 'src/main.ts')], write: false, outdir: '/tmp/eko-single', define: { ...common.define, __ASSETS__: JSON.stringify(assets) } });
const js = single.outputFiles.find(f => f.path.endsWith('.js')).text;
const css = single.outputFiles.find(f => f.path.endsWith('.css')).text;
const favicon = `data:image/png;base64,${(await readFile(join(web, 'public/icons/favicon-64.png'))).toString('base64')}`;
// La vista previa publicada no lleva doctype/html/head/body: la plataforma los agrega.
const singleHtml = [
  '<title>EKO RUMMY</title>',
  `<link rel="icon" href="${favicon}">`,
  '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  '<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Figtree:wght@400;500;600;700&display=swap" rel="stylesheet">',
  `<style>${css}</style>`,
  '<div id="app"></div>',
  `<script type="module">${js.replace(/<\/script/g, '<\\/script')}</script>`,
].join('\n');
await mkdir(join(root, 'build'), { recursive: true });
await writeFile(join(root, 'build/eko-rummy-preview.html'), singleHtml);
// Documento completo de un solo archivo para apps empaquetadas (APK de Android: assets/index.html)
const standalone = `<!doctype html>\n<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<meta name="theme-color" content="#0b3326">
${singleHtml.replace('<div id="app"></div>', '</head><body><div id="app"></div>')}
</body></html>`;
await writeFile(join(root, 'build/eko-rummy-standalone.html'), standalone);

const files = await readdir(dist);
console.log('dist:', files.join(', '));
console.log('preview:', (singleHtml.length / 1024).toFixed(0), 'KB');
