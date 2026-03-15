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

async function getPlayitDownloadUrl() {
  return new Promise((resolve, reject) => {
    https.get({
      hostname: 'api.github.com',
      path: '/repos/playit-cloud/playit-agent/releases/latest',
      headers: { 'User-Agent': 'Warden', 'Accept': 'application/vnd.github.v3+json' }
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const release = JSON.parse(data);
          // Prefer signed 64-bit exe on Windows
          const asset = release.assets.find(a => a.name === 'playit-windows-x86_64-signed.exe')
            || release.assets.find(a => a.name === 'playit-windows-x86_64.exe')
            || release.assets.find(a => /windows.*x86_64.*\.exe$/i.test(a.name))
            || release.assets.find(a => /windows.*\.exe$/i.test(a.name));
          if (!asset) { reject(new Error('No Windows exe found in latest release')); return; }
          resolve(asset.browser_download_url);
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function downloadPlayit(destPath) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  return new Promise(async (resolve, reject) => {
    push('playit:download', { status: 'downloading' });

    let url;
    try {
      url = await getPlayitDownloadUrl();
    } catch (e) {
      // Fallback to known URL pattern
      url = 'https://github.com/playit-cloud/playit-agent/releases/latest/download/playit-windows-x86_64.exe';
    }

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
  // Claim URL: any playit.gg/claim/... URL anywhere in the line
  const claimMatch = line.match(/https?:\/\/(?:www\.)?playit\.gg\/claim\/[a-zA-Z0-9_-]+/i);
  if (claimMatch) return { type: 'claim', url: claimMatch[0] };

  // Claim code style: "claim code: XXXXX" → build URL
  const claimCode = line.match(/claim[_\s-]*(?:code|key|url|link)?[\s:=]+([a-zA-Z0-9_-]{8,})/i);
  if (claimCode && !line.match(/tunnel|address|port/i)) {
    const code = claimCode[1];
    if (!code.includes('.') && !code.includes(':')) {
      return { type: 'claim', url: `https://playit.gg/claim/${code}` };
    }
  }

  // Tunnel address: tcp:// or udp:// style
  const tcpMatch = line.match(/(?:tcp|udp):\/\/([a-zA-Z0-9.\-]+:\d+)/i);
  if (tcpMatch) return { type: 'tunnel', address: tcpMatch[1] };

  // address/tunnel/connect followed by known playit domains
  const addrMatch = line.match(/(?:address|tunnel|connect|proxy|allocated)[\s:=]+([a-zA-Z0-9.\-]+\.(?:joinmc\.link|playit\.gg|ply\.gg)(?::\d+)?)/i);
  if (addrMatch) return { type: 'tunnel', address: addrMatch[1] };

  // Any joinmc.link or ply.gg hostname in the line
  const domainMatch = line.match(/([a-zA-Z0-9.\-]+\.(?:joinmc\.link|ply\.gg))(?::(\d+))?/i);
  if (domainMatch) return { type: 'tunnel', address: domainMatch[2] ? `${domainMatch[1]}:${domainMatch[2]}` : domainMatch[1] };

  // IP:port public address
  const ipMatch = line.match(/(?:public|assigned|address)[\s:=]+(\d+\.\d+\.\d+\.\d+:\d+)/i);
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
    windowsHide: true,
    env: {
      ...process.env,
      RUST_LOG: 'info',
      NO_COLOR: '1',
      TERM: 'dumb'
    }
  });

  instances[processId] = {
    child, tunnelUrl: null, claimUrl: null,
    status: 'starting'
  };

  push('playit:status', { id: processId, status: 'starting' });

  function onLine(line) {
    push('playit:log', { id: processId, text: line });
    // Mirror to the process log view so the user can see playit output
    const logManager = require('./log-manager');
    logManager.pushLine(processId, `[playit] ${line}`, 'stdout');
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
