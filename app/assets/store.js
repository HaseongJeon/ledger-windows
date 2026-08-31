/* 데이터 계층 — Supabase(클라우드) 또는 localStorage(로컬) 중 하나로 동작 */

const LS = {
  cfg:   "jpc.cfg",
  cases: "jpc.cases",
  exps:  "jpc.expenses",
  resv:  "jpc.reservations",
  local: "jpc.localmode"
};

export const store = {
  mode: "local",          // "local" | "cloud"
  sb: null,               // supabase client
  user: null,
  cases: [],
  expenses: [],
  reservations: [],
  onChange: () => {},
  onRemoteInsert: () => {}   // (table, row) => void — 상대방이 새로 입력했을 때(알림용)
};

/* ── 설정 ── */
/* 대시보드에서 REST 엔드포인트(…/rest/v1/)를 그대로 복사해 오는 일이 흔해서,
   프로젝트 주소만 남기고 뒤쪽 경로와 슬래시는 떼어 냅니다. */
function normUrl(u) {
  return (u || "").trim().replace(/\/+$/, "").replace(/\/(rest|auth|realtime|storage)\/v1$/, "");
}

export function readConfig() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(LS.cfg) || "null"); } catch { /* 무시 */ }
  const base = globalThis.APP_CONFIG || {};
  const url = normUrl(saved?.url || base.SUPABASE_URL);
  const key = (saved?.key || base.SUPABASE_ANON_KEY || "").trim();
  return { url, key, configured: !!(url && key) };
}
export function writeConfig(url, key) {
  localStorage.setItem(LS.cfg, JSON.stringify({ url: normUrl(url), key: key.trim() }));
}
export function clearConfig() { localStorage.removeItem(LS.cfg); }

/* 알림(FCM)용 Firebase 설정 — 비어 있으면 알림 기능만 꺼짐 */
export function readFirebaseConfig() {
  const f = globalThis.APP_CONFIG?.FIREBASE || {};
  const configured = !!(f.apiKey && f.projectId && f.appId && f.messagingSenderId && f.vapidKey);
  return { ...f, configured };
}

/* 기기마다 하나씩, 로그인 계정이 바뀌어도 유지되는 식별자 (푸시 토큰 upsert 키) */
export function deviceId() {
  let id = localStorage.getItem("jpc.deviceId");
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : "dev" + Date.now() + Math.random().toString(36).slice(2);
    localStorage.setItem("jpc.deviceId", id);
  }
  return id;
}

export function isLocalPinned() { return localStorage.getItem(LS.local) === "1"; }
export function pinLocal(v) { v ? localStorage.setItem(LS.local, "1") : localStorage.removeItem(LS.local); }

/* ── Supabase 클라이언트 ── */
export async function connect() {
  const { url, key, configured } = readConfig();
  if (!configured) throw new Error("Supabase URL / anon key 가 비어 있습니다.");
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.45.4");
  store.sb = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
  return store.sb;
}

export async function signIn(email, password) {
  if (!store.sb) await connect();
  const { data, error } = await store.sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  store.user = data.user;
  store.mode = "cloud";
  return data.user;
}
export async function currentSession() {
  if (!store.sb) await connect();
  const { data } = await store.sb.auth.getSession();
  if (data?.session) { store.user = data.session.user; store.mode = "cloud"; }
  return data?.session || null;
}
export async function signOut() {
  if (store.sb && store.user) {
    // 이 기기의 푸시 토큰은 계정이 바뀌면 의미가 없으니 best-effort로 지움
    await store.sb.from("push_tokens").delete().eq("user_id", store.user.id).eq("device_id", deviceId()).then(null, () => {});
  }
  if (store.sb) await store.sb.auth.signOut();
  store.user = null; store.mode = "local";
}

