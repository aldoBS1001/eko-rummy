// Genera docs/print/terminos.html a partir del mismo texto que muestra la app.
import { writeFileSync } from 'node:fs';
import { TERMS, TERMS_VERSION, TERMS_DATE } from '../apps/web/src/terms.ts';
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const body = TERMS.map(s => `<div class="blk"><h2>${esc(s.title)}</h2>${s.body.map(p => Array.isArray(p) ? `<ul>${p.map(li => `<li>${esc(li)}</li>`).join('')}</ul>` : `<p>${esc(p)}</p>`).join('')}</div>`).join('\n');
writeFileSync(new URL('../docs/print/terminos.html', import.meta.url), `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Términos y condiciones de EKO RUMMY</title><link rel="stylesheet" href="print.css">
<style>.blk h2{font-size:13pt;margin-top:14pt} .blk{break-inside:auto} .draft{border:1.5pt solid #c8372d;color:#7a1d14;padding:8pt 10pt;border-radius:6pt;margin:10pt 0}</style></head><body>
<section class="cover"><div class="logos"><img src="eko-logo.webp" alt=""><img src="business-shop.webp" alt=""></div>
<div><h1>Términos y<br>condiciones</h1><p class="sub">Incluye edad y elegibilidad, verificación de identidad, Web3 y lo que conlleva apostar.</p></div>
<p class="meta">Versión ${TERMS_VERSION} · ${TERMS_DATE}</p><img class="guide" src="guia.webp" alt=""></section>
<p class="draft"><b>Borrador para revisión legal.</b> Completa los datos entre corchetes (domicilio fiscal y correo de soporte) y haz que un abogado lo revise antes de publicarlo. Es el mismo texto que muestra la app; al cambiarlo, sube la versión en <code>apps/web/src/terms.ts</code> para que los usuarios lo acepten de nuevo.</p>
${body}
</body></html>`);
console.log('terminos.html');
