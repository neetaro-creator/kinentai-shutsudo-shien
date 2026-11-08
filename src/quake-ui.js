// src/quake-ui.js
// 地震情報の取り込みパネル（F8）。依存なしの ES Module。
import { fetchQuakeData, eventToInput, shindoLabel } from './quake.js';

const DAY_MS = 7 * 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DEFAULT_LIMIT_551 = 100;
const NO_TSUNAMI_MSG = 'この地震に対応する津波予報はありません（大津波警報なしとして扱っています）。大津波警報が出ている場合は手入力してください';
const LIMIT_MSG = '取得件数の上限に達したため、古い地震（本震）が含まれていない可能性があります';
const MAX_LIST = 20;
const TIMEOUT_MS = 8000;

// 要素作成の補助
function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
}

// "YYYY/MM/DD HH:mm:ss" を日本時間として Date に（端末のタイムゾーンに依存しない）
function parseTime(s) {
  const m = /^(\d{4})[/-](\d{2})[/-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(s || ''));
  if (!m) return null;
  // 日本時間の壁時計を UTC として作り、9時間を引いて実際の瞬間（UTC）に揃える
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) - JST_OFFSET_MS;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// タイムアウト付きで Promise を待つ
function withTimeout(promise, ms) {
  let timer;
  const t = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error('タイムアウト（8秒）')), ms);
  });
  return Promise.race([promise, t]).finally(() => clearTimeout(timer));
}

