// src/judge.js
// 判定仕様（段階2）の実装。依存なし。ブラウザ／Node.js 24 の両方で動く ES Module。
// 表の値は data.rule7（rule_table_7.json の中身）を正とし、コードには表の値を持たない。

// 措置の強さ（迅速出動 ＞ 出動準備 ＞ なし）
const RANK = { "なし": 0, "出動準備": 1, "迅速出動": 2 };

// 受け付ける最大震度
const SHINDO = ["7", "6強", "6弱", "5強", "5弱以下"];
// 受け付ける観測場所
const PLACES = ["general", "tokyo23", "seirei"];

// 区分 → 別表第7の列キー接頭辞
const COLUMN_PREFIX = { "Ⅰ": "s7", "Ⅱ": "s6s", "Ⅲ-ア": "s6w", "Ⅲ-イ": "tsunami" };

// アクションプランのキー → 名称の検索語と代替名称
const ACTION_PLANS = {
  shuto: { words: ["首都直下"], fallback: "首都直下地震" },
  nankai: { words: ["南海トラフ"], fallback: "南海トラフ地震" },
  nihonkaikou: { words: ["日本海溝", "千島"], fallback: "日本海溝・千島海溝周辺海溝型地震" },
};

const UNIT_GOKAN = "統合機動部隊";
const UNIT_TAITAI = "大隊・安全管理部隊";

/** 都道府県名を別表第7の表記（「県」「府」「都」なし）に正規化する。文字列以外は空文字。 */
function normPref(v) {
  if (typeof v !== "string") return "";
  const s = v.trim();
  if (s === "" || s === "北海道") return s;
  if (s === "京都" || s === "京都府") return "京都"; // 「京都」の「都」を削らない
  return s.replace(/[都府県]$/, "");
}

function uniq(arr) {
  return [...new Set(arr)];
}

/** 入力不足・型不正などの indeterminate 結果を作る。 */
function indeterminate(reasons, basis, actionPlan = null) {
  return {
    level: "indeterminate",
    units: null,
    kubun: [],
    actionPlan,
    reasons: uniq(reasons),
    events: [],
    basis,
  };
}

/**
 * 別表第7から、災害発生都道府県・列に対応する統合機動部隊／大隊・安全管理部隊のセルを引く。
 * 第１次・出動準備のどちらの行にも無い県は両方「なし」。
 * 表が引けない（データ欠損・不正値）ときは error を返す。
 */
function lookupCell(rule7, pref, column) {
  const groups = rule7?.groups;
  if (!Array.isArray(groups)) return { error: "missing-rule-table" };
  const g = groups.find(
    (x) =>
      (x?.id === "first" || x?.id === "prep") &&
      Array.isArray(x.prefectures) &&
      x.prefectures.some((p) => normPref(p) === pref)
  );
  if (!g) return { group: null, label: null, gokan: "なし", taitai: "なし" };

  const get = (unitName) => {
    const u = Array.isArray(g.units) ? g.units.find((x) => x?.unit === unitName) : undefined;
    const v = u?.cells?.[column]?.value;
    return typeof v === "string" && Object.hasOwn(RANK, v) ? v : null;
  };
  const gokan = get(UNIT_GOKAN);
  const taitai = get(UNIT_TAITAI);
  if (gokan === null || taitai === null) return { error: "table-lookup-failed" };
  return { group: g.id, label: g.label ?? g.id, gokan, taitai };
}

/** 強い方の措置を返す。 */
function stronger(a, b) {
  return RANK[b] > RANK[a] ? b : a;
}

/**
 * 判定本体。
 * @param {object} input 判定仕様の入力
 * @param {{rule7: object}} data
 */
export function judge(input, data) {
  try {
    return judgeInner(input, data);
  } catch {
    // 例外は投げない
    return indeterminate(["invalid-input"], ["入力の処理中に想定外のエラーが発生したため判定できない"]);
  }
}

