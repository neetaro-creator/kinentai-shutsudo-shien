// Service Worker の模擬試験: プレキャッシュ、オフライン動作、データのネットワーク優先、旧キャッシュ削除
import fs from 'node:fs';
import vm from 'node:vm';
const ORIGIN = 'https://example.github.io/kinentai/';
const code = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const stores = new Map();
const keyOf = (r) => (typeof r === 'string' ? new URL(r, ORIGIN).href : r.url);
class Cache {
  constructor(m) { this.m = m; }
  async addAll(reqs) { for (const r of reqs) { const res = await netFetch(r); if (!res.ok) throw new Error('addAll ' + keyOf(r)); this.m.set(keyOf(r), res.clone()); } }
  async put(r, res) { this.m.set(keyOf(r), res); }
  async match(r) { const x = this.m.get(keyOf(r)); return x ? x.clone() : undefined; }
  async keys() { return [...this.m.keys()].map((u) => new Request(u)); }
}
const caches = {
  async open(n) { if (!stores.has(n)) stores.set(n, new Map()); return new Cache(stores.get(n)); },
  async keys() { return [...stores.keys()]; },
  async delete(n) { return stores.delete(n); },
};
let online = true, version = 'A';
async function netFetch(r) {
  if (!online) throw new TypeError('offline');
  const u = new URL(keyOf(r));
  const res = new Response(`${u.pathname}@${version}`, { status: 200 });
  Object.defineProperty(res, 'type', { value: 'basic' });
  return res;
}
const handlers = {};
const self = { location: new URL(ORIGIN + 'sw.js'), addEventListener: (t, f) => (handlers[t] = f), skipWaiting: async () => {}, clients: { claim: async () => {} } };
// 実際のSWと同様、相対URLはSWの場所を基準に解決する
class SWRequest extends Request { constructor(u, o) { super(typeof u === 'string' ? new URL(u, ORIGIN).href : u, o); } }
vm.runInNewContext(code, { self, caches, fetch: netFetch, Request: SWRequest, Response, URL, Promise, console });
let bad = 0; const ck = (ok, m) => { if (!ok) { bad++; console.log('NG', m); } };
const run = async (type, extra = {}) => { let p; handlers[type]({ waitUntil: (x) => (p = x), respondWith: (x) => (p = x), ...extra }); return p; };
stores.set('kinentai-v0-old', new Map());
await run('install');
const name = [...stores.keys()].find((k) => k !== 'kinentai-v0-old');
ck(stores.get(name).size === 15, `プレキャッシュ件数 ${stores.get(name)?.size}`);
await run('activate');
ck(!stores.has('kinentai-v0-old'), '旧キャッシュの削除');
const get = async (path, mode = 'cors') => {
  const req = new Request(ORIGIN + path); Object.defineProperty(req, 'mode', { value: mode });
  let p; handlers.fetch({ request: req, waitUntil: (x) => x, respondWith: (x) => (p = x) }); return p ? (await p).text() : null;
};
// オフライン
online = false;
ck((await get('index.html', 'navigate')) === '/kinentai/index.html@A', 'オフラインで index.html');
ck((await get('', 'navigate')) === '/kinentai/@A', 'オフラインで ./');
ck((await get('data/rule_table_7.json')) === '/kinentai/data/rule_table_7.json@A', 'オフラインで data（キャッシュ）');
ck((await get('src/judge.js')) === '/kinentai/src/judge.js@A', 'オフラインで judge.js');
// 計画の改正: データはネットワーク優先で新しい版を取り込む
online = true; version = 'B';
ck((await get('data/meta.json')) === '/kinentai/data/meta.json@B', 'オンラインで data は新しい版');
online = false;
ck((await get('data/meta.json')) === '/kinentai/data/meta.json@B', '更新後のオフラインでも新しい data');
// 外部オリジンは処理しない
let handled = false; handlers.fetch({ request: new Request('https://example.org/x'), respondWith: () => (handled = true) });
ck(!handled, '外部オリジンは素通し');
console.log(bad ? `NG ${bad}件` : 'Service Worker 試験 OK'); process.exit(bad ? 1 : 0);
