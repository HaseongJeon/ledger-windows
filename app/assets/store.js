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
  onRemoteInsert: () => {}   // (table, row) => void — 내 다른 기기에서 새로 입력됐을 때(알림용)
};

/* ── 설정 ── */
/* 대시보드에서 REST 엔드포인트(…/rest/v1/)를 그대로 복사해 오는 일이 흔해서,
   프로젝트 주소만 남기고 뒤쪽 경로와 슬래시는 떼어 냅니다. */
function normUrl(u) {
  return (u || "").trim().replace(/\/+$/, "").replace(/\/(rest|auth|realtime|storage)\/v1$/, "");
}

/* 앱에 함께 실려 오는 기본 연결 정보 (config.js) */
function builtinConfig() {
  const base = globalThis.APP_CONFIG || {};
  return { url: normUrl(base.SUPABASE_URL), key: (base.SUPABASE_ANON_KEY || "").trim() };
}

export function readConfig() {
  const builtin = builtinConfig();
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(LS.cfg) || "null"); } catch { /* 무시 */ }

  /* 앱이 새 연결 정보를 들고 오면(키 교체·프로젝트 이전 등) 예전에 손으로 넣어 둔 값은 버립니다.
     안 그러면 옛 값으로 계속 붙어서 "연결 설정을 다시 해야만 최신 장부가 보이는" 상태가 됩니다. */
  if (saved && builtin.url && builtin.key &&
      (saved.builtinUrl !== builtin.url || saved.builtinKey !== builtin.key)) {
    localStorage.removeItem(LS.cfg);
    saved = null;
  }
  const url = normUrl(saved?.url) || builtin.url;
  const key = (saved?.key || "").trim() || builtin.key;
  return { url, key, configured: !!(url && key) };
}
export function writeConfig(url, key) {
  const builtin = builtinConfig();
  /* 저장 시점의 앱 기본값도 같이 적어 둡니다 — 나중에 기본값이 바뀌었는지 알아보려고 */
  localStorage.setItem(LS.cfg, JSON.stringify({
    url: normUrl(url), key: key.trim(), builtinUrl: builtin.url, builtinKey: builtin.key
  }));
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

/* ── 로컬 계정: Supabase Auth 를 거치지 않고 이 기기 안에서만 가입/로그인.
   계정마다 localStorage 키를 따로 써서 서로 다른 계정은 서로 다른 데이터를 봅니다. ── */
const LS_ACCOUNTS = "jpc.accounts";      // [{id, email, salt, hash}]
const LS_ACTIVE    = "jpc.activeAccount"; // 현재 로그인한 로컬 계정 id

function readAccounts() { try { return JSON.parse(localStorage.getItem(LS_ACCOUNTS) || "[]"); } catch { return []; } }
function saveAccounts(list) { localStorage.setItem(LS_ACCOUNTS, JSON.stringify(list)); }

async function hashPassword(password, salt) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + ":" + password));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function activateLocalAccount(id, email) {
  localStorage.setItem(LS_ACTIVE, id);
  store.user = { id, email, local: true };
  store.mode = "local";
}

export async function signUpLocal(email, password) {
  email = (email || "").trim().toLowerCase();
  if (!email || !password) throw new Error("이메일과 비밀번호를 입력하세요.");
  if (password.length < 4) throw new Error("비밀번호는 4자 이상으로 입력하세요.");
  const accounts = readAccounts();
  if (accounts.some(a => a.email === email)) throw new Error("이미 있는 계정입니다. 로그인해 주세요.");
  const id = crypto.randomUUID ? crypto.randomUUID() : "acc" + Date.now() + Math.random().toString(36).slice(2);
  const salt = crypto.randomUUID ? crypto.randomUUID() : String(Math.random());
  accounts.push({ id, email, salt, hash: await hashPassword(password, salt) });
  saveAccounts(accounts);
  activateLocalAccount(id, email);
  return store.user;
}

/* 이메일이 로컬 계정 목록에 없으면 null(=클라우드 로그인을 계속 시도해도 됨),
   있는데 비밀번호가 틀리면 예외를 던짐 */
