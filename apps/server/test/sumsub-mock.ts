// Servidor simulado de Sumsub para pruebas: valida la firma de cada solicitud igual que la API real.
import http from 'node:http';
import { createHmac } from 'node:crypto';

export async function startSumsubMock(appToken: string, secret: string) {
  const applicants = new Map<string, any>();
  const calls: { method: string; path: string; sigOk: boolean }[] = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks).toString();
    const path = req.url ?? '/';
    if (path === '/sdk.js') {
      // SDK falso con la misma API encadenable del WebSDK real
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      return res.end(`window.snsWebSdk = { init(token, refresh) { const h = {}; const api = {
        withConf() { return api; }, withOptions() { return api; },
        on(ev, cb) { h[ev] = cb; return api; },
        build() { return { launch(sel) { const el = document.querySelector(sel); el.innerHTML = '<p id="fake-sdk">SDK simulado · token ' + token + '</p>';
          refresh().then(t => { el.dataset.refreshed = t; setTimeout(() => h['idCheck.onApplicantSubmitted'] && h['idCheck.onApplicantSubmitted']({}), 300); }); } }; } }; return api; } };`);
    }
    const ts = Number(req.headers['x-app-access-ts']);
    const expected = createHmac('sha256', secret).update(String(ts) + req.method + path + body).digest('hex');
    const sigOk = req.headers['x-app-token'] === appToken && req.headers['x-app-access-sig'] === expected && Math.abs(Date.now() / 1000 - ts) < 60;
    calls.push({ method: req.method!, path, sigOk });
    if (!sigOk) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ description: 'Invalid signature' })); }
    const u = new URL(path, 'http://x');
    if (req.method === 'POST' && u.pathname === '/resources/accessTokens') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ token: `_act-${u.searchParams.get('userId')}-${u.searchParams.get('levelName')}`, userId: u.searchParams.get('userId') }));
    }
    const m = /^\/resources\/applicants\/-;externalUserId=([^/]+)\/one$/.exec(u.pathname);
    if (req.method === 'GET' && m) {
      const a = applicants.get(decodeURIComponent(m[1]));
      res.writeHead(a ? 200 : 404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(a ?? { description: 'Applicant not found' }));
    }
    res.writeHead(404).end('{}');
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  return { url, applicants, calls, close: () => new Promise<void>(r => server.close(() => r())) };
}
