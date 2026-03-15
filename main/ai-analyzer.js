const Anthropic = require('@anthropic-ai/sdk');
const https = require('https');
const http = require('http');
const { URL } = require('url');

let _mainWindow = null;
let _getSettings = null;

function init(mainWindow, getSettings) {
  _mainWindow = mainWindow;
  _getSettings = getSettings;
}

function getSettings() {
  return _getSettings ? _getSettings() : {};
}

function push(event, data) {
  if (_mainWindow && !_mainWindow.isDestroyed()) {
    _mainWindow.webContents.send(event, data);
  }
}

// ── OpenAI-compatible streaming (Groq + OpenRouter) ──────────────────────────
function streamOpenAI(baseURL, apiKey, model, systemPrompt, userMsg, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMsg }
      ],
      stream: true,
      max_tokens: 2048,
      temperature: 0.3
    });

    const parsedURL = new URL(`${baseURL}/chat/completions`);
    const options = {
      hostname: parsedURL.hostname,
      port: parsedURL.port || (parsedURL.protocol === 'https:' ? 443 : 80),
      path: parsedURL.pathname + parsedURL.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body),
        ...extraHeaders
      }
    };

    const transport = parsedURL.protocol === 'https:' ? https : http;
    const req = transport.request(options, (res) => {
      if (res.statusCode !== 200) {
        let errData = '';
        res.on('data', d => errData += d);
        res.on('end', () => {
          try { const j = JSON.parse(errData); reject(new Error(j.error?.message || `HTTP ${res.statusCode}`)); }
          catch { reject(new Error(`HTTP ${res.statusCode}: ${errData.slice(0, 200)}`)); }
        });
        return;
      }

      let buffer = '';
      res.on('data', chunk => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete line
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) push('ai:chunk', { text: delta });
          } catch { /* malformed chunk */ }
        }
      });
      res.on('end', () => { push('ai:done', {}); resolve(); });
      res.on('error', reject);
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Anthropic streaming ───────────────────────────────────────────────────────
async function streamAnthropic(apiKey, systemPrompt, userMsg) {
  const client = new Anthropic.default({ apiKey });
  const stream = client.messages.stream({
    model: 'claude-opus-4-6',
    max_tokens: 2048,
    thinking: { type: 'adaptive' },
    system: systemPrompt,
    messages: [{ role: 'user', content: userMsg }]
  });
  stream.on('text', delta => push('ai:chunk', { text: delta }));
  await stream.finalMessage();
  push('ai:done', {});
}

// ── Unified dispatch ──────────────────────────────────────────────────────────
async function dispatchStream(systemPrompt, userMsg) {
  const s = getSettings();
  const provider = s.aiProvider || 'groq';
  const model = s.aiModel || 'llama-3.3-70b-versatile';

  if (provider === 'anthropic') {
    const key = s.anthropicApiKey;
    if (!key) throw new Error('Anthropic API key not set in Settings');
    await streamAnthropic(key, systemPrompt, userMsg);
  } else if (provider === 'groq') {
    const key = s.groqApiKey;
    if (!key) throw new Error('Groq API key not set in Settings');
    await streamOpenAI('https://api.groq.com/openai/v1', key, model, systemPrompt, userMsg);
  } else if (provider === 'openrouter') {
    const key = s.openrouterApiKey;
    if (!key) throw new Error('OpenRouter API key not set in Settings');
    await streamOpenAI(
      'https://openrouter.ai/api/v1', key, model, systemPrompt, userMsg,
      { 'HTTP-Referer': 'https://warden.app', 'X-Title': 'Warden' }
    );
  } else {
    throw new Error(`Unknown AI provider: ${provider}`);
  }
}