export async function signInLocal(email, password) {
  email = (email || "").trim().toLowerCase();
  const acc = readAccounts().find(a => a.email === email);
  if (!acc) return null;
  if (await hashPassword(password, acc.salt) !== acc.hash) throw new Error("비밀번호가 맞지 않습니다.");
  activateLocalAccount(acc.id, acc.email);
  return store.user;
}

/* 새로고침 후에도 로컬 계정 로그인 상태를 이어감 */
export function restoreLocalSession() {
  const id = localStorage.getItem(LS_ACTIVE);
  if (!id) { store.user = null; return null; }
  const acc = readAccounts().find(a => a.id === id);
  if (!acc) { localStorage.removeItem(LS_ACTIVE); store.user = null; return null; }
  store.user = { id: acc.id, email: acc.email, local: true };
  return store.user;
}

export function signOutLocalAccount() {
  localStorage.removeItem(LS_ACTIVE);
  store.user = null;
}

/* 계정별로 나뉘는 localStorage 키 (로그인한 로컬 계정이 없으면 공용 키 그대로 사용) */
function scopedKey(base) {
  const id = localStorage.getItem(LS_ACTIVE);
  return id ? `${base}.${id}` : base;
}

/* ── Supabase 클라이언트 ── */
let clientFor = "";
export async function connect() {
  const { url, key, configured } = readConfig();
  if (!configured) throw new Error("Supabase URL / anon key 가 비어 있습니다.");
  if (store.sb && clientFor === url + "|" + key) return store.sb;   // 같은 설정이면 클라이언트를 새로 만들지 않음
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.45.4");
  store.sb = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
  clientFor = url + "|" + key;
  /* 토큰이 새로 발급되면 store.user 도 같이 최신으로 맞춥니다
     (실시간 소켓 토큰은 supabase-js 가 알아서 다시 넣어 줍니다) */
  store.sb.auth.onAuthStateChange((event, session) => {
    if (session) { store.user = session.user; store.mode = "cloud"; }
    else if (event === "SIGNED_OUT") { store.user = null; store.mode = "local"; }
  });
  return store.sb;
}

/* ── 토큰(JWT) 관리 ──
   액세스 토큰은 1시간이면 만료됩니다. 앱을 오래 켜 두거나 휴대폰에서 한참 뒤에
   다시 열면 만료된 토큰으로 조회가 나가서 "JWT expired" 같은 영문 오류가 떴고,
   그때 화면이 옛 자료에 멈춰 있었습니다. 아래에서 만료를 미리·자동으로 처리합니다. */

/* 토큰이 만료됐거나 권한이 없어서 난 오류인지 — 다시 로그인/갱신하면 풀리는 종류 */
export function isAuthError(err) {
  if (!err) return false;
  if (err.sessionExpired) return true;
  const code = String(err.code || "");
  const status = Number(err.status || err.statusCode || 0);
  const m = (err.message || "").toLowerCase();
  return status === 401 || code === "PGRST301" || code === "PGRST302" ||
         m.includes("jwt") || m.includes("refresh token") ||
         m.includes("api key") || m.includes("not authenticated");
}
function sessionExpired() {
  return Object.assign(new Error("로그인이 만료됐습니다. 다시 로그인해 주세요."), { sessionExpired: true });
}
function expiresSoon(session, sec = 60) {
  return !session?.expires_at || session.expires_at * 1000 - Date.now() < sec * 1000;
}

/* 토큰을 새로 받아 옵니다. 실패하면 남아 있는 세션을 지우고 null.
   동시에 여러 번 부르면 refresh token 이 꼬이므로 한 번만 돌게 묶어 둡니다. */
let refreshing = null;
function refreshOrClear() {
  if (!refreshing) refreshing = doRefresh().finally(() => { refreshing = null; });
  return refreshing;
}
async function doRefresh() {
  try {
    const { data, error } = await store.sb.auth.refreshSession();
    if (error || !data?.session) throw error || new Error("no session");
    store.user = data.session.user;
    store.mode = "cloud";
    return data.session;
  } catch {
    try { await store.sb.auth.signOut({ scope: "local" }); } catch { /* 무시 */ }
    store.user = null;
    store.mode = "local";
    return null;
  }
}

