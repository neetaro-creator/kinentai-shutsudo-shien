// 地震情報の取り込み: 独立に作った試験データ（Opus 5.5）と実データで検査する
import fs from 'node:fs';
import { groupEvents, eventToInput } from '../src/quake.js';
const R = (p) => JSON.parse(fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8'));
const data = { cities: R('data/cities.json'), tsunamiMap: R('data/tsunami_area_map.json') };
const files = process.argv.slice(2).length ? process.argv.slice(2) : ['test/cases_quake_oracle.json'];
let total = 0, bad = 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
for (const f of files) for (const c of R(f).cases) {
  total++;
  const ev = groupEvents(c.records551);
  const e = c.expected, errs = [];
  if (!ev.length) { errs.push('地震が1件も作られない'); }
  else {
    const r = eventToInput(ev[0], (c.records552 || [])[0] || null, data), i = r.input;
    if (i.maxShindo !== e.maxShindo) errs.push(`maxShindo ${i.maxShindo} != ${e.maxShindo}`);
    if (i.maxShindoPlace !== e.maxShindoPlace) errs.push(`place ${i.maxShindoPlace} != ${e.maxShindoPlace}`);
    if (i.qualifyingPrefCount !== e.qualifyingPrefCount) errs.push(`count ${i.qualifyingPrefCount} != ${e.qualifyingPrefCount}`);
    if (i.epicenterSea !== e.epicenterSea) errs.push(`sea ${i.epicenterSea} != ${e.epicenterSea}`);
    if ((i.epicenterPref || null) !== (e.epicenterPref || null)) errs.push(`epPref ${i.epicenterPref} != ${e.epicenterPref}`);
    if ((i.maxShindoPref || null) !== (e.maxShindoPref || null)) errs.push(`maxPref ${i.maxShindoPref} != ${e.maxShindoPref}`);
    if (!same([...i.tsunamiPrefs].sort(), [...(e.tsunamiPrefs || [])].sort())) errs.push(`tsunami ${i.tsunamiPrefs} != ${e.tsunamiPrefs}`);
    if ((r.warnings.length > 0) !== !!e.hasWarning) errs.push(`warning ${r.warnings.length > 0} != ${e.hasWarning} ${JSON.stringify(r.warnings)}`);
  }
  if (errs.length) { bad++; console.log(`NG ${c.id} [${c.note}]\n   ${errs.join('\n   ')}`); }
}
console.log(`${total}件中 不一致 ${bad}件`); process.exit(bad ? 1 : 0);