/* ── 불러오기 ── */
export async function loadAll() {
  if (store.mode === "cloud") {
    const [c, e, r] = await Promise.all([
      store.sb.from("cases").select("*").order("date", { ascending: false }),
      store.sb.from("expenses").select("*").order("created_at", { ascending: false }),
      store.sb.from("reservations").select("*").order("date", { ascending: true })
    ]);
    if (c.error) throw c.error;
    if (e.error) throw e.error;
    if (r.error) throw r.error;
    store.cases = c.data.map(fromRowCase);
    store.expenses = e.data.map(fromRowExp);
    store.reservations = r.data.map(fromRowResv);
  } else {
    store.cases = readLS(LS.cases);
    store.expenses = readLS(LS.exps);
    store.reservations = readLS(LS.resv);
    if (!store.cases.length && !store.expenses.length && localStorage.getItem("jpc.seeded") !== "1") {
      seed();
    }
  }
  sortAll();
  store.onChange();
}

function readLS(k) { try { return JSON.parse(localStorage.getItem(k) || "[]"); } catch { return []; } }
function saveLS() {
  localStorage.setItem(LS.cases, JSON.stringify(store.cases));
  localStorage.setItem(LS.exps, JSON.stringify(store.expenses));
  localStorage.setItem(LS.resv, JSON.stringify(store.reservations));
}
function sortAll() {
  store.cases.sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.id > a.id ? 1 : -1));
  store.expenses.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  store.reservations.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
}

/* ── 행 <-> 객체 ── */
const fromRowCase = r => ({
  id: r.id, date: r.date, company: r.company, dealer: r.dealer, phone: r.phone,
  carModel: r.car_model, plate: r.plate, items: r.items || [],
  price: Number(r.price) || 0, payMethod: r.pay_method,
  unpaid: Number(r.unpaid) || 0, cost: Number(r.cost) || 0, note: r.note || ""
});
const toRowCase = c => ({
  date: c.date, company: c.company, dealer: c.dealer, phone: c.phone,
  car_model: c.carModel, plate: c.plate, items: c.items,
  price: c.price, pay_method: c.payMethod, unpaid: c.unpaid, cost: c.cost, note: c.note
});
const fromRowExp = r => ({
  id: r.id, amount: Number(r.amount) || 0, category: r.category,
  recurring: !!r.recurring, dayOfMonth: r.day_of_month, date: r.date, note: r.note || ""
});
const toRowExp = e => ({
  amount: e.amount, category: e.category, recurring: e.recurring,
  day_of_month: e.recurring ? e.dayOfMonth : null,
  date: e.date, note: e.note
});
const fromRowResv = r => ({
  id: r.id, date: r.date, company: r.company, dealer: r.dealer, phone: r.phone,
  carModel: r.car_model, plate: r.plate, types: r.types || [], note: r.note || ""
});
const toRowResv = r => ({
  date: r.date, company: r.company, dealer: r.dealer, phone: r.phone,
  car_model: r.carModel, plate: r.plate, types: r.types, note: r.note
});

/* ── 쓰기 ── */
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "id" + Date.now() + Math.random().toString(36).slice(2));

export async function saveCase(c) {
  if (store.mode === "cloud") {
    const row = toRowCase(c);
    const q = c.id ? store.sb.from("cases").update(row).eq("id", c.id).select()
                   : store.sb.from("cases").insert(row).select();
    const { data, error } = await q;
    if (error) throw error;
    const saved = fromRowCase(data[0]);
    upsert(store.cases, saved);
  } else {
    if (!c.id) c.id = uid();
    upsert(store.cases, { ...c });
    saveLS();
  }
  sortAll(); store.onChange();
}

export async function deleteCase(id) {
  if (store.mode === "cloud") {
    const { error } = await store.sb.from("cases").delete().eq("id", id);
    if (error) throw error;
  }
  store.cases = store.cases.filter(x => x.id !== id);
  if (store.mode === "local") saveLS();
  store.onChange();
}

