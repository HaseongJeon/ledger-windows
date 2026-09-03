/* 집계 · 세금 계산 · 색 · 포맷 */

export const WORK_TYPES = ["전장", "선팅", "덴트"];
export const PAY_METHODS = ["카드", "현금", "세금계산서"];
export const EXPENSE_CATEGORIES = [
  "급여", "외주비", "복리후생비", "통신비", "관리비", "접대비", "지급임차료",
  "수선비", "보험료", "차량유지비", "소모품비", "지급수수료", "잡비", "잡손실"
];

export const WORK_COLOR = { "전장": "#FF7D00", "선팅": "#15616D", "덴트": "#78290F" };
export const CAT_COLOR = {
  "급여": "#FF7D00", "외주비": "#15616D", "복리후생비": "#78290F", "통신비": "#FFECD1",
  "관리비": "#E85D04", "접대비": "#4C93A0", "지급임차료": "#9C4A24", "수선비": "#F2C79A",
  "보험료": "#FFA333", "차량유지비": "#0E4148", "소모품비": "#5A1D0A", "지급수수료": "#001524",
  "잡비": "#C96A1E", "잡손실": "#2E7D8C",
  "부가세": "#3A4750", "종합소득세": "#23292E"
};

/* ── 포맷 ── */
export const won = n => (Math.round(n || 0)).toLocaleString("ko-KR");
export const wonUnit = n => won(n) + "원";
export const pct = (n, d) => d ? ((n / d) * 100).toFixed(1) + "%" : "0%";
export function shortWon(n) {
  const v = Math.round(n || 0);
  if (Math.abs(v) >= 100000000) return (v / 100000000).toFixed(2).replace(/\.?0+$/, "") + "억";
  if (Math.abs(v) >= 10000) return (v / 10000).toFixed(0) + "만";
  return won(v);
}
export const todayISO = () => new Date().toLocaleDateString("sv-SE");
export function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${m}.${d}`;
}
export function fmtDateFull(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${y}.${m}.${d}`;
}

/* ── 기간 ── */
export function rangeOf(kind, base = new Date()) {
  const y = base.getFullYear(), m = base.getMonth();
  const iso = dt => dt.toLocaleDateString("sv-SE");
  switch (kind) {
    case "this-month": return { from: iso(new Date(y, m, 1)),     to: iso(new Date(y, m + 1, 0)) };
    case "last-month": return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case "this-year":  return { from: `${y}-01-01`,               to: `${y}-12-31` };
    case "last-year":  return { from: `${y - 1}-01-01`,           to: `${y - 1}-12-31` };
    default:           return { from: "", to: "" };
  }
}

/* ── 전표 필터 ── */
const norm = v => (v || "").toLowerCase().replace(/\s|-/g, "");

export function filterCases(cases, f) {
  const company = norm(f.company), dealer = norm(f.dealer), plate = norm(f.plate);
  return cases.filter(c => {
    if (f.from && c.date < f.from) return false;
    if (f.to && c.date > f.to) return false;
    if (f.types?.length && !f.types.some(t => (c.items || []).some(i => i.type === t))) return false;
    if (f.unpaidOnly && !(c.unpaid > 0)) return false;
    if (company && !norm(c.company).includes(company)) return false;
    if (dealer && !norm(c.dealer).includes(dealer)) return false;
    if (plate && !norm(c.plate).includes(plate)) return false;
    return true;
  });
}

/** 검색 조건이 하나라도 걸려 있나 */
export function hasQuery(f) {
  return !!(f.company || f.dealer || f.plate || f.types?.length || f.unpaidOnly);
}

export function filterExpenses(expenses, f) {
  return expenses.filter(e => {
    if (f.from && e.date < f.from) return false;
    if (f.to && e.date > f.to) return false;
    return true;
  });
}

/* ── 총계 ── */
export function totals(cases) {
  const t = { count: cases.length, price: 0, unpaid: 0, received: 0, cost: 0, margin: 0 };
  for (const c of cases) { t.price += c.price || 0; t.unpaid += c.unpaid || 0; t.cost += c.cost || 0; }
  t.received = t.price - t.unpaid;
  t.margin = t.price - t.cost;
  return t;
}

