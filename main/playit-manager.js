const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');

// Active playit processes: processId -> { child, tunnelUrl, claimUrl, status }
const instances = {};
let _mainWindow = null;
let _onUpdate = null;

function init(mainWindow, onUpdate) {
  _mainWindow = mainWindow;
  _onUpdate = onUpdate;
}

function push(event, data) {
  if (_mainWindow && !_mainWindow.isDestroyed()) {
    _mainWindow.webContents.send(event, data);
  }
}

// Download playit.gg agent for Windows
function getDefaultPlayitPath() {
  const appData = process.env.APPDATA || process.env.HOME || '.';
  return path.join(appData, 'Warden', 'playit.exe');
}

async function downloadPlayit(destPath) {
  const url = 'https://github.com/playit-cloud/playit-agent/releases/latest/download/playit-windows_amd64.exe';
  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  return new Promise((resolve, reject) => {
    push('playit:download', { status: 'downloading' });

    function doDownload(downloadUrl, redirectCount = 0) {
      if (redirectCount > 5) { reject(new Error('Too many redirects')); return; }
      const parsedUrl = new URL(downloadUrl);
      https.get({ hostname: parsedUrl.hostname, path: parsedUrl.pathname + parsedUrl.search, headers: { 'User-Agent': 'Warden' } }, res => {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
          doDownload(res.headers.location, redirectCount + 1);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: HTTP ${res.statusCode}`));
          return;
        }
        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        file.on('finish', () => { file.close(); push('playit:download', { status: 'done', path: destPath }); resolve(destPath); });
        file.on('error', err => { fs.unlink(destPath, () => {}); reject(err); });
      }).on('error', reject);
    }
    doDownload(url);
  });
}

// Parse playit.gg output for useful info
function parsePlayitLine(line) {
  // Claim URL: "please go to https://playit.gg/claim/xxxxx"
  const claimMatch = line.match(/https?:\/\/playit\.gg\/claim\/[a-zA-Z0-9_-]+/i);
  if (claimMatch) return { type: 'claim', url: claimMatch[0] };

  // Tunnel address patterns: "tcp://xxx.joinmc.link:12345" or "address: xxx.joinmc.link:12345"
  const tcpMatch = line.match(/tcp:\/\/([a-zA-Z0-9.\-]+:\d+)/i);
  if (tcpMatch) return { type: 'tunnel', address: tcpMatch[1] };

  const addrMatch = line.match(/(?:address|tunnel|connect)[\s:]+([a-zA-Z0-9.\-]+\.(?:joinmc\.link|playit\.gg)(?::\d+)?)/i);
  if (addrMatch) return { type: 'tunnel', address: addrMatch[1] };

  // IP address assignments
  const ipMatch = line.match(/(?:public address|assigned)[\s:]+(\d+\.\d+\.\d+\.\d+(?::\d+)?)/i);
  if (ipMatch) return { type: 'tunnel', address: ipMatch[1] };

  return null;
}

function start(processId, config) {
  if (instances[processId]) return;

  const execPath = config.playit?.executablePath || getDefaultPlayitPath();

  if (!fs.existsSync(execPath)) {
    push('playit:status', { id: processId, status: 'missing', execPath });
    return;
  }

  const args = [];
  if (config.playit?.configPath) args.push('--config', config.playit.configPath);

  const child = spawn(execPath, args, {
    cwd: config.directory || process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });

  instances[processId] = {
    child, tunnelUrl: null, claimUrl: null,
    status: 'starting'
  };

  push('playit:status', { id: processId, status: 'starting' });

  function onLine(line) {
    push('playit:log', { id: processId, text: line });
    const parsed = parsePlayitLine(line);
    if (!parsed) return;

    if (parsed.type === 'claim') {
      instances[processId].claimUrl = parsed.url;
      instances[processId].status = 'waiting_claim';
      push('playit:status', { id: processId, status: 'waiting_claim', claimUrl: parsed.url });
      if (_onUpdate) _onUpdate(processId, { claimUrl: parsed.url });
    } else if (parsed.type === 'tunnel') {
      instances[processId].tunnelUrl = parsed.address;
      instances[processId].status = 'connected';
      push('playit:status', { id: processId, status: 'connected', tunnelUrl: parsed.address });
      if (_onUpdate) _onUpdate(processId, { tunnelUrl: parsed.address });
    }
  }

  child.stdout.on('data', d => d.toString().split('\n').forEach(l => { if (l.trim()) onLine(l.trim()); }));
  child.stderr.on('data', d => d.toString().split('\n').forEach(l => { if (l.trim()) onLine(l.trim()); }));

  child.on('exit', () => {
    delete instances[processId];
    push('playit:status', { id: processId, status: 'stopped', tunnelUrl: null });
  });

  child.on('error', err => {
    push('playit:log', { id: processId, text: `playit error: ${err.message}` });
  });
}

function stop(processId) {
  const inst = instances[processId];
  if (!inst) return;
  try { inst.child.kill(); } catch {}
  delete instances[processId];
  push('playit:status', { id: processId, status: 'stopped', tunnelUrl: null });
}

function stopAll() {
  Object.keys(instances).forEach(id => stop(id));
}

function getStatus(processId) {
  const inst = instances[processId];
  if (!inst) return { status: 'stopped', tunnelUrl: null, claimUrl: null };
  return { status: inst.status, tunnelUrl: inst.tunnelUrl, claimUrl: inst.claimUrl };
}

function isPlayitAvailable() {
  return fs.existsSync(getDefaultPlayitPath());
}

module.exports = { init, start, stop, stopAll, getStatus, downloadPlayit, getDefaultPlayitPath, isPlayitAvailable };