// ── Crash Analyzer ────────────────────────────────────────────────────────────
async function analyzeCrash(processConfig, logLines, crashInfo) {
  const logText = logLines
    .slice(-120)
    .map(e => `[${new Date(e.t).toISOString()}][${e.stream}] ${e.text}`)
    .join('\n');

  const systemPrompt = `You are an expert DevOps engineer. Analyze crash logs and give clear, actionable fixes.
Use these exact section headers (with ##):
## What Happened
## Root Cause
## How to Fix
## Prevention
Be specific, quote exact error messages, and give concrete commands when relevant. Keep it concise.`;

  const userMsg = `**Process:** ${processConfig.name} (${processConfig.type})
**Command:** ${processConfig.command} ${(processConfig.args || []).join(' ')}
**Directory:** ${processConfig.directory || '(none)'}
**Exit code:** ${crashInfo.code ?? 'unknown'}  **Crashes:** ${crashInfo.totalCrashes || 1}

**Last ${Math.min(logLines.length, 120)} log lines:**
\`\`\`
${logText || '(no logs)'}
\`\`\``;

  push('ai:start', { type: 'crash' });
  try {
    await dispatchStream(systemPrompt, userMsg);
  } catch (err) {
    push('ai:error', { message: err.message });
    throw err;
  }
}

// ── Setup Helper ──────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

async function suggestSetup(directory) {
  let dirInfo = '';
  try {
    const files = fs.readdirSync(directory).slice(0, 60);
    dirInfo = files.join('\n');
    const keyFiles = ['package.json', 'requirements.txt', 'Pipfile', 'pom.xml',
      'build.gradle', 'go.mod', 'Cargo.toml', 'server.properties', 'spigot.yml', 'paper.yml', 'config.yml'];
    for (const f of keyFiles) {
      const fp = path.join(directory, f);
      if (fs.existsSync(fp)) {
        try { dirInfo += `\n\n--- ${f} ---\n${fs.readFileSync(fp, 'utf8').slice(0, 1500)}`; } catch {}
      }
    }
  } catch (err) { dirInfo = `Error reading: ${err.message}`; }

  const systemPrompt = `You are an expert at configuring Discord bots, Minecraft servers, and other server processes.
Return ONLY a valid JSON object (no markdown fences, no explanation) with this exact schema:
{"type":"discord-bot"|"minecraft-server"|"custom","command":"string","args":["string"],"name":"string","env":{"KEY":"placeholder"},"notes":"string","rcon":{"enabled":boolean}}
For sensitive env values use descriptive placeholders like "YOUR_BOT_TOKEN_HERE".`;

  const userMsg = `Directory: ${directory}\n\nFiles:\n${dirInfo}\n\nSuggest the best configuration.`;

  push('ai:start', { type: 'setup' });
  let fullText = '';
  // Capture chunks for JSON parsing
  const origPush = push;
  const capturePush = (event, data) => {
    if (event === 'ai:chunk') fullText += data.text || '';
    push(event, data);
  };
  // Temporarily override push — just re-call the original
  try {
    // We'll collect chunks by listening to our own events via a local buffer
    // Simpler: run dispatch and collect
    const s = getSettings();
    const provider = s.aiProvider || 'groq';
    const model = s.aiModel || 'llama-3.3-70b-versatile';
    let collectedText = '';
    const origPushFn = _mainWindow.webContents.send.bind(_mainWindow.webContents);

    // Monkey-patch temporarily to also collect text
    _mainWindow.webContents.send = (event, ...args) => {
      if (event === 'ai:chunk' && args[0]?.text) collectedText += args[0].text;
      origPushFn(event, ...args);
    };

    await dispatchStream(systemPrompt, userMsg);

    _mainWindow.webContents.send = origPushFn;

    let suggestion = null;
    try {
      const jsonMatch = collectedText.match(/\{[\s\S]*\}/);
      if (jsonMatch) suggestion = JSON.parse(jsonMatch[0]);
    } catch { /* ignore */ }

    if (suggestion) push('ai:done', { suggestion });
    else push('ai:done', { suggestion: null });

  } catch (err) {
    push('ai:error', { message: err.message });
    throw err;
  }
}

// ── Log Summary ───────────────────────────────────────────────────────────────
async function summarizeLogs(processConfig, logLines) {
  const logText = logLines.slice(-80).map(e => `[${e.stream}] ${e.text}`).join('\n');

  const systemPrompt = 'You are a concise log analyst. Give a 2-3 sentence plain-English summary of what this process is doing or what went wrong. No headers, no lists — just a clear paragraph.';
  const userMsg = `Process: ${processConfig.name} (${processConfig.type})\n\nLogs:\n${logText}`;

  push('ai:start', { type: 'summary' });
  try {
    await dispatchStream(systemPrompt, userMsg);
  } catch (err) {
    push('ai:error', { message: err.message });
    throw err;
  }
}

module.exports = { init, analyzeCrash, suggestSetup, summarizeLogs };
