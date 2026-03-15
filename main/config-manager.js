const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const LOGS_DIR = path.join(DATA_DIR, 'logs');
const STATS_DIR = path.join(DATA_DIR, 'stats');

const DEFAULT_CONFIG = {
  appSettings: {
    theme: 'dark',
    accentColor: '#5865F2',
    logBufferSize: 5000,
    logRetentionDays: 7,
    startWithWindows: false,
    startMinimized: false,
    anthropicApiKey: '',
    groqApiKey: '',
    openrouterApiKey: '',
    aiProvider: 'groq',
    aiModel: 'llama-3.3-70b-versatile'
  },
  processes: []
};

function ensureDirs() {
  [DATA_DIR, LOGS_DIR, STATS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

function load() {
  ensureDirs();
  if (!fs.existsSync(CONFIG_PATH)) {
    save(DEFAULT_CONFIG);
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.error('Config load error:', e);
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
}

function save(config) {
  ensureDirs();
  const tmp = CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf8');
  fs.renameSync(tmp, CONFIG_PATH);
}

function getLogsDir() { return LOGS_DIR; }
function getStatsDir() { return STATS_DIR; }

module.exports = { load, save, getLogsDir, getStatsDir };
