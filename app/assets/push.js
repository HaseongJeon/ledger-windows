/* 크로스 기기 알림 — 같은 계정으로 입력하면 그 계정의 다른 기기에 알림.
   플랫폼별로 방식이 다릅니다 (앱이 완전히 꺼져 있어도 오는지는 README 참고):
     - Android(Capacitor 네이티브 앱): FCM 진짜 푸시
     - 일반 브라우저(데스크톱 PWA):     FCM 기반 Web Push
     - Electron(Windows 데스크톱 앱):  진짜 푸시 대신, 앱이 떠 있는 동안
       Supabase Realtime으로 감지해서 OS 알림을 띄움 (완전 종료 시엔 생략) */
import { store, readFirebaseConfig, deviceId } from "./store.js";

const isCapacitorNative = () => !!globalThis.Capacitor?.isNativePlatform?.();
const isElectron = () => /Electron/i.test(navigator.userAgent || "");

function titleAndBody(table, row) {
  if (table === "cases") {
    return { title: "새 매출 전표", body: `${row.company ?? ""} · ${(Number(row.price) || 0).toLocaleString("ko-KR")}원` };
  }
  return { title: "새 지출", body: `${row.category ?? ""} · ${(Number(row.amount) || 0).toLocaleString("ko-KR")}원` };
}

async function upsertToken(platform, token) {
  if (!store.sb || !store.user || !token) return;
  await store.sb.from("push_tokens").upsert({
    user_id: store.user.id,
    device_id: deviceId(),
    platform,
    fcm_token: token,
    updated_at: new Date().toISOString()
  });
}

async function initAndroid() {
  // google-services.json 없이 빌드된 APK(기본값)는 네이티브 Firebase가 아예
  // 초기화되지 않아, PushNotifications.register()가 FirebaseMessaging.getInstance()를
  // 호출하는 순간 네이티브 예외가 나고 Capacitor가 이를 앱 전체를 죽이는 방식으로
  // 다시 던진다(js try/catch로 못 막음). config.js 의 FIREBASE 값이 비어 있으면
  // "알림 기능만 꺼짐"이라는 계약대로 아예 시도하지 않는다.
  if (!readFirebaseConfig().configured) return;
  // 번들러 없이 쓰는 앱이라 npm import 대신, Capacitor가 WebView에 심어주는
  // 전역 객체로 네이티브 플러그인을 그대로 불러씀 (Capacitor의 공식 no-bundler 사용법).
  const PushNotifications = globalThis.Capacitor?.Plugins?.PushNotifications;
  if (!PushNotifications) return;
  const perm = await PushNotifications.requestPermissions();
  if (perm.receive !== "granted") return;
  PushNotifications.addListener("registration", t => upsertToken("android", t.value));
  await PushNotifications.register();
}

async function initWeb() {
  const fb = readFirebaseConfig();
  if (!fb.configured) return; // config.js 에 FIREBASE 값이 없으면 조용히 스킵
  if (!("serviceWorker" in navigator) || !("Notification" in globalThis)) return;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return;

  const { initializeApp } = await import("https://esm.sh/firebase@10.13.0/app");
  const { getMessaging, getToken } = await import("https://esm.sh/firebase@10.13.0/messaging");

  const app = initializeApp({
    apiKey: fb.apiKey, authDomain: fb.authDomain, projectId: fb.projectId,
    messagingSenderId: fb.messagingSenderId, appId: fb.appId
  });
  const swReg = await navigator.serviceWorker.register("./firebase-messaging-sw.js");
  const messaging = getMessaging(app);
  const token = await getToken(messaging, { vapidKey: fb.vapidKey, serviceWorkerRegistration: swReg });
  await upsertToken("web", token);
}

function initElectron() {
  if (!("Notification" in globalThis)) return;
  Notification.requestPermission().catch(() => {});
  store.onRemoteInsert = (table, row) => {
    if (row.created_by === store.user?.id) return; // 내가 방금 넣은 건 알림 안 함
    const { title, body } = titleAndBody(table, row);
    try { new Notification(title, { body }); } catch { /* 무시 */ }
  };
}

export async function initPush() {
  if (store.mode !== "cloud") return;
  try {
    if (isCapacitorNative()) await initAndroid();
    else if (isElectron()) initElectron();
    else await initWeb();
  } catch (err) {
    console.warn("push init failed:", err); // 알림은 부가 기능 — 실패해도 앱은 계속 써야 함
  }
}
