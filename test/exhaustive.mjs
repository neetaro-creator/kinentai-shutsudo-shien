// 全組み合わせ: 47都道府県 × (Ⅰ,Ⅱ,Ⅲ-ア,Ⅲ-イ) × (単県,複数県) が別表第7の表の値と一致するか。
// さらに別表第7と別表Ａ（要綱）の対応列が一致するか。
import fs from 'node:fs';
import { judge } from '../src/judge.js';
const root = new URL('../', import.meta.url);
const rule7 = JSON.parse(fs.readFileSync(new URL('data/rule_table_7.json', root), 'utf8'));
const A = JSON.parse(fs.readFileSync(new URL('data/rule_table_a.json', root), 'utf8'));
const prefs = '北海道 青森 岩手 宮城 秋田 山形 福島 茨城 栃木 群馬 埼玉 千葉 東京 神奈川 新潟 富山 石川 福井 山梨 長野 岐阜 静岡 愛知 三重 滋賀 京都 大阪 兵庫 奈良 和歌山 鳥取 島根 岡山 広島 山口 徳島 香川 愛媛 高知 福岡 佐賀 長崎 熊本 大分 宮崎 鹿児島 沖縄'.split(' ');
const ev = { s7: { sh: '7' }, s6s: { sh: '6強' }, s6w: { sh: '6弱' } };
const cell = (p, unit, col) => { for (const g of rule7.groups) if (g.prefectures.includes(p)) return g.units.find(u => u.unit === unit).cells[col].value; return 'なし'; };
const base = { actionPlan: null, epicenterSea: false, epicenterPref: null, maxShindoPref: null, maxShindo: '5弱以下', maxShindoPlace: 'general', qualifyingPrefCount: 0, tsunamiPrefs: [], eruptionWarning: false, nationalDisaster: null };
let n = 0, bad = 0;
const rank = v => ({ '迅速出動': 2, '出動準備': 1, 'なし': 0 })[v];
for (const p of prefs) for (const scope of ['single', 'multi']) {
  for (const [k, e] of Object.entries(ev)) {
    const r = judge({ ...base, epicenterPref: p, maxShindo: e.sh, qualifyingPrefCount: scope === 'multi' ? 2 : 1 }, { rule7 });
    const g = cell(p, '統合機動部隊', `${k}_${scope}`), t = cell(p, '大隊・安全管理部隊', `${k}_${scope}`);
    n++; if (!r.units || r.units.gokan !== g || r.units.taitai !== t) { bad++; console.log('NG', p, k, scope, JSON.stringify(r.units), g, t); }
  }
  const r = judge({ ...base, tsunamiPrefs: scope === 'multi' ? [p, '__他__'] : [p] }, { rule7 });
  // 複数県の津波は2県目が不対象のダミー県なので p の群のセルのみが効く
  const g = cell(p, '統合機動部隊', `tsunami_${scope}`), t = cell(p, '大隊・安全管理部隊', `tsunami_${scope}`);
  n++; if (!r.units || r.units.gokan !== g || r.units.taitai !== t) { bad++; console.log('NG tsunami', p, scope, JSON.stringify(r.units), g, t); }
}
// 別表第7 ↔ 別表Ａ
const rowOf = { s7: ['I-tan', 'I-fuku'], s6s: ['II-tan', 'II-fuku'], s6w: ['III-a-tan', 'III-a-fuku'], tsunami: ['III-i-tan', 'III-i-fuku'] };
const colOf = { first: { 統合機動部隊: 'first_gokan', '大隊・安全管理部隊': 'first_anzen' }, prep: { 統合機動部隊: 'prep_gokan', '大隊・安全管理部隊': 'prep_anzen' } };
for (const g of rule7.groups) for (const u of g.units) for (const [k, rows] of Object.entries(rowOf)) for (const [i, sc] of ['single', 'multi'].entries()) {
  const v7 = u.cells[`${k}_${sc}`].value;
  const ac = A.rows.find(r => r.id === rows[i]).cells[colOf[g.id][u.unit]];
  const vA = ac.na ? 'なし' : ac.value.replace(/（出動準備を含む。?）/, '');
  n++; if (v7 !== vA) { bad++; console.log('第7とAの不一致', g.id, u.unit, k, sc, v7, vA); }
}
console.log(`${n}件中 不一致 ${bad}件`); process.exit(bad ? 1 : 0);
