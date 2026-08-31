/* ────────────────────────────────────────────────────────────
   Supabase 연결 정보. 여기에 값을 넣고 GitHub에 올리면 두 사람이
   같은 데이터를 씁니다. anon key 는 공개되어도 되는 키입니다
   (실제 보호는 Postgres RLS 정책이 합니다 — supabase/schema.sql 참고).

   값을 비워두면 앱은 "로컬 모드"로 뜹니다. 이 기기에만 저장되고
   로그인 없이 바로 써볼 수 있습니다.
   앱 안 "Supabase 연결 설정"에서 넣은 값이 이 파일보다 우선합니다.

   FIREBASE 는 "다른 기기가 꺼져 있어도 알림 보내기" 기능에만 씁니다.
   Firebase 콘솔(console.firebase.google.com) → 프로젝트 설정 → 일반 탭에서
   웹 앱을 하나 등록하면 아래 값들이 나오고, Cloud Messaging 탭에서
   "웹 푸시 인증서"를 만들면 VAPID_KEY 가 나옵니다.
   비워두면 알림 기능만 꺼지고 나머지는 그대로 동작합니다.
   ──────────────────────────────────────────────────────────── */
globalThis.APP_CONFIG = {
  SUPABASE_URL: "https://dotsiylmhwfoadvixnoi.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRvdHNpeWxtaHdmb2Fkdml4bm9pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5ODc3NjUsImV4cCI6MjEwMzU2Mzc2NX0.88N1sUPPtSTHylJC0CtZWuF-lqBDlA2cTXuzVGAomGE",
  FIREBASE: {
    apiKey: "",
    authDomain: "",
    projectId: "",
    messagingSenderId: "",
    appId: "",
    vapidKey: ""
  }
};
