const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const logManager = require('./log-manager');
let _playitManager = null;

function setPlayitManager(pm) { _playitManager = pm; }

// ── OneDrive pause/resume (Windows only) ────────────────────────────────────
let _oneDrivePausedForIds = new Set();

function pauseOneDrive(id) {
  if (process.platform !== 'win32') return;
  _oneDrivePausedForIds.add(id);
  if (_oneDrivePausedForIds.size > 1) return; // already paused
  const { execSync } = require('child_process');
  try {
    execSync('taskkill /F /IM OneDrive.exe', { encoding: 'utf8' });
  } catch {} // not running = fine
}

function resumeOneDrive(id) {
  if (process.platform !== 'win32') return;
  _oneDrivePausedForIds.delete(id);
  if (_oneDrivePausedForIds.size > 0) return; // other MC servers still running
  const odPath = `${process.env.LOCALAPPDATA}\\Microsoft\\OneDrive\\OneDrive.exe`;
  const fs2 = require('fs');
  if (fs2.existsSync(odPath)) {
    spawn(odPath, [], { detached: true, stdio: 'ignore' }).unref();
  }
}

// Runtime state map: id -> runtimeEntry
const runtime = {};
let _config = null;
let _mainWindow = null;
let _onStateChange = null;

function init(config, mainWindow, onStateChange) {
  _config = config;
  _mainWindow = mainWindow;
  _onStateChange = onStateChange;
}

function getConfig() { return _config; }

function getRuntime(id) {
  if (!runtime[id]) {
    runtime[id] = {
      config: null,
      child: null,
      pid: null,
      status: 'stopped',
      startedAt: null,
      crashCount: 0,
      totalCrashes: 0,
      restartAttempt: 0,
      restartTimer: null,
      stableTimer: null
    };
  }
  return runtime[id];
}

function getAllRuntime() {
  return runtime;
}

function notifyState(id) {
  if (_onStateChange) _onStateChange(id);
}

function getProcessConfig(id) {
  return _config.processes.find(p => p.id === id);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function cleanupMinecraftLocks(id, procConfig) {
  if (procConfig.type !== 'minecraft-server' || !procConfig.directory) return;
  const dir = procConfig.directory;
  const { execSync } = require('child_process');

  const trackedPids = new Set(
    Object.values(runtime).filter(r => r.pid && r.child).map(r => r.pid)
  );

  const killPid = (pid) => {
    if (!pid || pid <= 4 || trackedPids.has(pid)) return;
    try { execSync(`taskkill /PID ${pid} /T /F`, { encoding: 'utf8', timeout: 3000 }); } catch {}
  };

  if (process.platform === 'win32') {
    // Kill untracked java.exe zombies
    try {
      const out = execSync('wmic process where "name=\'java.exe\'" get ProcessId /value', { encoding: 'utf8', timeout: 3000 });
      [...out.matchAll(/ProcessId=(\d+)/g)].map(m => parseInt(m[1])).forEach(killPid);
    } catch {}

    // Kill anything holding the Minecraft port, wait up to 4s for it to free
    const port = procConfig.minecraftPort || 25565;
    const killPortHolder = () => {
      try {
        const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8', timeout: 2000 });
        [...new Set([...out.matchAll(/\s+(\d+)\s*$/gm)].map(m => parseInt(m[1])))].forEach(killPid);
      } catch {}
    };
    const isPortFree = () => {
      try {
        const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8', timeout: 2000 });
        return !out.trim();
      } catch { return true; }
    };

    killPortHolder();
    for (let i = 0; i < 8 && !isPortFree(); i++) {
      await sleep(500);
      killPortHolder();
    }
  }

  // Pre-rename latest.log so Paper doesn't need to rotate it on startup
  // (Paper's log rotation requires exclusive access — Windows file locks cause FileSystemException)
  try {
    const latestLog = path.join(dir, 'logs', 'latest.log');
    if (fs.existsSync(latestLog)) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const archived = path.join(dir, 'logs', `archived-${ts}.log`);
      fs.renameSync(latestLog, archived);
      logManager.pushLine(id, `[Warden] Archived latest.log → archived-${ts}.log`, 'stderr');
    }
  } catch {}

  // Delete session.lock files
  const tryDelete = (lockPath) => {
    try {
      if (fs.existsSync(lockPath)) {
        fs.unlinkSync(lockPath);
        logManager.pushLine(id, `[Warden] Removed stale lock: ${lockPath}`, 'stderr');
      }
    } catch {}
  };
  try {
    tryDelete(path.join(dir, 'world', 'session.lock'));
    const entries = fs.readdirSync(dir);
    for (const entry of entries) tryDelete(path.join(dir, entry, 'session.lock'));
  } catch {}
}

