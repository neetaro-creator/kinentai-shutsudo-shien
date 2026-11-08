import fs from 'node:fs';
import { judge } from '../src/judge.js';
import { allocation } from '../src/allocation.js';
const root = new URL('../', import.meta.url);
const rule7 = JSON.parse(fs.readFileSync(new URL('data/rule_table_7.json', root), 'utf8'));
const F = JSON.parse(fs.readFileSync(new URL('data/formation.json', root), 'utf8'));
const H = ['大津市消防局','湖南広域消防局','甲賀広域行政組合消防本部','東近江行政組合消防本部','彦根市消防本部','湖北地域消防本部','高島市消防本部'];
const base = { actionPlan: null, epicenterSea: false, epicenterPref: '愛知', maxShindo: '7', maxShindoPlace: 'general', qualifyingPrefCount: 1, tsunamiPrefs: [], eruptionWarning: false, nationalDisaster: null };
let bad = 0; const ck = (ok, m) => { if (!ok) { bad++; console.log('NG', m); } };
const rapid = judge(base, { rule7 });                                   // 第1次・7 → 迅速出動（両方）
const prep = judge({ ...base, maxShindo: '6強' }, { rule7 });           // 第1次・6強 → 出動準備（両方）
const gokanOnly = judge({ ...base, maxShindo: '6弱' }, { rule7 });      // 第1次・6弱 → 統合機動部隊のみ出動準備
ck(rapid.level === 'rapid' && prep.level === 'prepare' && gokanOnly.level === 'prepare' && gokanOnly.units.taitai === 'なし', '前提の判定');
// 1) 5-1: 全本部の合計
let t51 = 0, t91 = 0, t92 = 0, g = 0;
for (const h of H) {
  const a = allocation(h, prep, F, null);
  ck(a.applicable && a.source === '5-1' && a.sets.length === 1, `${h} 5-1`);
  const exp = F.b5_1.per_honbu[h].count_stated;
  const tot = a.sets[0].total;
  ck(tot === exp || (h.startsWith('東近江') && tot === exp + 1), `${h} 5-1 隊数 ${tot} vs ${exp}`);
  t51 += tot;
  const r = allocation(h, rapid, F, true), r2 = allocation(h, rapid, F, false), r3 = allocation(h, rapid, F, null);
  t91 += r.sets[0].total; t92 += r2.sets[0].total;
  ck(r3.needsNationalDisasterChoice && r3.sets.length === 2, `${h} 不明のとき両方`);
  const gk = allocation(h, gokanOnly, F, null);
  g += gk.sets[0].total;
  ck(gk.sets.every(s => s.entries.every(e => e.phase === '統合機動部隊')), `${h} 統合機動部隊のみ`);
}
ck(t51 === 39, `5-1 総計 ${t51}（38＋東近江の乗り換え1）`);
console.log('9-1 全体', t91, '9-2 全体', t92, '統合機動部隊', g);
ck(g === 14, '統合機動部隊は計14');
ck(t92 === 14 + 17 + 8 + 4, '9-2 は 14＋17＋8＋その他4');
const none = judge({ ...base, epicenterPref: '東京' }, { rule7 });
ck(!allocation(H[0], none, F, null).applicable, '対象外では割当なし');
console.log(bad ? `NG ${bad}件` : '割当の検査 OK'); process.exit(bad ? 1 : 0);
