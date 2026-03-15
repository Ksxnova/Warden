const fs = require('fs');
const path = require('path');
const configManager = require('./config-manager');

// In-memory log buffers per process id
const buffers = {};
// Registered IPC push callbacks
let pushCallback = null;

function getBuffer(id) {
  if (!buffers[id]) buffers[id] = [];
  return buffers[id];
}

function pushLine(id, text, stream) {
  const config = require('./process-manager').getConfig();
  const maxLines = (config && config.appSettings && config.appSettings.logBufferSize) || 5000;
  const buf = getBuffer(id);
  const entry = { t: Date.now(), text, stream };
  buf.push(entry);
  if (buf.length > maxLines) buf.splice(0, buf.length - maxLines);

  // Append to disk log
  const logFile = path.join(configManager.getLogsDir(), `${id}.log`);
  const line = `[${new Date(entry.t).toISOString()}][${stream}] ${text}\n`;
  try { fs.appendFileSync(logFile, line); } catch (e) { /* ignore */ }

  // Push to renderer
  if (pushCallback) pushCallback(id, entry);
}

function getLines(id) {
  return getBuffer(id);
}

function clearBuffer(id) {
  buffers[id] = [];
}

function setPushCallback(cb) {
  pushCallback = cb;
}

function exportLog(id, destPath) {
  const lines = getBuffer(id);
  const content = lines.map(e =>
    `[${new Date(e.t).toISOString()}][${e.stream}] ${e.text}`
  ).join('\n');
  fs.writeFileSync(destPath, content, 'utf8');
}

function cleanOldLogs(retentionDays) {
  const logsDir = configManager.getLogsDir();
  if (!fs.existsSync(logsDir)) return;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  fs.readdirSync(logsDir).forEach(file => {
    const fp = path.join(logsDir, file);
    try {
      const stat = fs.statSync(fp);
      if (stat.mtimeMs < cutoff) fs.unlinkSync(fp);
    } catch (e) { /* ignore */ }
  });
}

module.exports = { pushLine, getLines, clearBuffer, setPushCallback, exportLog, cleanOldLogs };
