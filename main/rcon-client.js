const net = require('net');

// Minecraft RCON protocol constants
const SERVERDATA_AUTH = 3;
const SERVERDATA_EXECCOMMAND = 2;
const SERVERDATA_RESPONSE_VALUE = 0;
const SERVERDATA_AUTH_RESPONSE = 2;

let requestId = 1;
function nextId() { return requestId++ & 0x7FFFFFFF; }

function buildPacket(id, type, body) {
  const bodyBuf = Buffer.from(body, 'utf8');
  const size = 4 + 4 + bodyBuf.length + 2; // id + type + body + 2 null terminators
  const buf = Buffer.alloc(4 + size);
  let offset = 0;
  buf.writeInt32LE(size, offset); offset += 4;
  buf.writeInt32LE(id, offset); offset += 4;
  buf.writeInt32LE(type, offset); offset += 4;
  bodyBuf.copy(buf, offset); offset += bodyBuf.length;
  buf.writeUInt8(0, offset++);
  buf.writeUInt8(0, offset++);
  return buf;
}

function parsePacket(buf) {
  if (buf.length < 14) return null;
  const size = buf.readInt32LE(0);
  if (buf.length < 4 + size) return null;
  const id = buf.readInt32LE(4);
  const type = buf.readInt32LE(8);
  const body = buf.slice(12, 4 + size - 2).toString('utf8');
  return { size, id, type, body, totalLength: 4 + size };
}

class RconClient {
  constructor(host, port, password) {
    this.host = host;
    this.port = port;
    this.password = password;
    this.socket = null;
    this.connected = false;
    this.authenticated = false;
    this.pending = new Map(); // id -> {resolve, reject}
    this.recvBuf = Buffer.alloc(0);
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket = new net.Socket();
      this.socket.setTimeout(10000);
      this.socket.on('data', data => this._onData(data));
      this.socket.on('close', () => {
        this.connected = false;
        this.authenticated = false;
        this.pending.forEach(p => p.reject(new Error('Connection closed')));
        this.pending.clear();
      });
      this.socket.on('error', err => {
        this.connected = false;
        this.authenticated = false;
        reject(err);
      });
      this.socket.on('timeout', () => {
        this.socket.destroy();
        reject(new Error('RCON connection timeout'));
      });
      this.socket.connect(this.port, this.host, () => {
        this.connected = true;
        // Authenticate
        const authId = nextId();
        this.pending.set(authId, {
          resolve: result => {
            if (result.id === -1) {
              reject(new Error('RCON auth failed — wrong password'));
            } else {
              this.authenticated = true;
              resolve();
            }
          },
          reject
        });
        this.socket.write(buildPacket(authId, SERVERDATA_AUTH, this.password));
      });
    });
  }

  _onData(data) {
    this.recvBuf = Buffer.concat([this.recvBuf, data]);
    while (true) {
      const packet = parsePacket(this.recvBuf);
      if (!packet) break;
      this.recvBuf = this.recvBuf.slice(packet.totalLength);
      const pending = this.pending.get(packet.id);
      if (pending) {
        this.pending.delete(packet.id);
        pending.resolve(packet);
      }
    }
  }

  send(command) {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.authenticated) {
        return reject(new Error('Not connected/authenticated'));
      }
      const id = nextId();
      this.pending.set(id, { resolve: p => resolve(p.body), reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('RCON command timeout'));
        }
      }, 5000);
      this.socket.write(buildPacket(id, SERVERDATA_EXECCOMMAND, command));
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
    this.authenticated = false;
  }
}

// Active RCON connections per process id
const connections = {};
// Player counts: id -> number
const playerCounts = {};
let pollTimer = null;
let pushCallback = null;
let _processManager = null;

function init(processManager, onPlayerCount) {
  _processManager = processManager;
  pushCallback = onPlayerCount;
}

async function pollPlayerCount(id, rconConfig) {
  let client = connections[id];
  if (!client) {
    client = new RconClient(rconConfig.host, rconConfig.port, rconConfig.password);
    connections[id] = client;
    try { await client.connect(); } catch (e) {
      delete connections[id];
      return;
    }
  }
  try {
    const response = await client.send('list');
    // "There are X of a max of Y players online: ..."
    const match = response.match(/There are (\d+)/);
    if (match) {
      const count = parseInt(match[1], 10);
      playerCounts[id] = count;
      if (pushCallback) pushCallback(id, count);
    }
  } catch (e) {
    client.disconnect();
    delete connections[id];
  }
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    if (!_processManager) return;
    const config = _processManager.getConfig();
    if (!config) return;
    config.processes.forEach(p => {
      if (p.type === 'minecraft-server' && p.rcon && p.rcon.enabled) {
        const rt = _processManager.getRuntime(p.id);
        if (rt && rt.status === 'online') {
          pollPlayerCount(p.id, p.rcon).catch(() => {});
        }
      }
    });
  }, 30000);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  Object.values(connections).forEach(c => c.disconnect());
}

function getPlayerCount(id) {
  return playerCounts[id] || 0;
}

function sendCommand(id, command) {
  const client = connections[id];
  if (client) return client.send(command);
  return Promise.reject(new Error('No RCON connection for ' + id));
}

module.exports = { init, startPolling, stopPolling, getPlayerCount, sendCommand, RconClient };
