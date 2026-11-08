// src/quake.js
// 地震情報の取り込み（段階5・F8）。依存なしのES Module（ブラウザ／Node.js 24）。
// P2P地震情報 JSON API v2 の履歴から、状況入力（F2）の項目を作る。
// fetch 以外に外部への副作用はない。

// 地震情報の取得件数の上限（これに達したら古い地震が欠けている可能性がある）
const LIMIT_551 = 100;
const URL_551 = `https://api.p2pquake.net/v2/history?codes=551&limit=${LIMIT_551}`;
const URL_552 = "https://api.p2pquake.net/v2/history?codes=552&limit=20";

// 都道府県（「県・府・都」なしの表記）。都道府県名の五十音順（読みの順）に並べる。
const PREF_ORDER = [
  "愛知", "青森", "秋田", "石川", "茨城", "岩手", "愛媛", "大分", "大阪", "岡山",
  "沖縄", "香川", "鹿児島", "神奈川", "岐阜", "京都", "熊本", "群馬", "高知", "埼玉",
  "佐賀", "滋賀", "静岡", "島根", "千葉", "東京", "徳島", "栃木", "鳥取", "富山",
  "長崎", "長野", "奈良", "新潟", "兵庫", "広島", "福井", "福岡", "福島", "北海道",
  "三重", "宮城", "宮崎", "山形", "山口", "山梨", "和歌山",
];

// 短縮名 → 正式名（県・府・都・道付き）
const FULL_NAME = new Map(
  PREF_ORDER.map((p) => {
    let full;
    if (p === "北海道") full = "北海道";
    else if (p === "東京") full = "東京都";
    else if (p === "京都") full = "京都府";
    else if (p === "大阪") full = "大阪府";
    else full = p + "県";
    return [p, full];
  }),
);
const FULL_TO_SHORT = new Map([...FULL_NAME].map(([s, f]) => [f, s]));

// 北海道の地方名（「地方」を付けて使う）
const HOKKAIDO_REGIONS = [
  "石狩", "空知", "後志", "胆振", "日高", "渡島", "檜山",
  "上川", "留萌", "宗谷", "網走", "十勝", "釧路", "根室",
];

// 海域を示す語
const SEA_WORDS = ["沖", "灘", "湾", "海", "水道", "近海", "海峡", "海溝", "海盆"];

/** 都道府県名を「県・府・都」なしの表記にそろえる。不明なら null。 */
function normalizePref(s) {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!t) return null;
  if (FULL_TO_SHORT.has(t)) return FULL_TO_SHORT.get(t);
  if (FULL_NAME.has(t)) return t; // すでに短縮表記
  if (t !== "北海道" && /[県府都]$/.test(t)) return t.slice(0, -1);
  return t;
}

/** 都道府県の五十音順の位置（表にない名前は末尾） */
function prefRank(p) {
  const i = PREF_ORDER.indexOf(p);
  return i < 0 ? 999 : i;
}

/** 発表時刻などの "YYYY/MM/DD HH:mm:ss" を文字列として取り出す（なければ空文字） */
function issueTimeOf(rec) {
  const t = rec && rec.issue && rec.issue.time;
  return typeof t === "string" ? t : "";
}

/** 震度の数値を表示用ラベルにする */
export function shindoLabel(maxScale) {
  switch (maxScale) {
    case 10: return "1";
    case 20: return "2";
    case 30: return "3";
    case 40: return "4";
    case 45: return "5弱";
    case 50: return "5強";
    case 55: return "6弱";
    case 60: return "6強";
    case 70: return "7";
    default: return "情報なし";
  }
}

/** 観測点の震度ラベル（46 は推定値） */
function pointLabel(scale) {
  if (scale === 46) return "5弱以上と推定";
  return shindoLabel(scale);
}

/**
 * 地震情報（code 551）の配列を、earthquake.time が同じものごとに1つの地震へまとめる。
 * 新しい順で返す。壊れたレコード・時刻のないレコードは読み飛ばす。
 * 海外の地震（issue.type が Foreign）は国内の判定対象外なので含めない。
 */