/* Supabase 조회/저장 한 번 실행 — 토큰 문제면 새로 받아서 딱 한 번만 다시 시도 */
async function q(build) {
  const once = async () => {
    const { data, error } = await build();
    if (error) throw error;
    return data;
  };
  try { return await once(); }
  catch (err) {
    if (!isAuthError(err)) throw err;
    if (!(await refreshOrClear())) throw sessionExpired();
    return await once();
  }
}

export async function signIn(email, password) {
  if (!store.sb) await connect();
  const { data, error } = await store.sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  store.user = data.user;
  store.mode = "cloud";
  return data.user;
}

/* 회원가입: Supabase Auth 에 계정을 직접 만듭니다(대시보드에서 손으로 추가할 필요 없음).
   계정마다 데이터가 완전히 분리되므로(schema.sql 의 RLS 참고) 새로 가입해도 다른 사람 자료는 못 봅니다.
   "Confirm email" 설정이 꺼져 있으면 가입과 동시에 세션이 생겨 바로 로그인됩니다. */
export async function signUpCloud(email, password) {
  // 이메일이 비어 있으면 Supabase 서버가 "익명 가입" 요청으로 오인해서 이해하기 어려운
  // 영문 에러("Anonymous sign-ins are disabled")를 돌려줌 — 그 전에 여기서 막음
  if (!email || !password) throw new Error("이메일과 비밀번호를 입력하세요.");
  if (!store.sb) await connect();
  const { data, error } = await store.sb.auth.signUp({ email, password });
  if (error) throw error;
  // 이미 가입(인증 완료)된 이메일이면 Supabase 는 에러 없이 identities 를 빈 배열로 돌려줌
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    throw new Error("이미 가입된 이메일입니다. 로그인해 주세요.");
  }
  if (data.session) { store.user = data.user; store.mode = "cloud"; }
  return data;
}
export async function currentSession() {
  if (!store.sb) await connect();
  let session = null;
  try {
    const { data, error } = await store.sb.auth.getSession();
    if (error) throw error;
    session = data?.session || null;
  } catch { session = null; }

  /* 이미 만료됐거나 곧 만료될 토큰으로 첫 조회를 하면 "JWT expired" 가 뜹니다 —
     화면을 열기 전에 미리 새로 받아 둡니다. 받아오지 못하면 세션을 깨끗이 지우고
     로그인 화면으로 보냅니다(반쯤 죽은 세션이 남아 있지 않도록). */
  if (session && expiresSoon(session)) session = await refreshOrClear();

  if (session) { store.user = session.user; store.mode = "cloud"; }
  return session;
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
    const cases = await q(() => store.sb.from("cases").select("*").order("date", { ascending: false }));
    const [e, r] = await Promise.all([
      q(() => store.sb.from("expenses").select("*").order("created_at", { ascending: false })),
      q(() => store.sb.from("reservations").select("*").order("date", { ascending: true }))
    ]);
    store.cases = cases.map(fromRowCase);
    store.expenses = e.map(fromRowExp);
    store.reservations = r.map(fromRowResv);
  } else {
    store.cases = readLS(scopedKey(LS.cases));
    store.expenses = readLS(scopedKey(LS.exps));
    store.reservations = readLS(scopedKey(LS.resv));
    if (!store.cases.length && !store.expenses.length && localStorage.getItem(scopedKey("jpc.seeded")) !== "1") {
      seed();
    }
  }
  sortAll();
  store.onChange();
}

function readLS(k) { try { return JSON.parse(localStorage.getItem(k) || "[]"); } catch { return []; } }
function saveLS() {
  localStorage.setItem(scopedKey(LS.cases), JSON.stringify(store.cases));
  localStorage.setItem(scopedKey(LS.exps), JSON.stringify(store.expenses));
  localStorage.setItem(scopedKey(LS.resv), JSON.stringify(store.reservations));
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
    const data = await q(() => c.id
      ? store.sb.from("cases").update(row).eq("id", c.id).select()
      : store.sb.from("cases").insert(row).select());
    upsert(store.cases, fromRowCase(data[0]));
  } else {
    if (!c.id) c.id = uid();
    upsert(store.cases, { ...c });
    saveLS();
  }
  sortAll(); store.onChange();
}

