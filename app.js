// app.js
import { judge } from './src/judge.js';
import { allocation } from './src/allocation.js';
import { mountQuakePanel } from './src/quake-ui.js';

const KEY_HONBU = 'kinentai.honbu';
const KEY_CHECK = 'kinentai.check.';
const PREFS = ['北海道','青森','岩手','宮城','秋田','山形','福島','茨城','栃木','群馬','埼玉','千葉','東京','神奈川','新潟','富山','石川','福井','山梨','長野','岐阜','静岡','愛知','三重','滋賀','京都','大阪','兵庫','奈良','和歌山','鳥取','島根','岡山','広島','山口','徳島','香川','愛媛','高知','福岡','佐賀','長崎','熊本','大分','宮崎','鹿児島','沖縄'];

const store = {
  get(k){ try { return localStorage.getItem(k); } catch { return null; } },
  set(k,v){ try { localStorage.setItem(k,v); } catch {} },
  del(k){ try { localStorage.removeItem(k); } catch {} },
  keys(prefix){ try { return Object.keys(localStorage).filter(k=>k.startsWith(prefix)); } catch { return []; } }
};

function el(tag, attrs, ...kids){
  const n = document.createElement(tag);
  if (attrs) for (const [k,v] of Object.entries(attrs)){
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'text') n.textContent = v;
    else if (v === true) n.setAttribute(k,'');
    else n.setAttribute(k,v);
  }
  for (const c of kids.flat()){
    if (c === null || c === undefined || c === false) continue;
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}

const app = document.getElementById('app');
let D = null;               // data
let myHonbu = null;         // 保存された自本部
let viewHonbu = null;       // 表示中の本部
let showPicker = false;
const inp = { actionPlan:'', maxShindo:'', place:'general', count:'', sea:false, epPref:'', maxPref:'', tsunami:[], eruption:false, nd:'' };
let headerEl, resultsEl, formEl, quakeEl;
let quakeData = null;      // 地震情報取り込み用の地域データ（読めなくても本体は動く）

async function loadJson(name){
  const r = await fetch('./data/'+name);
  if (!r.ok) throw new Error(name+' の読み込みに失敗しました (HTTP '+r.status+')');
  return r.json();
}

async function init(){
  try {
    const names = ['rule_table_7','formation','procedure','forms','honbu','meta'];
    const arr = await Promise.all(names.map(n=>loadJson(n+'.json')));
    D = {};
    names.forEach((n,i)=>D[n]=arr[i]);
    if (!Array.isArray(D.honbu.honbu)) throw new Error('honbu.json の形式が不正です');
  } catch (e){
    app.replaceChildren(el('div',{class:'error',role:'alert'},
      'データの読み込みに失敗しました。画面を表示できません。',
      el('br'), String(e && e.message || e),
      el('br'), 'ネットワークと data/ フォルダの配置を確認してください。'));
    return;
  }
  const saved = store.get(KEY_HONBU);
  if (saved && D.honbu.honbu.some(h=>h.name===saved)) myHonbu = saved;
  if (!myHonbu) showSelect(); else buildMain();
}

function disclaimerEl(){
  return el('div',{class:'disclaimer'}, '参考表示。実際の出動準備・出動は消防庁からの連絡に従う');
}

function showSelect(){
  app.replaceChildren(
    disclaimerEl(),
    el('div',{class:'picker'},
      el('h1',null,'自本部を選んでください'),
      el('p',{class:'note'},'選んだ本部は、この端末にだけ保存されます。いつでも変更できます。'),
      D.honbu.honbu.map(h=>el('button',{type:'button',onclick:()=>{
        myHonbu = h.name; viewHonbu = null; store.set(KEY_HONBU,h.name); buildMain();
      }}, h.name, el('span',{class:'note'},'　'+(h.block||'')))),
      myHonbu ? el('button',{type:'button',onclick:buildMain},'キャンセル') : null
    ), versionEl());
}