export function groupEvents(records551) {
  if (!Array.isArray(records551)) return [];
  const groups = new Map();
  for (const rec of records551) {
    if (!rec || typeof rec !== "object") continue;
    if (rec.code !== undefined && rec.code !== 551) continue;
    const time = rec.earthquake && rec.earthquake.time;
    if (typeof time !== "string" || !time) continue;
    if (rec.issue && rec.issue.type === "Foreign") continue;
    if (!groups.has(time)) groups.set(time, []);
    groups.get(time).push(rec);
  }

  const events = [];
  for (const [time, recs] of groups) {
    let latestDetail = null;
    let latestPrompt = null;
    let nameRec = null;
    let maxScale = -1;
    let issuedAt = "";
    let hasDetail = false;

    for (const rec of recs) {
      const type = rec.issue && rec.issue.type;
      const it = issueTimeOf(rec);
      if (it > issuedAt) issuedAt = it;

      const ms = rec.earthquake && rec.earthquake.maxScale;
      if (Number.isFinite(ms) && ms > maxScale) maxScale = ms;

      if (type === "DetailScale") {
        hasDetail = true;
        if (!latestDetail || it > issueTimeOf(latestDetail)) latestDetail = rec;
      } else if (type === "ScalePrompt") {
        if (!latestPrompt || it > issueTimeOf(latestPrompt)) latestPrompt = rec;
      }

      const hn = rec.earthquake && rec.earthquake.hypocenter && rec.earthquake.hypocenter.name;
      if (typeof hn === "string" && hn.trim() !== "") {
        if (!nameRec || it > issueTimeOf(nameRec)) nameRec = rec;
      }
    }

    let points = [];
    let pointsSource = null;
    if (latestDetail) {
      pointsSource = "DetailScale";
      const ps = Array.isArray(latestDetail.points) ? latestDetail.points : [];
      points = ps.filter((p) => p && typeof p === "object" && p.isArea !== true);
    } else if (latestPrompt) {
      pointsSource = "ScalePrompt";
      const ps = Array.isArray(latestPrompt.points) ? latestPrompt.points : [];
      points = ps.filter((p) => p && typeof p === "object");
    }

    events.push({
      key: time,
      time,
      hypocenterName: nameRec ? nameRec.earthquake.hypocenter.name.trim() : "",
      maxScale,
      points,
      pointsSource,
      issuedAt,
      hasDetail,
    });
  }

  // "YYYY/MM/DD HH:mm:ss" は文字列比較で時刻順になる
  events.sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0));
  return events;
}

