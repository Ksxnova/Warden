// ── Global State ────────────────────────────────────────────────────────────
window.AppState = {
  config: null,
  statuses: {},      // id -> status object
  playerCounts: {},  // id -> number
  latestStats: {},   // id -> {cpu, mem}
  currentTab: 'dashboard'
};

// ── Tab Routing ─────────────────────────────────────────────────────────────
function switchTab(tabName) {
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-pane').forEach(el => {
    // The element id is "tab-{name}"
    el.classList.toggle('active', el.id === `tab-${tabName}`);
  });
  AppState.currentTab = tabName;

  // Notify modules
  if (tabName === 'logs' && window.LogsModule) LogsModule.onTabActivated();
  if (tabName === 'stats' && window.StatsModule) StatsModule.onTabActivated();
  if (tabName === 'add-edit' && window.AddEditModule) AddEditModule.onTabActivated();
  if (tabName === 'settings' && window.SettingsModule) SettingsModule.onTabActivated();
  if (tabName === 'dashboard' && window.DashboardModule) DashboardModule.onTabActivated();
}

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => switchTab(item.dataset.tab));
});

// ── Sidebar status counters ──────────────────────────────────────────────────
function updateSidebarStatus() {
  const statuses = Object.values(AppState.statuses);
  const online = statuses.filter(s => s.status === 'online').length;
  const total = AppState.config ? AppState.config.processes.length : 0;
  const hasCrash = statuses.some(s => s.status === 'crashed');

  document.getElementById('online-count').textContent = online;
  document.getElementById('sidebar-status-text').textContent = `${online}/${total} running`;

  const dot = document.getElementById('sidebar-status-dot');
  dot.style.background = hasCrash ? 'var(--status-crashed)' :
    (online === total && total > 0) ? 'var(--status-online)' :
    (online > 0) ? 'var(--status-starting)' : 'var(--status-offline)';
}

// ── Toast Notifications ──────────────────────────────────────────────────────
window.showToast = function(message, type = 'info', duration = 4000) {
  const icons = { success: '✓', warning: '⚠', error: '✕', info: 'ℹ' };
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ'}</span><span class="toast-text">${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 200);
  }, duration);
};

window.showToastWithAction = function(message, type = 'info', actionLabel, actionFn, duration = 6000) {
  const icons = { success: '✓', warning: '⚠', error: '✕', info: 'ℹ' };
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ'}</span><span class="toast-text">${message}</span>`;
  if (actionLabel && actionFn) {
    const btn = document.createElement('button');
    btn.className = 'toast-btn';
    btn.textContent = actionLabel;
    btn.addEventListener('click', () => { actionFn(); toast.remove(); });
    toast.appendChild(btn);
  }
  container.appendChild(toast);
  const timer = setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 200);
  }, duration);
};

// ── IPC Event Handlers ───────────────────────────────────────────────────────
api.onProcessStateChange((id, status) => {
  const prev = AppState.statuses[id];
  AppState.statuses[id] = status;
  updateSidebarStatus();

  if (window.DashboardModule) DashboardModule.onStatusChange(id, status);

  // Toast on crash — with AI analyze button
  if (status.status === 'crashed' && prev && prev.status !== 'crashed') {
    showToastWithAction(`${status.name} crashed`, 'error', '✦ Analyze', () => {
      switchTab('logs');
      LogsModule.selectProcess(id);
      LogsModule.triggerAiAnalysis(id);
    });
  }
  if (status.status === 'online' && prev && prev.status !== 'online') {
    showToast(`${status.name} started`, 'success', 3000);
  }
});

api.onLogLine((id, entry) => {
  if (window.LogsModule) LogsModule.onLogLine(id, entry);
  if (window.DashboardModule) DashboardModule.onLogLine(id, entry);
});

api.onStats((id, stat) => {
  AppState.latestStats[id] = stat;
  if (window.DashboardModule) DashboardModule.onStats(id, stat);
  if (window.StatsModule) StatsModule.onStats(id, stat);
});

api.onPlayerCount((id, count) => {
  AppState.playerCounts[id] = count;
  if (window.DashboardModule) DashboardModule.onPlayerCount(id, count);
});

// playit.gg events
if (api.onPlayitStatus) {
  api.onPlayitStatus((data) => {
    if (window.DashboardModule) DashboardModule.onPlayitStatus(data);
  });
}
if (api.onPlayitUpdate) {
  api.onPlayitUpdate((id, data) => {
    if (window.DashboardModule) DashboardModule.onPlayitUpdate(id, data);
  });
}

// AI events go to whichever module is active / listening
api.onAiStart((data) => {
  if (window.LogsModule) LogsModule.onAiStart(data);
  if (window.AddEditModule) AddEditModule.onAiStart(data);
});
api.onAiChunk((data) => {
  if (window.LogsModule) LogsModule.onAiChunk(data);
  if (window.AddEditModule) AddEditModule.onAiChunk(data);
});
api.onAiDone((data) => {
  if (window.LogsModule) LogsModule.onAiDone(data);
  if (window.AddEditModule) AddEditModule.onAiDone(data);
});
api.onAiError((data) => {
  if (window.LogsModule) LogsModule.onAiError(data);
  if (window.AddEditModule) AddEditModule.onAiError(data);
  showToast('AI error: ' + data.message, 'error', 6000);
});

// ── Keyboard Shortcuts ───────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.ctrlKey) {
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); switchTab('add-edit'); AddEditModule.newProcess(); }
    if (e.key === 'l' || e.key === 'L') { e.preventDefault(); switchTab('logs'); document.getElementById('log-search').focus(); }
    if (e.key === ',') { e.preventDefault(); switchTab('settings'); }
  }
});

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  AppState.config = await api.getConfig();

  // Seed initial statuses
  const statuses = await api.getAllStatuses();
  statuses.forEach(s => { AppState.statuses[s.id] = s; });
  updateSidebarStatus();

  // Apply saved theme
  if (AppState.config.appSettings.theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  }
  if (AppState.config.appSettings.accentColor) {
    document.documentElement.style.setProperty('--accent', AppState.config.appSettings.accentColor);
  }

  // Initialize modules
  if (window.DashboardModule) DashboardModule.init();
  if (window.LogsModule) LogsModule.init();
  if (window.StatsModule) StatsModule.init();
  if (window.AddEditModule) AddEditModule.init();
  if (window.SettingsModule) SettingsModule.init();
}

document.addEventListener('DOMContentLoaded', init);