function versionEl(){
  const m = D.meta || {};
  const plan = m.plan || {};
  let stale = false;
  try { stale = m.warn_after && new Date() > new Date(m.warn_after); } catch {}
  return el('div',null,
    el('div',{class:'verbar'}, `根拠: ${plan.name||''}（${plan.edition||'版不明'}）／転記日 ${m.transcribed_on||'不明'}`),
    stale ? el('div',{class:'stale',role:'alert'},'⚠ 古い版の可能性があります。最新の計画を確認してください。') : null);
}

function buildMain(){
  if (!viewHonbu) viewHonbu = myHonbu;
  headerEl = el('div');
  resultsEl = el('main',{'aria-label':'判定結果'});
  formEl = buildForm();
  quakeEl = el('div',{class:'quake-wrap no-print'});
  mountQuakePanel(quakeEl, { loadData: loadQuakeData, apply: applyQuake });
  app.replaceChildren(disclaimerEl(), headerEl, versionEl(), quakeEl, formEl, resultsEl);
  renderHeader();
  renderResults();
}

function renderHeader(){
  const viewing = viewHonbu !== myHonbu;
  const sel = el('select',{id:'viewsel','aria-label':'表示する本部',onchange:e=>{
    viewHonbu = e.target.value; renderHeader(); renderResults();
  }}, D.honbu.honbu.map(h=>el('option',{value:h.name,selected:h.name===viewHonbu},h.name)));
  headerEl.replaceChildren(...[
    el('div',{class:'honbubar'},
      el('div',{class:'name'},'自本部: ', myHonbu),
      el('button',{type:'button',class:'no-print',onclick:showSelect},'本部を変更'),
      el('button',{type:'button',class:'no-print','aria-expanded':String(showPicker),onclick:()=>{showPicker=!showPicker;renderHeader();}},'他本部を見る'),
      showPicker ? el('label',{class:'no-print'},'表示する本部 ',sel) : null,
      viewing ? el('button',{type:'button',class:'no-print',onclick:()=>{viewHonbu=myHonbu;renderHeader();renderResults();}},'自本部に戻す') : null),
    viewing ? el('div',{class:'viewing',role:'status'},'👁 他本部を表示中: ', viewHonbu, '（保存されている自本部は ', myHonbu, '）') : null].filter(Boolean));
}

