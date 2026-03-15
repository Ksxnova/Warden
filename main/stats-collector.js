const pidusage = require('pidusage');
const path = require('path');
const fs = require('fs');
const configManager = require('./config-manager');

const POLL_INTERVAL = 2000;
const MAX_HISTORY = 43200; // 24h at 2s intervals

// In-memory circular buffers: id -> [{t, cpu, mem}]
const history = {};
let pushCallback = null;
let timer = null;
let _processManager = null;

function init(processManager, onStats) {
  _processManager = processManager;
  pushCallback = onStats;
}

function getHistory(id) {
  if (!history[id]) history[id] = [];
  return history[id];
}

function addStat(id, stat) {
  const buf = getHistory(id);
  buf.push(stat);
  if (buf.length > MAX_HISTORY) buf.shift();
}

function getStats(id, rangeMs) {
  const buf = getHistory(id);
  if (!rangeMs) return buf;
  const cutoff = Date.now() - rangeMs;
  return buf.filter(s => s.t >= cutoff);
}

async function poll() {
  if (!_processManager) return;
  const all = _processManager.getAllRuntime();
  for (const [id, rt] of Object.entries(all)) {
    if (rt.pid && rt.status === 'online') {
      try {
        const usage = await pidusage(rt.pid);
        const stat = {
          t: Date.now(),
          cpu: Math.round(usage.cpu * 10) / 10,
          mem: Math.round(usage.memory / 1024 / 1024 * 10) / 10
        };
        addStat(id, stat);
        if (pushCallback) pushCallback(id, stat);
      } catch (e) {
        // Process may have just exited
      }
    }
  }
}

function start() {
  if (timer) return;
  timer = setInterval(poll, POLL_INTERVAL);
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = { init, start, stop, getStats, getHistory };