/** "YYYY/MM/DD HH:mm:ss"（日本時間）を Date にする。解釈できなければ null。 */
export function parseJstTime(s) {
  if (typeof s !== "string") return null;
  const m = s.match(/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+09:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * 一覧用の絞り込み。直近 days 日（既定7日）で、maxScale が minScale 以上のものを返す。
 * minScale の既定は 45（震度5弱以上）。「震度3以上」は 30。
 */
export function filterRecentEvents(events, { minScale = 45, days = 7, now = new Date() } = {}) {
  if (!Array.isArray(events)) return [];
  const limit = now.getTime() - days * 24 * 60 * 60 * 1000;
  return events.filter((e) => {
    const d = parseJstTime(e && e.time);
    if (!d || d.getTime() < limit) return false;
    return Number.isFinite(e.maxScale) && e.maxScale >= minScale;
  });
}

/** 震央地名から海域か判定する。北海道を除いた名前に海域を示す語があれば海域。 */
export function isSeaEpicenter(name) {
  if (typeof name !== "string" || name.trim() === "") return false;
  const rest = name.replace(/北海道/g, "");
  return SEA_WORDS.some((w) => rest.includes(w));
}

/** 震央地名から管轄の都道府県（県・府・都なし）を返す。判定できなければ null。 */
export function epicenterPref(name) {
  if (typeof name !== "string") return null;
  const n = name.trim();
  if (!n) return null;
  for (const [full, short] of FULL_TO_SHORT) {
    if (n.startsWith(full)) return short;
  }
  for (const r of HOKKAIDO_REGIONS) {
    if (n.startsWith(r + "地方")) return "北海道";
  }
  if (n.startsWith("淡路島")) return "兵庫";
  return null;
}

/**
 * 観測点を分類する。
 * 東京特別区: 東京都で観測点名が23区の区名で始まる → "tokyo23"
 * 政令市: 都道府県が一致し、観測点名が短縮名で始まり、続く部分に「〜区」が来る → "seirei"
 * それ以外 → "general"
 */
export function classifyPoint(point, cities) {
  if (!point || typeof point !== "object") return "general";
  const addr = typeof point.addr === "string" ? point.addr.trim() : "";
  const pref = normalizePref(point.pref);
  if (!addr || !pref || !cities || typeof cities !== "object") return "general";

  const wards = Array.isArray(cities.tokyo_special_wards) ? cities.tokyo_special_wards : [];
  if (pref === "東京" && wards.some((w) => addr.startsWith(w))) return "tokyo23";

  const designated = Array.isArray(cities.designated) ? cities.designated : [];
  for (const c of designated) {
    if (!c || typeof c.short !== "string") continue;
    if (normalizePref(c.pref) !== pref) continue;
    if (!addr.startsWith(c.short)) continue;
    const rest = addr.slice(c.short.length);
    // 区名は「市・町・村・郡」を挟まず、数文字のあとに「区」が来る形
    if (/^[^区市町村郡]{1,4}区/.test(rest)) return "seirei";
  }
  return "general";
}

/**
 * 津波予報（code 552）の1件から、大津波警報の対象都道府県を求める。
 * 解除済みなら空。予報区が対応表にない場合は unknownAreas に入れる。
 */
export function tsunamiPrefsFrom(record552, tsunamiMap) {
  if (!record552 || typeof record552 !== "object") {
    return { prefs: [], unknownAreas: [], cancelled: false, issueTime: null };
  }
  const issueTime = issueTimeOf(record552) || null;
  if (record552.cancelled === true) {
    return { prefs: [], unknownAreas: [], cancelled: true, issueTime };
  }
  const map = tsunamiMap && typeof tsunamiMap === "object" ? tsunamiMap : {};
  const areas = Array.isArray(record552.areas) ? record552.areas : [];
  const prefs = [];
  const unknownAreas = [];
  for (const a of areas) {
    if (!a || a.grade !== "MajorWarning") continue;
    const name = a.name;
    if (typeof name !== "string") continue;
    if (Object.prototype.hasOwnProperty.call(map, name) && Array.isArray(map[name])) {
      for (const p of map[name]) {
        const np = normalizePref(p);
        if (np && !prefs.includes(np)) prefs.push(np);
      }
    } else if (!unknownAreas.includes(name)) {
      unknownAreas.push(name);
    }
  }
  return { prefs, unknownAreas, cancelled: false, issueTime };
}

/** maxScale から判定仕様の maxShindo へ。変換できなければ null。 */
function maxShindoFrom(maxScale) {
  if (!Number.isFinite(maxScale) || maxScale < 10) return null;
  if (maxScale >= 70) return "7";
  if (maxScale >= 60) return "6強";
  if (maxScale >= 55) return "6弱";
  if (maxScale >= 50) return "5強";
  return "5弱以下";
}

/**
 * 地震1件（と津波予報1件）を状況入力（F2）の項目に変換する。
 * 戻り値: { input, notes（根拠）, warnings（警告） }。例外は出さない。
 * actionPlan / eruptionWarning / nationalDisaster は取り込まない。
 */
export function eventToInput(event, tsunamiRecord, data) {
  const notes = [];
  const warnings = [];
  const input = {
    actionPlan: null,
    epicenterSea: false,
    epicenterPref: null,
    epicenterName: null, // 震央地名（アクションプランの該当ヒントに使う）
    maxShindoPref: null,
    maxShindo: null,
    maxShindoPlace: "general",
    qualifyingPrefCount: 0,
    tsunamiPrefs: [],
    eruptionWarning: false,
    nationalDisaster: null,
  };

  const cities = data && data.cities ? data.cities : null;
  const tsunamiMap = data && data.tsunamiMap ? data.tsunamiMap : {};
  if (!cities) {
    warnings.push("政令市・東京特別区の判定表がありません。観測場所の判定ができない");
  }

  try {
    if (!event || typeof event !== "object") {
      warnings.push("地震情報がありません。手入力してください");
    } else {
      applyEvent(event, cities, input, notes, warnings);
    }
  } catch (e) {
    warnings.push(`地震情報の変換中に問題が起きました（${e && e.message ? e.message : e}）。手入力で確認してください`);
  }

  try {
    const t = tsunamiPrefsFrom(tsunamiRecord, tsunamiMap);
    if (tsunamiRecord) {
      if (t.cancelled) {
        notes.push(`津波予報: 最新の発表（${t.issueTime ?? "発表時刻不明"}）は解除。大津波警報なし`);
      } else if (t.prefs.length > 0) {
        notes.push(`津波予報: 最新の発表（${t.issueTime ?? "発表時刻不明"}）で大津波警報の対象は ${t.prefs.join("、")}`);
      } else {
        notes.push(`津波予報: 最新の発表（${t.issueTime ?? "発表時刻不明"}）に大津波警報なし`);
      }
    } else {
      notes.push("津波予報: 取得できた発表なし（大津波警報なしとして扱う）");
    }
    input.tsunamiPrefs = t.prefs;
    if (t.unknownAreas.length > 0) {
      warnings.push(`津波予報区が対応表にありません: ${t.unknownAreas.join("、")}。対象の都道府県を手入力で確認`);
    }
  } catch (e) {
    warnings.push(`津波予報の変換中に問題が起きました（${e && e.message ? e.message : e}）。手入力で確認してください`);
  }

  notes.push("アクションプラン・噴火警報・国家的非常災害は取り込まない（手入力）");
  return { input, notes, warnings };
}

/** 地震1件の変換本体。input / notes / warnings を直接更新する。 */
function applyEvent(event, cities, input, notes, warnings) {
  const maxScale = Number.isFinite(event.maxScale) ? event.maxScale : -1;
  const points = Array.isArray(event.points)
    ? event.points.filter((p) => p && typeof p === "object")
    : [];
  const name = typeof event.hypocenterName === "string" ? event.hypocenterName.trim() : "";

  notes.push(`発生時刻: ${event.time ?? "不明"}`);
  notes.push(`発表時刻: ${event.issuedAt || "不明"}`);

  // 最大震度
  input.maxShindo = maxShindoFrom(maxScale);
  if (input.maxShindo === null) {
    warnings.push("最大震度の情報がない（maxScale が -1 など）。最大震度を変換できないので手入力が必要");
  } else {
    notes.push(`最大震度: ${shindoLabel(maxScale)}`);
  }

  // 観測点の出所
  if (event.pointsSource === "ScalePrompt") {
    warnings.push("観測点の震度情報なし（震度速報のみ）。政令市・東京特別区の判定ができない");
  } else if (event.pointsSource !== "DetailScale") {
    warnings.push("観測点の情報がない。政令市・東京特別区の判定ができない");
  }

  const scaleOf = (p) => (Number.isFinite(p.scale) ? p.scale : null);
  const kind = (p) => (cities ? classifyPoint(p, cities) : "general");
  const pointText = (p) => `${p.pref ?? ""}${p.addr ?? ""}（震度${pointLabel(scaleOf(p))}）`;

  // 最大震度の観測点
  const maxPoints = maxScale >= 10 ? points.filter((p) => scaleOf(p) === maxScale) : [];

  // 震央が海域か・管轄都道府県
  input.epicenterName = name || null;
  if (!name) {
    warnings.push("震央地名が不明（震度速報のみ等）。震央が海域か、震央管轄都道府県を手入力で確認");
  } else {
    input.epicenterSea = isSeaEpicenter(name);
    notes.push(`震央地名: ${name}（${input.epicenterSea ? "海域" : "陸域"}と判定）`);
    if (!input.epicenterSea) {
      input.epicenterPref = epicenterPref(name);
      if (input.epicenterPref === null) {
        warnings.push(`震央地名「${name}」から震央管轄都道府県を判定できない。手入力が必要`);
      }
    }
  }

  // 海域のときの最大震度の都道府県
  if (input.epicenterSea) {
    const counts = new Map();
    let noPref = 0;
    for (const p of maxPoints) {
      const pref = normalizePref(p.pref);
      if (!pref) { noPref++; continue; }
      counts.set(pref, (counts.get(pref) || 0) + 1);
    }
    const ranked = [...counts.entries()].sort(
      (a, b) => b[1] - a[1] || prefRank(a[0]) - prefRank(b[0]) || (a[0] < b[0] ? -1 : 1),
    );
    if (ranked.length > 0) {
      input.maxShindoPref = ranked[0][0];
      if (ranked.length > 1) {
        warnings.push(
          `最大震度が複数の都道府県で観測。要確認: ${ranked.slice(1).map((r) => r[0]).join("、")}`,
        );
      }
    } else if (input.maxShindo !== null) {
      warnings.push("最大震度の観測点が見つからず、最大震度の都道府県を決められない。手入力が必要");
    }
    if (noPref > 0) warnings.push("都道府県が不明の最大震度観測点がある");
  }

  // 最大震度の観測場所
  if (maxPoints.length > 0) {
    const kinds = maxPoints.map(kind);
    if (kinds.includes("tokyo23")) input.maxShindoPlace = "tokyo23";
    else if (kinds.includes("seirei")) input.maxShindoPlace = "seirei";
    else input.maxShindoPlace = "general";
    const shown = maxPoints.slice(0, 10).map(pointText).join("、");
    notes.push(`最大震度の観測点: ${shown}${maxPoints.length > 10 ? ` ほか${maxPoints.length - 10}点` : ""}`);
  } else if (input.maxShindo !== null && event.pointsSource) {
    warnings.push("最大震度の観測点が見つからない。観測場所は general としている。要確認");
  }

  // 判定に使う都道府県の数
  const qualifying = new Set();
  let estimated = 0;
  let noPrefQualifying = 0;
  for (const p of points) {
    const s = scaleOf(p);
    if (s === null) continue;
    if (s === 46) { estimated++; continue; }
    const need55 = s >= 55;
    const need50 = s >= 50 && kind(p) !== "general";
    if (!need55 && !need50) continue;
    const pref = normalizePref(p.pref);
    if (pref) qualifying.add(pref);
    else noPrefQualifying++;
  }
  input.qualifyingPrefCount = qualifying.size;
  if (qualifying.size > 0) {
    notes.push(
      `震度6弱以上（政令市・特別区は5強以上）の都道府県: ${[...qualifying].sort((a, b) => prefRank(a) - prefRank(b)).join("、")}（${qualifying.size}）`,
    );
  }
  if (estimated > 0) {
    warnings.push("震度5弱以上と推定の観測点があり未確認");
  }
  if (noPrefQualifying > 0) {
    warnings.push("都道府県が不明の観測点があり、都道府県数に数えていない");
  }
  if (event.pointsSource) {
    notes.push(
      `使用した観測点: ${event.pointsSource === "DetailScale" ? "各地の震度に関する情報" : "震度速報（区域名）"}、${points.length}点`,
    );
  }
}

/** 取得失敗の例外メッセージを日本語にそろえる */
function toJaError(e) {
  if (e && e.isQuakeError) return e;
  const err = new Error(`地震情報を取得できませんでした（${e && e.message ? e.message : "原因不明"}）`);
  err.isQuakeError = true;
  return err;
}

function quakeError(message) {
  const err = new Error(message);
  err.isQuakeError = true;
  return err;
}

/**
 * P2P地震情報から地震情報と津波予報を取得する。
 * タイムアウトや失敗は日本語メッセージの例外として投げる。
 * 津波予報が取れないまま「大津波警報なし」と誤認させないよう、どちらの失敗も例外にする。
 * 戻り値: { events, tsunami（最新1件か null）, tsunamiAll（発表時刻の新しい順の配列）,
 *          count551（取得した地震情報の件数）, limit551（取得件数の上限）, fetchedAt }
 */
export async function fetchQuakeData(fetchImpl = globalThis.fetch, { timeoutMs = 8000 } = {}) {
  if (typeof fetchImpl !== "function") {
    throw quakeError("この環境では通信機能（fetch）が使えません");
  }
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(quakeError(`通信がタイムアウトしました（${Math.round(timeoutMs / 1000)}秒）`));
    }, timeoutMs);
  });

  const getJson = async (url) => {
    let res;
    try {
      res = await fetchImpl(url, { signal: controller.signal });
    } catch (e) {
      if (controller.signal.aborted) {
        throw quakeError(`通信がタイムアウトしました（${Math.round(timeoutMs / 1000)}秒）`);
      }
      throw quakeError(`通信に失敗しました（回線を確認してください）`);
    }
    if (!res || !res.ok) {
      throw quakeError(`APIがエラーを返しました（HTTP ${res ? res.status : "不明"}）`);
    }
    let json;
    try {
      json = await res.json();
    } catch (e) {
      throw quakeError("APIの応答がJSONとして読めませんでした（形式の違い）");
    }
    if (!Array.isArray(json)) {
      throw quakeError("APIの応答の形式が想定と異なります");
    }
    return json;
  };

  try {
    const [r551, r552] = await Promise.race([
      Promise.all([getJson(URL_551), getJson(URL_552)]),
      timeout,
    ]);

    const events = groupEvents(r551);

    // 津波予報: 正しい形のものを発表時刻の新しい順に並べる（同時刻は元の順を保つ）。tsunami はその最新1件
    const tsunamiAll = r552
      .filter((rec) => rec && typeof rec === "object" && (rec.code === undefined || rec.code === 552))
      .sort((a, b) => {
        const ta = issueTimeOf(a);
        const tb = issueTimeOf(b);
        return ta < tb ? 1 : ta > tb ? -1 : 0;
      });
    const tsunami = tsunamiAll.length > 0 ? tsunamiAll[0] : null;

    return {
      events,
      tsunami,
      tsunamiAll,
      count551: r551.length,
      limit551: LIMIT_551,
      fetchedAt: new Date().toISOString(),
    };
  } catch (e) {
    controller.abort();
    throw toJaError(e);
  } finally {
    clearTimeout(timer);
  }
}
