// src/ap-view.js
// アクションプラン発動時の「自本部の動き」表示部品（フレームワークなし・ES Modules）
// 表示はすべて参考。実際の出動・編成は消防庁長官の指示に従う。

/** 小さな要素作成関数。attrs: class / text / その他属性、children: Node|string */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

// 表の item の表示順
const ITEM_ORDER = [
  "応援編成区分", "応援先", "出動時期", "集結場所", "進出拠点",
  "出動ルート", "出動規模（隊数など）", "地域ブロック", "その他",
];

/** 「根拠」の開閉（頁ID・原文引用） */
function basisDetails(page, quote) {
  if (!page && !quote) return null;
  return el("details", { class: "print-open" },
    el("summary", { text: "根拠" }),
    el("p", { class: "note" },
      "原文の頁ID：", el("code", { text: page || "（不明）" })),
    quote ? el("blockquote", { class: "note", text: `「${quote}」` }) : null
  );
}

/** partially の「照合で修正」注記（小さく） */
function correctedMark(status) {
  return status === "partially"
    ? el("small", { class: "note", text: "（照合で修正）" })
    : null;
}

/** 節(2): 滋賀県大隊の扱い */
function buildHandlingSection(plan, ctx) {
  const sec = el("section", { class: "card", "aria-labelledby": "ap-handling-h" },
    el("h2", { id: "ap-handling-h", text: "アクションプランでの滋賀県大隊の扱い" })
  );

  // 計画名・版・適用要約
  sec.append(
    el("p", {},
      el("strong", { text: plan.name || "" }),
      plan.edition ? ` （版：${plan.edition}）` : ""
    )
  );
  if (plan.applicability?.summary) {
    sec.append(el("h3", { text: "適用の要約" }));
    sec.append(el("p", { text: plan.applicability.summary }));
    const basis = plan.applicability.basis || [];
    if (basis.length) {
      sec.append(el("details", { class: "print-open" },
        el("summary", { text: "適用の根拠" }),
        el("ul", {}, basis.map(b =>
          el("li", {},
            el("code", { text: b.page || "" }), " ",
            el("span", { class: "note", text: b.quote ? `「${b.quote}」` : "" })
          )))
      ));
    }
  }

  // item ごとに行をまとめた表
  const entries = plan.entries || [];
  if (entries.length) {
    const groups = new Map();
    for (const e of entries) {
      if (!groups.has(e.item)) groups.set(e.item, []);
      groups.get(e.item).push(e);
    }
    const keys = [...groups.keys()].sort((a, b) => {
      const ia = ITEM_ORDER.indexOf(a), ib = ITEM_ORDER.indexOf(b);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    });
    const tbody = el("tbody");
    for (const k of keys) {
      const list = groups.get(k);
      const valueCell = el("td");
      list.forEach(e => {
        valueCell.append(el("div", {},
          e.value, " ", correctedMark(e.status), basisDetails(e.page, e.quote)));
      });
      tbody.append(el("tr", {}, el("th", { scope: "row", text: k }), valueCell));
    }
    sec.append(el("h3", { text: "アクションプランの記載" }));
    sec.append(el("table", {},
      el("caption", { text: "アクションプランにおける滋賀県大隊の扱い（項目別）" }),
      el("thead", {}, el("tr", {},
        el("th", { scope: "col", text: "項目" }),
        el("th", { scope: "col", text: "内容・根拠" }))),
      tbody));
  }

  // 応援等実施計画 別表第7
  const t7 = plan.from_plan_table7;
  if (t7) {
    const rows = [
      ["編成区分", t7.formation_class],
      ["応援先", t7.destination],
      ["集結場所", t7.assembly_point],
      ["進出拠点", t7.staging_base],
    ];
    sec.append(el("h3", { text: "応援等実施計画 別表第7" }));
    sec.append(el("table", {},
      el("caption", { text: "応援等実施計画 別表第7（アクションプラン適応時における応援先）" }),
      el("thead", {}, el("tr", {},
        el("th", { scope: "col", text: "項目" }),
        el("th", { scope: "col", text: "内容" }))),
      el("tbody", {}, rows.map(([k, v]) =>
        el("tr", {}, el("th", { scope: "row", text: k }), el("td", { text: v ?? "－" }))))
    ));
    if (t7.condition) {
      sec.append(el("p", { class: "note", text: `適用条件：${t7.condition}` }));
    }
    if (t7.source) sec.append(el("p", { class: "note", text: `出典：${t7.source}` }));
  }

  // 統合機動部隊（参考）
  if (ctx && ctx.gokanSection) {
    sec.append(
      el("h3", { text: "統合機動部隊（参考）" }),
      el("p", { class: "note",
        text: "このアクションプランでは統合機動部隊を先遣出動させる記載がある。割当は別表9-1の統合機動部隊の欄。" }),
      ctx.gokanSection
    );
  }
  return sec;
}