/* ---------- フォーム ---------- */
function radioGroup(legend, name, opts, get, set){
  return el('fieldset',null, el('legend',null,legend),
    el('div',{class:'row'}, opts.map(([v,t])=>
      el('label',{class:'opt'},
        el('input',{type:'radio',name,value:v,checked:get()===v,onchange:()=>{set(v);update();}}), t))));
}
function prefSelect(id,label,key){
  return el('label',{id:id+'-wrap'},label+' ',
    el('select',{id,onchange:e=>{inp[key]=e.target.value;update();}},
      el('option',{value:''},'（未選択）'),
      PREFS.map(p=>el('option',{value:p,selected:inp[key]===p},p))));
}
function buildForm(){
  const epWrap = prefSelect('epPref','震央管轄都道府県（陸域のとき）','epPref');
  const mxWrap = prefSelect('maxPref','最大震度を観測した都道府県（海域のとき）','maxPref');
  const sync = () => { epWrap.hidden = inp.sea; mxWrap.hidden = !inp.sea; };
  window.__syncForm = sync;
  const f = el('form',{class:'card no-print span2',onsubmit:e=>e.preventDefault(),style:'margin:12px'},
    el('h2',{style:'margin:0'},'状況入力'),
    el('p',{class:'note'},'入力すると自動で判定します。'),
    radioGroup('アクションプラン該当','ap',[['','なし'],['shuto','首都直下'],['nankai','南海トラフ'],['nihonkaikou','日本海溝・千島海溝']],()=>inp.actionPlan,v=>inp.actionPlan=v),
    radioGroup('最大震度','shindo',[['','未入力'],['7','7'],['6強','6強'],['6弱','6弱'],['5強','5強'],['5弱以下','5弱以下']],()=>inp.maxShindo,v=>inp.maxShindo=v),
    radioGroup('最大震度の観測場所','place',[['general','それ以外'],['seirei','政令市等（区は市として扱う）'],['tokyo23','東京都特別区']],()=>inp.place,v=>inp.place=v),
    el('label',null,'震度6弱以上（政令市・東京特別区は5強以上）を観測した都道府県の数 ',
      el('input',{type:'number',min:'0',step:'1',inputmode:'numeric',value:inp.count,style:'width:6em',oninput:e=>{inp.count=e.target.value;update();}})),
    el('fieldset',null,el('legend',null,'震央'),
      el('label',{class:'opt row'},el('input',{type:'checkbox',style:'width:22px;height:22px',checked:inp.sea,onchange:e=>{inp.sea=e.target.checked;sync();update();}}),' 震央が海域'),
      epWrap, mxWrap),
    el('fieldset',null,el('legend',null,'大津波警報が発表された都道府県（複数選択）'),
      el('details',{open:inp.tsunami.length>0},el('summary',null,'都道府県を選ぶ'),
        el('div',{class:'grid2'},PREFS.map(p=>el('label',{class:'opt row',style:'display:flex;gap:6px;align-items:center;min-height:44px'},
          el('input',{type:'checkbox',style:'width:22px;height:22px',value:p,checked:inp.tsunami.includes(p),onchange:e=>{
            inp.tsunami = e.target.checked ? [...inp.tsunami,p] : inp.tsunami.filter(x=>x!==p); update();}}),p))))),
    el('label',{class:'opt row',style:'display:flex;gap:6px;align-items:center;min-height:44px'},
      el('input',{type:'checkbox',style:'width:22px;height:22px',checked:inp.eruption,onchange:e=>{inp.eruption=e.target.checked;update();}}),'噴火警報（居住区域）が発表された'),
    radioGroup('国家的非常災害か','nd',[['','不明'],['true','はい'],['false','いいえ']],()=>inp.nd,v=>inp.nd=v));
  sync();
  return f;
}
function update(){ renderResults(); }

/* ---------- 地震情報の取り込み（F8） ---------- */
async function loadQuakeData(){
  if (!quakeData){
    const [cities, tsunamiMap] = await Promise.all([loadJson('cities.json'), loadJson('tsunami_area_map.json')]);
    quakeData = { cities, tsunamiMap };
  }
  return quakeData;
}
// 取り込んだ値を状況入力へ反映する（アクションプラン・噴火警報・国家的非常災害は触らない）
function applyQuake(input){
  inp.maxShindo = input.maxShindo || '';
  inp.place = input.maxShindoPlace || 'general';
  inp.count = String(input.qualifyingPrefCount || 0);
  inp.sea = !!input.epicenterSea;
  inp.epPref = input.epicenterPref || '';
  inp.maxPref = input.maxShindoPref || '';
  inp.tsunami = (input.tsunamiPrefs || []).slice();
  const f = buildForm();
  formEl.replaceWith(f); formEl = f;
  renderResults();
}

/* ---------- 判定 ---------- */
function buildInput(){
  return {
    actionPlan: inp.actionPlan || null,
    epicenterSea: !!inp.sea,
    epicenterPref: inp.epPref || null,
    maxShindoPref: inp.maxPref || null,
    maxShindo: inp.maxShindo || null,
    maxShindoPlace: inp.place || 'general',
    qualifyingPrefCount: Math.max(0, parseInt(inp.count,10) || 0),
    tsunamiPrefs: inp.tsunami.slice(),
    eruptionWarning: !!inp.eruption,
    nationalDisaster: inp.nd === '' ? null : inp.nd === 'true'
  };
}
function isWaiting(){
  return !inp.actionPlan && !inp.maxShindo && inp.tsunami.length === 0 && !inp.eruption;
}

