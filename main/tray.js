const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');

let tray = null;
let _mainWindow = null;
let _processManager = null;
let _config = null;

// Build a colored dot icon as a 16x16 PNG buffer using raw pixel data
function buildTrayIcon(color) {
  // Use nativeImage.createEmpty() with a simple colored square (16x16)
  // We'll use a simple approach: create a data URL
  const colorMap = {
    green: '\x00\xff\x00\xff',
    yellow: '\xff\xcc\x00\xff',
    red: '\xff\x00\x00\xff',
    grey: '\x88\x88\x88\xff'
  };
  // Fallback: just use a default icon if no image system
  return null;
}

function getStatusColor() {
  if (!_processManager || !_config) return 'grey';
  const statuses = _config.processes.map(p => _processManager.getRuntime(p.id));
  if (statuses.length === 0) return 'grey';
  const hasCrash = statuses.some(s => s && s.status === 'crashed');
  const hasOnline = statuses.some(s => s && s.status === 'online');
  const allOnline = statuses.every(s => s && s.status === 'online');
  if (hasCrash) return 'red';
  if (allOnline) return 'green';
  if (hasOnline) return 'yellow';
  return 'grey';
}

function getTooltip() {
  if (!_processManager || !_config) return 'Warden';
  const procs = _config.processes;
  const online = procs.filter(p => {
    const rt = _processManager.getRuntime(p.id);
    return rt && rt.status === 'online';
  }).length;
  return `Warden — ${online}/${procs.length} running`;
}

function buildContextMenu() {
  const template = [
    {
      label: 'Show Window',
      click: () => {
        if (_mainWindow) {
          _mainWindow.show();
          _mainWindow.focus();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Start All',
      click: () => _processManager && _processManager.startAll()
    },
    {
      label: 'Stop All',
      click: () => _processManager && _processManager.stopAll()
    },
    { type: 'separator' }
  ];

  if (_config && _config.processes.length > 0) {
    _config.processes.slice(0, 10).forEach(p => {
      const rt = _processManager ? _processManager.getRuntime(p.id) : null;
      const isRunning = rt && rt.status === 'online';
      template.push({
        label: `${isRunning ? '● ' : '○ '}${p.name}`,
        click: () => {
          if (isRunning) {
            _processManager.stop(p.id);
          } else {
            _processManager.start(p.id);
          }
        }
      });
    });
    template.push({ type: 'separator' });
  }

  template.push({
    label: 'Quit',
    click: () => app.quit()
  });

  return Menu.buildFromTemplate(template);
}

function init(mainWindow, processManager, config) {
  _mainWindow = mainWindow;
  _processManager = processManager;
  _config = config;
}

function updateConfig(config) {
  _config = config;
  refresh();
}

function createIcon() {
  const fs = require('fs');
  // Prefer a small dedicated tray PNG, fall back to main icon
  const candidates = [
    path.join(__dirname, '..', 'assets', 'tray.png'),
    path.join(__dirname, '..', 'assets', 'icon32.png'),
    path.join(__dirname, '..', 'assets', 'icon.png'),
    process.platform === 'win32' ? path.join(__dirname, '..', 'assets', 'icon.ico') : null
  ].filter(Boolean);

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) return img;
    }
  }

  // Last resort: blank PNG (won't crash)
  const BLANK_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABmJLR0QA/wD/AP+gvaeTAAAADUlEQVQ4jWNgYGBgAAAABQABXvMqGgAAAABJRU5ErkJggg==';
  return nativeImage.createFromDataURL(BLANK_PNG);
}

function create() {
  let icon = createIcon();

  tray = new Tray(icon);
  tray.setToolTip(getTooltip());
  tray.setContextMenu(buildContextMenu());

  tray.on('double-click', () => {
    if (_mainWindow) {
      _mainWindow.show();
      _mainWindow.focus();
    }
  });

  tray.on('click', () => {
    if (_mainWindow) {
      if (_mainWindow.isVisible()) {
        _mainWindow.focus();
      } else {
        _mainWindow.show();
      }
    }
  });
}

function refresh() {
  if (!tray) return;
  tray.setToolTip(getTooltip());
  tray.setContextMenu(buildContextMenu());
}

function destroy() {
  if (tray) { tray.destroy(); tray = null; }
}

module.exports = { init, create, refresh, destroy, updateConfig };
