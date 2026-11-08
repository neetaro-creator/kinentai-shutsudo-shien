// src/ap-hint.js
// アクションプラン「該当の可能性」ヒント（確定ではない。適用を決めるのは消防庁長官）
// 依存なしのES Module。ブラウザ・Node.js 24で動く。

/** 震度の順序（小さい→大きい） */
export const SHINDO_ORDER = Object.freeze(["5弱以下", "5強", "6弱", "6強", "7"]);

// 仕様に固定で出る名称（定数）
const NANKAI_REGION_KEYS = ["中部", "近畿", "四国・九州"];
const NIHONKAIKOU_REGION_KEY = "1道6県";
const PREF_TOKYO = "東京";
const PREFS_A1_NIHONKAIKOU = ["青森", "岩手", "宮城"];
const PREF_HOKKAIDO = "北海道";

/** 震度の序列（不明・null は -1） */
function shindoRank(s) {
  return typeof s === "string" ? SHINDO_ORDER.indexOf(s) : -1;
}

/** 指定震度以上か（maxShindo が null/不正なら false） */
function atLeast(maxShindo, threshold) {
  const r = shindoRank(maxShindo);
  return r >= 0 && r >= SHINDO_ORDER.indexOf(threshold);
}

/**
 * 都道府県名を「県・府・都なし」の表記にそろえる。
 * 2文字以下（京都など）はそのまま。「京都府」→「京都」、「東京都」→「東京」。
 */
function normPref(s) {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!t) return null;
  if (t.length > 2 && /[県府都]$/.test(t)) return t.slice(0, -1);
  return t;
}