const LV = {
  rapid:{cls:'lv-rapid',icon:'🚨',title:'赤：出動の求め・指示、迅速出動',body:'割当隊を直ちに出動させる。集結場所の連絡を待つ。'},
  prepare:{cls:'lv-prepare',icon:'◆',title:'橙：出動準備',body:'出動可否を大津市消防局へ連絡し、様式2-2で隊数を報告する。'},
  info:{cls:'lv-info',icon:'●',title:'黄：情報収集・自主確認',body:'法令上の依頼はない。消防庁・県の連絡を待ち、被害情報を集める。'},
  none:{cls:'lv-none',icon:'－',title:'灰：対象外',body:'今回の震度では動きはない。'},
  indeterminate:{cls:'lv-indeterminate',icon:'？',title:'青：判定不能・要確認',body:'入力不足か、アクションプラン該当の可能性がある。消防庁の指示を確認する。'}
};
const REASON_MSG = {
  'missing-disaster-pref':'災害発生都道府県が未入力です。震央が海域なら「最大震度を観測した都道府県」、陸域なら「震央管轄都道府県」を選んでください。',
  'missing-pref-count':'震度6弱以上（政令市・東京特別区は5強以上）を観測した都道府県の数を、1以上で入力してください。',
  'unknown-intensity':'最大震度を選んでください（津波だけの場合も、観測した最大震度、なければ「5弱以下」を選択）。'
};

function safeJudge(){
  try { return judge(buildInput(), { rule7: D.rule_table_7 }); }
  catch (e){ return { level:'indeterminate', units:null, kubun:[], actionPlan:null, reasons:['error'], events:[], basis:[], _error:String(e&&e.message||e) }; }
}

function honbuInfo(){ return D.honbu.honbu.find(h=>h.name===viewHonbu) || {name:viewHonbu}; }

function renderResults(){
  const h = honbuInfo();
  const kids = [];
  if (isWaiting()){
    kids.push(el('section',{class:'span2'},el('h2',null,'(1) 判定'),
      el('div',{class:'banner lv-wait','aria-live':'polite'},
        el('div',{class:'big'},el('span',{class:'icon'},'…'),'入力待ち'),
        el('p',null,'上の「状況入力」で最大震度などを入れると、'+viewHonbu+' の対応区分を表示します。'))));
    kids.push(roleBox(h) && el('div',{class:'span2'},roleBox(h)));
    kids.push(formsSection(h), basisSection(null));
    resultsEl.replaceChildren(...kids.filter(Boolean));
    return;
  }
  const res = safeJudge();
  kids.push(el('section',{class:'span2'},el('h2',null,'(1) 判定'), bannerEl(res), roleBox(h)));
  kids.push(allocSection(res));
  kids.push(stepsSection(res,h));
  kids.push(formsSection(h));
  kids.push(basisSection(res));
  resultsEl.replaceChildren(...kids.filter(Boolean));
}

