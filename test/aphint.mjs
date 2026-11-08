// アクションプラン「該当の可能性」ヒントの試験（仕様だけから別モデルが作った試験データ）
import fs from 'node:fs';
import { apHints } from '../src/ap-hint.js';
const R = (p) => JSON.parse(fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8'));
const rules = R('data/ap_rules.json');
const files = process.argv.slice(2).length ? process.argv.slice(2) : ['test/cases_aphint_oracle.json'];
let total = 0, bad = 0;
const norm = (a) => a.map((h) => `${h.key}:${h.level}:${[...(h.matched || [])].sort().join('+')}`);
for (const f of files) for (const c of R(f).cases) {
  total++;
  let got; try { got = apHints(c.input, rules); } catch (e) { got = ['EXCEPTION ' + e.message]; }
  const g = Array.isArray(got) && typeof got[0] !== 'string' ? norm(got) : got;
  const e = norm(c.expected);
  if (JSON.stringify(g) !== JSON.stringify(e)) { bad++; console.log(`NG ${c.id} [${c.note}]\n   got ${JSON.stringify(g)}\n   exp ${JSON.stringify(e)}\n   input=${JSON.stringify(c.input)}`); }
}
console.log(`${total}件中 不一致 ${bad}件`); process.exit(bad ? 1 : 0);
