const { app, BrowserWindow } = require('electron');
const path = require('path');
const configManager = require('./config-manager');
const processManager = require('./process-manager');
const logManager = require('./log-manager');
const statsCollector = require('./stats-collector');
const rconClient = require('./rcon-client');
const scheduler = require('./scheduler');
const tray = require('./tray');
const ipcHandlers = require('./ipc-handlers');
const aiAnalyzer = require('./ai-analyzer');
const playitManager = require('./playit-manager');

let mainWindow = null;
let isQuitting = false;

function getAppIcon() {
  const iconFile = process.platform === 'win32' ? 'icon.ico'
    : process.platform === 'darwin' ? 'icon.png'
    : 'icon.png';
  return path.join(__dirname, '..', 'assets', iconFile);
}

function createWindow() {
  const config = configManager.load();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: true,
    backgroundColor: '#1a1a2e',
    title: 'Warden',
    icon: getAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (!config.appSettings.startMinimized) {
      mainWindow.show();
    }
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  // ── Wire up IPC handlers ─────────────────────────────────────────────
  ipcHandlers.init(config, mainWindow);

  // ── Wire up process manager ──────────────────────────────────────────
  processManager.init(config, mainWindow, (id) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const status = processManager.getStatus(id);
      mainWindow.webContents.send('process:stateChange', id, status);
    }
    tray.refresh();
  });

  // ── Wire up log manager ──────────────────────────────────────────────
  logManager.setPushCallback((id, entry) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('log:line', id, entry);
    }
  });

  // ── Wire up stats collector ──────────────────────────────────────────
  statsCollector.init(processManager, (id, stat) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('stats:update', id, stat);
    }
  });
  statsCollector.start();

  // ── Wire up RCON ─────────────────────────────────────────────────────
  rconClient.init(processManager, (id, count) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('rcon:playerCount', id, count);
    }
  });
  rconClient.startPolling();

  // ── Wire up scheduler ────────────────────────────────────────────────
  scheduler.init(processManager, config);
  scheduler.start();

  // ── Wire up tray ─────────────────────────────────────────────────────
  tray.init(mainWindow, processManager, config);
  tray.create();

  // ── Wire up AI analyzer ──────────────────────────────────────────────
  aiAnalyzer.init(mainWindow, () => config.appSettings || {});

  // ── Wire up playit manager ───────────────────────────────────────────
  playitManager.init(mainWindow, (id, data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('playit:update', id, data);
    }
  });
  processManager.setPlayitManager(playitManager);

  // ── Clean old logs daily ─────────────────────────────────────────────
  const retentionDays = (config.appSettings && config.appSettings.logRetentionDays) || 7;
  logManager.cleanOldLogs(retentionDays);
  setInterval(() => logManager.cleanOldLogs(retentionDays), 24 * 60 * 60 * 1000);
}

app.whenReady().then(() => {
  createWindow();
});

app.on('before-quit', () => {
  isQuitting = true;
  statsCollector.stop();
  rconClient.stopPolling();
  scheduler.stop();
  playitManager.stopAll();
  processManager.stopAll();
  tray.destroy();
});

app.on('window-all-closed', () => {
  // Keep running in tray on Windows
  if (process.platform !== 'darwin') {
    // Don't quit — tray handles exit
  }
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});