export async function deleteCase(id) {
  if (store.mode === "cloud") {
    await q(() => store.sb.from("cases").delete().eq("id", id));
  }
  store.cases = store.cases.filter(x => x.id !== id);
  if (store.mode === "local") saveLS();
  store.onChange();
}

export async function saveExpense(e) {
  if (store.mode === "cloud") {
    const row = toRowExp(e);
    const data = await q(() => e.id
      ? store.sb.from("expenses").update(row).eq("id", e.id).select()
      : store.sb.from("expenses").insert(row).select());
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
    await q(() => store.sb.from("expenses").delete().eq("id", id));
  }
  store.expenses = store.expenses.filter(x => x.id !== id);
  if (store.mode === "local") saveLS();
  store.onChange();
}

export async function saveReservation(r) {
  if (store.mode === "cloud") {
    const row = toRowResv(r);
    const data = await q(() => r.id
      ? store.sb.from("reservations").update(row).eq("id", r.id).select()
      : store.sb.from("reservations").insert(row).select());
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
    await q(() => store.sb.from("reservations").delete().eq("id", id));
  }
  store.reservations = store.reservations.filter(x => x.id !== id);
  if (store.mode === "local") saveLS();
  store.onChange();
}

function upsert(arr, item) {
  const i = arr.findIndex(x => x.id === item.id);
  if (i >= 0) arr[i] = item; else arr.unshift(item);
}

/* ── 실시간 동기화: 내 다른 기기에서 입력하면 바로 반영 ── */
let channel = null;
let joinedOnce = false;
export function watch() {
  if (store.mode !== "cloud" || !store.sb) return;
  unwatch();
  const onEvent = table => payload => {
    if (payload.eventType === "INSERT") store.onRemoteInsert(table, payload.new);
    refresh();
  };
  channel = store.sb.channel("jpc-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "cases" }, onEvent("cases"))
    .on("postgres_changes", { event: "*", schema: "public", table: "expenses" }, onEvent("expenses"))
    .on("postgres_changes", { event: "*", schema: "public", table: "reservations" }, onEvent("reservations"))
    .subscribe(status => {
      if (status !== "SUBSCRIBED") return;
      // 끊겼다 다시 붙은 경우에만, 그동안 다른 기기에서 들어온 것들을 한 번 당겨옵니다
      // (처음 붙을 때는 방금 읽어 온 참이라 그대로 둡니다)
      if (joinedOnce) refresh();
      joinedOnce = true;
    });
}

export function unwatch() {
  if (!channel) return;
  try { store.sb?.removeChannel(channel); } catch { /* 무시 */ }
  channel = null;
}

/* 앱을 다시 앞으로 가져왔거나(백그라운드 → 포그라운드) 인터넷이 돌아왔을 때 호출.
   휴대폰에서는 실시간 소켓이 조용히 끊긴 채로 남아, 다른 기기에서 넣은 전표가
   영영 안 들어오는 일이 잦습니다. 그래서 끊겼으면 다시 붙이고 자료도 새로 읽습니다. */
export async function resume() {
  if (store.mode !== "cloud" || !store.sb) return;
  const st = channel?.state;
  if (st !== "joined" && st !== "joining") watch();
  await loadAll();
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
  localStorage.setItem(scopedKey("jpc.seeded"), "1");
  saveLS();
}

/* 현재 로그인한 계정(또는 공용 로컬 모드) 범위의 저장 데이터를 지움 */
export function wipeLocalData() {
  localStorage.removeItem(scopedKey(LS.cases));
  localStorage.removeItem(scopedKey(LS.exps));
  localStorage.removeItem(scopedKey(LS.resv));
  localStorage.removeItem(scopedKey("jpc.seeded"));
}
