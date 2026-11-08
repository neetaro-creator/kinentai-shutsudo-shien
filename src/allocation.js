// src/allocation.js
// 自本部（消防本部）の割当を formation.json から引く。依存なし。
// 迅速出動 → 別表9-1（国家的非常災害）／9-2（それ以外）、出動準備 → 別表5-1（統合機動部隊のみなら9-1の統合機動部隊欄）。

const SAFETY_KEY = "安全管理部隊"; // 安全管理部隊の行を counts で数えるときのキー
const GOKAN = "統合機動部隊";
const PHASES_FULL = ["統合機動部隊", "第一次編成陸上隊", "第二次編成陸上隊"];

/** 空の set を作る。 */
function newSet(source, label) {
  return { source, label, entries: [], counts: {}, total: 0 };
}

/** entry を追加し、種別ごとの隊数と合計を更新する。安全管理部隊は chutai とは別のキーで数える。 */
function addEntry(set, entry) {
  set.entries.push(entry);
  const key = entry.safety ? SAFETY_KEY : entry.chutai;
  set.counts[key] = (set.counts[key] || 0) + 1;
  set.total += 1;
}

function same(a, honbu) {
  return typeof a === "string" && a.trim() === honbu;
}

/**
 * 1行（中隊等）から、自本部が載っている項目を set に追加する。
 * formed_by に同じ本部が複数回載っていれば複数の項目になる。
 * safety_unit_honbu が自本部なら safety:true の別項目にする。
 */
function scanRow(set, honbu, phase, chutai, block, formedBy, safetyHonbu) {
  if (Array.isArray(formedBy)) {
    for (const fb of formedBy) {
      if (same(fb?.honbu, honbu)) {
        addEntry(set, { phase, chutai, block: block ?? null, note: fb.note ?? null, safety: false });
      }
    }
  }
  if (safetyHonbu && same(safetyHonbu.honbu, honbu)) {
    addEntry(set, { phase, chutai, block: block ?? null, note: safetyHonbu.note ?? null, safety: true });
  }
}

/** 別表9-1／9-2 の sections から、指定した phase の行を走査して set を作る。 */
function buildFromB9(source, label, table, phases, honbu) {
  const set = newSet(source, label);
  const sections = table?.sections ?? {};
  for (const phase of phases) {
    const rows = Array.isArray(sections[phase]) ? sections[phase] : [];
    for (const r of rows) {
      if (phase === "その他") {
        // その他は {unit, vehicle, formed_by}。車種を種別名に含めて区別する
        const chutai = r?.vehicle ? `${r.unit}（${r.vehicle}）` : r?.unit;
        scanRow(set, honbu, phase, chutai, null, r?.formed_by, null);
      } else {
        scanRow(set, honbu, phase, r?.chutai, r?.block, r?.formed_by, r?.safety_unit_honbu);
      }
    }
  }
  return set;
}

/** 別表5-1 全体から set を作る。 */
function buildFromB5(table, honbu) {
  const set = newSet("5-1", "出動準備（別表5-1）");
  const rows = Array.isArray(table?.units) ? table.units : [];
  for (const r of rows) {
    scanRow(set, honbu, "災害初期", r?.chutai, r?.block, r?.formed_by, r?.safety_unit_honbu);
  }
  return set;
}

/**
 * 自本部の割当を返す。
 * @param {string} honbu 自本部名（formation.json の honbu と完全一致、前後空白は無視）
 * @param {object} result judge() の戻り値
 * @param {object} formation formation.json の中身
 * @param {boolean|null} nationalDisaster 国家的非常災害か（不明は null）
 */
export function allocation(honbu, result, formation, nationalDisaster = null) {
  const none = { applicable: false, source: null, sets: [], needsNationalDisasterChoice: false };
  try {
    const level = result?.level;
    if (level !== "rapid" && level !== "prepare") return none;

    const name = typeof honbu === "string" ? honbu.trim() : "";
    const gokanV = result?.units?.gokan;
    const taitaiV = result?.units?.taitai;
    const sets = [];
    let needsChoice = false;

    // ---- 迅速出動 → 別表9-1 / 9-2 ----
    const rapidG = gokanV === "迅速出動";
    const rapidT = taitaiV === "迅速出動";
    if (rapidG || rapidT) {
      // 統合機動部隊だけが対象なら統合機動部隊の欄のみ。
      // 大隊が対象に含まれるときは全欄（9-2は「その他」も）。大隊のみの場合も全欄とする。
      const gokanOnly = rapidG && !rapidT;
      const scope = gokanOnly ? "統合機動部隊のみ" : "全欄";
      const add91 = () =>
        sets.push(
          buildFromB9("9-1", `迅速出動（別表9-1 国家的非常災害・${scope}）`, formation?.b9_1, gokanOnly ? [GOKAN] : PHASES_FULL, name)
        );
      const add92 = () =>
        sets.push(
          buildFromB9(
            "9-2",
            `迅速出動（別表9-2 国家的非常災害以外・${scope}）`,
            formation?.b9_2,
            gokanOnly ? [GOKAN] : [...PHASES_FULL, "その他"],
            name
          )
        );
      if (nationalDisaster === true) {
        add91();
      } else if (nationalDisaster === false) {
        add92();
      } else {
        // 不明のときは両方返し、呼び出し側に選択を促す
        add91();
        add92();
        needsChoice = true;
      }
    }

    // ---- 出動準備 → 別表5-1（統合機動部隊のみなら9-1の統合機動部隊欄） ----
    const prepG = gokanV === "出動準備";
    const prepT = taitaiV === "出動準備";
    if (prepG || prepT) {
      if (prepG && !prepT) {
        // 統合機動部隊は別表6で定める部隊
        sets.push(buildFromB9("9-1", "出動準備（別表9-1 統合機動部隊の欄。統合機動部隊は別表6で定める部隊）", formation?.b9_1, [GOKAN], name));
      } else {
        sets.push(buildFromB5(formation?.b5_1, name));
      }
    }

    // source は全 set が同一のときだけ値を持つ（複数種が混在すれば null）
    const sources = [...new Set(sets.map((s) => s.source))];
    return {
      applicable: true,
      source: sources.length === 1 ? sources[0] : null,
      sets,
      needsNationalDisasterChoice: needsChoice,
    };
  } catch {
    // 例外は投げない
    return none;
  }
}
