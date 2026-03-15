// ── Stats Module ─────────────────────────────────────────────────────────────
window.StatsModule = (() => {
  let selectedId = null;
  let rangeMs = 3600000; // 1h default

  // Local cache of stats for selected process (populated on tab activate)
  let statsCache = [];

  function formatUptime(ms) {
    if (!ms) return '—';
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    if (d > 0) return `${d}d ${h % 24}h ${m % 60}m`;
    if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
    if (m > 0) return `${m}m ${s % 60}s`;
    return `${s}s`;
  }

  function avg(arr) {
    if (!arr.length) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  function max(arr) {
    if (!arr.length) return 0;
    return Math.max(...arr);
  }

  // ── Canvas Chart ───────────────────────────────────────────────────────
  function drawChart(canvasId, data, color, unit, yMin = 0) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const container = canvas.parentElement;
    const W = container.clientWidth - 32;
    const H = 160;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    if (!data || data.length < 2) {
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No data in range', W / 2, H / 2);
      return;
    }

    const padLeft = 44;
    const padRight = 10;
    const padTop = 10;
    const padBottom = 24;
    const chartW = W - padLeft - padRight;
    const chartH = H - padTop - padBottom;

    const values = data.map(d => d.value);
    const maxVal = Math.max(max(values), 0.01);
    const minVal = yMin;

    function xPos(i) { return padLeft + (i / (data.length - 1)) * chartW; }
    function yPos(v) { return padTop + chartH - ((v - minVal) / (maxVal - minVal)) * chartH; }

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padTop + (i / 4) * chartH;
      ctx.beginPath(); ctx.moveTo(padLeft, y); ctx.lineTo(padLeft + chartW, y); ctx.stroke();
      const label = ((maxVal - minVal) * (1 - i / 4) + minVal).toFixed(maxVal < 10 ? 1 : 0) + unit;
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(label, padLeft - 4, y + 4);
    }

    // X labels (time)
    const labelCount = Math.min(6, data.length);
    for (let i = 0; i < labelCount; i++) {
      const idx = Math.floor(i * (data.length - 1) / (labelCount - 1));
      const x = xPos(idx);
      const d = new Date(data[idx].t);
      const label = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, x, H - 6);
    }

    // Line
    ctx.beginPath();
    ctx.moveTo(xPos(0), yPos(data[0].value));
    data.slice(1).forEach((d, i) => ctx.lineTo(xPos(i + 1), yPos(d.value)));
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Fill
    ctx.lineTo(xPos(data.length - 1), padTop + chartH);
    ctx.lineTo(xPos(0), padTop + chartH);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, padTop, 0, padTop + chartH);
    grad.addColorStop(0, color + '50');
    grad.addColorStop(1, color + '05');
    ctx.fillStyle = grad;
    ctx.fill();
  }

  async function loadAndRender() {
    if (!selectedId) return;
    statsCache = await api.getStats(selectedId, rangeMs);
    renderCharts();
    renderSummary();
  }

  function renderCharts() {
    if (!statsCache) return;
    const cpuData = statsCache.map(s => ({ t: s.t, value: s.cpu }));
    const memData = statsCache.map(s => ({ t: s.t, value: s.mem }));
    drawChart('chart-cpu', cpuData, '#5865F2', '%');
    drawChart('chart-mem', memData, '#57f287', ' MB');
  }

  function renderSummary() {
    const status = selectedId ? AppState.statuses[selectedId] : null;
    const rt = status || {};

    // Uptime
    const uptimeEl = document.getElementById('stat-uptime');
    const uptimeSince = document.getElementById('stat-uptime-since');
    if (rt.startedAt) {
      uptimeEl.textContent = formatUptime(rt.uptime || 0);
      uptimeSince.textContent = `Since ${new Date(rt.startedAt).toLocaleString()}`;
    } else {
      uptimeEl.textContent = '—';
      uptimeSince.textContent = 'Not running';
    }

    // CPU/Mem from stats cache
    const cpus = statsCache.map(s => s.cpu).filter(v => v !== undefined);
    const mems = statsCache.map(s => s.mem).filter(v => v !== undefined);
    document.getElementById('stat-cpu').textContent = cpus.length ? avg(cpus).toFixed(1) + '%' : '—';
    document.getElementById('stat-mem').textContent = mems.length ? max(mems).toFixed(0) + ' MB' : '—';

    // Crashes
    document.getElementById('stat-crashes').textContent = rt.totalCrashes !== undefined ? rt.totalCrashes : '—';
    document.getElementById('stat-last-crash').textContent = rt.totalCrashes > 0 ? 'Last: N/A' : 'No crashes';
  }

  function rebuildSelect() {
    const select = document.getElementById('stats-process-select');
    const prev = select.value;
    select.innerHTML = '<option value="">— Select Process —</option>';
    const config = AppState.config;
    if (config && config.processes) {
      config.processes.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        select.appendChild(opt);
      });
    }
    if (prev) select.value = prev;
  }

  function init() {
    rebuildSelect();

    document.getElementById('stats-process-select').addEventListener('change', e => {
      selectedId = e.target.value || null;
      statsCache = [];
      loadAndRender();

      // Show player chart for Minecraft
      const config = AppState.config;
      const proc = config && config.processes.find(p => p.id === selectedId);
      const playerContainer = document.getElementById('chart-players-container');
      if (proc && proc.type === 'minecraft-server') {
        playerContainer.style.display = '';
      } else {
        playerContainer.style.display = 'none';
      }
    });

    // Time range buttons
    document.querySelectorAll('.time-range-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.time-range-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        rangeMs = parseInt(btn.dataset.range, 10);
        loadAndRender();
      });
    });
  }

  function onTabActivated() {
    rebuildSelect();
    if (selectedId) loadAndRender();
  }

  function onStats(id, stat) {
    if (id !== selectedId) return;
    // Append to cache
    statsCache.push(stat);
    const cutoff = Date.now() - rangeMs;
    statsCache = statsCache.filter(s => s.t >= cutoff);
    if (AppState.currentTab === 'stats') {
      renderCharts();
      renderSummary();
    }
  }

  return { init, onTabActivated, onStats };
})();