function bannerEl(res){
  const lv = LV[res.level] || LV.indeterminate;
  const reasons = Array.isArray(res.reasons) ? res.reasons : [];
  const parts = [];
  if (reasons.includes('action-plan') && res.actionPlan){
    const ap = res.actionPlan, i = ap.info || {};
    parts.push(el('p',null,el('strong',null,'該当: '+(ap.name||ap.key)+'。消防庁の指示待ち。')));
    const rows = [['条件',i.condition],['編成区分',i.formation_class],['応援先',i.destination],['集結場所',i.assembly_point],['進出拠点',i.staging_base]].filter(r=>r[1]);
    if (rows.length) parts.push(el('table',null,rows.map(r=>el('tr',null,el('th',null,r[0]),el('td',null,String(r[1]))))));
  } else if (reasons.includes('action-plan')){
    parts.push(el('p',null,el('strong',null,'アクションプラン該当。消防庁の指示待ち。')));
  }
  if (reasons.includes('below-threshold-5strong')){
    parts.push(el('p',null,el('strong',null,'法令上の出動準備なし。消防庁の依頼と県の判断に従う。')));
    parts.push(el('p',{class:'note'},'※ 県が必要と認めて出動可否を確認する場合がある（計画第8第5項）。'));
  }
  for (const r of reasons){
    if (REASON_MSG[r]) parts.push(el('p',null,'▶ '+REASON_MSG[r]));
    else if (!['action-plan','below-threshold-5strong'].includes(r) && res.level==='indeterminate') parts.push(el('p',{class:'note'},'理由コード: '+r));
  }
  // 区分には該当するが滋賀県の隊は対象外のとき、理由（どの表のどこで外れたか）を示す
  if (res.level === 'info' && Array.isArray(res.events) && res.events.length){
    const GL = { first:'第１次都道府県大隊', prep:'出動準備都道府県大隊' };
    parts.push(el('p',{class:'note'},el('strong',null,'対象外の理由（別表第7）')));
    parts.push(el('ul',null,res.events.map(ev=>el('li',null,
      `区分${ev.kubun}・${ev.scope}・${ev.pref||'（都道府県未定）'}` +
      (ev.group ? `（${GL[ev.group]}）: この組み合わせでは、滋賀県の統合機動部隊・大隊とも「なし」（別表第7で斜線）。`
                : ': 別表第7の対象都道府県（第１次・出動準備都道府県大隊）に含まれないため、滋賀県の隊は対象外。')))));
  }
  if (res._error) parts.push(el('p',null,'判定中にエラー: '+res._error));
  const u = res.units;
  return el('div',{class:'banner '+lv.cls,'aria-live':'polite',role:'status'},
    el('div',{class:'big'},el('span',{class:'icon','aria-hidden':'true'},lv.icon),lv.title),
    el('p',null,lv.body),
    u ? el('p',{class:'note'},`統合機動部隊: ${u.gokan}　／　大隊・安全管理部隊: ${u.taitai}`) : null,
    (res.kubun&&res.kubun.length) ? el('p',{class:'note'},'該当区分: '+res.kubun.join('、')) : null,
    parts);
}

function roleBox(h){
  const items = [];
  const r = D.procedure.roles || {};
  if (h.is_representative) items.push('代表消防機関（集結場所の決定・様式Bの連絡など）');
  if (h.is_representative_deputy || (r.representative && r.representative.deputy === h.name)) items.push('代表消防機関代行');
  if (h.is_representative || h.is_representative_deputy || (r.battalion_chief_from && [r.battalion_chief_from.honbu,r.battalion_chief_from.deputy].includes(h.name)))
    items.push(h.name === (r.battalion_chief_from&&r.battalion_chief_from.honbu) ? '滋賀県大隊長を出す本部' : '滋賀県大隊長を出す本部（代行）');
  if (h.block_role === '幹事' || h.block_role === '幹事代行') items.push((h.block||'')+' の'+h.block_role);
  if (D.honbu.logistics_hq && D.honbu.logistics_hq.honbu === h.name) items.push('後方支援本部を置く本部');
  const uniq = [...new Set(items)];
  if (!uniq.length) return null;
  return el('div',{class:'role'},el('strong',null,'📌 役割（'+h.name+'）'),el('ul',null,uniq.map(t=>el('li',null,t))));
}

/* ---------- (2) 割当 ---------- */
function allocSection(res){
  const sec = el('section',null,el('h2',null,'(2) 自本部の割当隊'));
  if (res.level !== 'rapid' && res.level !== 'prepare'){
    sec.append(el('p',null,'割当なし。'+(res.level==='indeterminate'?'判定が確定していないため、割当を出せません。':'今回の判定では出動準備・出動の対象となっていません。')));
    return sec;
  }
  let a;
  try { a = allocation(viewHonbu, res, D.formation, buildInput().nationalDisaster); }
  catch (e){ sec.append(el('p',{class:'error'},'割当の取得でエラー: '+String(e&&e.message||e))); return sec; }
  if (!a || !a.applicable || !a.sets || !a.sets.length){
    sec.append(el('p',null,'割当なし。'+viewHonbu+' は該当する編成（編成消防本部・安全管理部隊）に載っていません。'));
    return sec;
  }
  if (a.needsNationalDisasterChoice)
    sec.append(el('p',{class:'note'},'国家的非常災害か不明のため、別表9-1と9-2を両方表示しています。「国家的非常災害か」を選ぶと絞り込めます。'));
  for (const s of a.sets){
    const counts = s.counts || {};
    sec.append(el('h3',null,(s.label||'')+(s.source?'（'+s.source+'）':'')),
      el('div',{class:'chips'},
        Object.entries(counts).map(([k,n])=>el('span',{class:'chip'},`${k} × ${n}`)),
        el('span',{class:'chip'},'合計 '+(s.total ?? ''))),
      el('div',{class:'tblwrap'},el('table',null,
        el('thead',null,el('tr',null,['欄','種別','ブロック','備考'].map(t=>el('th',null,t)))),
        el('tbody',null,(s.entries||[]).map(e=>el('tr',null,
          el('td',null,e.phase||''),
          el('td',null,(e.chutai||'')+(e.safety?'（安全管理）':'')),
          el('td',null,e.block||''),
          el('td',null,e.note||'')))))));
  }
  return sec;
}

