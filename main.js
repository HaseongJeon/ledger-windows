const { app, BrowserWindow, Menu, Tray, nativeImage } = require("electron");
const path = require("node:path");

Menu.setApplicationMenu(null);

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
