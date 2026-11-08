// src/quake-ui.js
// 地震情報の取り込みパネル（F8）。依存なしの ES Module。
import { fetchQuakeData, eventToInput, shindoLabel } from './quake.js';

const DAY_MS = 7 * 24 * 60 * 60 * 1000;
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

// "YYYY/MM/DD HH:mm:ss" を Date に（ローカル時刻として解釈）
function parseTime(s) {
  const m = /^(\d{4})[/-](\d{2})[/-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(s || ''));
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
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

  let data = null;       // {events, tsunami, fetchedAt}
  let busy = false;

  // ---- DOM 構築 ----
  const root = el('section', { class: 'quake-panel no-print', 'aria-labelledby': 'quake-heading' });
  const heading = el('h2', { id: 'quake-heading', text: '地震情報の取り込み（自動入力・要確認）' });

  const fetchBtn = el('button', { type: 'button', class: 'quake-fetch', style: 'min-height:44px;min-width:44px', text: '地震情報を取り込む' });
  const latestBtn = el('button', { type: 'button', class: 'quake-latest', style: 'min-height:44px;min-width:44px', text: '最新の震度5弱以上を入れる' });

  const chk = el('input', { type: 'checkbox', id: 'quake-only5', checked: 'checked' });
  chk.checked = true;
  const chkLabel = el('label', { for: 'quake-only5', style: 'min-height:44px;display:inline-flex;align-items:center;gap:0.5em' },
    [chk, '震度5弱以上のみ']);

  const status = el('p', { class: 'quake-status', role: 'status', 'aria-live': 'polite' });
  const alertBox = el('div', { class: 'quake-error', 'aria-live': 'assertive' });
  const listBox = el('div', { class: 'quake-list-wrap' });
  const infoBox = el('div', { class: 'quake-info-wrap', 'aria-live': 'polite' });
  const metaBox = el('p', { class: 'quake-meta' });

  root.append(heading, el('div', { class: 'quake-controls' }, [fetchBtn, latestBtn, chkLabel]),
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

  // 一覧に出す地震（直近7日・新しい順・最大20件）
  function visibleEvents() {
    if (!data) return [];
    const minScale = chk.checked ? 45 : 30;
    const nowMs = getNow().getTime();
    return data.events
      .map((ev) => ({ ev, d: parseTime(ev.time) }))
      .filter(({ ev, d }) => d && nowMs - d.getTime() <= DAY_MS && d.getTime() <= nowMs + 60 * 1000 && ev.maxScale >= minScale)
      .sort((a, b) => b.d - a.d)
      .slice(0, MAX_LIST)
      .map(({ ev }) => ev);
  }

  function renderList() {
    listBox.textContent = '';
    if (!data) return;
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
      const r = eventToInput(ev, data.tsunami, tables);
      const label = `${ev.time} ${ev.hypocenterName || ''}`.trim();
      apply(r.input, { label, notes: r.notes || [], warnings: r.warnings || [] });
      renderInfo(ev, r);
    } catch (e) {
      showError(`変換に失敗: ${e && e.message ? e.message : e}`);
    }
  }

  function renderInfo(ev, r) {
    infoBox.textContent = '';
    const box = el('div', { class: 'quake-info', role: 'group', 'aria-label': '自動入力の根拠' });
    box.append(el('h3', { text: '自動入力しました（要確認）' }));
    box.append(el('p', { text: `発表時刻: ${ev.issuedAt || '不明'}` }));
    box.append(el('p', { text: `震央地名: ${ev.hypocenterName || '（不明）'}` }));
    if (r.notes && r.notes.length) {
      box.append(el('ul', { class: 'quake-notes' }, r.notes.map((n) => el('li', { text: n }))));
    }
    if (r.warnings && r.warnings.length) {
      box.append(el('ul', { class: 'quake-warn' },
        r.warnings.map((w) => el('li', {}, [el('strong', { text: `⚠ 警告: ${w}` })]))));
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

  latestBtn.addEventListener('click', async () => {
    if (busy) return;
    const d = await doFetch();
    if (!d) return;
    const nowMs = getNow().getTime();
    const cand = d.events
      .map((ev) => ({ ev, t: parseTime(ev.time) }))
      .filter(({ ev, t }) => t && nowMs - t.getTime() <= DAY_MS && ev.maxScale >= 45)
      .sort((a, b) => b.t - a.t)[0];
    if (!cand) {
      status.textContent = '直近7日間に震度5弱以上の地震はありません。';
      return;
    }
    await select(cand.ev);
  });

  return { root, refresh: doFetch };
}