/* ---------- (3) 手順 ---------- */
function scopeMatch(scope,h){
  const r = D.procedure.roles || {};
  switch (scope){
    case 'all': return 'mine';
    case 'representative': return h.is_representative ? 'mine' : 'skip';
    case 'battalion_chief': {
      const bc = r.battalion_chief_from || {};
      return (h.is_representative || h.is_representative_deputy || h.name===bc.honbu || h.name===bc.deputy) ? 'mine' : 'skip';
    }
    case 'logistics_hq': return (D.honbu.logistics_hq && D.honbu.logistics_hq.honbu === h.name) ? 'mine' : 'skip';
    case 'block_secretary': return h.block_role === '幹事' ? 'mine' : 'skip';
    default: return 'ref';
  }
}
function basisEl(b){
  if (!b) return null;
  return el('details',null,el('summary',null,'根拠'),
    el('div',null,`${b.article?'第'.length&&String(b.article).startsWith('第')?b.article:b.article:''}${b.paragraph?' 第'+b.paragraph+'項':''}`),
    b.quote ? el('blockquote',null,b.quote) : null);
}
function stepEl(s,faded){
  const key = KEY_CHECK + s.id;
  const cb = el('input',{type:'checkbox',id:'c-'+s.id,checked:store.get(key)==='1','aria-label':s.action,onchange:e=>{
    if (e.target.checked) store.set(key,'1'); else store.del(key);
    wrap.classList.toggle('done',e.target.checked);
  }});
  const wrap = el('div',{class:'step'+(cb.checked?' done':'')},cb,
    el('div',null,
      el('div',{class:'when'},'時点: '+(s.when||'')),
      el('div',{class:'act'},s.action||''),
      (s.actor&&s.actor.text) ? el('div',{class:'when'},'担当: '+s.actor.text) : null,
      (s.forms&&s.forms.length) ? el('div',{class:'forms'},'様式: '+s.forms.join('、')) : null,
      basisEl(s.basis)));
  return wrap;
}
function stepsSection(res,h){
  const sec = el('section',null,el('h2',null,'(3) 手順チェックリスト'));
  const ids = res.level==='rapid' ? ['rapid','dispatch'] : res.level==='prepare' ? ['prepare','dispatch'] : [];
  if (!ids.length){
    sec.append(el('p',null,'法令上の手順はなし。'));
    return sec;
  }
  sec.append(el('button',{type:'button',class:'no-print',onclick:()=>{
    store.keys(KEY_CHECK).forEach(k=>store.del(k)); renderResults();
  }},'チェックを全て外す'));
  const refs = [];
  for (const id of ids){
    const ph = (D.procedure.phases||[]).find(p=>p.id===id);
    if (!ph) { sec.append(el('p',{class:'error'},`手順の段階 ${id} がデータにありません。`)); continue; }
    const steps = (ph.steps||[]).slice().sort((a,b)=>(a.order||0)-(b.order||0));
    const mine = [];
    for (const s of steps){
      const m = scopeMatch(s.actor&&s.actor.scope,h);
      if (m==='mine') mine.push(s); else if (m==='ref') refs.push({ph,s});
    }
    sec.append(el('h3',null,ph.label||ph.id));
    if (!mine.length) sec.append(el('p',{class:'note'},'この段階で '+h.name+' が行う手順はありません。'));
    mine.forEach(s=>sec.append(stepEl(s)));
  }
  if (refs.length){
    sec.append(el('details',null,el('summary',null,'県・消防庁の動き（参考）'+refs.length+'件'),
      refs.map(({ph,s})=>el('div',null,el('div',{class:'note'},'【'+(ph.label||ph.id)+'】'),stepEl(s,true)))));
  }
  return sec;
}