export async function saveExpense(e) {
  if (store.mode === "cloud") {
    const row = toRowExp(e);
    const q = e.id ? store.sb.from("expenses").update(row).eq("id", e.id).select()
                   : store.sb.from("expenses").insert(row).select();
    const { data, error } = await q;
    if (error) throw error;
    upsert(store.expenses, fromRowExp(data[0]));
  } else {
    if (!e.id) e.id = uid();
    upsert(store.expenses, { ...e });
    saveLS();
  }
  sortAll(); store.onChange();
}

export async function deleteExpense(id) {
  if (store.mode === "cloud") {
    const { error } = await store.sb.from("expenses").delete().eq("id", id);
    if (error) throw error;
  }
  store.expenses = store.expenses.filter(x => x.id !== id);
  if (store.mode === "local") saveLS();
  store.onChange();
}

export async function saveReservation(r) {
  if (store.mode === "cloud") {
    const row = toRowResv(r);
    const q = r.id ? store.sb.from("reservations").update(row).eq("id", r.id).select()
                   : store.sb.from("reservations").insert(row).select();
    const { data, error } = await q;
    if (error) throw error;
    upsert(store.reservations, fromRowResv(data[0]));
  } else {
    if (!r.id) r.id = uid();
    upsert(store.reservations, { ...r });
    saveLS();
  }
  sortAll(); store.onChange();
}

export async function deleteReservation(id) {
  if (store.mode === "cloud") {
    const { error } = await store.sb.from("reservations").delete().eq("id", id);
    if (error) throw error;
  }
  store.reservations = store.reservations.filter(x => x.id !== id);
  if (store.mode === "local") saveLS();
  store.onChange();
}

function upsert(arr, item) {
  const i = arr.findIndex(x => x.id === item.id);
  if (i >= 0) arr[i] = item; else arr.unshift(item);
}