async function start(id) {
  const procConfig = getProcessConfig(id);
  if (!procConfig) throw new Error(`Process ${id} not found`);
  const rt = getRuntime(id);
  if (rt.status === 'online' || rt.status === 'starting') return;

  // Show "starting" immediately so UI doesn't feel frozen
  rt.config = procConfig;
  rt.status = 'starting';
  notifyState(id);

  // Pause OneDrive sync for Minecraft servers (it locks session.lock)
  if (procConfig.type === 'minecraft-server') pauseOneDrive(id);

  // Clean up stale Minecraft session.lock files + zombie processes (async, non-blocking)
  await cleanupMinecraftLocks(id, procConfig);

  // Re-check status in case stop() was called during cleanup
  if (rt.status === 'stopping' || rt.status === 'stopped') return;

  const env = { ...process.env, ...(procConfig.env || {}) };
  let child;
  try {
    child = spawn(procConfig.command, procConfig.args || [], {
      cwd: procConfig.directory || process.cwd(),
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: process.platform === 'win32'
    });
  } catch (e) {
    rt.status = 'crashed';
    logManager.pushLine(id, `Failed to start: ${e.message}`, 'stderr');
    notifyState(id);
    return;
  }

  rt.child = child;
  rt.pid = child.pid;
  rt.startedAt = new Date();
  rt.status = 'online';
  notifyState(id);

  // On Windows, shell:true means child.pid is cmd.exe — poll for the real child PID
  if (process.platform === 'win32') {
    const shellPid = child.pid;
    const findRealPid = async () => {
      const { execSync } = require('child_process');
      for (let attempt = 0; attempt < 10; attempt++) {
        await sleep(1000);
        if (rt.status !== 'online' || !rt.child) return;
        try {
          const out = execSync(`wmic process where "ParentProcessId=${shellPid}" get ProcessId /value`, { encoding: 'utf8', timeout: 3000 });
          const childPids = [...out.matchAll(/ProcessId=(\d+)/g)].map(m => parseInt(m[1])).filter(p => p > 0);
          if (childPids.length > 0) {
            rt.pid = childPids[0];
            notifyState(id);
            return;
          }
        } catch {}
      }
    };
    findRealPid();
  }

  // Auto-start playit.gg for Minecraft servers that have it enabled
  if (procConfig.type === 'minecraft-server' && procConfig.playit && procConfig.playit.enabled && _playitManager) {
    setTimeout(() => _playitManager.start(id, procConfig), 3000); // give server 3s to init
  }

  child.stdout.on('data', data => {
    data.toString().split('\n').forEach(line => {
      if (line) logManager.pushLine(id, line, 'stdout');
    });
  });

  child.stderr.on('data', data => {
    data.toString().split('\n').forEach(line => {
      if (line) logManager.pushLine(id, line, 'stderr');
    });
  });

  // Start stable uptime timer (30s → reset restartAttempt)
  if (rt.stableTimer) clearTimeout(rt.stableTimer);
  rt.stableTimer = setTimeout(() => {
    if (rt.status === 'online') {
      rt.restartAttempt = 0;
      rt.crashCount = 0;
    }
  }, 30000);

  child.on('exit', (code, signal) => {
    const wasOnline = rt.status === 'online' || rt.status === 'starting';
    rt.child = null;
    rt.pid = null;
    if (rt.stableTimer) { clearTimeout(rt.stableTimer); rt.stableTimer = null; }

    const isCrash = wasOnline && rt.status !== 'stopping';

    if (isCrash) {
      rt.crashCount++;
      rt.totalCrashes++;
      rt.status = 'crashed';
      logManager.pushLine(id, `Process exited (code=${code}, signal=${signal})`, 'stderr');
      notifyState(id);
      scheduleRestart(id);
    } else {
      rt.status = 'stopped';
      rt.startedAt = null;
      notifyState(id);
    }
    // Stop playit when process stops
    if (_playitManager) _playitManager.stop(id);
    // Resume OneDrive sync now that Minecraft has released its file locks
    if (procConfig.type === 'minecraft-server') resumeOneDrive(id);
  });

  child.on('error', err => {
    logManager.pushLine(id, `Spawn error: ${err.message}`, 'stderr');
    rt.status = 'crashed';
    notifyState(id);
  });
}

