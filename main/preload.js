const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Config
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveSettings: (settings) => ipcRenderer.invoke('config:saveSettings', settings),

  // Process CRUD
  addProcess: (proc) => ipcRenderer.invoke('process:add', proc),
  updateProcess: (proc) => ipcRenderer.invoke('process:update', proc),
  deleteProcess: (id) => ipcRenderer.invoke('process:delete', id),
  duplicateProcess: (id) => ipcRenderer.invoke('process:duplicate', id),

  // Process control
  startProcess: (id) => ipcRenderer.invoke('process:start', id),
  stopProcess: (id) => ipcRenderer.invoke('process:stop', id),
  restartProcess: (id) => ipcRenderer.invoke('process:restart', id),
  startAll: () => ipcRenderer.invoke('process:startAll'),
  stopAll: () => ipcRenderer.invoke('process:stopAll'),
  sendInput: (id, text) => ipcRenderer.invoke('process:sendInput', id, text),
  getStatus: (id) => ipcRenderer.invoke('process:getStatus', id),
  getAllStatuses: () => ipcRenderer.invoke('process:getAllStatuses'),

  // Logs
  getLogs: (id) => ipcRenderer.invoke('logs:get', id),
  clearLogs: (id) => ipcRenderer.invoke('logs:clear', id),
  exportLogs: (id) => ipcRenderer.invoke('logs:export', id),

  // Stats
  getStats: (id, rangeMs) => ipcRenderer.invoke('stats:get', id, rangeMs),

  // RCON
  rconSendCommand: (id, cmd) => ipcRenderer.invoke('rcon:sendCommand', id, cmd),
  rconGetPlayerCount: (id) => ipcRenderer.invoke('rcon:getPlayerCount', id),

  // Scheduler
  getNextTrigger: (id) => ipcRenderer.invoke('scheduler:getNextTrigger', id),

  // Dialogs
  detectProject: (dir) => ipcRenderer.invoke('project:detect', dir),
  openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  openFile: (filters) => ipcRenderer.invoke('dialog:openFile', filters),
  saveConfig: () => ipcRenderer.invoke('dialog:saveConfig'),
  loadConfig: () => ipcRenderer.invoke('dialog:loadConfig'),

  // App
  setStartWithWindows: (enabled) => ipcRenderer.invoke('app:setStartWithWindows', enabled),

  // AI
  aiAnalyzeCrash: (id) => ipcRenderer.invoke('ai:analyzeCrash', id),
  aiSuggestSetup: (dir) => ipcRenderer.invoke('ai:suggestSetup', dir),
  aiSummarizeLogs: (id) => ipcRenderer.invoke('ai:summarizeLogs', id),

  // playit.gg
  playitGetStatus: (id) => ipcRenderer.invoke('playit:getStatus', id),
  playitStart: (id) => ipcRenderer.invoke('playit:start', id),
  playitStop: (id) => ipcRenderer.invoke('playit:stop', id),
  playitDownload: () => ipcRenderer.invoke('playit:download'),
  playitIsAvailable: () => ipcRenderer.invoke('playit:isAvailable'),

  // Event listeners
  onProcessStateChange: (cb) => {
    ipcRenderer.on('process:stateChange', (e, id, status) => cb(id, status));
  },
  onLogLine: (cb) => {
    ipcRenderer.on('log:line', (e, id, entry) => cb(id, entry));
  },
  onStats: (cb) => {
    ipcRenderer.on('stats:update', (e, id, stat) => cb(id, stat));
  },
  onPlayerCount: (cb) => {
    ipcRenderer.on('rcon:playerCount', (e, id, count) => cb(id, count));
  },
  onAiStart: (cb) => ipcRenderer.on('ai:start', (e, data) => cb(data)),
  onAiChunk: (cb) => ipcRenderer.on('ai:chunk', (e, data) => cb(data)),
  onAiDone: (cb) => ipcRenderer.on('ai:done', (e, data) => cb(data)),
  onAiError: (cb) => ipcRenderer.on('ai:error', (e, data) => cb(data)),

  onPlayitStatus: (cb) => ipcRenderer.on('playit:status', (e, data) => cb(data)),
  onPlayitLog: (cb) => ipcRenderer.on('playit:log', (e, data) => cb(data)),
  onPlayitUpdate: (cb) => ipcRenderer.on('playit:update', (e, id, data) => cb(id, data)),
  onPlayitDownload: (cb) => ipcRenderer.on('playit:download', (e, data) => cb(data)),

  // Remove listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});
