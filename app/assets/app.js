import * as S from "./store.js";
import * as C from "./calc.js";
import { donut, legend, miniBar, mountPie, esc } from "./charts.js";
import { exportSheets } from "./xlsx.js";
import { initPush } from "./push.js";

const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

/* ═══════════════ 상태 ═══════════════ */
const state = {
  tab: "slips",
  sub: "list",
  filter: { from: "", to: "", company: "", dealer: "", plate: "", types: [], unpaidOnly: false },
  period: { kind: "this-month", ...C.rangeOf("this-month") },
  calMonth: new Date(),
  calSel: "",
  tax: { dependents: 1, taxCredit: 0 }
};

/* ═══════════════ 부팅 ═══════════════ */
async function boot() {
  registerSW();
  wireChrome();

  if (S.isLocalPinned()) {
    S.restoreLocalSession();
    return enterApp();
  }
  const cfg = S.readConfig();
  if (cfg.configured) {
    try {
      const sess = await S.currentSession();
      if (sess) return enterApp();
    } catch (err) { /* 설정 오류 → 로그인 화면에서 안내 */ }
    showAuth();
    return;
  }
  showAuth("Supabase 연결 정보가 없습니다. 아래에서 설정하거나, 이 기기에서 계정을 만들어 먼저 써보세요.");
}

function showAuth(msg = "") {
  $("#view-auth").hidden = false;
  $("#view-signup").hidden = true;
  $("#view-app").hidden = true;
  if (msg) { $("#auth-msg").textContent = msg; $("#auth-msg").classList.add("auth__msg--info"); }
}

function showSignup() {
  $("#view-auth").hidden = true;
  $("#view-signup").hidden = false;
  $("#signup-msg").textContent = ""; $("#signup-msg").classList.remove("auth__msg--info");
}

async function enterApp() {
  $("#view-auth").hidden = true;
  $("#view-signup").hidden = true;
  $("#view-app").hidden = false;
  const badge = $("#mode-badge");
  badge.textContent = S.store.mode === "cloud" ? "클라우드" : "로컬";
  badge.classList.toggle("is-cloud", S.store.mode === "cloud");
  $("#who").textContent = S.store.user?.email || "이 기기에만 저장 중";

  S.store.onChange = renderCurrent;
  try {
    await S.loadAll();
    S.watch();
    initPush();
  } catch (err) {
    toast("불러오기 실패: " + (err.message || err));
  }
  applyPeriodDefaultsToFinder();
  switchTab(state.tab);
}

function applyPeriodDefaultsToFinder() {
  const r = C.rangeOf("this-month");
  state.filter.from = r.from; state.filter.to = r.to;
  $("#f-from").value = r.from; $("#f-to").value = r.to;
}