export function groupBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r) || "미지정";
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

export function byWorkType(cases) {
  return WORK_TYPES.map(t => {
    const rows = [];
    let price = 0, cost = 0, unpaid = 0;
    for (const c of cases) {
      const item = (c.items || []).find(i => i.type === t);
      if (!item) continue;
      rows.push(c);
      const ip = item.price || 0, ic = item.cost || 0;
      price += ip; cost += ic;
      // 미수금은 항목별로 나뉘어 있지 않으니, 이 항목 금액이 전표 견적가에서 차지하는 비율만큼 비례 배분
      const share = c.price > 0 ? ip / c.price : 0;
      unpaid += (c.unpaid || 0) * share;
    }
    const received = price - unpaid;
    const margin = price - cost;
    return { key: t, color: WORK_COLOR[t], rows, count: rows.length, price, unpaid, received, cost, margin };
  });
}

export function byCategory(expenses) {
  const m = groupBy(expenses, e => e.category);
  return [...m.entries()]
    .map(([key, rows]) => ({ key, color: CAT_COLOR[key] || "#8895A0", rows, amount: rows.reduce((s, e) => s + e.amount, 0) }))
    .sort((a, b) => b.amount - a.amount);
}

export function clients(cases) {
  const m = groupBy(cases, c => c.company);
  return [...m.entries()].map(([name, rows]) => {
    const t = totals(rows);
    const dealers = [...new Set(rows.map(r => r.dealer).filter(Boolean))];
    const last = rows.reduce((a, b) => (a && a.date > b.date ? a : b), null);
    return { name, rows, dealers, last: last?.date || "", phone: last?.phone || "", ...t, mix: byWorkType(rows) };
  }).sort((a, b) => b.price - a.price);
}

/* ── 정기 지출을 기간 안에서 실제 발생 건으로 펼치기 ── */
export function expandRecurring(expenses, from, to) {
  if (!from || !to) return expenses.map(e => ({ ...e, occurredOn: e.date }));
  const out = [];
  const start = new Date(from + "T00:00:00"), end = new Date(to + "T00:00:00");
  for (const e of expenses) {
    if (!e.recurring) {
      if (e.date >= from && e.date <= to) out.push({ ...e, occurredOn: e.date });
      continue;
    }
    const anchor = e.date || from;
    const cur = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cur <= end) {
      const last = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate();
      const day = Math.min(e.dayOfMonth || 1, last);
      const iso = new Date(cur.getFullYear(), cur.getMonth(), day).toLocaleDateString("sv-SE");
      if (iso >= from && iso <= to && iso >= anchor.slice(0, 10)) out.push({ ...e, occurredOn: iso });
      cur.setMonth(cur.getMonth() + 1);
    }
  }
  return out.sort((a, b) => b.occurredOn.localeCompare(a.occurredOn));
}

/* ══════════════════════════════════════════════════════
   세금
   부가세  = (매출액 − 원가) × 10%      ← 요청하신 산식 그대로
   종합소득세 = 누진세율표 (2026 기준) + 지방소득세 10%
   ══════════════════════════════════════════════════════ */

export const VAT_RATE = 0.1;
export function vat(revenue, cost) { return Math.max(0, (revenue - cost) * VAT_RATE); }

export const BRACKETS = [
  { upTo: 14_000_000,    rate: 0.06, deduct: 0 },
  { upTo: 50_000_000,    rate: 0.15, deduct: 1_260_000 },
  { upTo: 88_000_000,    rate: 0.24, deduct: 5_760_000 },
  { upTo: 150_000_000,   rate: 0.35, deduct: 15_440_000 },
  { upTo: 300_000_000,   rate: 0.38, deduct: 19_940_000 },
  { upTo: 500_000_000,   rate: 0.40, deduct: 25_940_000 },
  { upTo: 1_000_000_000, rate: 0.42, deduct: 35_940_000 },
  { upTo: Infinity,      rate: 0.45, deduct: 65_940_000 }
];

