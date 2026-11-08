// 試験の実行: node test/run.mjs [cases.json ...]
import fs from 'node:fs';
import { judge } from '../src/judge.js';
const root = new URL('../', import.meta.url);
const rule7 = JSON.parse(fs.readFileSync(new URL('data/rule_table_7.json', root), 'utf8'));
const files = process.argv.slice(2).length ? process.argv.slice(2) : ['test/cases_oracle.json'];
let total = 0, bad = 0;
for (const f of files) {
  const cases = JSON.parse(fs.readFileSync(new URL(f, root), 'utf8')).cases;
  for (const c of cases) {
    total++;
    const r = judge(c.input, { rule7 });
    const e = c.expected;
    const errs = [];
    if (r.level !== e.level) errs.push(`level ${r.level} != ${e.level}`);
    if (e.units) {
      if (!r.units || r.units.gokan !== e.units.gokan || r.units.taitai !== e.units.taitai) errs.push(`units ${JSON.stringify(r.units)} != ${JSON.stringify(e.units)}`);
    } else if (r.units) errs.push(`units ${JSON.stringify(r.units)} != null`);
    if (JSON.stringify([...r.kubun].sort()) !== JSON.stringify([...(e.kubun || [])].sort())) errs.push(`kubun ${r.kubun} != ${e.kubun}`);
    if (errs.length) { bad++; console.log(`NG ${c.id} [${c.note}]\n   ${errs.join('\n   ')}\n   input=${JSON.stringify(c.input)}`); }
  }
}
console.log(`${total}件中 不一致 ${bad}件`);
process.exit(bad ? 1 : 0);