function scheduleRestart(id) {
  const procConfig = getProcessConfig(id);
  if (!procConfig) return;
  const rt = getRuntime(id);
  if (!procConfig.autoRestart) return;
  const maxRestarts = procConfig.maxRestarts || 5;
  if (rt.restartAttempt >= maxRestarts) {
    logManager.pushLine(id, `Max restarts (${maxRestarts}) reached, giving up.`, 'stderr');
    return;
  }

  const baseDelay = (procConfig.restartDelaySeconds || 3) * 1000;
  const multiplier = procConfig.restartBackoffMultiplier || 1.5;
  const delay = baseDelay * Math.pow(multiplier, rt.restartAttempt);
  rt.restartAttempt++;

  logManager.pushLine(id, `Restarting in ${(delay / 1000).toFixed(1)}s (attempt ${rt.restartAttempt}/${maxRestarts})...`, 'stderr');

  rt.restartTimer = setTimeout(() => {
    rt.restartTimer = null;
    start(id);
  }, delay);
}

function stop(id) {
  const rt = getRuntime(id);
  if (rt.restartTimer) { clearTimeout(rt.restartTimer); rt.restartTimer = null; }
  if (rt.stableTimer) { clearTimeout(rt.stableTimer); rt.stableTimer = null; }
  if (!rt.child) {
    rt.status = 'stopped';
    rt.startedAt = null;
    notifyState(id);
    return;
  }

  rt.status = 'stopping';
  notifyState(id);

  const procConfig = getProcessConfig(id);
  const isMinecraft = procConfig && procConfig.type === 'minecraft-server';

  if (isMinecraft && rt.child && rt.child.stdin) {
    try { rt.child.stdin.write('stop\n'); } catch (e) { /* ignore */ }
    const forceKillTimer = setTimeout(() => {
      if (rt.child && rt.pid) {
        killProcessTree(rt.pid);
      }
    }, 30000);
    rt.child.once('exit', () => clearTimeout(forceKillTimer));
  } else {
    if (rt.pid) {
      killProcessTree(rt.pid);
    } else if (rt.child) {
      rt.child.kill();
    }
  }
}

function killProcessTree(pid) {
  if (process.platform === 'win32') {
    exec(`taskkill /PID ${pid} /T /F`, err => {
      if (err) console.error('taskkill error:', err);
    });
  } else {
    try { process.kill(-pid, 'SIGKILL'); } catch (e) {
      try { process.kill(pid, 'SIGKILL'); } catch (e2) { /* ignore */ }
    }
  }
}

function restart(id) {
  const rt = getRuntime(id);
  if (rt.child) {
    rt.child.once('exit', () => { start(id); });
    stop(id);
  } else {
    start(id);
  }
}

function sendInput(id, text) {
  const rt = getRuntime(id);
  if (rt.child && rt.child.stdin) {
    rt.child.stdin.write(text + '\n');
  }
}

function getStatus(id) {
  const rt = getRuntime(id);
  const procConfig = getProcessConfig(id);
  return {
    id,
    name: procConfig ? procConfig.name : id,
    type: procConfig ? procConfig.type : 'custom',
    status: rt.status,
    pid: rt.pid,
    startedAt: rt.startedAt,
    crashCount: rt.crashCount,
    totalCrashes: rt.totalCrashes,
    restartAttempt: rt.restartAttempt,
    uptime: rt.startedAt ? Date.now() - rt.startedAt.getTime() : 0
  };
}

function getAllStatuses() {
  if (!_config) return [];
  return _config.processes.map(p => getStatus(p.id));
}

function startAll() {
  if (!_config) return;
  _config.processes.forEach(p => start(p.id));
}

function stopAll() {
  if (!_config) return;
  _config.processes.forEach(p => stop(p.id));
}

module.exports = {
  init, setPlayitManager, getConfig, start, stop, restart, sendInput,
  getStatus, getAllStatuses, getRuntime, getAllRuntime,
  startAll, stopAll
};