/** 都道府県の配列を正規化（文字列以外は捨てる） */
function normPrefList(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const v of arr) {
    const n = normPref(v);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

/** rules から地域定義（正規化済みの配列）を引く。不正なら null */
function getRegion(rules, planKey, regionKey) {
  const def = rules?.[planKey]?.regions_definition?.[regionKey];
  if (!Array.isArray(def)) return null;
  const list = normPrefList(def);
  return list.length > 0 ? list : null;
}

/**
 * 震央地名の照合。
 * - 空 → { empty: true, ok: true }
 * - 非空 → names のいずれかと完全一致、またはいずれかで始まるときだけ ok
 */
function checkEpicenter(epicenterName, rules, planKey) {
  const name = typeof epicenterName === "string" ? epicenterName.trim() : "";
  if (name === "") return { empty: true, ok: true, name };
  const names = rules?.[planKey]?.epicenter_table?.names;
  if (!Array.isArray(names)) return { empty: false, ok: false, name };
  const ok = names.some(
    (n) => typeof n === "string" && n !== "" && (name === n || name.startsWith(n))
  );
  return { empty: false, ok, name };
}

/** 災害発生都道府県（正規化済み。なければ null） */
function disasterPref(input) {
  return input.epicenterSea === true
    ? normPref(input.maxShindoPref)
    : normPref(input.epicenterPref);
}

/** 首都直下 */
function hintShuto(input, dp) {
  if (!atLeast(input.maxShindo, "6強")) return null;
  const base = { key: "shuto", name: "首都直下地震" };
  if (input.maxShindoPlace === "tokyo23") {
    return {
      ...base,
      level: "strong",
      matched: ["A1"],
      checks: [],
      reasons: [`東京23区で最大震度${input.maxShindo}を観測`],
    };
  }
  if (dp === PREF_TOKYO) {
    return {
      ...base,
      level: "possible",
      matched: ["A1"],
      checks: ["東京23区の観測点で震度6強以上があるか"],
      reasons: [`災害発生都道府県が${PREF_TOKYO}で最大震度${input.maxShindo}`],
    };
  }
  return null;
}

/** 日本海溝・千島海溝 */
function hintNihonkaikou(input, rules, dp, tsunami) {
  const region = getRegion(rules, "nihonkaikou", NIHONKAIKOU_REGION_KEY);
  if (!region || !dp) return null;

  const tsunamiHit = tsunami.filter((p) => region.includes(p));
  if (tsunamiHit.length === 0) return null;

  const matched = [];
  if (PREFS_A1_NIHONKAIKOU.includes(dp) && atLeast(input.maxShindo, "6弱")) {
    matched.push("A1");
  }
  if (dp === PREF_HOKKAIDO && atLeast(input.maxShindo, "6強")) {
    matched.push("A2");
  }
  if (matched.length === 0) return null;

  const ep = checkEpicenter(input.epicenterName, rules, "nihonkaikou");
  if (!ep.ok) return null;

  const checks = [];
  const reasons = [
    `災害発生都道府県 ${dp}で最大震度${input.maxShindo}`,
    `大津波警報の発表（1道6県）: ${tsunamiHit.join("、")}`,
  ];
  if (ep.empty) {
    checks.push("震央地名が表3の想定震源断層域と重なる地名か");
  } else {
    reasons.push(`震央地名「${ep.name}」が表3の地名に該当`);
  }
  checks.push("その道県で震度6弱以上（北海道は6強以上）を観測したか");
  checks.push("1道6県のいずれかで大津波警報が出たか");

  return {
    key: "nihonkaikou",
    name: "日本海溝・千島海溝周辺海溝型地震",
    level: "possible",
    matched,
    checks,
    reasons,
  };
}

/** 南海トラフ */
function hintNankai(input, rules, dp, tsunami) {
  const regions = NANKAI_REGION_KEYS.map((k) => ({
    key: k,
    list: getRegion(rules, "nankai", k),
  }));
  if (regions.some((r) => !r.list)) return null;

  const matched = [];
  const checks = [];
  const reasons = [];

  // B1: 震度6強以上で、災害発生都道府県が3地域のいずれか
  if (dp && atLeast(input.maxShindo, "6強")) {
    const reg = regions.find((r) => r.list.includes(dp));
    if (reg) {
      matched.push("A1");
      reasons.push(`災害発生都道府県 ${dp}（${reg.key}）で最大震度${input.maxShindo}`);
    }
  }

  // B2 / B3: 大津波警報の地域カバー状況
  const covered = regions.filter((r) => tsunami.some((p) => r.list.includes(p)));
  if (covered.length > 0) {
    matched.push("A2");
    const names = covered.map((r) => r.key).join("・");
    if (covered.length === regions.length) {
      reasons.push(`大津波警報が3地域すべて（${names}）で発表`);
    } else {
      reasons.push(`大津波警報が一部の地域（${names}）で発表`);
      checks.push("他の地域でも大津波警報が出たか");
    }
  }

  if (matched.length === 0) return null;

  const ep = checkEpicenter(input.epicenterName, rules, "nankai");
  if (!ep.ok) return null;

  if (ep.empty) {
    checks.push("震央地名が表2の想定震源断層域と重なる地名か");
  } else {
    reasons.push(`震央地名「${ep.name}」が表2の地名に該当`);
  }
  checks.push("中部・近畿・四国九州の3地域すべてで震度6強以上、または大津波警報が出たか");

  return {
    key: "nankai",
    name: "南海トラフ地震",
    level: "possible",
    matched,
    checks,
    reasons,
  };
}

/**
 * アクションプラン該当の可能性ヒントを返す（確定ではない）。
 * 順序: shuto, nihonkaikou, nankai。例外は投げず、壊れた入力は空配列。
 */
export function apHints(input, rules) {
  try {
    if (!input || typeof input !== "object") return [];
    // アクションプラン選択済みなら何も返さない
    if (input.actionPlan !== null && input.actionPlan !== undefined) return [];

    const dp = disasterPref(input);
    const tsunami = normPrefList(input.tsunamiPrefs);

    const out = [];
    const builders = [
      () => hintShuto(input, dp),
      () => hintNihonkaikou(input, rules, dp, tsunami),
      () => hintNankai(input, rules, dp, tsunami),
    ];
    for (const build of builders) {
      try {
        const h = build();
        if (h) out.push(h);
      } catch {
        // 個別の失敗は無視（他のヒントは返す）
      }
    }
    return out;
  } catch {
    return [];
  }
}
