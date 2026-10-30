// Cloudflare Worker for data.mywardy.com. Phones read the bulletin from here, so 300 people at once cost one Apps Script call a minute.
// Serves its copy for 60 seconds, then refreshes in the background. If Apps Script fails, it keeps serving the last good copy.
// The data is the same public program the bulletin page shows. There are no secrets here.
const UNITS = {
  kingston: 'https://script.google.com/macros/s/AKfycbxTmstrn1ETmsEnobIx9-MB12Mw8LCsdHlzGO41-UxkxitVuE224xnl8wTXhK3BlzRo/exec'
};
const FRESH_MS = 60000, KEEP_SECONDS = 7 * 86400;
const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=30', 'X-Robots-Tag': 'noindex' };
const RETRY_MS = 15000, lastTry = {}, inFlight = {};

async function fromScript(unit) {
  const r = await fetch(UNITS[unit], { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ fn: 'publicBulletin' }), redirect: 'follow' });
  const text = await r.text(), d = JSON.parse(text);
  if (!r.ok || !d || d.ok !== true) throw new Error('Bad answer from Apps Script');
  return text;
}
// Requests that arrive together share one Apps Script call, so a first burst with no copy yet can't swamp it.
function shared(unit, key, cache) {
  if (!inFlight[unit]) inFlight[unit] = refresh(unit, key, cache).finally(() => { inFlight[unit] = null; });
  return inFlight[unit];
}
async function refresh(unit, key, cache) {
  let text;
  try { text = await fromScript(unit); }
  catch (e) { await new Promise(res => setTimeout(res, 1500)); text = await fromScript(unit); }
  await cache.put(key, new Response(text, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=' + KEEP_SECONDS, 'X-Fetched-At': String(Date.now()) } }));
  return text;
}
export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' } });
    if (request.method !== 'GET') return new Response('Not allowed', { status: 405 });
    const url = new URL(request.url), unit = url.pathname.replace(/^\/|\/$/g, '');
    if (!Object.prototype.hasOwnProperty.call(UNITS, unit)) return new Response('Not found', { status: 404, headers: { 'X-Robots-Tag': 'noindex' } });
    const cache = caches.default, key = new Request(url.origin + '/__copy/v2/' + unit), hit = await cache.match(key);
    if (hit) {
      const body = await hit.text(), age = Date.now() - Number(hit.headers.get('X-Fetched-At') || 0);
      if (age >= FRESH_MS && Date.now() - (lastTry[unit] || 0) >= RETRY_MS) {
        lastTry[unit] = Date.now();
        ctx.waitUntil(shared(unit, key, cache).catch(() => {}));
      }
      return new Response(body, { headers: HEADERS });
    }
    try { return new Response(await shared(unit, key, cache), { headers: HEADERS }); }
    catch (e) { return new Response(JSON.stringify({ ok: false, error: 'unavailable' }), { status: 503, headers: Object.assign({}, HEADERS, { 'Cache-Control': 'no-store' }) }); }
  }
};
