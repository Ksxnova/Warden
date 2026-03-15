const { ipcMain, dialog } = require('electron');
const { v4: uuidv4 } = require('uuid');
const configManager = require('./config-manager');
const processManager = require('./process-manager');
const logManager = require('./log-manager');
const statsCollector = require('./stats-collector');
const rconClient = require('./rcon-client');
const scheduler = require('./scheduler');
const tray = require('./tray');
const aiAnalyzer = require('./ai-analyzer');
const playitManager = require('./playit-manager');

let _config = null;
let _mainWindow = null;

function saveConfig() {
  configManager.save(_config);
  scheduler.updateConfig(_config);
  tray.updateConfig(_config);
}

function init(config, mainWindow) {
  _config = config;
  _mainWindow = mainWindow;

  // ── Config / Settings ──────────────────────────────────────────────────
  ipcMain.handle('config:get', () => _config);

  ipcMain.handle('config:saveSettings', (e, settings) => {
    _config.appSettings = { ..._config.appSettings, ...settings };
    saveConfig();
    return true;
  });

  // ── AI ─────────────────────────────────────────────────────────────────
  ipcMain.handle('ai:analyzeCrash', async (e, id) => {
    const procConfig = _config.processes.find(p => p.id === id);
    if (!procConfig) return { error: 'Process not found' };
    const logs = logManager.getLines(id);
    const rt = processManager.getRuntime(id);
    try {
      await aiAnalyzer.analyzeCrash(procConfig, logs, { code: null, totalCrashes: rt.totalCrashes });
      return { ok: true };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('ai:suggestSetup', async (e, directory) => {
    try {
      const suggestion = await aiAnalyzer.suggestSetup(directory);
      return { ok: true, suggestion };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('ai:summarizeLogs', async (e, id) => {
    const procConfig = _config.processes.find(p => p.id === id);
    if (!procConfig) return { error: 'Process not found' };
    const logs = logManager.getLines(id);
    try {
      await aiAnalyzer.summarizeLogs(procConfig, logs);
      return { ok: true };
    } catch (err) {
      return { error: err.message };
    }
  });

  // ── Process CRUD ───────────────────────────────────────────────────────
  ipcMain.handle('process:add', (e, proc) => {
    proc.id = proc.id || uuidv4();
    // Default fields
    proc.autoRestart = proc.autoRestart !== undefined ? proc.autoRestart : true;
    proc.maxRestarts = proc.maxRestarts || 5;
    proc.restartDelaySeconds = proc.restartDelaySeconds || 3;
    proc.restartBackoffMultiplier = proc.restartBackoffMultiplier || 1.5;
    proc.schedule = proc.schedule || { enabled: false, startTime: '08:00', stopTime: '23:00', days: [1,2,3,4,5] };
    proc.rcon = proc.rcon || { enabled: false, host: '127.0.0.1', port: 25575, password: '' };
    proc.env = proc.env || {};
    proc.pinned = proc.pinned || false;
    proc.notes = proc.notes || '';
    _config.processes.push(proc);
    saveConfig();
    return proc;
  });

  ipcMain.handle('process:update', (e, updated) => {
    const idx = _config.processes.findIndex(p => p.id === updated.id);
    if (idx === -1) return false;
    _config.processes[idx] = { ..._config.processes[idx], ...updated };
    saveConfig();
    return true;
  });

  ipcMain.handle('process:delete', (e, id) => {
    const rt = processManager.getRuntime(id);
    if (rt && (rt.status === 'online' || rt.status === 'starting')) {
      processManager.stop(id);
    }
    _config.processes = _config.processes.filter(p => p.id !== id);
    saveConfig();
    return true;
  });

  ipcMain.handle('process:duplicate', (e, id) => {
    const orig = _config.processes.find(p => p.id === id);
    if (!orig) return null;
    const copy = JSON.parse(JSON.stringify(orig));
    copy.id = uuidv4();
    copy.name = orig.name + ' (copy)';
    _config.processes.push(copy);
    saveConfig();
    return copy;
  });

  // ── Process Control ────────────────────────────────────────────────────
  ipcMain.handle('process:start', (e, id) => {
    processManager.start(id);
    return true;
  });

  ipcMain.handle('process:stop', (e, id) => {
    processManager.stop(id);
    return true;
  });

  ipcMain.handle('process:restart', (e, id) => {
    processManager.restart(id);
    return true;
  });

  ipcMain.handle('process:startAll', () => {
    processManager.startAll();
    return true;
  });

  ipcMain.handle('process:stopAll', () => {
    processManager.stopAll();
    return true;
  });

  ipcMain.handle('process:sendInput', (e, id, text) => {
    processManager.sendInput(id, text);
    return true;
  });

  ipcMain.handle('process:getStatus', (e, id) => {
    return processManager.getStatus(id);
  });

  ipcMain.handle('process:getAllStatuses', () => {
    return processManager.getAllStatuses();
  });

  // ── Logs ───────────────────────────────────────────────────────────────
  ipcMain.handle('logs:get', (e, id) => {
    return logManager.getLines(id);
  });

  ipcMain.handle('logs:clear', (e, id) => {
    logManager.clearBuffer(id);
    return true;
  });

  ipcMain.handle('logs:export', async (e, id) => {
    const result = await dialog.showSaveDialog(_mainWindow, {
      defaultPath: `${id}-logs.txt`,
      filters: [{ name: 'Log Files', extensions: ['txt', 'log'] }]
    });
    if (!result.canceled && result.filePath) {
      logManager.exportLog(id, result.filePath);
      return result.filePath;
    }
    return null;
  });

  // ── Stats ──────────────────────────────────────────────────────────────
  ipcMain.handle('stats:get', (e, id, rangeMs) => {
    return statsCollector.getStats(id, rangeMs);
  });

  // ── RCON ───────────────────────────────────────────────────────────────
  ipcMain.handle('rcon:sendCommand', async (e, id, command) => {
    try {
      const result = await rconClient.sendCommand(id, command);
      return { success: true, result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('rcon:getPlayerCount', (e, id) => {
    return rconClient.getPlayerCount(id);
  });

  // ── Scheduler ─────────────────────────────────────────────────────────
  ipcMain.handle('scheduler:getNextTrigger', (e, id) => {
    return scheduler.getNextTrigger(id);
  });

  // ── File / Directory pickers ───────────────────────────────────────────
  ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog(_mainWindow, {
      properties: ['openDirectory']
    });
    if (!result.canceled && result.filePaths.length > 0) return result.filePaths[0];
    return null;
  });

  ipcMain.handle('dialog:saveConfig', async () => {
    const result = await dialog.showSaveDialog(_mainWindow, {
      defaultPath: 'bbr-config-backup.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (!result.canceled && result.filePath) {
      const fs = require('fs');
      fs.writeFileSync(result.filePath, JSON.stringify(_config, null, 2), 'utf8');
      return result.filePath;
    }
    return null;
  });

  ipcMain.handle('dialog:loadConfig', async () => {
    const result = await dialog.showOpenDialog(_mainWindow, {
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    });
    if (!result.canceled && result.filePaths.length > 0) {
      const fs = require('fs');
      try {
        const loaded = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'));
        _config = loaded;
        configManager.save(_config);
        scheduler.updateConfig(_config);
        tray.updateConfig(_config);
        return _config;
      } catch (e) {
        return null;
      }
    }
    return null;
  });

  ipcMain.handle('project:detect', (e, dir) => {
    const fs = require('fs');
    const path = require('path');
    try {
      let files = fs.readdirSync(dir);

      // If nothing useful at root, check one level of subdirectories
      const hasUsefulFiles = f => f.match(/\.(jar|py|js|json|toml|mod|properties|yml|yaml|txt)$/i);
      if (!files.some(hasUsefulFiles)) {
        const subdirs = files.filter(f => {
          try { return fs.statSync(path.join(dir, f)).isDirectory(); } catch { return false; }
        });
        for (const sub of subdirs) {
          const subFiles = fs.readdirSync(path.join(dir, sub));
          if (subFiles.some(hasUsefulFiles)) {
            dir = path.join(dir, sub);
            files = subFiles;
            break;
          }
        }
      }
      const has = f => files.includes(f);
      const name = path.basename(dir);

      // Node.js / Discord.js bot
      if (has('package.json')) {
        try {
          const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
          const main = pkg.main || 'index.js';
          const start = pkg.scripts && pkg.scripts.start;
          const isMinecraft = JSON.stringify(pkg).toLowerCase().includes('minecraft');
          const type = isMinecraft ? 'minecraft-server' : 'discord-bot';
          // Parse start script if it exists
          if (start && start.startsWith('node ')) {
            const parts = start.replace('node ', '').trim().split(/\s+/);
            return { dir, name: pkg.name || name, type, command: 'node', args: parts, env: {} };
          }
          return { dir, name: pkg.name || name, type, command: 'node', args: [main], env: {} };
        } catch {}
        return { dir, name, type: 'discord-bot', command: 'node', args: ['index.js'], env: {} };
      }

      // Python bot
      if (has('requirements.txt') || has('bot.py') || has('main.py') || has('run.py')) {
        const entry = ['bot.py','main.py','run.py','app.py'].find(f => has(f)) || 'main.py';
        return { dir, name, type: 'discord-bot', command: 'python', args: [entry], env: {} };
      }

      // Minecraft server — detect by properties/yml files or any jar
      const mcIndicators = ['server.properties','bukkit.yml','spigot.yml','paper.yml','paper-global.yml',
        'config/paper-global.yml','eula.txt','ops.json','whitelist.json','banned-players.json'];
      const hasMcFile = mcIndicators.some(f => has(f));
      const allJars = files.filter(f => f.match(/\.jar$/i));
      // Score jars by how MC-like their name is
      const mcJarScore = f => {
        const n = f.toLowerCase();
        if (n.match(/paper|spigot|purpur|forge|fabric|bungeecord|velocity|waterfall|minecraft_server|server/)) return 10;
        if (n.match(/\.jar$/)) return 1;
        return 0;
      };
      const bestJar = allJars.sort((a,b) => mcJarScore(b) - mcJarScore(a))[0];
      if (hasMcFile || (bestJar && mcJarScore(bestJar) >= 10)) {
        const jar = bestJar || 'server.jar';
        return { dir, name, type: 'minecraft-server', command: 'java', args: ['-Xmx2G', '-Xms1G', '-jar', jar, 'nogui'], env: {} };
      }

      // Java jar (generic)
      if (allJars.length > 0) {
        return { name, type: 'custom', command: 'java', args: ['-jar', allJars[0]], env: {} };
      }

      // Go
      if (has('go.mod')) return { name, type: 'custom', command: 'go', args: ['run', '.'], env: {} };

      // Rust
      if (has('Cargo.toml')) return { name, type: 'custom', command: 'cargo', args: ['run'], env: {} };

      return null;
    } catch { return null; }
  });

  ipcMain.handle('dialog:openFile', async (e, filters) => {
    const result = await dialog.showOpenDialog(_mainWindow, {
      properties: ['openFile'],
      filters: filters || [{ name: 'All Files', extensions: ['*'] }]
    });
    if (!result.canceled && result.filePaths.length > 0) return result.filePaths[0];
    return null;
  });

  // ── Startup ────────────────────────────────────────────────────────────
  ipcMain.handle('app:setStartWithWindows', (e, enabled) => {
    const { app } = require('electron');
    app.setLoginItemSettings({ openAtLogin: enabled });
    return true;
  });

  // ── playit.gg ──────────────────────────────────────────────────────────
  ipcMain.handle('playit:getStatus', (e, id) => {
    return playitManager.getStatus(id);
  });

  ipcMain.handle('playit:start', (e, id) => {
    const procConfig = _config.processes.find(p => p.id === id);
    if (procConfig) playitManager.start(id, procConfig);
    return true;
  });

  ipcMain.handle('playit:stop', (e, id) => {
    playitManager.stop(id);
    return true;
  });

  ipcMain.handle('playit:download', async () => {
    try {
      const dest = playitManager.getDefaultPlayitPath();
      await playitManager.downloadPlayit(dest);
      return { ok: true, path: dest };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('playit:isAvailable', () => {
    return playitManager.isPlayitAvailable();
  });
}

module.exports = { init };