export const BASIC_DEDUCTION = 1_500_000;   // 인당 기본공제

/**
 * 종합소득세
 * @param {number} revenue    매출액 (견적가 합)
 * @param {number} cost       원가 합
 * @param {number} expenses   지출(경비) 합
 * @param {object} opts       { dependents: 부양가족 포함 인원, taxCredit: 세액공제 }
 */
export function incomeTax(revenue, cost, expenses, opts = {}) {
  const dependents = Math.max(1, opts.dependents ?? 1);
  const taxCredit = opts.taxCredit ?? 0;

  const businessIncome = revenue - cost - expenses;          // 사업소득금액
  const deduction = BASIC_DEDUCTION * dependents;            // 소득공제
  const base = Math.max(0, businessIncome - deduction);      // 과세표준

  const b = BRACKETS.find(x => base <= x.upTo);
  const gross = Math.max(0, base * b.rate - b.deduct);       // 산출세액
  const national = Math.max(0, gross - taxCredit);           // 결정세액
  const local = national * 0.1;                              // 지방소득세

  return {
    businessIncome, deduction, base,
    bracket: b, rate: b.rate, progressiveDeduction: b.deduct,
    gross, taxCredit, national, local, total: national + local
  };
}

/** 매출·지출·세금을 한 장으로 */
export function summarize(cases, expenses, opts = {}) {
  const t = totals(cases);
  const expenseTotal = expenses.reduce((s, e) => s + e.amount, 0);
  const v = vat(t.price, t.cost);
  const netProfit = t.price - expenseTotal - v;
  const it = incomeTax(t.price, t.cost, expenseTotal, opts);
  return {
    revenue: t.price, unpaid: t.unpaid, received: t.received, cost: t.cost,
    expenseTotal, vat: v, netProfit,
    incomeTax: it, remaining: t.price - expenseTotal - v - it.total
  };
}

/* ══════════════════════════════════════════════════════
   달력용 — 하루에 들어온 돈 / 나간 돈
   들어온 돈 = 그날 전표의 (견적가 − 미수금)
   나간 돈   = 그날 지출 (정기 지출은 그 달 해당일에 잡힘)
   ══════════════════════════════════════════════════════ */
export function dayLedger(cases, expenses, reservations, iso, lastDayOfMonth) {
  const slips = cases.filter(c => c.date === iso);
  const day = Number(iso.slice(8));
  const exps = expenses.filter(e => e.recurring
    // 정기 지출은 등록한 달부터 잡습니다 — 그 전 달 달력에 소급되지 않게
    ? Math.min(e.dayOfMonth || 1, lastDayOfMonth) === day && (!e.date || iso >= e.date)
    : e.date === iso);
  const resv = reservations.filter(r => r.date === iso);
  const inAmt = slips.reduce((s, c) => s + (c.price - c.unpaid), 0);
  const outAmt = exps.reduce((s, e) => s + e.amount, 0);
  const billed = slips.reduce((s, c) => s + c.price, 0);
  const unpaid = slips.reduce((s, c) => s + c.unpaid, 0);
  return { iso, slips, exps, resv, in: inAmt, out: outAmt, billed, unpaid, net: inAmt - outAmt };
}

/** 한 달 전체를 하루씩 */
export function monthLedger(cases, expenses, reservations, year, month) {
  const last = new Date(year, month + 1, 0).getDate();
  const days = [];
  for (let d = 1; d <= last; d++) {
    const iso = new Date(year, month, d).toLocaleDateString("sv-SE");
    days.push(dayLedger(cases, expenses, reservations, iso, last));
  }
  const sum = days.reduce((a, d) => ({
    in: a.in + d.in, out: a.out + d.out, billed: a.billed + d.billed, unpaid: a.unpaid + d.unpaid
  }), { in: 0, out: 0, billed: 0, unpaid: 0 });
  return { days, last, ...sum, net: sum.in - sum.out };
}
