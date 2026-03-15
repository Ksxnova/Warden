// ── Dashboard Module ─────────────────────────────────────────────────────────
window.DashboardModule = (() => {
  const sparklineData = {}; // id -> [{cpu, mem}] (last 60)
  const MAX_SPARK = 60;
  const playitStatus = {}; // id -> { status, tunnelUrl, claimUrl }

  function formatUptime(ms) {
    if (!ms || ms <= 0) return '—';
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    if (d > 0) return `${d}d ${h % 24}h`;
    if (h > 0) return `${h}h ${m % 60}m`;
    if (m > 0) return `${m}m ${s % 60}s`;
    return `${s}s`;
  }

  function formatMem(mb) {
    if (mb === undefined || mb === null) return '—';
    if (mb >= 1024) return (mb / 1024).toFixed(1) + ' GB';
    return mb.toFixed(0) + ' MB';
  }

  function getTypeLabel(type) {
    if (type === 'discord-bot') return 'Discord';
    if (type === 'minecraft-server') return 'Minecraft';
    return 'Custom';
  }

  function getTypeClass(type) {
    if (type === 'discord-bot') return 'type-discord';
    if (type === 'minecraft-server') return 'type-minecraft';
    return 'type-custom';
  }

  function getStatusLabel(status) {
    const labels = {
      online: 'Online', stopped: 'Stopped', crashed: 'Crashed',
      starting: 'Starting', stopping: 'Stopping', offline: 'Offline'
    };
    return labels[status] || status;
  }

  function renderSparkline(canvas, data, color) {
    const ctx = canvas.getContext('2d');
    const W = canvas.offsetWidth || 260;
    const H = canvas.offsetHeight || 36;
    canvas.width = W;
    canvas.height = H;
    ctx.clearRect(0, 0, W, H);
    if (!data || data.length < 2) return;

    const max = Math.max(...data, 0.01);
    const pts = data.map((v, i) => ({
      x: (i / (data.length - 1)) * W,
      y: H - (v / max) * H * 0.9 - H * 0.05
    }));

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Fill
    ctx.lineTo(pts[pts.length - 1].x, H);
    ctx.lineTo(pts[0].x, H);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, color + '40');
    grad.addColorStop(1, color + '00');
    ctx.fillStyle = grad;
    ctx.fill();
  }

  function createCard(proc, status) {
    const div = document.createElement('div');
    div.className = 'process-card';
    div.dataset.id = proc.id;
    div.dataset.status = status ? status.status : 'stopped';
    updateCard(div, proc, status);
    return div;
  }

  function updateCard(div, proc, status) {
    const st = status || { status: 'stopped', uptime: 0, pid: null, crashCount: 0, totalCrashes: 0, restartAttempt: 0 };
    const stats = AppState.latestStats[proc.id] || {};
    const players = AppState.playerCounts[proc.id];
    const spark = sparklineData[proc.id] || [];
    const pStatus = playitStatus[proc.id];

    div.dataset.status = st.status;

    const pinned = proc.pinned ? '<span class="pin-icon">📌</span>' : '';
    const crashes = st.totalCrashes > 0 ? `<span class="crash-badge">✕ ${st.totalCrashes}</span>` : '';
    const playerBadge = (proc.type === 'minecraft-server' && players !== undefined)
      ? `<span class="player-count">👥 ${players}</span>` : '';
    const tunnelBadge = pStatus && pStatus.tunnelUrl
      ? `<div style="font-size:10.5px;color:#43e97b;margin-top:4px;display:flex;align-items:center;gap:5px;">🌐 <span style="font-family:var(--font-mono);user-select:all">${pStatus.tunnelUrl}</span></div>`
      : pStatus && pStatus.claimUrl
      ? `<div style="font-size:10.5px;color:var(--status-starting);margin-top:4px;">🌐 <a href="${pStatus.claimUrl}" style="color:inherit">Claim playit.gg tunnel →</a></div>`
      : '';
    const restartInfo = st.restartAttempt > 0
      ? `<span class="text-muted text-sm"> (restart ${st.restartAttempt})</span>` : '';
    const cpuVal = stats.cpu !== undefined ? stats.cpu.toFixed(1) + '%' : '—';
    const memVal = stats.mem !== undefined ? formatMem(stats.mem) : '—';
    const uptimeVal = formatUptime(st.uptime);
    const pidVal = st.pid ? `PID ${st.pid}` : '—';

    const isRunning = st.status === 'online' || st.status === 'starting';
    const isStopped = st.status === 'stopped' || st.status === 'offline';
    const isCrashed = st.status === 'crashed';

    div.innerHTML = `
      <div class="card-header">
        <div class="card-name-row">
          ${pinned}
          <span class="card-name" title="${proc.name}">${proc.name}</span>
          <span class="type-badge ${getTypeClass(proc.type)}">${getTypeLabel(proc.type)}</span>
          ${crashes}
        </div>
        <div class="status-badge status-${st.status}">
          <span class="status-indicator"></span>
          <span>${getStatusLabel(st.status)}${restartInfo}</span>
          ${playerBadge}
        </div>
        ${tunnelBadge}
      </div>
      <div class="card-stats">
        <div class="stat-item">
          <span class="stat-label">Uptime</span>
          <span class="stat-value uptime-val">${uptimeVal}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">PID</span>
          <span class="stat-value">${pidVal}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">CPU</span>
          <span class="stat-value cpu-val">${cpuVal}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">RAM</span>
          <span class="stat-value mem-val">${memVal}</span>
        </div>
      </div>
      <div class="sparkline-container">
        <canvas class="sparkline-canvas" id="spark-${proc.id}"></canvas>
      </div>
      <div class="card-actions">
        <button class="btn btn-success btn-sm" data-action="start" ${isRunning ? 'disabled' : ''}>▶ Start</button>
        <button class="btn btn-danger btn-sm" data-action="stop" ${isStopped ? 'disabled' : ''}>■ Stop</button>
        <button class="btn btn-warning btn-sm" data-action="restart">↺</button>
        <button class="btn btn-ghost btn-sm btn-icon-only" data-action="logs" title="Logs">📋</button>
        ${isCrashed ? `<button class="btn btn-ai btn-sm btn-icon-only" data-action="ai-analyze" title="AI Analyze">✦</button>` : ''}
        <button class="btn btn-ghost btn-sm btn-icon-only" data-action="edit" title="Edit">✏</button>
      </div>
    `;

    // Bind card buttons
    div.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        if (action === 'start') api.startProcess(proc.id);
        else if (action === 'stop') api.stopProcess(proc.id);
        else if (action === 'restart') api.restartProcess(proc.id);
        else if (action === 'logs') { switchTab('logs'); LogsModule.selectProcess(proc.id); }
        else if (action === 'ai-analyze') {
          switchTab('logs');
          LogsModule.selectProcess(proc.id);
          setTimeout(() => LogsModule.triggerAiAnalysis(proc.id), 300);
        }
        else if (action === 'edit') { switchTab('add-edit'); AddEditModule.editProcess(proc.id); }
      });
    });

    // Draw sparkline after DOM update
    requestAnimationFrame(() => {
      const canvas = div.querySelector(`#spark-${proc.id}`);
      if (canvas) {
        const cpuData = spark.map(s => s.cpu);
        renderSparkline(canvas, cpuData, '#5865F2');
      }
    });
  }

  function renderGrid() {
    const config = AppState.config;
    if (!config) return;

    const grid = document.getElementById('process-grid');
    const empty = document.getElementById('dashboard-empty');

    if (!config.processes || config.processes.length === 0) {
      grid.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }

    empty.classList.add('hidden');

    // Sort: pinned first
    const sorted = [...config.processes].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return a.name.localeCompare(b.name);
    });

    // Rebuild or update cards
    const existing = new Set([...grid.querySelectorAll('.process-card')].map(c => c.dataset.id));
    const needed = new Set(sorted.map(p => p.id));

    // Remove stale cards
    [...grid.querySelectorAll('.process-card')].forEach(card => {
      if (!needed.has(card.dataset.id)) card.remove();
    });

    sorted.forEach(proc => {
      const status = AppState.statuses[proc.id];
      let card = grid.querySelector(`[data-id="${proc.id}"]`);
      if (!card) {
        card = createCard(proc, status);
        grid.appendChild(card);
      } else {
        updateCard(card, proc, status);
      }
    });
  }

  // Uptime tick every second
  let uptimeTick = null;

  function startUptimeTick() {
    if (uptimeTick) return;
    uptimeTick = setInterval(() => {
      if (AppState.currentTab !== 'dashboard') return;
      document.querySelectorAll('.process-card').forEach(card => {
        const id = card.dataset.id;
        const st = AppState.statuses[id];
        if (!st) return;
        const uptime = st.startedAt ? Date.now() - new Date(st.startedAt).getTime() : 0;
        const el = card.querySelector('.uptime-val');
        if (el) el.textContent = formatUptime(uptime);
      });
    }, 1000);
  }

  function init() {
    // Global buttons
    document.getElementById('btn-start-all').addEventListener('click', () => api.startAll());
    document.getElementById('btn-stop-all').addEventListener('click', () => api.stopAll());
    document.getElementById('btn-add-new').addEventListener('click', () => {
      switchTab('add-edit');
      AddEditModule.newProcess();
    });
    document.getElementById('btn-empty-add').addEventListener('click', () => {
      switchTab('add-edit');
      AddEditModule.newProcess();
    });

    renderGrid();
    startUptimeTick();
  }

  function onTabActivated() { renderGrid(); }

  function onStatusChange(id, status) {
    AppState.statuses[id] = status;
    const config = AppState.config;
    if (!config) return;
    const proc = config.processes.find(p => p.id === id);
    if (!proc) return;
    const card = document.getElementById('process-grid')?.querySelector(`[data-id="${id}"]`);
    if (card) updateCard(card, proc, status);
  }

  function onStats(id, stat) {
    // Update sparkline buffer
    if (!sparklineData[id]) sparklineData[id] = [];
    sparklineData[id].push(stat);
    if (sparklineData[id].length > MAX_SPARK) sparklineData[id].shift();

    // Update card stats in-place (fast path)
    const card = document.getElementById('process-grid')?.querySelector(`[data-id="${id}"]`);
    if (!card) return;
    const cpuEl = card.querySelector('.cpu-val');
    const memEl = card.querySelector('.mem-val');
    if (cpuEl) cpuEl.textContent = stat.cpu.toFixed(1) + '%';
    if (memEl) memEl.textContent = formatMem(stat.mem);

    // Redraw sparkline
    const canvas = card.querySelector(`#spark-${id}`);
    if (canvas) {
      const cpuData = sparklineData[id].map(s => s.cpu);
      renderSparkline(canvas, cpuData, '#5865F2');
    }
  }

  function onPlayerCount(id, count) {
    const card = document.getElementById('process-grid')?.querySelector(`[data-id="${id}"]`);
    if (!card) return;
    let badge = card.querySelector('.player-count');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'player-count';
      card.querySelector('.status-badge').appendChild(badge);
    }
    badge.textContent = `👥 ${count}`;
  }

  function onLogLine(id, entry) { /* could highlight cards */ }

  function onPlayitStatus(data) {
    // data = { id, status, tunnelUrl, claimUrl }
    if (!data || !data.id) return;
    playitStatus[data.id] = { status: data.status, tunnelUrl: data.tunnelUrl, claimUrl: data.claimUrl };
    const config = AppState.config;
    if (!config) return;
    const proc = config.processes.find(p => p.id === data.id);
    if (!proc) return;
    const card = document.getElementById('process-grid')?.querySelector(`[data-id="${data.id}"]`);
    if (card) updateCard(card, proc, AppState.statuses[data.id]);
  }

  function onPlayitUpdate(id, data) {
    onPlayitStatus({ id, ...data });
  }

  function refreshConfig(config) {
    AppState.config = config;
    renderGrid();
  }

  return { init, onTabActivated, onStatusChange, onStats, onPlayerCount, onLogLine, renderGrid, refreshConfig, onPlayitStatus, onPlayitUpdate };
})();
