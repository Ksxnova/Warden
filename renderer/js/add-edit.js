// ── Add/Edit Module ──────────────────────────────────────────────────────────
window.AddEditModule = (() => {
  let editingId = null;

  function getSelectedDays() {
    return [...document.querySelectorAll('.day-btn.selected')].map(b => parseInt(b.dataset.day, 10));
  }

  function setSelectedDays(days) {
    document.querySelectorAll('.day-btn').forEach(b => {
      b.classList.toggle('selected', days.includes(parseInt(b.dataset.day, 10)));
    });
  }

  function getEnvVars() {
    const rows = document.querySelectorAll('#env-tbody tr');
    const env = {};
    rows.forEach(row => {
      const [keyEl, valEl] = row.querySelectorAll('input');
      const k = keyEl.value.trim();
      const v = valEl.value;
      if (k) env[k] = v;
    });
    return env;
  }

  function addEnvRow(key = '', val = '') {
    const tbody = document.getElementById('env-tbody');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="text" placeholder="KEY" value="${escHtml(key)}" /></td>
      <td><input type="text" placeholder="value" value="${escHtml(val)}" /></td>
      <td><button type="button" class="env-remove-btn" title="Remove">✕</button></td>
    `;
    tr.querySelector('.env-remove-btn').addEventListener('click', () => tr.remove());
    tbody.appendChild(tr);
  }

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function resetForm() {
    editingId = null;
    document.getElementById('form-id').value = '';
    document.getElementById('form-title').textContent = 'Add Process';
    document.getElementById('form-edit-actions').style.display = 'none';
    document.getElementById('process-form').reset();
    document.getElementById('env-tbody').innerHTML = '';

    // Defaults
    document.getElementById('form-auto-restart').checked = true;
    document.getElementById('form-max-restarts').value = 5;
    document.getElementById('form-restart-delay').value = 3;
    document.getElementById('form-backoff').value = 1.5;
    document.getElementById('form-schedule-enabled').checked = false;
    document.getElementById('schedule-options').classList.add('hidden');
    document.getElementById('form-rcon-enabled').checked = false;
    document.getElementById('rcon-options').classList.add('hidden');
    document.getElementById('rcon-section').classList.add('hidden');
    document.getElementById('form-playit-enabled').checked = false;
    document.getElementById('playit-options').classList.add('hidden');
    document.getElementById('playit-section').classList.add('hidden');
    document.getElementById('playit-download-status').textContent = '';
    setSelectedDays([1, 2, 3, 4, 5]);
    updateTypeSpecific();
  }

  function updateTypeSpecific() {
    const type = document.getElementById('form-type').value;
    const isMinecraft = type === 'minecraft-server';
    document.getElementById('rcon-section').classList.toggle('hidden', !isMinecraft);
    document.getElementById('playit-section').classList.toggle('hidden', !isMinecraft);
  }

  function populateForm(proc) {
    editingId = proc.id;
    document.getElementById('form-id').value = proc.id;
    document.getElementById('form-title').textContent = `Edit: ${proc.name}`;
    document.getElementById('form-edit-actions').style.display = 'flex';

    document.getElementById('form-name').value = proc.name || '';
    document.getElementById('form-type').value = proc.type || 'discord-bot';
    document.getElementById('form-directory').value = proc.directory || '';
    document.getElementById('form-command').value = proc.command || '';
    document.getElementById('form-args').value = (proc.args || []).join(' ');
    document.getElementById('form-notes').value = proc.notes || '';
    document.getElementById('form-pinned').checked = !!proc.pinned;

    // Env
    document.getElementById('env-tbody').innerHTML = '';
    Object.entries(proc.env || {}).forEach(([k, v]) => addEnvRow(k, v));

    // Auto-restart
    document.getElementById('form-auto-restart').checked = proc.autoRestart !== false;
    document.getElementById('form-max-restarts').value = proc.maxRestarts || 5;
    document.getElementById('form-restart-delay').value = proc.restartDelaySeconds || 3;
    document.getElementById('form-backoff').value = proc.restartBackoffMultiplier || 1.5;

    // Schedule
    const sched = proc.schedule || {};
    document.getElementById('form-schedule-enabled').checked = !!sched.enabled;
    if (sched.enabled) document.getElementById('schedule-options').classList.remove('hidden');
    document.getElementById('form-start-time').value = sched.startTime || '08:00';
    document.getElementById('form-stop-time').value = sched.stopTime || '23:00';
    setSelectedDays(sched.days || [1, 2, 3, 4, 5]);

    // RCON
    const rcon = proc.rcon || {};
    document.getElementById('form-rcon-enabled').checked = !!rcon.enabled;
    if (rcon.enabled) document.getElementById('rcon-options').classList.remove('hidden');
    document.getElementById('form-rcon-host').value = rcon.host || '127.0.0.1';
    document.getElementById('form-rcon-port').value = rcon.port || 25575;
    document.getElementById('form-rcon-password').value = rcon.password || '';

    // playit.gg
    const playit = proc.playit || {};
    document.getElementById('form-playit-enabled').checked = !!playit.enabled;
    if (playit.enabled) document.getElementById('playit-options').classList.remove('hidden');
    document.getElementById('form-playit-path').value = playit.executablePath || '';

    updateTypeSpecific();
  }

  function collectForm() {
    const name = document.getElementById('form-name').value.trim();
    if (!name) { showToast('Name is required', 'warning'); return null; }

    const command = document.getElementById('form-command').value.trim();
    if (!command) { showToast('Command is required', 'warning'); return null; }

    const argsRaw = document.getElementById('form-args').value.trim();
    const args = argsRaw ? argsRaw.split(/\s+/) : [];

    return {
      id: document.getElementById('form-id').value || undefined,
      name,
      type: document.getElementById('form-type').value,
      directory: document.getElementById('form-directory').value.trim(),
      command,
      args,
      env: getEnvVars(),
      notes: document.getElementById('form-notes').value.trim(),
      pinned: document.getElementById('form-pinned').checked,
      autoRestart: document.getElementById('form-auto-restart').checked,
      maxRestarts: parseInt(document.getElementById('form-max-restarts').value, 10) || 5,
      restartDelaySeconds: parseInt(document.getElementById('form-restart-delay').value, 10) || 3,
      restartBackoffMultiplier: parseFloat(document.getElementById('form-backoff').value) || 1.5,
      schedule: {
        enabled: document.getElementById('form-schedule-enabled').checked,
        startTime: document.getElementById('form-start-time').value,
        stopTime: document.getElementById('form-stop-time').value,
        days: getSelectedDays()
      },
      rcon: {
        enabled: document.getElementById('form-rcon-enabled').checked,
        host: document.getElementById('form-rcon-host').value,
        port: parseInt(document.getElementById('form-rcon-port').value, 10) || 25575,
        password: document.getElementById('form-rcon-password').value
      },
      playit: {
        enabled: document.getElementById('form-playit-enabled').checked,
        executablePath: document.getElementById('form-playit-path').value.trim()
      }
    };
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const data = collectForm();
    if (!data) return;

    let result;
    if (editingId) {
      data.id = editingId;
      result = await api.updateProcess(data);
      showToast(`${data.name} updated`, 'success');
    } else {
      result = await api.addProcess(data);
      showToast(`${data.name} added`, 'success');
    }

    // Refresh config
    AppState.config = await api.getConfig();
    DashboardModule.refreshConfig(AppState.config);
    LogsModule.onTabActivated();
    StatsModule.onTabActivated();

    switchTab('dashboard');
    resetForm();
  }

  function newProcess() {
    resetForm();
    document.getElementById('form-title').textContent = 'Add Process';
  }

  function editProcess(id) {
    const proc = AppState.config && AppState.config.processes.find(p => p.id === id);
    if (!proc) return;
    populateForm(proc);
  }

  // ── AI Setup Helper ──────────────────────────────────────────────────
  let aiBuffer = '';
  let aiActive = false;
  let pendingSuggestion = null;

  function onAiStart(data) {
    if (data.type !== 'setup') return;
    aiActive = true; aiBuffer = '';
    const panel = document.getElementById('ai-setup-panel');
    const output = document.getElementById('ai-setup-output');
    panel.classList.remove('hidden');
    output.innerHTML = '<div class="ai-loading" style="font-size:12px;">Scanning directory <div class="ai-dots"><span></span><span></span><span></span></div></div>';
  }

  function onAiChunk(data) {
    if (!aiActive) return;
    aiBuffer += data.text;
    // Don't show raw JSON; just show a loading indicator
  }

  function onAiDone(data) {
    if (!aiActive) return;
    aiActive = false;
    const output = document.getElementById('ai-setup-output');
    if (!output) return;

    if (data.suggestion) {
      pendingSuggestion = data.suggestion;
      const s = data.suggestion;
      const envList = Object.entries(s.env || {}).map(([k,v]) => `<code>${k}</code> = ${v}`).join(', ') || 'none';
      output.innerHTML = `
        <strong style="color:var(--text-primary)">Detected: ${escHtml(s.name || 'Unknown')}</strong><br/>
        <span style="color:var(--text-muted);font-size:11px;">Type: ${escHtml(s.type)} · Command: <code>${escHtml(s.command)} ${(s.args||[]).join(' ')}</code></span><br/>
        <span style="color:var(--text-muted);font-size:11px;">Env vars: ${envList}</span>
        ${s.notes ? `<br/><span style="font-size:11px;color:var(--text-secondary)">${escHtml(s.notes)}</span>` : ''}
        <br/><button class="btn btn-ai btn-sm" id="btn-apply-suggestion" style="margin-top:7px;">✓ Apply Suggestion</button>
      `;
      document.getElementById('btn-apply-suggestion').addEventListener('click', applySuggestion);
    } else {
      output.innerHTML = '<span style="color:var(--text-muted);font-size:12px;">Could not detect setup automatically. Fill in the fields manually.</span>';
    }
  }

  function onAiError(data) {
    aiActive = false;
    const output = document.getElementById('ai-setup-output');
    if (output) output.innerHTML = `<span style="color:var(--status-crashed);font-size:12px;">AI error: ${escHtml(data.message)}</span>`;
  }

  function applySuggestion() {
    if (!pendingSuggestion) return;
    const s = pendingSuggestion;
    if (s.name) document.getElementById('form-name').value = s.name;
    if (s.type) document.getElementById('form-type').value = s.type;
    if (s.command) document.getElementById('form-command').value = s.command;
    if (s.args) document.getElementById('form-args').value = (s.args || []).join(' ');
    if (s.env && Object.keys(s.env).length) {
      document.getElementById('env-tbody').innerHTML = '';
      Object.entries(s.env).forEach(([k,v]) => addEnvRow(k, v));
    }
    if (s.notes) document.getElementById('form-notes').value = s.notes;
    if (s.rcon && s.rcon.enabled) {
      document.getElementById('form-rcon-enabled').checked = true;
      document.getElementById('rcon-options').classList.remove('hidden');
    }
    updateTypeSpecific();
    showToast('Suggestion applied — review and save', 'success');
    document.getElementById('ai-setup-panel').classList.add('hidden');
    pendingSuggestion = null;
  }

  function init() {
    document.getElementById('process-form').addEventListener('submit', handleSubmit);

    document.getElementById('btn-cancel-form').addEventListener('click', () => {
      resetForm();
      switchTab('dashboard');
    });

    document.getElementById('btn-browse-dir').addEventListener('click', async () => {
      const dir = await api.openDirectory();
      if (dir) document.getElementById('form-directory').value = dir;
    });

    document.getElementById('btn-ai-setup').addEventListener('click', async () => {
      const dir = document.getElementById('form-directory').value.trim();
      if (!dir) {
        // Let them pick a directory first
        const picked = await api.openDirectory();
        if (!picked) return;
        document.getElementById('form-directory').value = picked;
        await api.aiSuggestSetup(picked);
      } else {
        await api.aiSuggestSetup(dir);
      }
    });

    document.getElementById('btn-add-env').addEventListener('click', () => addEnvRow());

    document.getElementById('form-type').addEventListener('change', updateTypeSpecific);

    // Auto-restart toggle
    document.getElementById('form-auto-restart').addEventListener('change', e => {
      document.getElementById('restart-options').style.opacity = e.target.checked ? '1' : '0.4';
    });

    // Schedule toggle
    document.getElementById('form-schedule-enabled').addEventListener('change', e => {
      document.getElementById('schedule-options').classList.toggle('hidden', !e.target.checked);
    });

    // RCON toggle
    document.getElementById('form-rcon-enabled').addEventListener('change', e => {
      document.getElementById('rcon-options').classList.toggle('hidden', !e.target.checked);
    });

    // playit.gg toggle
    document.getElementById('form-playit-enabled').addEventListener('change', e => {
      document.getElementById('playit-options').classList.toggle('hidden', !e.target.checked);
    });

    document.getElementById('btn-browse-playit').addEventListener('click', async () => {
      const file = await api.openFile([{ name: 'Executable', extensions: ['exe'] }]);
      if (file) document.getElementById('form-playit-path').value = file;
    });

    document.getElementById('btn-download-playit').addEventListener('click', async () => {
      const status = document.getElementById('playit-download-status');
      status.textContent = 'Downloading...';
      status.style.color = 'var(--text-muted)';
      const result = await api.playitDownload();
      if (result.ok) {
        status.textContent = `✓ Saved to ${result.path}`;
        status.style.color = 'var(--status-online)';
        document.getElementById('form-playit-path').value = result.path;
        showToast('playit.gg downloaded', 'success');
      } else {
        status.textContent = `✗ ${result.error}`;
        status.style.color = 'var(--status-crashed)';
        showToast('Download failed: ' + result.error, 'error');
      }
    });

    // playit status events
    api.onPlayitStatus && api.onPlayitStatus(data => {
      if (window.DashboardModule) DashboardModule.onPlayitStatus(data);
    });
    api.onPlayitUpdate && api.onPlayitUpdate((id, data) => {
      if (window.DashboardModule) DashboardModule.onPlayitUpdate(id, data);
    });

    // Day buttons
    document.getElementById('days-selector').addEventListener('click', e => {
      const btn = e.target.closest('.day-btn');
      if (btn) btn.classList.toggle('selected');
    });

    // Duplicate
    document.getElementById('btn-duplicate').addEventListener('click', async () => {
      if (!editingId) return;
      const copy = await api.duplicateProcess(editingId);
      if (copy) {
        AppState.config = await api.getConfig();
        DashboardModule.refreshConfig(AppState.config);
        populateForm(copy);
        showToast(`Duplicated as "${copy.name}"`, 'info');
      }
    });

    // Delete
    document.getElementById('btn-delete').addEventListener('click', async () => {
      if (!editingId) return;
      const proc = AppState.config.processes.find(p => p.id === editingId);
      const name = proc ? proc.name : editingId;
      if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
      await api.deleteProcess(editingId);
      AppState.config = await api.getConfig();
      DashboardModule.refreshConfig(AppState.config);
      LogsModule.onTabActivated();
      showToast(`${name} deleted`, 'info');
      resetForm();
      switchTab('dashboard');
    });
  }

  function onTabActivated() { /* nothing needed */ }

  return { init, onTabActivated, newProcess, editProcess, onAiStart, onAiChunk, onAiDone, onAiError };
})();
