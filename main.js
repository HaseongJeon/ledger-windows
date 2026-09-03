const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

Menu.setApplicationMenu(null);

const GH_REPO = "HaseongJeon/ledger-windows";
let pendingUpdate = null; // { version, downloadUrl, fileName }

function compareVersions(a, b) {
  // "v" 접두사 제거, "." 로 분리해 세 자리 숫자 비교. 파싱 실패 시 false(새 버전 아님)로
  // 안전하게 처리. a > b 면 true.
  const pa = String(a).replace(/^v/, "").split(".").map((n) => parseInt(n, 10));
  const pb = String(b).replace(/^v/, "").split(".").map((n) => parseInt(n, 10));
  if (pa.some(isNaN) || pb.some(isNaN)) return false;
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

async function fetchLatestRelease() {
  const res = await fetch(`https://api.github.com/repos/${GH_REPO}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "ledger-windows-app" },
  });
  if (!res.ok) throw new Error(`GitHub API 응답 오류 (${res.status})`);
  return res.json();
}

ipcMain.handle("software-update:check", async () => {
  try {
    const data = await fetchLatestRelease();
    const latest = String(data.tag_name || "").replace(/^v/, "");
    const asset = (data.assets || []).find((a) => /Setup.*\.exe$/i.test(a.name));
    if (!asset) return { status: "error", message: "설치 파일을 찾지 못했습니다" };
    if (!compareVersions(latest, app.getVersion())) {
      return { status: "up-to-date", version: app.getVersion() };
    }
    pendingUpdate = { version: latest, downloadUrl: asset.browser_download_url, fileName: asset.name };
    return { status: "update-available", version: latest };
  } catch (err) {
    return { status: "error", message: err.message };
  }
});

ipcMain.handle("software-update:download-and-install", async () => {
  try {
    if (!pendingUpdate) {
      const data = await fetchLatestRelease();
      const latest = String(data.tag_name || "").replace(/^v/, "");
      const asset = (data.assets || []).find((a) => /Setup.*\.exe$/i.test(a.name));
      if (asset && compareVersions(latest, app.getVersion())) {
        pendingUpdate = { version: latest, downloadUrl: asset.browser_download_url, fileName: asset.name };
      }
    }
    if (!pendingUpdate) {
      return { status: "error", message: "업데이트 정보가 없습니다. 다시 확인해 주세요." };
    }
    const res = await fetch(pendingUpdate.downloadUrl);
    if (!res.ok) throw new Error(`다운로드 실패 (${res.status})`);
    const dest = path.join(app.getPath("temp"), pendingUpdate.fileName);
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));

    const openErr = await shell.openPath(dest);
    if (openErr) return { status: "error", message: openErr };

    isQuitting = true;
    setTimeout(() => app.quit(), 800);
    return { status: "launched" };
  } catch (err) {
    return { status: "error", message: err.message };
  }
});

const trayIcon = nativeImage.createFromPath(path.join(__dirname, "build", "tray-icon.png"));

let win;
let tray;
let isQuitting = false;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#E9ECEB",
    autoHideMenuBar: true,
    icon: trayIcon,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  win.loadFile(path.join(__dirname, "app", "index.html"));

  win.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    win.hide();
  });
}

function showWindow() {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
    return;
  }
  win.show();
  win.focus();
}

app.whenReady().then(() => {
  createWindow();

  tray = new Tray(trayIcon);
  tray.setToolTip("전표철");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "전표철 열기", click: showWindow },
      {
        label: "종료",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on("click", showWindow);

  app.on("activate", showWindow);
});