/* ── 실시간 동기화: 상대방이 입력하면 바로 반영 ── */
export function watch() {
  if (store.mode !== "cloud" || !store.sb) return;
  const onEvent = table => payload => {
    if (payload.eventType === "INSERT") store.onRemoteInsert(table, payload.new);
    refresh();
  };
  store.sb.channel("jpc-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "cases" }, onEvent("cases"))
    .on("postgres_changes", { event: "*", schema: "public", table: "expenses" }, onEvent("expenses"))
    .on("postgres_changes", { event: "*", schema: "public", table: "reservations" }, onEvent("reservations"))
    .subscribe();
}
let pending = null;
function refresh() {
  clearTimeout(pending);
  pending = setTimeout(() => loadAll().catch(() => {}), 400);
}

/* ── 처음 켰을 때 보여줄 예시 전표 (로컬 모드 전용) ── */
function seed() {
  const today = new Date();
  const d = n => {
    const x = new Date(today); x.setDate(x.getDate() - n);
    return x.toLocaleDateString("sv-SE");
  };
  store.cases = [
    { id: uid(), date: d(1),  company: "대성모터스", dealer: "김성호", phone: "010-2231-8842", carModel: "그랜저 IG",   plate: "12가 3456", items: [{ type: "선팅", price: 450000, cost: 180000 }], price: 450000,  payMethod: "카드",       unpaid: 0,      cost: 180000, note: "전면 15% 측후면 5%" },
    { id: uid(), date: d(2),  company: "대성모터스", dealer: "김성호", phone: "010-2231-8842", carModel: "카니발 KA4",  plate: "31버 7719", items: [{ type: "전장", price: 780000, cost: 310000 }], price: 780000,  payMethod: "세금계산서", unpaid: 380000, cost: 310000, note: "블박+하이패스" },
    { id: uid(), date: d(4),  company: "한빛오토",   dealer: "박지훈", phone: "010-4410-2093", carModel: "쏘렌토 MQ4",  plate: "88도 1204", items: [{ type: "덴트", price: 320000, cost: 90000 }],  price: 320000,  payMethod: "현금",       unpaid: 0,      cost: 90000,  note: "" },
    { id: uid(), date: d(6),  company: "한빛오토",   dealer: "이가람", phone: "010-7788-1120", carModel: "아이오닉 5",  plate: "204허 5561", items: [{ type: "선팅", price: 620000, cost: 240000 }], price: 620000,  payMethod: "카드",       unpaid: 0,      cost: 240000, note: "열차단 프리미엄" },
    { id: uid(), date: d(9),  company: "정우상사",   dealer: "최민석", phone: "010-3320-7745", carModel: "G80",         plate: "77무 9083", items: [{ type: "전장", price: 1000000, cost: 400000 }, { type: "선팅", price: 150000, cost: 70000 }], price: 1150000, payMethod: "세금계산서", unpaid: 0,      cost: 470000, note: "순정 매립 + 선팅" },
    { id: uid(), date: d(12), company: "정우상사",   dealer: "최민석", phone: "010-3320-7745", carModel: "투싼 NX4",    plate: "45조 3312", items: [{ type: "덴트", price: 280000, cost: 60000 }],  price: 280000,  payMethod: "현금",       unpaid: 80000,  cost: 60000,  note: "뒷휀더 2군데" },
    { id: uid(), date: d(15), company: "삼일카서비스", dealer: "정유진", phone: "010-9902-4417", carModel: "레이 EV",    plate: "19바 2274", items: [{ type: "선팅", price: 380000, cost: 150000 }], price: 380000,  payMethod: "카드",       unpaid: 0,      cost: 150000, note: "" },
    { id: uid(), date: d(20), company: "대성모터스", dealer: "김성호", phone: "010-2231-8842", carModel: "스타리아",    plate: "63우 8890", items: [{ type: "전장", price: 940000, cost: 380000 }], price: 940000,  payMethod: "세금계산서", unpaid: 0,      cost: 380000, note: "" }
  ];
  const day = n => new Date(today.getFullYear(), today.getMonth(), n).toLocaleDateString("sv-SE");
  store.expenses = [
    { id: uid(), amount: 2800000, category: "급여",       recurring: true,  dayOfMonth: 10, date: day(10), note: "직원 1명" },
    { id: uid(), amount: 1200000, category: "지급임차료", recurring: true,  dayOfMonth: 25, date: day(25), note: "공장 임대료" },
    { id: uid(), amount: 88000,   category: "통신비",     recurring: true,  dayOfMonth: 17, date: day(17), note: "" },
    { id: uid(), amount: 240000,  category: "관리비",     recurring: true,  dayOfMonth: 5,  date: day(5),  note: "" },
    { id: uid(), amount: 610000,  category: "외주비",     recurring: false, dayOfMonth: null, date: d(7),  note: "덴트 외주" },
    { id: uid(), amount: 152000,  category: "소모품비",   recurring: false, dayOfMonth: null, date: d(11), note: "필름 자재" },
    { id: uid(), amount: 96000,   category: "차량유지비", recurring: false, dayOfMonth: null, date: d(3),  note: "주유" },
    { id: uid(), amount: 143000,  category: "접대비",     recurring: false, dayOfMonth: null, date: d(14), note: "거래처 미팅" }
  ];
  const future = n => { const x = new Date(today); x.setDate(x.getDate() + n); return x.toLocaleDateString("sv-SE"); };
  store.reservations = [
    { id: uid(), date: future(3), company: "한빛오토", dealer: "박지훈", phone: "010-4410-2093", carModel: "스포티지 NQ5", plate: "", types: ["선팅"], note: "다음 주 입고 예정" },
    { id: uid(), date: future(9), company: "정우상사", dealer: "최민석", phone: "010-3320-7745", carModel: "", plate: "", types: ["전장", "덴트"], note: "" }
  ];
  localStorage.setItem("jpc.seeded", "1");
  saveLS();
}