/* ---------- (4) 様式 ---------- */
function formMine(f,h){
  const fb = String(f.fill_by||'');
  if (fb.includes('全本部')) return true;
  if (fb.includes('代表消防機関') && h.is_representative) return true;
  if (fb.includes('幹事') && h.block_role==='幹事') return true;
  if (fb.includes('後方支援') && D.honbu.logistics_hq && D.honbu.logistics_hq.honbu===h.name) return true;
  return false;
}
function formsSection(h){
  const sec = el('section',null,el('h2',null,'(4) 様式'));
  const list = (D.forms && D.forms.forms) || [];
  sec.append(el('p',{class:'note'},'様式の本文は計画の様式ページ（PDF p.35〜39）を参照。'));
  if (!list.length) sec.append(el('p',null,'様式データがありません。'));
  for (const f of list){
    const mine = formMine(f,h);
    const b = f.basis;
    sec.append(el('div',{class:'form-item'+(mine?' mine':'')},
      el('strong',null,(mine?'★ ':'')+(f.name||f.id)+'　'+(f.title||'')),
      mine ? el('span',{class:'tag'},h.name+'が対象') : null,
      el('div',null,'用途: '+(f.purpose||'')),
      el('div',null,'提出者: '+(f.submitter||'')),
      el('div',null,'提出先: '+(f.destination||'')),
      f.timing ? el('div',null,'時期: '+f.timing) : null,
      f.related_article ? el('div',{class:'note'},'関連条文: '+f.related_article) : null,
      b ? el('details',null,el('summary',null,'根拠'),
        el('div',null,(b.article||'')+(b.paragraph?' 第'+b.paragraph+'項':'')),
        b.quote?el('blockquote',null,b.quote):null) : null));
  }
  return sec;
}

/* ---------- (5) 根拠 ---------- */
function basisSection(res){
  const sec = el('section',null,el('h2',null,'(5) 根拠条文'));
  const basis = res && Array.isArray(res.basis) ? res.basis : [];
  if (basis.length) sec.append(el('ul',null,basis.map(b=>el('li',null,typeof b==='string'?b:JSON.stringify(b)))));
  else sec.append(el('p',{class:'note'},'判定を行うと、判定の根拠がここに表示されます。'));
  const src = (D.meta && D.meta.sources) || [];
  sec.append(el('details',null,el('summary',null,'使用した別表と頁'),
    el('div',{class:'tblwrap'},el('table',null,
      el('thead',null,el('tr',null,['表','文書','頁'].map(t=>el('th',null,t)))),
      el('tbody',null,src.map(s=>el('tr',null,el('td',null,s.table||''),el('td',null,s.doc||''),el('td',null,s.page||''))))))));
  return sec;
}

init();

// --- Service Worker 登録 ---
if ('serviceWorker' in navigator) {
  const registerSW = () => {
    try {
      const hadController = !!navigator.serviceWorker.controller;
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        // 初回インストールでは再読込せず、更新時のみ一度だけ静かに反映
        if (!hadController || reloaded) return;
        reloaded = true;
        location.reload();
      });
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    } catch (e) {
      /* 登録に失敗しても画面は止めない */
    }
  };
  // モジュールの評価が load の後になることがあるため、完了済みなら即登録する
  if (document.readyState === 'complete') registerSW();
  else window.addEventListener('load', registerSW);
}
