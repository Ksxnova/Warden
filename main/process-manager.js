const { spawn, exec } = require('child_process');
const logManager = require('./log-manager');
let _playitManager = null;

function setPlayitManager(pm) { _playitManager = pm; }

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

function start(id) {
  const procConfig = getProcessConfig(id);
  if (!procConfig) throw new Error(`Process ${id} not found`);
  const rt = getRuntime(id);
  if (rt.status === 'online' || rt.status === 'starting') return;

  rt.config = procConfig;
  rt.status = 'starting';
  notifyState(id);

  const env = { ...process.env, ...(procConfig.env || {}) };
  let child;
  try {
    child = spawn(procConfig.command, procConfig.args || [], {
      cwd: procConfig.directory || process.cwd(),
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false
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
