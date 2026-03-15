// ── Settings Module ──────────────────────────────────────────────────────────
window.SettingsModule = (() => {
  function applyTheme(dark) {
    document.documentElement.setAttribute('data-theme', dark ? '' : 'light');
    if (dark) document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', 'light');
  }

  function applyAccentColor(color) {
    document.documentElement.style.setProperty('--accent', color);
  }

  function loadSettings() {
    const s = AppState.config && AppState.config.appSettings;
    if (!s) return;
    document.getElementById('setting-api-key').value = s.anthropicApiKey || '';
    document.getElementById('setting-groq-key').value = s.groqApiKey || '';
    document.getElementById('setting-openrouter-key').value = s.openrouterApiKey || '';
    document.getElementById('setting-ai-provider').value = s.aiProvider || 'groq';
    document.getElementById('setting-ai-model').value = s.aiModel || 'llama-3.3-70b-versatile';
    document.getElementById('setting-dark-theme').checked = s.theme !== 'light';
    document.getElementById('setting-accent-color').value = s.accentColor || '#5865F2';
    document.getElementById('setting-log-buffer').value = s.logBufferSize || 5000;
    document.getElementById('setting-log-retention').value = s.logRetentionDays || 7;
    document.getElementById('setting-start-with-windows').checked = !!s.startWithWindows;
    document.getElementById('setting-start-minimized').checked = !!s.startMinimized;
  }

  function init() {
    loadSettings();

    // Eye toggles for all password fields
    document.querySelectorAll('[data-toggle]').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.toggle);
        if (input) input.type = input.type === 'password' ? 'text' : 'password';
      });
    });
    // Legacy single eye toggle
    const legacyToggle = document.getElementById('btn-toggle-api-key');
    if (legacyToggle) {
      legacyToggle.addEventListener('click', () => {
        const input = document.getElementById('setting-api-key');
        if (input) input.type = input.type === 'password' ? 'text' : 'password';
      });
    }

    // Live theme preview
    document.getElementById('setting-dark-theme').addEventListener('change', e => {
      applyTheme(e.target.checked);
    });

    document.getElementById('setting-accent-color').addEventListener('input', e => {
      applyAccentColor(e.target.value);
    });

    document.getElementById('btn-save-settings').addEventListener('click', async () => {
      const darkTheme = document.getElementById('setting-dark-theme').checked;
      const accentColor = document.getElementById('setting-accent-color').value;
      const logBufferSize = parseInt(document.getElementById('setting-log-buffer').value, 10) || 5000;
      const logRetentionDays = parseInt(document.getElementById('setting-log-retention').value, 10) || 7;
      const startWithWindows = document.getElementById('setting-start-with-windows').checked;
      const startMinimized = document.getElementById('setting-start-minimized').checked;
      const anthropicApiKey = document.getElementById('setting-api-key').value.trim();
      const groqApiKey = document.getElementById('setting-groq-key').value.trim();
      const openrouterApiKey = document.getElementById('setting-openrouter-key').value.trim();
      const aiProvider = document.getElementById('setting-ai-provider').value;
      const aiModel = document.getElementById('setting-ai-model').value;

      const settings = {
        theme: darkTheme ? 'dark' : 'light',
        accentColor, logBufferSize, logRetentionDays, startWithWindows, startMinimized,
        anthropicApiKey, groqApiKey, openrouterApiKey, aiProvider, aiModel
      };

      await api.saveSettings(settings);
      await api.setStartWithWindows(startWithWindows);

      AppState.config = await api.getConfig();
      applyTheme(darkTheme);
      applyAccentColor(accentColor);
      showToast('Settings saved', 'success');
    });

    document.getElementById('btn-export-config').addEventListener('click', async () => {
      const p = await api.saveConfig();
      if (p) showToast('Config exported', 'success');
    });

    document.getElementById('btn-import-config').addEventListener('click', async () => {
      const config = await api.loadConfig();
      if (config) {
        AppState.config = config;
        DashboardModule.refreshConfig(config);
        LogsModule.onTabActivated();
        StatsModule.onTabActivated();
        loadSettings();
        showToast('Config imported', 'success');
      } else {
        showToast('Import cancelled', 'warning');
      }
    });
  }

  function onTabActivated() { loadSettings(); }

  return { init, onTabActivated };
})();
