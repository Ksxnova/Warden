// ── Logs Module ──────────────────────────────────────────────────────────────
window.LogsModule = (() => {
  let selectedId = null;
  const cmdHistory = {};
  const cmdHistoryIdx = {};
  let aiActive = false; // is AI currently streaming?
  let aiTarget = null;  // 'logs' or 'setup'

  const logViewer = () => document.getElementById('log-viewer');
  const selectEl = () => document.getElementById('log-process-select');

  // ── Markdown Renderer ─────────────────────────────────────────────────
  function renderMarkdown(md) {
    const lines = md.split('\n');
    let html = '';
    let inCode = false;
    let codeBuf = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('```')) {
        if (!inCode) { inCode = true; codeBuf = []; continue; }
        else {
          html += `<pre class="md-pre">${escHtml(codeBuf.join('\n'))}</pre>`;
          inCode = false; codeBuf = []; continue;
        }
      }
      if (inCode) { codeBuf.push(line); continue; }

      if (line.startsWith('## ')) {
        html += `<div class="md-h2">${escHtml(line.slice(3))}</div>`;
      } else if (line.startsWith('# ')) {
        html += `<div class="md-h2">${escHtml(line.slice(2))}</div>`;
      } else if (line.match(/^[-*] /)) {
        html += `<div class="md-li">${inlineMarkdown(line.slice(2))}</div>`;
      } else if (line.match(/^\d+\. /)) {
        html += `<div class="md-li">${inlineMarkdown(line.replace(/^\d+\. /, ''))}</div>`;
      } else if (line.trim() === '') {
        html += '<br/>';
      } else {
        html += `<div class="md-p">${inlineMarkdown(line)}</div>`;
      }
    }
    if (inCode && codeBuf.length) {
      html += `<pre class="md-pre">${escHtml(codeBuf.join('\n'))}</pre>`;
    }
    return html;
  }

  function inlineMarkdown(text) {
    return escHtml(text)
      .replace(/`([^`]+)`/g, '<code class="md-code">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong class="md-strong">$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── ANSI Parser ───────────────────────────────────────────────────────
  const ANSI_MAP = {
    '30':'ansi-black','31':'ansi-red','32':'ansi-green','33':'ansi-yellow',
    '34':'ansi-blue','35':'ansi-magenta','36':'ansi-cyan','37':'ansi-white',
    '1':'ansi-bold','2':'ansi-dim'
  };

  function parseAnsi(text) {
    const esc = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    let result = ''; let spans = 0;
    const parts = esc.split(/\x1b\[([0-9;]*)m/);
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 0) { result += parts[i]; }
      else {
        const codes = parts[i].split(';');
        if (codes.includes('0') || parts[i] === '') {
          result += '</span>'.repeat(spans); spans = 0;
        } else {
          codes.forEach(c => {
            const cls = ANSI_MAP[c];
            if (cls) { result += `<span class="${cls}">`; spans++; }
          });
        }
      }
    }
    return result + '</span>'.repeat(spans);
  }

  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  }

  function getSearchTerm() { return document.getElementById('log-search').value.trim(); }
  function getLevelFilter() { return document.getElementById('log-level-filter').value; }
  function isRegexMode() { return document.getElementById('log-regex-mode').checked; }

  function matchesSearch(text, search) {
    if (!search) return true;
    if (isRegexMode()) { try { return new RegExp(search,'i').test(text); } catch { return false; } }
    return text.toLowerCase().includes(search.toLowerCase());
  }

  function highlightSearch(html, search) {
    if (!search) return html;
    try {
      const pat = isRegexMode() ? search : search.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      return html.replace(new RegExp(`(${pat})`,'gi'),'<mark class="log-highlight">$1</mark>');
    } catch { return html; }
  }

  function renderLine(entry) {
    const filter = getLevelFilter();
    if (filter !== 'all' && entry.stream !== filter) return null;
    const search = getSearchTerm();
    if (!matchesSearch(entry.text, search)) return null;
    let html = parseAnsi(entry.text);
    html = highlightSearch(html, search);
    const div = document.createElement('div');
    div.className = `log-line log-${entry.stream}`;
    div.innerHTML = `<span class="log-time">${formatTime(entry.t)}</span><span class="log-text">${html}</span>`;
    return div;
  }

  function renderAll(entries) {
    const viewer = logViewer();
    const empty = document.getElementById('log-empty');
    if (empty) empty.remove();
    viewer.innerHTML = '';
    const frag = document.createDocumentFragment();
    entries.forEach(e => { const el = renderLine(e); if (el) frag.appendChild(el); });
    viewer.appendChild(frag);
    scrollToBottom();
  }

  function scrollToBottom() {
    if (document.getElementById('log-auto-scroll').checked) {
      const viewer = logViewer();
      viewer.scrollTop = viewer.scrollHeight;
    }
  }

  function rebuildProcessSelect() {
    const select = selectEl();
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

  async function selectProcess(id) {
    selectedId = id;
    selectEl().value = id;
    const config = AppState.config;
    const proc = config && config.processes.find(p => p.id === id);
    document.getElementById('minecraft-commands').classList.toggle('hidden', !(proc && proc.type === 'minecraft-server'));
    const viewer = logViewer();
    viewer.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div><p>Loading...</p></div>';
    const entries = await api.getLogs(id);
    renderAll(entries);
  }

  function onLogLine(id, entry) {
    if (id !== selectedId) return;
    const filter = getLevelFilter();
    if (filter !== 'all' && entry.stream !== filter) return;
    if (!matchesSearch(entry.text, getSearchTerm())) return;
    const el = renderLine(entry);
    if (!el) return;
    const viewer = logViewer();
    viewer.appendChild(el);
    while (viewer.children.length > 2500) viewer.removeChild(viewer.firstChild);
    scrollToBottom();
  }

  // ── AI Panel ──────────────────────────────────────────────────────────
  let aiBuffer = '';
  let aiCursor = null;

  function showAiPanel(title) {
    const panel = document.getElementById('ai-panel');
    panel.classList.remove('hidden');
    document.getElementById('ai-panel-title-text').textContent = title;
    const output = document.getElementById('ai-output');
    output.innerHTML = '<div class="ai-loading">Analyzing <div class="ai-dots"><span></span><span></span><span></span></div></div>';
    aiBuffer = '';
    aiTarget = 'logs';
    // Shrink log viewer when panel open
    logViewer().style.flex = '1';
  }

  function onAiStart(data) {
    if (data.type === 'setup') return; // handled by add-edit module
    aiActive = true;
    aiBuffer = '';
    aiTarget = 'logs';
    const title = data.type === 'summary' ? '✦ AI Summary' : '✦ AI Crash Analysis';
    showAiPanel(title);
  }

  function onAiChunk(data) {
    if (aiTarget !== 'logs') return;
    aiBuffer += data.text;
    const output = document.getElementById('ai-output');
    if (!output) return;
    output.innerHTML = renderMarkdown(aiBuffer) + '<span class="ai-cursor"></span>';
    const panel = document.getElementById('ai-panel');
    if (panel) panel.scrollTop = panel.scrollHeight;
  }

  function onAiDone(data) {
    if (aiTarget !== 'logs') return;
    aiActive = false;
    const output = document.getElementById('ai-output');
    if (output) output.innerHTML = renderMarkdown(aiBuffer);
  }

  function onAiError(data) {
    if (aiTarget !== 'logs') return;
    aiActive = false;
    const output = document.getElementById('ai-output');
    if (output) output.innerHTML = `<span style="color:var(--status-crashed)">Error: ${escHtml(data.message)}</span>`;
  }

  async function triggerAiAnalysis(id) {
    const pid = id || selectedId;
    if (!pid) { showToast('Select a process first', 'warning'); return; }
    if (aiActive) return;
    await api.aiAnalyzeCrash(pid);
  }

  async function triggerAiSummary() {
    if (!selectedId) { showToast('Select a process first', 'warning'); return; }
    if (aiActive) return;
    aiTarget = 'logs';
    await api.aiSummarizeLogs(selectedId);
  }

  function sendCommand() {
    const input = document.getElementById('console-input');
    const text = input.value.trim();
    if (!text || !selectedId) return;
    if (!cmdHistory[selectedId]) cmdHistory[selectedId] = [];
    const hist = cmdHistory[selectedId];
    hist.push(text);
    if (hist.length > 100) hist.shift();
    cmdHistoryIdx[selectedId] = hist.length;
    api.sendInput(selectedId, text);
    input.value = '';
  }

  function init() {
    rebuildProcessSelect();

    selectEl().addEventListener('change', e => {
      if (e.target.value) selectProcess(e.target.value);
    });

    document.getElementById('log-search').addEventListener('input', () => {
      if (selectedId) selectProcess(selectedId);
    });
    document.getElementById('log-level-filter').addEventListener('change', () => {
      if (selectedId) selectProcess(selectedId);
    });
    document.getElementById('log-regex-mode').addEventListener('change', () => {
      if (selectedId) selectProcess(selectedId);
    });

    const consoleInput = document.getElementById('console-input');
    consoleInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { sendCommand(); return; }
      const hist = cmdHistory[selectedId] || [];
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!cmdHistoryIdx[selectedId]) cmdHistoryIdx[selectedId] = hist.length;
        if (cmdHistoryIdx[selectedId] > 0) {
          cmdHistoryIdx[selectedId]--;
          consoleInput.value = hist[cmdHistoryIdx[selectedId]] || '';
        }
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const idx = cmdHistoryIdx[selectedId];
        if (idx !== undefined && idx < hist.length - 1) {
          cmdHistoryIdx[selectedId]++;
          consoleInput.value = hist[cmdHistoryIdx[selectedId]] || '';
        } else {
          cmdHistoryIdx[selectedId] = hist.length;
          consoleInput.value = '';
        }
      }
    });

    document.getElementById('btn-send-cmd').addEventListener('click', sendCommand);

    document.getElementById('minecraft-commands').addEventListener('click', e => {
      const btn = e.target.closest('[data-mc-cmd]');
      if (!btn) return;
      const cmd = btn.dataset.mcCmd;
      consoleInput.value = cmd;
      consoleInput.focus();
      if (!cmd.endsWith(' ')) sendCommand();
    });

    document.getElementById('btn-export-log').addEventListener('click', async () => {
      if (!selectedId) { showToast('Select a process first', 'warning'); return; }
      const path = await api.exportLogs(selectedId);
      if (path) showToast(`Log exported`, 'success');
    });

    document.getElementById('btn-clear-log').addEventListener('click', async () => {
      if (!selectedId) return;
      await api.clearLogs(selectedId);
      logViewer().innerHTML = '';
      document.getElementById('ai-panel').classList.add('hidden');
    });

    document.getElementById('btn-ai-analyze').addEventListener('click', () => triggerAiAnalysis());

    document.getElementById('btn-ai-summary').addEventListener('click', triggerAiSummary);

    document.getElementById('btn-ai-close').addEventListener('click', () => {
      document.getElementById('ai-panel').classList.add('hidden');
      aiBuffer = '';
      aiActive = false;
    });
  }

  function onTabActivated() { rebuildProcessSelect(); }

  return { init, onTabActivated, onLogLine, selectProcess, triggerAiAnalysis,
    onAiStart, onAiChunk, onAiDone, onAiError };
})();
