# 전표철 (Windows)

[전표철](https://github.com/HaseongJeon/ledger) 을 Electron 으로 감싼 Windows 데스크톱 앱입니다.
빌드 도구 없이 만든 순수 HTML/JS 앱을 그대로 창 안에 띄웁니다 — 화면·데이터·Supabase 연동은
`ledger` 저장소와 완전히 동일합니다.

---

## 구조

```
main.js              Electron 메인 프로세스 — app/index.html 을 창으로 띄움
app/                 전표철 웹 앱 (../ledger 에서 복사해 옴, 커밋됨)
scripts/sync-app.mjs ../ledger 의 최신 파일을 app/ 으로 다시 복사
.github/workflows/windows.yml   GitHub Actions 가 실제 Windows 환경에서 .exe 빌드
```

`ledger` 본체를 고치면 이 저장소에는 자동으로 반영되지 않습니다. 아래처럼 동기화하세요.

```bash
npm run sync     # ../ledger 에서 최신 파일을 app/ 으로 복사
git add app && git commit -m "sync: 전표철 최신 반영"
```

`ledger-windows` 와 `ledger` 폴더가 같은 상위 폴더 아래(형제 폴더)에 있어야 `sync` 가 동작합니다.

---

## .exe 만들기 — GitHub Actions (권장)

macOS 에는 Windows 실행 파일에 아이콘을 심는 `rcedit` 가 Wine 없이 동작하지 않아서,
**실제 Windows 환경에서 빌드하는 GitHub Actions** 를 씁니다. 안드로이드 APK 를
GitHub 가 대신 빌드해 주는 것과 같은 방식입니다.

1. 이 폴더를 GitHub 저장소로 올립니다.

   ```bash
   git remote add origin https://github.com/<사용자명>/<저장소명>.git
   git push -u origin main
   ```

2. **Actions** 탭 → `Windows exe` 워크플로가 자동 실행됩니다 (몇 분 소요).
3. 실행이 끝나면 **Artifacts** 에서 `jeonpyo-cheol-windows-*.zip` 을 내려받아 풀면
   `.exe` 두 개가 들어 있습니다.
   * `전표철-Setup-*.exe` — 설치형 (시작 메뉴에 등록)
   * `전표철-Portable-*.exe` — 설치 없이 바로 실행

### 정식 배포판 내기

```bash
npm version patch -m "전표철(Windows) %s"
git push && git push --tags
```

태그를 밀면 워크플로가 `.exe` 를 빌드해 **Releases** 에 첨부합니다.

### 실행 시 경고

서명이 없는 실행 파일이라 Windows 가 **"Windows의 PC 보호"** 경고를 띄웁니다.
**추가 정보 → 실행** 을 누르면 됩니다. 안드로이드의 "출처를 알 수 없는 앱 설치" 경고와 같은 것입니다.

---

## 맥에서 직접 빌드하려면 (선택)

로컬에서 바로 `.exe` 를 만들려면 아이콘 삽입에 필요한 [Wine](https://formulae.brew.sh/formula/wine-stable) 이 있어야 합니다.

```bash
brew install --cask wine-stable   # 아이콘 삽입용, 용량 큼
npm install
npm run dist                      # dist/ 에 .exe 생성
```

Wine 을 쓰기 싫다면 `package.json` 의 `build.win.target` 에서 아이콘을 빼거나
GitHub Actions 를 쓰는 쪽(위 방법)을 권합니다.

---

## 개발 중 미리보기 (Windows 아님, 창만 확인)

```bash
npm install
npm run sync
npm start
```

macOS/Linux 에서도 창은 뜨지만, 배포용 `.exe` 는 위 GitHub Actions 방식으로 만들어야 합니다.
