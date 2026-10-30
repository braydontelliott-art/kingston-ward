// Run: node _workers/bulletin-data.test.mjs
import assert from 'node:assert';
import worker from './bulletin-data.js';
const store = new Map();
globalThis.caches = { default: { match: async k => { const r = store.get(k.url); return r ? r.clone() : undefined; }, put: async (k, r) => { store.set(k.url, r.clone()); } } };
let calls = 0, mode = 'ok', v = 1;
globalThis.fetch = async () => { calls++; if (mode === 'html') return new Response('<html>Too many</html>', { status: 200 }); if (mode === 'down') throw new Error('down'); return new Response(JSON.stringify({ ok: true, v }), { status: 200 }); };
const pend = []; const ctx = { waitUntil: p => pend.push(p) };
const get = (p = '/kingston', method = 'GET') => worker.fetch(new Request('https://data.mywardy.com' + p, { method }), {}, ctx);
const age = ms => { const k = 'https://data.mywardy.com/__copy/kingston', r = store.get(k), h = new Headers(r.headers); h.set('X-Fetched-At', String(Date.now() - ms)); store.set(k, new Response(r.clone().body, { headers: h })); };
const tests = {
  async 'first call fetches once, then 300 at once cost no more calls'() { let r = await get(); assert.equal(r.status, 200); assert.equal((await r.json()).v, 1); assert.equal(calls, 1); const all = await Promise.all(Array.from({ length: 300 }, () => get())); all.forEach(x => assert.equal(x.status, 200)); assert.equal(calls, 1); },
  async 'after a minute it serves the copy and refreshes once in the background'() { age(61000); v = 2; const all = await Promise.all(Array.from({ length: 50 }, () => get())); for (const x of all) assert.equal((await x.json()).v, 1); await Promise.all(pend); assert.equal(calls, 2); assert.equal((await (await get()).json()).v, 2); },
  async 'Apps Script error page never replaces the good copy'() { age(61000); mode = 'html'; assert.equal((await (await get()).json()).v, 2); await Promise.all(pend); assert.equal((await (await get()).json()).v, 2); },
  async 'Apps Script down: good copy still served'() { age(61000); mode = 'down'; assert.equal((await (await get()).json()).v, 2); await Promise.all(pend); },
  async 'no copy and Apps Script down: clear failure so the page falls back'() { store.clear(); const r = await get(); assert.equal(r.status, 503); assert.equal(store.size, 0); mode = 'ok'; },
  async 'an error page is not cached either'() { mode = 'html'; assert.equal((await get()).status, 503); assert.equal(store.size, 0); mode = 'ok'; },
  async 'unknown unit and writes are refused'() { assert.equal((await get('/other')).status, 404); assert.equal((await get('/__proto__')).status, 404); assert.equal((await get('/constructor')).status, 404); assert.equal((await get('/kingston', 'POST')).status, 405); },
  async 'CORS works from the bulletin'() { assert.equal((await get()).headers.get('Access-Control-Allow-Origin'), '*'); assert.equal((await get('/kingston', 'OPTIONS')).status, 200); }
};
let fail = 0; for (const n of Object.keys(tests)) { try { await tests[n](); console.log('ok   ' + n); } catch (e) { fail++; console.log('FAIL ' + n + ': ' + e.message); } }
console.log(Object.keys(tests).length - fail + ' of ' + Object.keys(tests).length + ' passed'); process.exit(fail ? 1 : 0);