/** flow 1件の表示 */
function flowItem(f) {
  return el("li", {},
    el("p", {},
      el("strong", { text: "時点：" }), f.when || "（記載なし）", " ",
      correctedMark(f.status)),
    el("p", {}, el("strong", { text: "主体：" }), f.actor || ""),
    el("p", {}, el("strong", { text: "行動：" }), f.action || ""),
    basisDetails(f.page, f.quote)
  );
}

/** 節(3): 流れと自本部の動き */
function buildFlowSection(plan, ctx) {
  const sec = el("section", { class: "card", "aria-labelledby": "ap-flow-h" },
    el("h2", { id: "ap-flow-h", text: "アクションプランの流れと自本部の動き" })
  );
  const flow = [...(plan.flow || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const isBn = !!(ctx && ctx.isBattalionChiefHonbu);

  const main = [], side = [];
  for (const f of flow) {
    if (f.relevance === "honbu" || (f.relevance === "battalion" && isBn)) main.push(f);
    else side.push(f);
  }

  sec.append(el("h3", { text: "自本部の動き（時系列）" }));
  if (main.length) {
    sec.append(el("ol", {}, main.map(flowItem)));
  } else {
    sec.append(el("p", { class: "note", text: "自本部の動きとして記載された項目はない。" }));
  }

  if (side.length) {
    sec.append(el("details", { class: "print-open" },
      el("summary", { text: "県・消防庁の動き（参考）" }),
      el("ol", {}, side.map(f => {
        const li = flowItem(f);
        // 大隊長本部以外の battalion 項目は参考側であることを文字でも示す
        if (f.relevance === "battalion") {
          li.prepend(el("p", { class: "note", text: "【大隊長を担う本部向けの動き（参考）】" }));
        }
        return li;
      }))
    ));
  }
  return sec;
}

/** 注意（常に先頭に太字の注意）の折りたたみ */
function buildCautions(plan) {
  const list = plan.cautions || [];
  return el("details", { class: "print-open" },
    el("summary", { text: "注意（読み取り上の留意点）" }),
    el("p", {}, el("strong", {
      text: "アクションプランの出動・編成は消防庁長官の指示で決まる。ここに出る内容は参考。" })),
    list.length ? el("ul", {}, list.map(c => el("li", { text: c }))) : null
  );
}

/**
 * アクションプラン発動時の表示（DOM要素1つ）を返す。
 * @param {string} apKey "nankai"|"nihonkaikou"|"shuto"
 * @param {object} apData action_plans.json 全体
 * @param {object} honbu honbu.json の1件
 * @param {{gokanSection: Element|null, isBattalionChiefHonbu: boolean}} ctx
 */
export function actionPlanSections(apKey, apData, honbu, ctx = {}) {
  const root = el("div", { class: "ap-sections" });
  const plan = apData?.plans?.[apKey];
  if (!plan) {
    root.append(el("section", { class: "card" },
      el("h2", { text: "アクションプランでの滋賀県大隊の扱い" }),
      el("p", { class: "note",
        text: "該当するアクションプランのデータが見つからない。消防庁の指示に従うこと。" })));
    return root;
  }

  // 最上部の要点（flow に原文がある場合のみ「待たずに準備」を書く）
  const noWait = (plan.flow || []).some(f =>
    f.relevance === "honbu" && /待つことなく|待たずに/.test(`${f.when || ""}${f.action || ""}${f.quote || ""}`));
  const lead = noWait
    ? "消防庁の連絡（出動準備依頼、出動可能隊数報告の依頼、出動の指示）に従う。連絡・依頼を待たずに、適用基準に該当すると判断したら出動準備を行う。"
    : "消防庁の連絡（出動準備依頼、出動可能隊数報告の依頼、出動の指示）に従う。";
  root.append(
    el("p", { class: "note", role: "note" },
      el("strong", { text: "要点：" }), lead,
      " 以下は参考表示で、実際は消防庁の指示に従う。",
      honbu?.name ? ` （自本部：${honbu.name}）` : "")
  );

  root.append(buildHandlingSection(plan, ctx));
  root.append(buildFlowSection(plan, ctx));
  root.append(buildCautions(plan));
  return root;
}
