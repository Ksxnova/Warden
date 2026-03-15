let _processManager = null;
let _config = null;
let timer = null;

function init(processManager, config) {
  _processManager = processManager;
  _config = config;
}

function updateConfig(config) {
  _config = config;
}

function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function nowMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function tick() {
  if (!_config || !_processManager) return;
  const now = nowMinutes();
  const today = new Date().getDay(); // 0=Sun, 1=Mon...

  _config.processes.forEach(p => {
    if (!p.schedule || !p.schedule.enabled) return;
    const days = p.schedule.days || [1, 2, 3, 4, 5, 6, 0];
    if (!days.includes(today)) return;

    const startMin = timeToMinutes(p.schedule.startTime || '08:00');
    const stopMin = timeToMinutes(p.schedule.stopTime || '23:00');
    const rt = _processManager.getRuntime(p.id);
    const status = rt ? rt.status : 'stopped';

    // Trigger start within a 30s window
    if (Math.abs(now - startMin) < 1 && status === 'stopped') {
      _processManager.start(p.id);
    }
    if (Math.abs(now - stopMin) < 1 && status === 'online') {
      _processManager.stop(p.id);
    }
  });
}

function getNextTrigger(processId) {
  if (!_config) return null;
  const p = _config.processes.find(pr => pr.id === processId);
  if (!p || !p.schedule || !p.schedule.enabled) return null;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const startMin = timeToMinutes(p.schedule.startTime || '08:00');
  const stopMin = timeToMinutes(p.schedule.stopTime || '23:00');

  const targets = [
    { label: 'Start', min: startMin },
    { label: 'Stop', min: stopMin }
  ].map(t => {
    let diffMin = t.min - nowMin;
    if (diffMin < 0) diffMin += 1440; // next day
    return { ...t, diffMin };
  }).sort((a, b) => a.diffMin - b.diffMin);

  if (!targets.length) return null;
  const next = targets[0];
  const nextTime = new Date(Date.now() + next.diffMin * 60000);
  return { label: next.label, time: nextTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
}

function start() {
  if (timer) return;
  timer = setInterval(tick, 30000); // every 30s
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = { init, updateConfig, start, stop, getNextTrigger };