function judgeInner(input, data) {
  if (input === null || typeof input !== "object") {
    return indeterminate(["invalid-input"], ["入力がオブジェクトではない"]);
  }
  const rule7 = data?.rule7;

  // ---- 手順1: アクションプラン該当 ----
  const ap = input.actionPlan ?? null;
  if (ap !== null) {
    const def = typeof ap === "string" && Object.hasOwn(ACTION_PLANS, ap) ? ACTION_PLANS[ap] : null;
    if (!def) {
      return indeterminate(["unknown-action-plan"], [`未知のアクションプラン指定: ${String(ap)}`]);
    }
    const plans = Array.isArray(rule7?.action_plans) ? rule7.action_plans : [];
    const info = plans.find((p) => typeof p?.name === "string" && def.words.some((w) => p.name.includes(w))) ?? null;
    const name = info?.name ?? def.fallback;
    return indeterminate(
      ["action-plan"],
      [`アクションプラン（${name}）に該当するため区分は決めない。別表第7の第2表の情報を参照`],
      { key: ap, name, info }
    );
  }

  // ---- 入力検証 ----
  const problems = []; // 入力不足・型不正（あれば indeterminate）
  const notes = []; // 補足の理由コード（below-threshold-5strong など）
  const basis = [];

  const shindo = input.maxShindo;
  if (typeof shindo !== "string" || !SHINDO.includes(shindo)) {
    return indeterminate(["unknown-intensity"], [`未知の最大震度: ${String(shindo)}`]);
  }

  // ---- 手順3: 地震の区分 ----
  const place = input.maxShindoPlace;
  const placeOk = PLACES.includes(place);
  let eqKubun = null;
  if (shindo === "7") {
    eqKubun = "Ⅰ";
  } else if (shindo === "6強") {
    eqKubun = "Ⅱ";
  } else if (shindo === "6弱" || shindo === "5強") {
    if (!placeOk) {
      problems.push("unknown-place");
      basis.push(`最大震度${shindo}だが観測場所が不正: ${String(place)}`);
    } else if (shindo === "6弱") {
      eqKubun = place === "tokyo23" ? "Ⅱ" : "Ⅲ-ア";
    } else if (place === "general") {
      // 5強で一般の観測場所 → 区分なし
      notes.push("below-threshold-5strong");
      basis.push("最大震度5強（東京都特別区・政令市以外）は区分なし");
    } else {
      eqKubun = "Ⅲ-ア";
    }
  } else {
    basis.push("最大震度5弱以下は地震の区分なし");
  }

  // ---- 手順4: 津波 ----
  let tsunamiRaw = input.tsunamiPrefs ?? [];
  if (!Array.isArray(tsunamiRaw)) {
    problems.push("invalid-input");
    basis.push("tsunamiPrefs が配列ではない");
    tsunamiRaw = [];
  }
  const tsunamiNorm = tsunamiRaw.map(normPref);
  if (tsunamiNorm.some((p) => p === "")) {
    problems.push("missing-disaster-pref");
    basis.push("大津波警報の発表県に空または不正な値がある");
  }
  const tsunamiPrefs = uniq(tsunamiNorm.filter((p) => p !== ""));

  // ---- 手順5: 噴火警報 ----
  const eruption = input.eruptionWarning === true;

  // ---- 手順2・6: 地震の災害発生都道府県と単県／複数県 ----
  let eqPref = "";
  let eqScope = null;
  if (eqKubun) {
    if (typeof input.epicenterSea !== "boolean") {
      problems.push("invalid-input");
      basis.push("epicenterSea が真偽値ではない");
    } else {
      eqPref = normPref(input.epicenterSea ? input.maxShindoPref : input.epicenterPref);
      if (eqPref === "") {
        problems.push("missing-disaster-pref");
        basis.push(
          input.epicenterSea
            ? "震央が海域だが最大震度観測都道府県が未入力"
            : "震央が陸域だが震央管轄都道府県が未入力"
        );
      }
    }
    const c = input.qualifyingPrefCount;
    if (!Number.isInteger(c) || c < 1) {
      problems.push("missing-pref-count");
      basis.push("震度6弱以上（特別区・政令市は5強以上）の都道府県数が0または不正で、単県／複数県が決まらない");
    } else {
      eqScope = c === 1 ? "単県" : "複数県";
    }
  }
  const tsunamiScope = tsunamiPrefs.length === 1 ? "単県" : "複数県";

  // 区分一覧（適用順・重複なし）
  const kubun = [];
  if (eqKubun) kubun.push(eqKubun);
  if (tsunamiRaw.length > 0) kubun.push("Ⅲ-イ");
  if (eruption) kubun.push("Ⅳ");

  if (problems.length > 0) {
    return indeterminate([...problems, ...notes], basis);
  }

  // ---- 手順7〜9: 別表第7を引いて events を作る ----
  const events = [];
  const labels = []; // basis 用の表示ラベル
  const addEvent = (k, scope, pref) => {
    const column = `${COLUMN_PREFIX[k]}_${scope === "単県" ? "single" : "multi"}`;
    const cell = lookupCell(rule7, pref, column);
    if (cell.error) {
      problems.push(cell.error);
      basis.push(`別表第7を引けない（区分${k}、${pref}、列${column}）`);
      return;
    }
    events.push({ kubun: k, scope, column, pref, group: cell.group, gokan: cell.gokan, taitai: cell.taitai });
    labels.push(cell.label);
  };

  if (eqKubun) addEvent(eqKubun, eqScope, eqPref);
  for (const p of tsunamiPrefs) addEvent("Ⅲ-イ", tsunamiScope, p);

  if (problems.length > 0) {
    return indeterminate([...problems, ...notes], basis);
  }

  let gokan = "なし";
  let taitai = "なし";
  events.forEach((e, i) => {
    gokan = stronger(gokan, e.gokan);
    taitai = stronger(taitai, e.taitai);
    const where = e.group ? `${labels[i]}` : "第１次・出動準備のいずれでもない県";
    basis.push(`区分${e.kubun}・${e.scope}・${e.pref}（${where}）: 統合機動部隊=${e.gokan}、大隊・安全管理部隊=${e.taitai}`);
  });
  if (eruption) basis.push("噴火警報（居住区域）→ 区分Ⅳ（滋賀県大隊は対象外。区分として記録のみ）");

  // ---- 手順10: 全体の level ----
  let level;
  if (gokan === "迅速出動" || taitai === "迅速出動") {
    level = "rapid";
  } else if (gokan === "出動準備" || taitai === "出動準備") {
    level = "prepare";
  } else if (kubun.length > 0) {
    level = "info";
    basis.push("滋賀県の隊は対象でないが法令上の区分に該当");
  } else if (notes.includes("below-threshold-5strong")) {
    level = "info";
  } else {
    level = "none";
  }

  return {
    level,
    units: { gokan, taitai },
    kubun,
    actionPlan: null,
    reasons: uniq(notes),
    events,
    basis,
  };
}