export function mountQuakePanel(container, { loadData, apply, now } = {}) {
  const getNow = () => (typeof now === 'function' ? now() : new Date());

  let data = null;       // {events, tsunami, tsunamiAll, count551, limit551, fetchedAt}
  let busy = false;

  // ---- DOM 構築 ----
  const root = el('section', { class: 'quake-panel no-print', 'aria-labelledby': 'quake-heading' });
  const heading = el('h2', { id: 'quake-heading', text: '地震情報の取り込み（自動入力・要確認）' });

  const fetchBtn = el('button', { type: 'button', class: 'quake-fetch', style: 'min-height:44px;min-width:44px', text: '地震情報を取り込む' });
  const latestBtn = el('button', { type: 'button', class: 'quake-latest', style: 'min-height:44px;min-width:44px', text: '直近7日で最大の地震を入れる' });

  const chk = el('input', { type: 'checkbox', id: 'quake-only5', checked: 'checked' });
  chk.checked = true;
  const chkLabel = el('label', { for: 'quake-only5', style: 'min-height:44px;display:inline-flex;align-items:center;gap:0.5em' },
    [chk, '震度5弱以上のみ']);

  // 一覧の並び順の切り替え
  const sortSel = el('select', { id: 'quake-sort', class: 'quake-sort', style: 'min-height:44px' }, [
    el('option', { value: 'new', text: '新しい順' }),
    el('option', { value: 'scale', text: '震度の大きい順' }),
  ]);
  const sortLabel = el('label', { for: 'quake-sort', style: 'min-height:44px;display:inline-flex;align-items:center;gap:0.5em' },
    ['並び順', sortSel]);

  const status = el('p', { class: 'quake-status', role: 'status', 'aria-live': 'polite' });
  const alertBox = el('div', { class: 'quake-error', 'aria-live': 'assertive' });
  const listBox = el('div', { class: 'quake-list-wrap' });
  const infoBox = el('div', { class: 'quake-info-wrap', 'aria-live': 'polite' });
  const metaBox = el('p', { class: 'quake-meta' });

  root.append(heading, el('div', { class: 'quake-controls' }, [fetchBtn, latestBtn, chkLabel, sortLabel]),
    status, alertBox, listBox, infoBox, metaBox);
  container.appendChild(root);

  // ---- 状態表示 ----
  function setBusy(b) {
    busy = b;
    fetchBtn.disabled = b;
    latestBtn.disabled = b;
    fetchBtn.textContent = b ? '取得中…' : '地震情報を取り込む';
    root.setAttribute('aria-busy', b ? 'true' : 'false');
    if (b) status.textContent = '取得中…';
  }

  function showError(reason) {
    alertBox.textContent = '';
    alertBox.append(el('p', {
      class: 'quake-warn', role: 'alert',
      text: `取得できませんでした。手入力で続けられます。（${reason}）`,
    }));
    status.textContent = '';
  }

  // 直近7日の地震（発生時刻は日本時間として解釈し、現在の瞬間と比較）。先の時刻すぎるものは除く
  function recentEvents(events) {
    const nowMs = getNow().getTime();
    return (Array.isArray(events) ? events : [])
      .map((ev) => ({ ev, d: parseTime(ev && ev.time) }))
      .filter(({ d }) => d && nowMs - d.getTime() <= DAY_MS && d.getTime() <= nowMs + 60 * 1000);
  }

  const scaleOf = (ev) => (ev && Number.isFinite(ev.maxScale) ? ev.maxScale : -1);

  // 最大震度の大きい順。同じなら新しい順
  function byScaleThenNew(a, b) {
    return scaleOf(b.ev) - scaleOf(a.ev) || b.d - a.d;
  }

  // 直近7日で最大の地震（最大震度が最大のもの。同じなら新しいもの）。なければ null
  function largestRecent(events) {
    const c = recentEvents(events)
      .filter(({ ev }) => scaleOf(ev) >= 10)
      .sort(byScaleThenNew)[0];
    return c ? c.ev : null;
  }

  // 選んだ地震より最大震度の大きい地震が直近7日にあれば、その中で最大のものを返す
  function biggerEventThan(ev) {
    const big = largestRecent(data ? data.events : []);
    return big && big !== ev && scaleOf(big) > scaleOf(ev) ? big : null;
  }

  function eventSummary(ev) {
    return `${ev.time}・${ev.hypocenterName || '（震央地名なし）'}・最大震度${shindoLabel(ev.maxScale)}`;
  }

  // 選んだ地震の発生時刻以降に発表された津波予報のうち最新の1件。なければ null
  function tsunamiFor(ev) {
    if (!data) return null;
    const all = Array.isArray(data.tsunamiAll) ? data.tsunamiAll : (data.tsunami ? [data.tsunami] : []);
    const evT = parseTime(ev && ev.time);
    if (!evT) return null;
    let best = null;
    let bestMs = -Infinity;
    for (const rec of all) {
      const t = parseTime(rec && rec.issue && rec.issue.time);
      if (!t || t.getTime() < evT.getTime()) continue;
      if (!best || t.getTime() > bestMs) {
        best = rec;
        bestMs = t.getTime();
      }
    }
    return best;
  }

  // 取得件数が上限に達していて、取得できた最も古い地震が7日前より新しいか
  function limitReached() {
    if (!data) return false;
    const limit = Number.isFinite(data.limit551) ? data.limit551 : DEFAULT_LIMIT_551;
    if (!Number.isFinite(data.count551) || data.count551 < limit) return false;
    let oldest = null;
    for (const ev of data.events) {
      const d = parseTime(ev && ev.time);
      if (d && (oldest === null || d.getTime() < oldest)) oldest = d.getTime();
    }
    if (oldest === null) return true; // 古さを確かめられないので注意を出す
    return oldest > getNow().getTime() - DAY_MS;
  }

  // 一覧に出す地震（直近7日・選んだ並び順・最大20件）
  function visibleEvents() {
    if (!data) return [];
    const minScale = chk.checked ? 45 : 30;
    const cmp = sortSel.value === 'scale' ? byScaleThenNew : (a, b) => b.d - a.d;
    return recentEvents(data.events)
      .filter(({ ev }) => ev.maxScale >= minScale)
      .sort(cmp)
      .slice(0, MAX_LIST)
      .map(({ ev }) => ev);
  }

  function renderList() {
    listBox.textContent = '';
    if (!data) return;
    if (limitReached()) {
      listBox.append(el('p', { class: 'quake-warn quake-limit', text: LIMIT_MSG }));
    }
    const evs = visibleEvents();
    if (!evs.length) {
      listBox.append(el('p', { text: `該当する地震はありません（直近7日間、${chk.checked ? '震度5弱以上' : '震度3以上'}）。` }));
      return;
    }
    const ul = el('ul', { class: 'quake-list' });
    for (const ev of evs) {
      const label = `${ev.time}　${ev.hypocenterName || '（震央地名なし）'}　最大震度 ${shindoLabel(ev.maxScale)}`;
      const b = el('button', { type: 'button', style: 'min-height:44px;min-width:44px', text: label });
      b.addEventListener('click', () => select(ev));
      ul.append(el('li', {}, [b]));
    }
    listBox.append(ul);
  }

  function renderMeta() {
    metaBox.textContent = '';
    if (!data) return;
    const ts = data.tsunami;
    let tsText = '津波予報の発表: なし';
    if (ts) {
      const t = ts.issuedAt || ts.issue?.time || (Array.isArray(ts) && ts[0]?.issue?.time);
      if (t) tsText = `津波予報の最新発表時刻: ${t}`;
    }
    const f = data.fetchedAt instanceof Date ? data.fetchedAt : new Date(data.fetchedAt || getNow());
    metaBox.textContent = `${tsText} ／ 取得日時: ${fmtDate(f)}`;
  }

  // 選択した地震を F2 に反映
  async function select(ev) {
    try {
      const tables = await loadData();
      // 選んだ地震の発生時刻以降に発表された津波予報の最新1件（なければ null）
      const tsunamiRecord = tsunamiFor(ev);
      const r = eventToInput(ev, tsunamiRecord, tables);
      const extra = [];
      const bigger = biggerEventThan(ev);
      if (bigger) extra.push(`直近7日に、より大きい地震があります: ${eventSummary(bigger)}`);
      if (!tsunamiRecord) extra.push(NO_TSUNAMI_MSG);
      const warnings = [...extra, ...(r.warnings || [])];
      const label = `${ev.time} ${ev.hypocenterName || ''}`.trim();
      apply(r.input, { label, notes: r.notes || [], warnings });
      renderInfo(ev, r, warnings);
    } catch (e) {
      showError(`変換に失敗: ${e && e.message ? e.message : e}`);
    }
  }

  function renderInfo(ev, r, warnings = r.warnings || []) {
    infoBox.textContent = '';
    const box = el('div', { class: 'quake-info', role: 'group', 'aria-label': '自動入力の根拠' });
    box.append(el('h3', { text: '自動入力しました（要確認）' }));
    box.append(el('p', { text: `発表時刻: ${ev.issuedAt || '不明'}` }));
    box.append(el('p', { text: `震央地名: ${ev.hypocenterName || '（不明）'}` }));
    if (r.notes && r.notes.length) {
      box.append(el('ul', { class: 'quake-notes' }, r.notes.map((n) => el('li', { text: n }))));
    }
    if (warnings.length) {
      box.append(el('ul', { class: 'quake-warn' },
        warnings.map((w) => el('li', {}, [el('strong', { text: `⚠ 警告: ${w}` })]))));
    }
    infoBox.append(box);
  }

  // 取得処理
  async function doFetch() {
    if (busy) return null;
    alertBox.textContent = '';
    infoBox.textContent = '';
    setBusy(true);
    try {
      const d = await withTimeout(Promise.resolve().then(() => fetchQuakeData()), TIMEOUT_MS);
      if (!d || !Array.isArray(d.events)) throw new Error('形式が想定と異なります');
      data = d;
      status.textContent = '取得しました。';
      renderList();
      renderMeta();
      return d;
    } catch (e) {
      data = null;
      listBox.textContent = '';
      metaBox.textContent = `取得日時: ${fmtDate(getNow())}（失敗）`;
      showError(e && e.message ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  fetchBtn.addEventListener('click', () => { doFetch(); });
  chk.addEventListener('change', renderList);
  sortSel.addEventListener('change', renderList);

  latestBtn.addEventListener('click', async () => {
    if (busy) return;
    const d = await doFetch();
    if (!d) return;
    // 余震で本震を見逃さないよう、最新ではなく直近7日で最大の地震を選ぶ
    const big = largestRecent(d.events);
    if (!big) {
      status.textContent = '直近7日間に震度の情報がある地震はありません。';
      return;
    }
    await select(big);
  });

  return { root, refresh: doFetch };
}