function registerSW() {
  // 네이티브(APK)로 감싼 경우엔 등록하지 않습니다 — 앱이 이미 오프라인이고,
  // 워커가 남으면 앱을 새로 깔아도 옛 화면이 뜹니다.
  const native = !!window.Capacitor || !!document.querySelector('meta[name="jpc-native"]');
  if (native) return;
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

/* ═══════════════ 공통 UI ═══════════════ */
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

function openModal({ title, body, foot }) {
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML = body;
  $("#modal-foot").innerHTML = foot || "";
  $("#modal").hidden = false;
  document.body.style.overflow = "hidden";
}
function closeModal() {
  $("#modal").hidden = true;
  document.body.style.overflow = "";
}

function confirmDelete(label, onYes) {
  openModal({
    title: "삭제할까요?",
    body: `<p style="margin:6px 0 2px;font-size:14px;color:var(--ink-2)">${esc(label)}</p>
           <p class="hint">되돌릴 수 없습니다.</p>`,
    foot: `<button class="btn" data-close type="button">취소</button>
           <button class="btn btn--danger" id="do-del" type="button">삭제</button>`
  });
  $("#do-del").onclick = async () => { await onYes(); closeModal(); toast("삭제했습니다"); };
}

/* 금액 입력: 천단위 구분 자동 */
function attachMoney(el, onInput) {
  const fmt = () => {
    const raw = el.value.replace(/[^0-9]/g, "");
    el.value = raw ? Number(raw).toLocaleString("ko-KR") : "";
  };
  el.addEventListener("input", () => { fmt(); onInput?.(); });
  fmt();
}
const money = el => Number(String(el?.value || "").replace(/[^0-9]/g, "")) || 0;

/* ═══════════════ 앱 크롬 배선 ═══════════════ */
function wireChrome() {
  /* 로그인 */
  $("#auth-form").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = $("#auth-submit");
    btn.disabled = true; btn.textContent = "확인 중…";
    $("#auth-msg").textContent = ""; $("#auth-msg").classList.remove("auth__msg--info");
    const email = $("#auth-email").value, pass = $("#auth-pass").value;
    try {
      const local = await S.signInLocal(email, pass);
      if (local) {
        S.pinLocal(true);
        await enterApp();
      } else {
        await S.signIn(email, pass);
        S.pinLocal(false);
        await enterApp();
      }
    } catch (err) {
      $("#auth-msg").textContent = translateAuthError(err);
    } finally {
      btn.disabled = false; btn.textContent = "로그인";
    }
  });
  $("#auth-signup").onclick = () => showSignup();
  $("#signup-back").onclick = () => showAuth();

  $("#signup-form").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = $("#signup-submit");
    const msg = $("#signup-msg");
    msg.textContent = ""; msg.classList.remove("auth__msg--info");
    const email = $("#signup-email").value.trim();
    const pass = $("#signup-pass").value;
    const pass2 = $("#signup-pass2").value;
    if (pass !== pass2) { msg.textContent = "비밀번호가 서로 다릅니다."; return; }
    btn.disabled = true; btn.textContent = "가입 중…";
    try {
      if (S.readConfig().configured) {
        // Supabase 가 연결돼 있으면 그 계정으로 바로 회원가입 — 대시보드에서 손으로 추가할 필요 없음
        const data = await S.signUpCloud(email, pass);
        if (data.session) {
          S.pinLocal(false);
          await enterApp();
        } else {
          msg.textContent = "가입됐습니다. 메일함에서 인증 링크를 눌러야 로그인할 수 있어요.";
          msg.classList.add("auth__msg--info");
        }
      } else {
        await S.signUpLocal(email, pass);
        S.pinLocal(true);
        await enterApp();
      }
    } catch (err) {
      msg.textContent = translateAuthError(err);
    } finally {
      btn.disabled = false; btn.textContent = "가입하기";
    }
  });
  $("#auth-local").onclick = async () => { S.pinLocal(true); S.store.mode = "local"; await enterApp(); };
  $("#auth-config").onclick = () => openConfig();

  /* 탭 */
  $$(".stack__tab").forEach(b => {
    b.dataset.full = b.textContent.trim();
    if (b.getAttribute("aria-selected") !== "true") b.textContent = b.dataset.short;
  });
  $("#tabstack").addEventListener("click", e => {
    const b = e.target.closest(".stack__tab");
    if (b) switchTab(b.dataset.tab);
  });

  /* 검색 */
  ["#f-from", "#f-to", "#f-company", "#f-dealer", "#f-plate"].forEach(sel => {
    $(sel).addEventListener("input", () => {
      state.filter.from = $("#f-from").value;
      state.filter.to = $("#f-to").value;
      state.filter.company = $("#f-company").value;
      state.filter.dealer = $("#f-dealer").value;
      state.filter.plate = $("#f-plate").value;
      renderSlips();
    });
  });
  $("#f-types").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    b.classList.toggle("is-on");
    if (b.dataset.only === "unpaid") state.filter.unpaidOnly = b.classList.contains("is-on");
    else state.filter.types = $$("#f-types .chip[data-type].is-on").map(x => x.dataset.type);
    renderSlips();
  });
  $(".finder__quick").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.id === "f-reset") return resetFinder();
    const r = C.rangeOf(b.dataset.range);
    state.filter.from = r.from; state.filter.to = r.to;
    $("#f-from").value = r.from; $("#f-to").value = r.to;
    renderSlips();
  });

  $("#btn-table").onclick = () => {
    const t = $("#slips-table"), l = $("#slips-list");
    const showTable = t.hidden;
    t.hidden = !showTable; l.hidden = showTable;
    $("#btn-table").textContent = showTable ? "카드 보기" : "표 보기";
    renderSlips();
  };

  $("#c-q").addEventListener("input", renderClients);

  $("#expense-subnav").addEventListener("click", e => {
    const b = e.target.closest(".subnav__b"); if (!b) return;
    state.sub = b.dataset.sub;
    $$("#expense-subnav .subnav__b").forEach(x => x.classList.toggle("is-on", x === b));
    ["list", "chart", "tax", "sum"].forEach(k => { $("#sub-" + k).hidden = k !== state.sub; });
    renderExpense();
  });

  $("#cal-prev").onclick = () => shiftMonth(-1);
  $("#cal-next").onclick = () => shiftMonth(1);
  $("#cal-today").onclick = () => { state.calMonth = new Date(); state.calSel = C.todayISO(); renderCalendar(); };

  $("#btn-add-exp").onclick = () => expenseForm();
  $("#btn-add-slip-c").onclick = () => caseForm();
  $("#btn-menu").onclick = openMenu;

  $("#modal").addEventListener("click", e => { if (e.target.closest("[data-close]")) closeModal(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#modal").hidden) closeModal(); });

  /* 내보내기 */
  $("#btn-export-slips").onclick   = () => exportSlips(visibleCases());
  $("#btn-export-clients").onclick = () => exportClients();
  $("#btn-export-exp").onclick     = () => exportExpenses();
  $("#btn-export-rev").onclick     = () => exportRevenue();
  $("#btn-export-cal").onclick     = () => exportMonth();
  $("#btn-export-all").onclick     = () => exportAll();
}

function translateAuthError(err) {
  const m = (err?.message || String(err)).toLowerCase();
  if (m.includes("invalid login")) return "이메일 또는 비밀번호가 맞지 않습니다.";
  if (m.includes("failed to fetch") || m.includes("networkerror")) return "서버에 연결하지 못했습니다. Supabase 주소를 확인하세요.";
  if (m.includes("email not confirmed")) return "이메일 인증이 아직 끝나지 않았습니다.";
  if (m.includes("already registered") || m.includes("already exists")) return "이미 가입된 이메일입니다. 로그인해 주세요.";
  if (m.includes("password") && m.includes("least")) return "비밀번호가 너무 짧습니다. 6자 이상으로 입력하세요.";
  if (m.includes("unable to validate email") || m.includes("invalid email")) return "이메일 형식이 올바르지 않습니다.";
  if (m.includes("signups not allowed") || m.includes("signup is disabled")) return "지금은 새 가입을 받지 않습니다. 관리자에게 문의하세요.";
  return err?.message || "로그인하지 못했습니다.";
}

function resetFinder() {
  state.filter = { from: "", to: "", company: "", dealer: "", plate: "", types: [], unpaidOnly: false };
  ["#f-from", "#f-to", "#f-company", "#f-dealer", "#f-plate"].forEach(sel => { $(sel).value = ""; });
  $$("#f-types button").forEach(b => b.classList.remove("is-on"));
  renderSlips();
}

function switchTab(tab) {
  state.tab = tab;
  $$(".stack__tab").forEach(b => {
    const on = b.dataset.tab === tab;
    b.setAttribute("aria-selected", String(on));
    b.textContent = on ? b.dataset.full : b.dataset.short;
  });
  ["slips", "clients", "expense", "cal", "revenue"].forEach(k => { $("#panel-" + k).hidden = k !== tab; });
  renderCurrent();
}

function renderCurrent() {
  if (state.tab === "slips") renderSlips();
  else if (state.tab === "clients") renderClients();
  else if (state.tab === "expense") renderExpense();
  else if (state.tab === "cal") renderCalendar();
  else renderRevenue();
}

/* ═══════════════ 1. 매출 전표 ═══════════════ */
const visibleCases = () => C.filterCases(S.store.cases, state.filter);

function renderSlips() {
  const rows = visibleCases();
  $("#slips-count").textContent = `${rows.length}건`;

  if (!$("#slips-list").hidden) {
    $("#slips-list").innerHTML = rows.length ? rows.map(slipCard).join("") : emptyBox(
      "해당하는 전표가 없습니다",
      "검색 조건을 넓히거나, 합계 줄의 \"신규 전표\"로 입력하세요."
    );
    $("#slips-list").onclick = e => {
      const b = e.target.closest(".slip"); if (b) caseForm(S.store.cases.find(c => c.id === b.dataset.id));
    };
  } else {
    $("#slips-table").innerHTML = slipTable(rows);
    $("#slips-table").onclick = e => {
      if (e.target.closest("a.tel-link")) return;
      const tr = e.target.closest("tr[data-id]"); if (tr) caseForm(S.store.cases.find(c => c.id === tr.dataset.id));
    };
  }
  $("#slips-tally").innerHTML = tallyHTML(C.totals(rows), rows.length);
  $("#tally-add").onclick = () => caseForm();
}

function slipCard(c) {
  const primary = c.items?.[0]?.type || "";
  return `<button class="slip" type="button" data-id="${c.id}" data-type="${esc(primary)}">
    <span class="slip__top">
      <span class="slip__date">${C.fmtDateFull(c.date)}</span>
      ${(c.items || []).map(i => `<span class="slip__type" data-t="${esc(i.type)}">${esc(i.type)}</span>`).join("")}
      <span class="slip__price won">${C.won(c.price)}</span>
    </span>
    <span class="slip__mid">
      <span class="slip__co">${esc(c.company)}</span>
      <span class="slip__dealer">${esc(c.dealer)}</span>
      <span class="plate">${esc(c.plate)}</span>
      <span class="slip__car">${esc(c.carModel)}</span>
    </span>
    <span class="slip__foot">
      <span class="slip__pay">${esc(c.payMethod)}</span>
      ${c.unpaid > 0 ? `<span class="slip__due">미수 ${C.won(c.unpaid)}</span>` : ""}
      ${c.note ? `<span class="slip__note">${esc(c.note)}</span>` : ""}
      <span class="slip__cost">원가 ${C.won(c.cost)}</span>
    </span>
  </button>`;
}

const SLIP_COLS = ["날짜", "상사명", "딜러명", "연락처", "차종", "차량번호", "작업내용", "견적가", "결제", "미수금", "원가", "비고"];

function slipTable(rows) {
  const t = C.totals(rows);
  return `<table>
    <thead><tr>${SLIP_COLS.map(h => `<th>${h}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(c => `<tr data-id="${c.id}">
      <td>${C.fmtDateFull(c.date)}</td><td>${esc(c.company)}</td><td>${esc(c.dealer)}</td>
      <td>${c.phone ? `<a class="tel-link" href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : ""}</td><td>${esc(c.carModel)}</td>
      <td><span class="plate">${esc(c.plate)}</span></td><td>${(c.items || []).map(i => esc(i.type)).join(" + ")}</td>
      <td class="num">${C.won(c.price)}</td><td>${esc(c.payMethod)}</td>
      <td class="num">${c.unpaid ? C.won(c.unpaid) : "—"}</td>
      <td class="num">${C.won(c.cost)}</td><td>${esc(c.note)}</td>
    </tr>`).join("")}</tbody>
    <tfoot><tr>
      <th colspan="7" style="text-align:right">합계 ${rows.length}건</th>
      <th class="num" style="text-align:right">${C.won(t.price)}</th><th></th>
      <th class="num" style="text-align:right">${C.won(t.unpaid)}</th>
      <th class="num" style="text-align:right">${C.won(t.cost)}</th><th></th>
    </tr></tfoot>
  </table>`;
}

function tallyHTML(t, count) {
  return `<div class="tally__bar"><p class="tally__h">합계 · ${count}건</p>
      <button class="tally__add" id="tally-add" type="button">신규 전표</button></div>
    ${tallyRow("견적가 합", C.won(t.price))}
    ${tallyRow("미수금 합", C.won(t.unpaid), "tally__v--due")}
    ${tallyRow("실제 들어온 돈", C.won(t.received))}
    ${tallyRow("원가 합", C.won(t.cost))}
    <div class="tally__row tally__row--big">
      <span class="tally__k">마진 (견적가 − 원가)</span>
      <span class="tally__lead"></span>
      <span class="tally__v">${C.won(t.margin)}</span>
    </div>`;
}
const tallyRow = (k, v, cls = "") =>
  `<div class="tally__row"><span class="tally__k">${k}</span><span class="tally__lead"></span><span class="tally__v ${cls}">${v}</span></div>`;

const emptyBox = (t, s) => `<div class="empty"><p class="empty__t">${esc(t)}</p><p class="empty__s">${esc(s)}</p></div>`;

/* ── 전표 입력 / 수정 ── */
function caseForm(existing, defaults = {}) {
  const c = existing || {
    date: defaults.date || C.todayISO(), company: "", dealer: "", phone: "", carModel: "", plate: "",
    items: [{ type: "선팅", price: 0, cost: 0 }], payMethod: "카드", unpaid: 0, note: ""
  };
  const companies = [...new Set(S.store.cases.map(x => x.company).filter(Boolean))];
  const dealers = [...new Set(S.store.cases.map(x => x.dealer).filter(Boolean))];

  let selected = (c.items?.length ? c.items.map(i => i.type) : ["선팅"]);
  const itemVals = {};
  (c.items || []).forEach(i => { itemVals[i.type] = { price: i.price || 0, cost: i.cost || 0 }; });

  openModal({
    title: existing ? "전표 수정" : "신규 전표",
    body: `<div class="form">
      <div class="form__2">
        <label class="field"><span class="field__label">날짜</span><input id="c-date" type="date" value="${c.date}"></label>
        <label class="field"><span class="field__label">차량번호</span><input id="c-plate" type="text" value="${esc(c.plate)}" placeholder="12가 3456"></label>
      </div>
      <div class="form__2">
        <label class="field"><span class="field__label">상사명</span><input id="c-company" list="dl-co" value="${esc(c.company)}" placeholder="대성모터스"></label>
        <label class="field"><span class="field__label">딜러명</span><input id="c-dealer" list="dl-dl" value="${esc(c.dealer)}" placeholder="김성호"></label>
      </div>
      <datalist id="dl-co">${companies.map(v => `<option value="${esc(v)}">`).join("")}</datalist>
      <datalist id="dl-dl">${dealers.map(v => `<option value="${esc(v)}">`).join("")}</datalist>
      <div class="form__2">
        <div class="field" id="c-phone-field"></div>
        <label class="field"><span class="field__label">차종</span><input id="c-model" value="${esc(c.carModel)}" placeholder="그랜저 IG"></label>
      </div>

      <p class="form__sec">작업내용 <span class="hint" style="display:inline">(여러 개 고를 수 있습니다)</span></p>
      <div class="finder__chips" id="c-type"></div>

      <p class="form__sec">금액</p>
      <div id="c-items"></div>

      <p class="form__sec">결제</p>
      <div class="seg" id="c-pay">
        ${C.PAY_METHODS.map(t => `<button class="seg__b ${c.payMethod === t ? "is-on" : ""}" data-v="${t}" type="button">${t}</button>`).join("")}
      </div>
      <label class="switch"><input id="c-hasdue" type="checkbox" ${c.unpaid > 0 ? "checked" : ""}><span>미수금이 있습니다</span></label>
      <label class="field field--money" id="c-duewrap" ${c.unpaid > 0 ? "" : "hidden"}>
        <span class="field__label">미수금액</span><input id="c-unpaid" inputmode="numeric" placeholder="0" value="${c.unpaid || ""}">
      </label>
      <p class="calcline" id="c-calc"></p>

      <label class="field"><span class="field__label">비고</span><textarea id="c-note" placeholder="전면 15% · 측후면 5%">${esc(c.note)}</textarea></label>
    </div>`,
    foot: existing
      ? `<button class="btn btn--danger btn--icononly" id="c-del" type="button">삭제</button>
         <button class="btn btn--sm" data-close type="button">취소</button>
         <button class="btn btn--plate" id="c-edit" type="button">수정</button>
         <button class="btn btn--sm btn--plate" id="c-save" type="button">저장</button>`
      : `<button class="btn" data-close type="button">취소</button>
         <button class="btn btn--plate" id="c-save" type="button">전표 추가</button>`
  });

  /* 기존 전표는 "수정" 을 눌러야만 값을 바꿀 수 있게 잠가 둡니다 (실수로 건드리는 것 방지) */
  let editing = !existing;

  function renderPhoneField() {
    $("#c-phone-field").innerHTML = editing
      ? `<span class="field__label">연락처</span><input id="c-phone" type="tel" inputmode="tel" value="${esc(c.phone)}" placeholder="010-0000-0000">`
      : `<span class="field__label">연락처</span><div class="field__ro${c.phone ? "" : " field__ro--muted"}">${c.phone
          ? `<a class="tel-link" href="tel:${esc(c.phone)}">${esc(c.phone)}</a>`
          : "번호 없음"}</div>`;
  }

  function applyEditingState() {
    $("#modal-body").classList.toggle("is-locked", !editing);
    $$("#modal-body input, #modal-body textarea").forEach(el => { if (el.id !== "c-phone") el.disabled = !editing; });
    renderPhoneField();
    if (existing) {
      $("#c-edit").hidden = editing;
      $("#c-save").disabled = !editing;
    }
  }

  const itemsTotal = () => selected.reduce((s, t) => {
    const v = itemVals[t] || { price: 0, cost: 0 };
    return { price: s.price + (v.price || 0), cost: s.cost + (v.cost || 0) };
  }, { price: 0, cost: 0 });

  const recalc = () => {
    const { price, cost } = itemsTotal();
    const u = $("#c-hasdue")?.checked ? money($("#c-unpaid")) : 0;
    $("#c-calc").textContent = selected.length > 1
      ? `합계 견적가 ${C.won(price)}원 · 합계 원가 ${C.won(cost)}원 · 실입금 ${C.won(price - u)}원 · 마진 ${C.won(price - cost)}원`
      : `실입금 ${C.won(price - u)}원 · 마진 ${C.won(price - cost)}원`;
  };

  function renderTypeChips() {
    $("#c-type").innerHTML = C.WORK_TYPES.map(t =>
      `<button class="chip ${selected.includes(t) ? "is-on" : ""}" data-type="${t}" type="button">${t}</button>`
    ).join("");
  }
  function renderItems() {
    if (selected.length <= 1) {
      const t = selected[0] || "";
      const v = itemVals[t] || { price: 0, cost: 0 };
      $("#c-items").innerHTML = `<div class="form__2">
        <label class="field field--money"><span class="field__label">견적가</span><input id="c-price" inputmode="numeric" placeholder="0" value="${v.price || ""}"></label>
        <label class="field field--money"><span class="field__label">원가</span><input id="c-cost" inputmode="numeric" placeholder="0" value="${v.cost || ""}"></label>
      </div>`;
      attachMoney($("#c-price"), () => { itemVals[t] = itemVals[t] || { price: 0, cost: 0 }; itemVals[t].price = money($("#c-price")); recalc(); });
      attachMoney($("#c-cost"), () => { itemVals[t] = itemVals[t] || { price: 0, cost: 0 }; itemVals[t].cost = money($("#c-cost")); recalc(); });
    } else {
      $("#c-items").innerHTML = selected.map(t => {
        const v = itemVals[t] || { price: 0, cost: 0 };
        return `<div class="form__2">
          <label class="field field--money"><span class="field__label">${t} 견적가</span><input class="c-item-price" data-type="${t}" inputmode="numeric" placeholder="0" value="${v.price || ""}"></label>
          <label class="field field--money"><span class="field__label">${t} 원가</span><input class="c-item-cost" data-type="${t}" inputmode="numeric" placeholder="0" value="${v.cost || ""}"></label>
        </div>`;
      }).join("");
      $$("#c-items .c-item-price").forEach(el => attachMoney(el, () => {
        itemVals[el.dataset.type] = itemVals[el.dataset.type] || { price: 0, cost: 0 };
        itemVals[el.dataset.type].price = money(el); recalc();
      }));
      $$("#c-items .c-item-cost").forEach(el => attachMoney(el, () => {
        itemVals[el.dataset.type] = itemVals[el.dataset.type] || { price: 0, cost: 0 };
        itemVals[el.dataset.type].cost = money(el); recalc();
      }));
    }
    recalc();
  }
  renderTypeChips(); renderItems();
  $("#c-type").addEventListener("click", e => {
    const b = e.target.closest(".chip"); if (!b) return;
    const t = b.dataset.type;
    if (selected.includes(t)) { if (selected.length > 1) selected = selected.filter(x => x !== t); }
    else selected = [...selected, t];
    renderTypeChips(); renderItems();
  });

  attachMoney($("#c-unpaid"), recalc);

  segment("#c-pay");
  $("#c-hasdue").onchange = e => { $("#c-duewrap").hidden = !e.target.checked; recalc(); };

  applyEditingState();
  if (existing) $("#c-edit").onclick = () => { editing = true; applyEditingState(); };

  /* 알잘딱: 딜러 이름을 이미 쓴 적 있으면 상사명·연락처를 채워 준다 */
  $("#c-dealer").addEventListener("change", () => {
    const v = $("#c-dealer").value.trim(); if (!v) return;
    const prev = S.store.cases.find(x => x.dealer === v);
    if (!prev) return;
    if (!$("#c-company").value) $("#c-company").value = prev.company || "";
    if (!$("#c-phone").value) $("#c-phone").value = prev.phone || "";
  });
  $("#c-company").addEventListener("change", () => {
    const v = $("#c-company").value.trim(); if (!v || $("#c-phone").value) return;
    const prev = S.store.cases.find(x => x.company === v);
    if (prev && !$("#c-dealer").value) { $("#c-dealer").value = prev.dealer || ""; $("#c-phone").value = prev.phone || ""; }
  });

  $("#c-save").onclick = async () => {
    const { price, cost } = itemsTotal();
    const items = selected.map(t => ({ type: t, price: (itemVals[t]?.price) || 0, cost: (itemVals[t]?.cost) || 0 }));
    const rec = {
      id: existing?.id,
      date: $("#c-date").value || C.todayISO(),
      company: $("#c-company").value.trim(),
      dealer: $("#c-dealer").value.trim(),
      phone: $("#c-phone").value.trim(),
      carModel: $("#c-model").value.trim(),
      plate: $("#c-plate").value.trim(),
      items,
      price,
      payMethod: $("#c-pay .is-on")?.dataset.v || "카드",
      unpaid: $("#c-hasdue").checked ? money($("#c-unpaid")) : 0,
      cost,
      note: $("#c-note").value.trim()
    };
    if (!rec.company) return toast("상사명을 넣어 주세요");
    if (!rec.price) return toast("견적가를 넣어 주세요");
    if (rec.unpaid > rec.price) return toast("미수금이 견적가보다 클 수 없습니다");
    try { await S.saveCase(rec); closeModal(); toast(existing ? "저장했습니다" : "전표를 등록했습니다"); }
    catch (err) { toast("저장 실패: " + (err.message || err)); }
  };
  if (existing) $("#c-del").onclick = () =>
    confirmDelete(`${existing.company} · ${existing.plate} · ${C.won(existing.price)}원`, () => S.deleteCase(existing.id));
}

function segment(sel) {
  $(sel).addEventListener("click", e => {
    const b = e.target.closest(".seg__b"); if (!b) return;
    $$(sel + " .seg__b").forEach(x => x.classList.toggle("is-on", x === b));
    $(sel).dispatchEvent(new CustomEvent("seg", { detail: b.dataset.v }));
  });
}

/* ═══════════════ 2. 거래처 ═══════════════ */
function renderClients() {
  const q = ($("#c-q").value || "").trim().toLowerCase();
  const list = C.clients(S.store.cases).filter(c => !q || c.name.toLowerCase().includes(q));
  $("#clients-list").innerHTML = list.length ? list.map(clientCard).join("") : emptyBox(
    "거래처가 없습니다", "전표를 넣으면 상사명이 자동으로 거래처가 됩니다."
  );
  $("#clients-list").onclick = e => {
    const b = e.target.closest(".client"); if (b) clientDetail(b.dataset.name);
  };
}

function clientCard(c) {
  return `<button class="client" type="button" data-name="${esc(c.name)}">
    <span class="client__top">
      <span class="client__name">${esc(c.name)}</span>
      <span class="client__n">${c.count}건</span>
      <span class="client__sum won">${C.won(c.price)}</span>
    </span>
    <span class="client__bar">${miniBar(c.mix.map(m => ({ value: m.price, color: m.color })))}</span>
    <span class="client__meta">
      <span>${esc(c.dealers.slice(0, 3).join(", ") || "딜러 미기재")}${c.dealers.length > 3 ? ` 외 ${c.dealers.length - 3}명` : ""}</span>
      <span>최근 ${C.fmtDateFull(c.last)}</span>
      ${c.unpaid > 0 ? `<span class="client__due">미수 ${C.won(c.unpaid)}</span>` : ""}
    </span>
  </button>`;
}

function clientDetail(name) {
  const c = C.clients(S.store.cases).find(x => x.name === name);
  if (!c) return;
  openModal({
    title: name,
    body: `<div class="detail__sum">
        ${tallyRow("견적가 합", C.won(c.price))}
        ${tallyRow("미수금 합", C.won(c.unpaid), "tally__v--due")}
        ${tallyRow("실제 들어온 돈", C.won(c.received))}
        ${tallyRow("원가 합", C.won(c.cost))}
        <div class="tally__row tally__row--big"><span class="tally__k">마진</span><span class="tally__lead"></span><span class="tally__v">${C.won(c.margin)}</span></div>
      </div>
      <div class="legend" style="margin-bottom:14px">
        ${legend(c.mix.map(m => ({ key: `${m.key} ${m.count}건`, value: m.price, color: m.color })))}
      </div>
      <p class="form__sec" style="margin-bottom:10px">전표 ${c.count}건</p>
      <div class="slips" id="cd-list">${c.rows.map(slipCard).join("")}</div>`,
    foot: `<button class="btn" data-close type="button">닫기</button>
           <button class="btn btn--plate" id="cd-export" type="button">엑셀 내보내기</button>`
  });
  $("#cd-list").onclick = e => {
    const b = e.target.closest(".slip"); if (b) caseForm(S.store.cases.find(x => x.id === b.dataset.id));
  };
  $("#cd-export").onclick = () => exportSlips(c.rows, `거래처_${name}`);
}

/* ═══════════════ 기간 선택 막대 ═══════════════ */
const PERIODS = [
  { k: "this-month", t: "이번 달" }, { k: "last-month", t: "지난 달" },
  { k: "this-year", t: "올해" }, { k: "last-year", t: "작년" }, { k: "all", t: "전체" }
];

function periodBar(hostSel) {
  const host = $(hostSel);
  host.innerHTML = PERIODS.map(p =>
    `<button class="ghost ${state.period.kind === p.k ? "is-on" : ""}" data-k="${p.k}" type="button">${p.t}</button>`
  ).join("") + `<span class="listhead__count" style="margin-left:auto;align-self:center">${periodLabel()}</span>`;
  host.onclick = e => {
    const b = e.target.closest("button[data-k]"); if (!b) return;
    state.period = { kind: b.dataset.k, ...C.rangeOf(b.dataset.k) };
    renderCurrent();
  };
}
function periodLabel() {
  const { from, to } = state.period;
  return from ? `${C.fmtDateFull(from)} – ${C.fmtDateFull(to)}` : "전체 기간";
}

/* 기간 안의 자료 */
function periodData() {
  const { from, to } = state.period;
  const cases = C.filterCases(S.store.cases, { from, to });
  // 정기 지출은 "이미 빠져나간 달"까지만 펼칩니다 — 아직 안 온 달을 지출로 잡지 않기 위해서
  const cap = to && to > C.todayISO() ? C.todayISO() : to;
  const expenses = from
    ? C.expandRecurring(S.store.expenses, from, cap)
    : S.store.expenses.map(e => ({ ...e, occurredOn: e.date }));
  return { cases, expenses };
}

/* ═══════════════ 3. 지출 ═══════════════ */
function renderExpense() {
  if (state.sub === "list") return renderExpenseList();
  if (state.sub === "chart") return renderExpenseChart();
  if (state.sub === "tax") return renderTax();
  return renderSummary();
}

function renderExpenseList() {
  const rows = S.store.expenses;
  $("#exp-count").textContent = `${rows.length}건 등록`;
  $("#exp-list").innerHTML = rows.length ? rows.map(expRow).join("") : emptyBox(
    "등록된 지출이 없습니다", "오른쪽 위 \"신규 지출\"로 입력하세요. 정기 지출은 달력에도 표시됩니다."
  );
  $("#exp-list").onclick = e => {
    const b = e.target.closest(".exp"); if (b) expenseForm(S.store.expenses.find(x => x.id === b.dataset.id));
  };
}

function expRow(e) {
  const when = e.recurring ? `매달 ${e.dayOfMonth}일` : C.fmtDateFull(e.date);
  return `<button class="exp" type="button" data-id="${e.id}">
    <span class="exp__dot" style="background:${C.CAT_COLOR[e.category] || "#8895A0"}"></span>
    <span class="exp__body">
      <span class="exp__cat">${esc(e.category)}${e.recurring ? `<span class="exp__rec">정기</span>` : ""}</span><br>
      <span class="exp__when">${when}${e.note ? " · " + esc(e.note) : ""}</span>
    </span>
    <span class="exp__amt">${C.won(e.amount)}</span>
  </button>`;
}

function resvRow(r) {
  const types = (r.types || []).join(" · ");
  return `<button class="exp" type="button" data-id="${r.id}">
    <span class="exp__dot" style="background:var(--smoke)"></span>
    <span class="exp__body">
      <span class="exp__cat">${esc(r.company || "예약")}${types ? `<span class="exp__rec">${esc(types)}</span>` : ""}</span><br>
      <span class="exp__when">${esc(r.dealer || "")}${r.phone ? " · " + esc(r.phone) : ""}${r.note ? " · " + esc(r.note) : ""}</span>
    </span>
  </button>`;
}

function reservationForm(existing, defaults = {}) {
  const r = existing || {
    date: defaults.date || C.todayISO(), company: "", dealer: "", phone: "", carModel: "", plate: "",
    types: [], note: ""
  };
  let selected = [...(r.types || [])];

  openModal({
    title: existing ? "예약 수정" : "작업 예약",
    body: `<div class="form">
      <div class="form__2">
        <label class="field"><span class="field__label">날짜</span><input id="r-date" type="date" value="${r.date}"></label>
        <label class="field"><span class="field__label">차량번호</span><input id="r-plate" value="${esc(r.plate)}" placeholder="12가 3456"></label>
      </div>
      <div class="form__2">
        <label class="field"><span class="field__label">상사명</span><input id="r-company" value="${esc(r.company)}" placeholder="대성모터스"></label>
        <label class="field"><span class="field__label">딜러명</span><input id="r-dealer" value="${esc(r.dealer)}" placeholder="김성호"></label>
      </div>
      <div class="form__2">
        <label class="field"><span class="field__label">연락처</span><input id="r-phone" type="tel" value="${esc(r.phone)}" placeholder="010-0000-0000"></label>
        <label class="field"><span class="field__label">차종</span><input id="r-model" value="${esc(r.carModel)}" placeholder="그랜저 IG"></label>
      </div>
      <p class="form__sec">예정 작업 <span class="hint" style="display:inline">(여러 개 고를 수 있습니다)</span></p>
      <div class="finder__chips" id="r-type">
        ${C.WORK_TYPES.map(t => `<button class="chip ${selected.includes(t) ? "is-on" : ""}" data-type="${t}" type="button">${t}</button>`).join("")}
      </div>
      <label class="field"><span class="field__label">메모</span><textarea id="r-note" placeholder="예약 관련 메모">${esc(r.note)}</textarea></label>
    </div>`,
    foot: `${existing ? `<button class="btn btn--danger btn--icononly" id="r-del" type="button">삭제</button>` : ""}
           <button class="btn" data-close type="button">취소</button>
           <button class="btn btn--plate" id="r-save" type="button">${existing ? "저장" : "예약 등록"}</button>`
  });

  $("#r-type").addEventListener("click", e => {
    const b = e.target.closest(".chip"); if (!b) return;
    b.classList.toggle("is-on");
    selected = $$("#r-type .chip.is-on").map(x => x.dataset.type);
  });

  $("#r-save").onclick = async () => {
    const rec = {
      id: existing?.id,
      date: $("#r-date").value || C.todayISO(),
      company: $("#r-company").value.trim(),
      dealer: $("#r-dealer").value.trim(),
      phone: $("#r-phone").value.trim(),
      carModel: $("#r-model").value.trim(),
      plate: $("#r-plate").value.trim(),
      types: selected,
      note: $("#r-note").value.trim()
    };
    if (!rec.company) return toast("상사명을 넣어 주세요");
    try { await S.saveReservation(rec); closeModal(); toast(existing ? "저장했습니다" : "예약을 등록했습니다"); }
    catch (err) { toast("저장 실패: " + (err.message || err)); }
  };
  if (existing) $("#r-del").onclick = () =>
    confirmDelete(`${existing.company || "예약"} · ${C.fmtDateFull(existing.date)}`, () => S.deleteReservation(existing.id));
}

function expenseForm(existing, defaults = {}) {
  const e = existing || {
    amount: 0, category: "소모품비", recurring: false,
    dayOfMonth: defaults.date ? Number(defaults.date.slice(8)) : 25,
    date: defaults.date || C.todayISO(), note: ""
  };
  openModal({
    title: existing ? "지출 수정" : "신규 지출",
    body: `<div class="form">
      <label class="field field--money"><span class="field__label">금액</span><input id="e-amt" inputmode="numeric" value="${e.amount || ""}" placeholder="0"></label>
      <label class="field"><span class="field__label">지출 종류</span>
        <select id="e-cat">${C.EXPENSE_CATEGORIES.map(c => `<option ${c === e.category ? "selected" : ""}>${c}</option>`).join("")}</select>
      </label>
      <p class="form__sec">언제 나가나요</p>
      <div class="seg" id="e-kind">
        <button class="seg__b ${e.recurring ? "" : "is-on"}" data-v="once" type="button">한 번</button>
        <button class="seg__b ${e.recurring ? "is-on" : ""}" data-v="rec" type="button">정기</button>
      </div>
      <label class="field" id="e-datewrap" ${e.recurring ? "hidden" : ""}>
        <span class="field__label">지출 날짜</span><input id="e-date" type="date" value="${e.date || C.todayISO()}">
      </label>
      <div id="e-recwrap" ${e.recurring ? "" : "hidden"}>
        <label class="field"><span class="field__label">매달 며칠</span>
          <select id="e-day">${Array.from({ length: 31 }, (_, i) => i + 1).map(d => `<option value="${d}" ${d === (e.dayOfMonth || 25) ? "selected" : ""}>${d}일</option>`).join("")}</select>
        </label>
        <p class="hint">해당 월에 그 날짜가 없으면 그 달의 마지막 날에 잡힙니다.</p>
      </div>
      <label class="field"><span class="field__label">메모</span><input id="e-note" value="${esc(e.note)}" placeholder="공장 임대료"></label>
    </div>`,
    foot: `${existing ? `<button class="btn btn--danger btn--icononly" id="e-del" type="button">삭제</button>` : ""}
           <button class="btn" data-close type="button">취소</button>
           <button class="btn btn--plate" id="e-save" type="button">${existing ? "저장" : "지출 추가"}</button>`
  });

  attachMoney($("#e-amt"));
  segment("#e-kind");
  $("#e-kind").addEventListener("seg", ev => {
    const rec = ev.detail === "rec";
    $("#e-recwrap").hidden = !rec;
    $("#e-datewrap").hidden = rec;
  });

  $("#e-save").onclick = async () => {
    const rec = $("#e-kind .is-on").dataset.v === "rec";
    const obj = {
      id: existing?.id,
      amount: money($("#e-amt")),
      category: $("#e-cat").value,
      recurring: rec,
      dayOfMonth: rec ? Number($("#e-day").value) : null,
      date: rec ? (existing?.date || C.todayISO()) : $("#e-date").value,
      note: $("#e-note").value.trim()
    };
    if (!obj.amount) return toast("금액을 넣어 주세요");
    try { await S.saveExpense(obj); closeModal(); toast(existing ? "저장했습니다" : "지출을 등록했습니다"); }
    catch (err) { toast("저장 실패: " + (err.message || err)); }
  };
  if (existing) $("#e-del").onclick = () =>
    confirmDelete(`${existing.category} · ${C.won(existing.amount)}원`, () => S.deleteExpense(existing.id));
}

/* ── 지출 그래프 (세금 포함) ── */
function renderExpenseChart() {
  periodBar("#chart-period");
  const { cases, expenses } = periodData();
  const cats = C.byCategory(expenses);
  const t = C.totals(cases);
  const v = C.vat(t.price, t.cost);
  const it = C.incomeTax(t.price, t.cost, expenses.reduce((s, e) => s + e.amount, 0), state.tax);

  const slices = [
    ...cats.map(c => ({ key: c.key, value: c.amount, color: c.color })),
    { key: "부가세", value: v, color: C.CAT_COLOR["부가세"] },
    { key: "종합소득세", value: it.total, color: C.CAT_COLOR["종합소득세"] }
  ].filter(s => s.value > 0).sort((a, b) => b.value - a.value);

  $("#exp-pie").innerHTML = donut(slices, { centerLabel: "지출+세금" });
  $("#exp-legend").innerHTML = legend(slices);
  mountPie($("#exp-pie"), $("#exp-legend"));
}

/* ═══════════════ 4. 달력 ═══════════════ */
function shiftMonth(n) {
  const d = state.calMonth;
  state.calMonth = new Date(d.getFullYear(), d.getMonth() + n, 1);
  state.calSel = "";
  renderCalendar();
}

function monthOf() {
  const y = state.calMonth.getFullYear(), m = state.calMonth.getMonth();
  return { y, m, ...C.monthLedger(S.store.cases, S.store.expenses, S.store.reservations, y, m) };
}

function renderCalendar() {
  const { y, m, days, last, in: inSum, out: outSum, billed, unpaid, net } = monthOf();
  $("#cal-title").textContent = `${y}년 ${m + 1}월`;

  const today = C.todayISO();
  const startPad = new Date(y, m, 1).getDay();
  const WD = ["일", "월", "화", "수", "목", "금", "토"];

  let html = WD.map((d, i) => `<div class="cal__wd ${i === 0 ? "cal__wd--sun" : ""}">${d}</div>`).join("");
  for (let i = 0; i < startPad; i++) html += `<div class="cal__d cal__d--out"></div>`;

  for (const d of days) {
    const n = Number(d.iso.slice(8));
    const cls = [
      "cal__d",
      d.iso === today ? "cal__d--today" : "",
      d.iso === state.calSel ? "is-sel" : "",
      (d.in || d.out || d.resv.length) ? "cal__d--has" : ""
    ].join(" ");
    html += `<button class="${cls}" type="button" data-iso="${d.iso}">
      <span class="cal__n">${n}</span>
      <span class="cal__amt cal__amt--in">${d.in ? "+" + C.shortWon(d.in) : ""}</span>
      <span class="cal__amt cal__amt--out">${d.out ? "−" + C.shortWon(d.out) : ""}</span>
      ${d.unpaid ? `<span class="cal__due" title="미수 ${C.won(d.unpaid)}원"></span>` : ""}
      ${d.resv.length ? `<span class="cal__resv" title="예약 ${d.resv.length}건"></span>` : ""}
    </button>`;
  }
  const tail = (7 - ((startPad + last) % 7)) % 7;
  for (let i = 0; i < tail; i++) html += `<div class="cal__d cal__d--out"></div>`;
  $("#cal-grid").innerHTML = html;

  $("#cal-month").innerHTML = `<p class="tally__h">${y}년 ${m + 1}월</p>
    ${tallyRow("들어온 돈", C.won(inSum))}
    ${tallyRow("나간 돈", (outSum ? "−" : "") + C.won(outSum), "tally__v--out")}
    ${tallyRow("이 달 청구액", C.won(billed))}
    ${tallyRow("미수금", C.won(unpaid), "tally__v--due")}
    <div class="tally__row tally__row--big">
      <span class="tally__k">차액 (들어온 돈 − 나간 돈)</span>
      <span class="tally__lead"></span>
      <span class="tally__v">${C.won(net)}</span>
    </div>`;

  const recs = S.store.expenses.filter(e => e.recurring).sort((a, b) => (a.dayOfMonth || 0) - (b.dayOfMonth || 0));
  $("#cal-notes").innerHTML = `<div class="card">
    <h3 class="card__h">정기 지출 <span class="card__note">매달 ${C.won(recs.reduce((s, e) => s + e.amount, 0))}원</span></h3>
    ${recs.length
      ? `<div class="rows">${recs.map(e => row(e.category, `매달 ${e.dayOfMonth}일${e.note ? " · " + e.note : ""}`, C.won(e.amount))).join("")}</div>`
      : `<p class="hint">정기 지출이 없습니다. 지출을 넣을 때 "정기"를 고르면 달력에 매달 표시됩니다.</p>`}
  </div>`;

  $("#cal-grid").onclick = e => {
    const b = e.target.closest(".cal__d[data-iso]"); if (!b) return;
    state.calSel = state.calSel === b.dataset.iso ? "" : b.dataset.iso;
    renderCalendar();
  };

  renderDayCard(last);
}

function renderDayCard(lastDay) {
  const host = $("#cal-daywrap");
  if (!state.calSel) {
    host.innerHTML = `<p class="hint" style="text-align:center;padding:6px 0 2px">날짜를 누르면 그날 들어온 돈과 나간 돈을 자세히 볼 수 있습니다.</p>`;
    return;
  }
  const d = C.dayLedger(S.store.cases, S.store.expenses, S.store.reservations, state.calSel, lastDay);

  host.innerHTML = `<div class="daycard">
    <div class="daycard__head">
      <h3 class="daycard__t">${C.fmtDateFull(d.iso)}</h3>
      <span class="daycard__net ${d.net < 0 ? "is-neg" : ""}">${d.net >= 0 ? "+" : "−"}${C.won(Math.abs(d.net))}</span>
    </div>
    <div class="daycard__pair">
      <div class="daycard__half daycard__half--in">
        <span class="daycard__k">들어온 돈</span>
        <span class="daycard__v">${C.won(d.in)}</span>
        <span class="daycard__s">${d.slips.length}건${d.unpaid ? ` · 미수 ${C.won(d.unpaid)}` : ""}</span>
      </div>
      <div class="daycard__half daycard__half--out">
        <span class="daycard__k">나간 돈</span>
        <span class="daycard__v">${C.won(d.out)}</span>
        <span class="daycard__s">${d.exps.length}건</span>
      </div>
    </div>

    ${d.slips.length ? `<p class="form__sec">매출 전표</p>
      <div class="slips" id="day-slips">${d.slips.map(slipCard).join("")}</div>` : ""}

    ${d.exps.length ? `<p class="form__sec">지출</p>
      <div class="exps" id="day-exps">${d.exps.map(expRow).join("")}</div>` : ""}

    ${d.resv.length ? `<p class="form__sec">예약</p>
      <div class="exps" id="day-resv">${d.resv.map(resvRow).join("")}</div>` : ""}

    ${!d.slips.length && !d.exps.length && !d.resv.length ? `<p class="hint" style="margin-top:12px">이 날은 아무것도 없습니다.</p>` : ""}

    <div class="daycard__acts">
      <button class="btn" id="day-add-slip" type="button">전표 추가</button>
      <button class="btn" id="day-add-exp" type="button">지출 추가</button>
      <button class="btn" id="day-add-resv" type="button">예약 추가</button>
    </div>
  </div>`;

  if ($("#day-slips")) $("#day-slips").onclick = e => {
    const b = e.target.closest(".slip"); if (b) caseForm(S.store.cases.find(x => x.id === b.dataset.id));
  };
  if ($("#day-exps")) $("#day-exps").onclick = e => {
    const b = e.target.closest(".exp"); if (b) expenseForm(S.store.expenses.find(x => x.id === b.dataset.id));
  };
  if ($("#day-resv")) $("#day-resv").onclick = e => {
    const b = e.target.closest(".exp"); if (b) reservationForm(S.store.reservations.find(x => x.id === b.dataset.id));
  };
  $("#day-add-slip").onclick = () => caseForm(null, { date: d.iso });
  $("#day-add-exp").onclick = () => expenseForm(null, { date: d.iso });
  $("#day-add-resv").onclick = () => reservationForm(null, { date: d.iso });
}

/* ── 세금 ── */
function renderTax() {
  periodBar("#tax-period");
  const { cases, expenses } = periodData();
  const t = C.totals(cases);
  const expTotal = expenses.reduce((s, e) => s + e.amount, 0);
  const v = C.vat(t.price, t.cost);
  const it = C.incomeTax(t.price, t.cost, expTotal, state.tax);

  const annual = ["this-year", "last-year", "all"].includes(state.period.kind);
  $("#tax-body").innerHTML = `
    ${annual ? "" : `<div class="notice">종합소득세는 1년치를 합쳐서 내는 세금입니다. 기간을 <b>올해</b>로 두고 보세요.
      <button class="ghost" id="t-year" type="button">올해로 보기</button></div>`}
    <div class="stat">
      <h3 class="stat__h">부가가치세</h3>
      <p class="stat__v stat__v--rose">${C.won(v)}<span class="unit">원</span></p>
      <p class="stat__f">(매출 ${C.won(t.price)} − 원가 ${C.won(t.cost)}) × 10%</p>
    </div>

    <div class="stat">
      <h3 class="stat__h">종합소득세 <span class="stat__h-sub">지방소득세 포함</span></h3>
      <p class="stat__v stat__v--rose">${C.won(it.total)}<span class="unit">원</span></p>
      <div class="rows">
        ${row("사업소득금액", it.businessIncome < 0 ? "매출 − 원가 − 지출 · 결손" : "매출 − 원가 − 지출", C.won(it.businessIncome))}
        ${row("소득공제", `기본공제 ${C.won(C.BASIC_DEDUCTION)} × ${state.tax.dependents}명`, (it.deduction ? "−" : "") + C.won(it.deduction))}
        ${row("과세표준", "", C.won(it.base), true)}
        ${row("산출세액", `${(it.rate * 100).toFixed(0)}% − 누진공제 ${C.won(it.progressiveDeduction)}`, C.won(it.gross))}
        ${row("세액공제", "", (it.taxCredit ? "−" : "") + C.won(it.taxCredit))}
        ${row("결정세액 (국세)", "", C.won(it.national))}
        ${row("지방소득세", "결정세액 × 10%", C.won(it.local))}
        ${row("납부할 세금", "", C.won(it.total), true)}
      </div>
      <div class="form__2">
        <label class="field field--mini"><span class="field__label">인적공제 인원</span><input id="t-dep" type="number" min="1" max="10" value="${state.tax.dependents}"></label>
        <label class="field field--mini field--money"><span class="field__label">세액공제</span><input id="t-cred" inputmode="numeric" value="${state.tax.taxCredit || ""}"></label>
      </div>
      <div class="brackets">
        ${C.BRACKETS.map(b => `<div class="brackets__r ${b === it.bracket ? "is-on" : ""}">
          <span>${b.upTo === Infinity ? "10억 초과" : "~ " + C.shortWon(b.upTo)}</span>
          <span style="margin-left:auto">${(b.rate * 100).toFixed(0)}%</span>
          <span style="min-width:78px;text-align:right">누진공제 ${C.shortWon(b.deduct)}</span>
        </div>`).join("")}
      </div>
      <p class="hint">2026년 기준 누진세율표로 계산한 추정치입니다. 실제 신고 때는 노란우산·연금·의료비 등 추가 공제와 기납부세액에 따라 달라집니다.</p>
    </div>`;

  if ($("#t-year")) $("#t-year").onclick = () => { state.period = { kind: "this-year", ...C.rangeOf("this-year") }; renderTax(); };
  $("#t-dep").onchange = e => { state.tax.dependents = Math.max(1, Number(e.target.value) || 1); renderTax(); };
  attachMoney($("#t-cred"));
  $("#t-cred").onchange = e => { state.tax.taxCredit = money(e.target); renderTax(); };
}

const row = (k, sub, v, em = false) =>
  `<div class="rows__r ${em ? "rows__r--em" : ""}"><span class="rows__k">${esc(k)}${sub ? `<span class="rows__sub">${esc(sub)}</span>` : ""}</span>
   <span class="rows__lead"></span><span class="rows__v">${v}</span></div>`;

/** 값이 금액이 아니라 글자일 때 (설정 화면 등) */
const rowText = (k, sub, v) =>
  `<div class="rows__r"><span class="rows__k">${esc(k)}${sub ? `<span class="rows__sub">${esc(sub)}</span>` : ""}</span>
   <span class="rows__lead"></span><span class="rows__v rows__v--text">${esc(v)}</span></div>`;

/* ── 통합 정리 ── */
function renderSummary() {
  periodBar("#sum-period");
  const { cases, expenses } = periodData();
  const s = C.summarize(cases, expenses, state.tax);

  const annualSum = ["this-year", "last-year", "all"].includes(state.period.kind);
  $("#sum-body").innerHTML = `
    ${annualSum ? "" : `<div class="notice">종합소득세가 섞여 있는 표입니다. 1년 기준으로 보려면 <b>올해</b>를 고르세요.</div>`}
    <div class="stat">
      <h3 class="stat__h">남은 돈 <span class="stat__h-sub">매출 − 지출 − 부가세 − 종합소득세</span></h3>
      <p class="stat__v ${s.remaining < 0 ? "stat__v--rose" : "stat__v--plate"}">${C.won(s.remaining)}<span class="unit">원</span></p>
      <p class="stat__f">${periodLabel()} · 전표 ${cases.length}건</p>
    </div>
    <div class="stat">
      <div class="rows">
        ${row("매출", `견적가 합 · 미수 ${C.won(s.unpaid)} 포함`, C.won(s.revenue), true)}
        ${row("원가", "", (s.cost ? "−" : "") + C.won(s.cost))}
        ${row("지출", "정기 지출 포함", (s.expenseTotal ? "−" : "") + C.won(s.expenseTotal))}
        ${row("부가세", "(매출 − 원가) × 10%", (s.vat ? "−" : "") + C.won(s.vat))}
        ${row("순이익", "매출 − 지출 − 부가세", C.won(s.netProfit), true)}
        ${row("종합소득세", "지방소득세 포함", (s.incomeTax.total ? "−" : "") + C.won(s.incomeTax.total))}
        ${row("남은 돈", "", C.won(s.remaining), true)}
      </div>
    </div>
    <div class="stat">
      <h3 class="stat__h">현금 흐름</h3>
      <div class="rows">
        ${row("실제 들어온 돈", "매출 − 미수금", C.won(s.received))}
        ${row("아직 못 받은 돈", "", C.won(s.unpaid))}
      </div>
    </div>`;
}

/* ═══════════════ 4. 매출 분석 ═══════════════ */
function renderRevenue() {
  periodBar("#rev-period");
  const { cases } = periodData();
  const mix = C.byWorkType(cases);
  const slices = mix.map(m => ({ key: m.key, value: m.price, color: m.color }));

  $("#rev-pie").innerHTML = donut(slices, { centerLabel: "매출" });
  $("#rev-legend").innerHTML = legend(slices);
  mountPie($("#rev-pie"), $("#rev-legend"));
  $("#rev-breakdown").innerHTML = `<div class="card" style="margin-top:12px">
    <h3 class="card__h">작업 종류별 상세</h3>
    <div class="rows">
      ${mix.map(m => row(m.key, `${m.count}건 · 원가 ${C.won(m.cost)} · 미수 ${C.won(m.unpaid)}`, C.won(m.price))).join("")}
      ${row("합계", "", C.won(mix.reduce((s, m) => s + m.price, 0)), true)}
    </div>
    <div class="rows" style="margin-top:10px">
      ${mix.map(m => row(`${m.key} 마진`, m.price ? `마진율 ${((m.margin / m.price) * 100).toFixed(1)}%` : "", C.won(m.margin))).join("")}
    </div>
  </div>`;
}

/* ═══════════════ 엑셀 내보내기 ═══════════════ */
const SLIP_WIDTHS = [12, 14, 10, 15, 14, 12, 10, 12, 12, 12, 12, 24];

function slipsSheet(rows, name = "매출전표") {
  const t = C.totals(rows);
  return {
    name,
    widths: SLIP_WIDTHS,
    aoa: [
      SLIP_COLS,
      ...rows.map(c => [c.date, c.company, c.dealer, c.phone, c.carModel, c.plate, (c.items || []).map(i => i.type).join(" + "), c.price, c.payMethod, c.unpaid, c.cost, c.note]),
      [],
      ["합계", `${rows.length}건`, "", "", "", "", "", t.price, "", t.unpaid, t.cost, ""],
      ["실제 들어온 돈", "", "", "", "", "", "", t.received, "", "", "", ""],
      ["마진 (견적가−원가)", "", "", "", "", "", "", t.margin, "", "", "", ""]
    ]
  };
}

async function exportSlips(rows, base = "매출전표") {
  const kind = await exportSheets(base, [slipsSheet(rows)]);
  toast(kind === "xlsx" ? "엑셀 파일을 내려받았습니다" : "CSV 로 내려받았습니다");
}

function clientsSheet() {
  const list = C.clients(S.store.cases);
  return {
    name: "거래처요약",
    widths: [16, 8, 14, 14, 14, 14, 20, 12],
    aoa: [
      ["상사명", "건수", "견적가 합", "미수금 합", "들어온 돈", "원가 합", "딜러", "최근 거래일"],
      ...list.map(c => [c.name, c.count, c.price, c.unpaid, c.received, c.cost, c.dealers.join(", "), c.last])
    ]
  };
}
async function exportClients() {
  const list = C.clients(S.store.cases);
  const sheets = [clientsSheet(), ...list.map(c => slipsSheet(c.rows, c.name.slice(0, 28)))];
  const kind = await exportSheets("거래처", sheets);
  toast(kind === "xlsx" ? `거래처 ${list.length}곳을 시트로 내보냈습니다` : "CSV 로 내려받았습니다");
}

function expensesSheet() {
  const rows = S.store.expenses;
  return {
    name: "지출내역",
    widths: [14, 14, 10, 14, 24],
    aoa: [
      ["지출 종류", "금액", "형식", "날짜", "메모"],
      ...rows.map(e => [e.category, e.amount, e.recurring ? "정기" : "1회", e.recurring ? `매달 ${e.dayOfMonth}일` : e.date, e.note]),
      [],
      ["합계", rows.reduce((s, e) => s + e.amount, 0), "", "", ""]
    ]
  };
}
async function exportExpenses() {
  const kind = await exportSheets("지출", [expensesSheet()]);
  toast(kind === "xlsx" ? "엑셀 파일을 내려받았습니다" : "CSV 로 내려받았습니다");
}

function revenueSheet() {
  const { cases } = periodData();
  const mix = C.byWorkType(cases);
  return {
    name: "작업별집계",
    widths: [12, 8, 14, 14, 14, 14],
    aoa: [
      [`기간 ${periodLabel()}`],
      ["작업내용", "건수", "견적가", "원가", "마진", "미수금"],
      ...mix.map(m => [m.key, m.count, m.price, m.cost, m.margin, m.unpaid]),
      ["합계", cases.length, ...["price", "cost", "margin", "unpaid"].map(k => mix.reduce((s, m) => s + m[k], 0))]
    ]
  };
}
async function exportRevenue() {
  const kind = await exportSheets("매출분석", [revenueSheet(), slipsSheet(periodData().cases)]);
  toast(kind === "xlsx" ? "엑셀 파일을 내려받았습니다" : "CSV 로 내려받았습니다");
}

async function exportMonth() {
  const { y, m, days, in: inSum, out: outSum, billed, unpaid, net } = monthOf();
  const daily = {
    name: `${y}년 ${m + 1}월 일별`,
    widths: [12, 14, 14, 14, 14, 14, 8, 8],
    aoa: [
      ["날짜", "들어온 돈", "나간 돈", "차액", "청구액", "미수금", "전표", "지출"],
      ...days.map(d => [d.iso, d.in, d.out, d.net, d.billed, d.unpaid, d.slips.length, d.exps.length]),
      [],
      ["합계", inSum, outSum, net, billed, unpaid, "", ""]
    ]
  };
  const monthCases = days.flatMap(d => d.slips);
  const monthExps = {
    name: "이 달 지출",
    widths: [12, 14, 14, 10, 24],
    aoa: [
      ["날짜", "지출 종류", "금액", "형식", "메모"],
      ...days.flatMap(d => d.exps.map(e => [d.iso, e.category, e.amount, e.recurring ? "정기" : "1회", e.note])),
      [],
      ["합계", "", outSum, "", ""]
    ]
  };
  const kind = await exportSheets(`${y}년${String(m + 1).padStart(2, "0")}월_달력`, [daily, slipsSheet(monthCases, "이 달 전표"), monthExps]);
  toast(kind === "xlsx" ? "이 달 일별 집계를 내보냈습니다" : "CSV 로 내려받았습니다");
}

async function exportAll() {
  const { cases, expenses } = periodData();
  const s = C.summarize(cases, expenses, state.tax);
  const summary = {
    name: "통합정리",
    widths: [24, 18, 30],
    aoa: [
      ["항목", "금액", "산식"],
      ["기간", periodLabel(), ""],
      ["매출", s.revenue, "견적가 합"],
      ["미수금", s.unpaid, ""],
      ["실제 들어온 돈", s.received, "매출 − 미수금"],
      ["원가", s.cost, ""],
      ["지출", s.expenseTotal, "정기 지출 펼침 포함"],
      ["부가세", s.vat, "(매출 − 원가) × 10%"],
      ["순이익", s.netProfit, "매출 − 지출 − 부가세"],
      ["과세표준", s.incomeTax.base, "매출 − 원가 − 지출 − 소득공제"],
      ["종합소득세(국세)", s.incomeTax.national, `${(s.incomeTax.rate * 100).toFixed(0)}% 구간`],
      ["지방소득세", s.incomeTax.local, "국세 × 10%"],
      ["종합소득세 합계", s.incomeTax.total, ""],
      ["남은 돈", s.remaining, "매출 − 지출 − 부가세 − 종합소득세"]
    ]
  };
  const kind = await exportSheets("전표철_통합", [summary, slipsSheet(cases), expensesSheet(), clientsSheet(), revenueSheet()]);
  toast(kind === "xlsx" ? "5개 시트로 내보냈습니다" : "CSV 로 내려받았습니다");
}

/* ═══════════════ 메뉴 · 연결 설정 ═══════════════ */
function openMenu() {
  const cfg = S.readConfig();
  openModal({
    title: "설정",
    body: `<div class="rows">
        ${rowText("저장 위치", S.store.mode === "cloud" ? "Supabase · 내 계정 전용" : "이 기기 · localStorage", S.store.mode === "cloud" ? "클라우드" : "로컬")}
        ${rowText("계정", "", S.store.user?.email || "로그인 안 함")}
        ${rowText("전표", "", `${S.store.cases.length}건`)}
        ${rowText("지출", "", `${S.store.expenses.length}건`)}
        ${rowText("예약", "", `${S.store.reservations.length}건`)}
      </div>
      <div class="form" style="margin-top:14px">
        <button class="btn btn--block" id="m-config" type="button">Supabase 연결 ${cfg.configured ? "다시 " : ""}설정</button>
        ${S.store.mode === "cloud" || S.store.user
          ? `<button class="btn btn--block" id="m-out" type="button">로그아웃</button>`
          : `<button class="btn btn--block" id="m-cloud" type="button">클라우드로 전환 (로그인)</button>`}
        <button class="btn btn--block btn--danger" id="m-wipe" type="button">이 기기 데이터 지우기</button>
      </div>
      <p class="hint">로컬 모드에서 넣은 자료는 이 기기에만 있습니다. 여러 기기에서 이어 쓰려면 Supabase 로 연결하세요.</p>`,
    foot: `<button class="btn" data-close type="button">닫기</button>`
  });
  $("#m-config").onclick = () => openConfig();
  if ($("#m-out")) $("#m-out").onclick = async () => {
    if (S.store.mode === "cloud") await S.signOut();
    else { S.signOutLocalAccount(); S.pinLocal(false); }
    location.reload();
  };
  if ($("#m-cloud")) $("#m-cloud").onclick = () => { S.pinLocal(false); location.reload(); };
  $("#m-wipe").onclick = () => confirmDelete("이 기기에 저장된 전표와 지출 전부", async () => {
    S.wipeLocalData();
    location.reload();
  });
}

function openConfig() {
  const cfg = S.readConfig();
  openModal({
    title: "Supabase 연결",
    body: `<div class="form">
      <label class="field"><span class="field__label">Project URL</span><input id="s-url" value="${esc(cfg.url)}" placeholder="https://xxxx.supabase.co"></label>
      <label class="field"><span class="field__label">anon public key</span><textarea id="s-key" placeholder="eyJhbGciOi…">${esc(cfg.key)}</textarea></label>
      <p class="hint">Supabase 대시보드 → Project Settings → API 에서 그대로 복사하면 됩니다.
      anon key 는 공개되어도 되는 값입니다. 실제 보호는 <b>supabase/schema.sql</b> 의 RLS 정책이 합니다.
      테이블을 아직 안 만들었다면 그 파일을 SQL Editor 에 붙여넣고 한 번 실행하세요.</p>
    </div>`,
    foot: `<button class="btn" data-close type="button">취소</button>
           <button class="btn btn--plate" id="s-save" type="button">저장하고 다시 시작</button>`
  });
  $("#s-save").onclick = () => {
    const url = $("#s-url").value.trim(), key = $("#s-key").value.trim();
    if (!url || !key) return toast("두 값을 모두 넣어 주세요");
    S.writeConfig(url, key);
    S.pinLocal(false);
    location.reload();
  };
}


/* 모듈 정의가 모두 끝난 뒤 시작 */
boot();
