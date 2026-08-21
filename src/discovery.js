import dgram from 'node:dgram';
import net from 'node:net';
import { logger } from './logger.js';

const MNDP_PORT = 5678;
const QUERY = Buffer.concat([
  Buffer.from([0x01, 0x0f, 0x07]),
  Buffer.from('RouterOS', 'utf8'),
  Buffer.from([0x0e, 0x03, 0x00, 0x00, 0x00]),
]);

const TLV = {
  MAC: 0x02,
  PLATFORM: 0x03,
  HARDWARE: 0x04,
  UPTIME: 0x05,
  SOFTWARE_ID: 0x0a,
  VERSION: 0x0b,
  IP: 0x0c,
  IDENTITY: 0x0f,
};

export function parseMndp(buf) {
  const out = {};
  let i = 1;
  while (i + 2 <= buf.length) {
    const type = buf[i];
    const len = buf[i + 1];
    i += 2;
    if (i + len > buf.length) break;
    const data = buf.subarray(i, i + len);
    i += len;
    if (type === TLV.IDENTITY) out.identity = data.toString('utf8').replace(/[^\x20-\x7e]/g, '').trim();
    else if (type === TLV.VERSION) out.version = data.toString('utf8').trim();
    else if (type === TLV.PLATFORM) out.platform = data.toString('utf8').trim();
    else if (type === TLV.HARDWARE) out.hardware = data.toString('utf8').trim();
    else if (type === TLV.SOFTWARE_ID) out.softwareId = data.toString('utf8').trim();
    else if (type === TLV.UPTIME) out.uptime = data.toString('utf8').trim();
    else if (type === TLV.MAC && len === 6) {
      out.mac = [...data].map((b) => b.toString(16).padStart(2, '0')).join(':');
    } else if (type === TLV.IP && len === 4) {
      (out.ips ||= []).push(`${data[0]}.${data[1]}.${data[2]}.${data[3]}`);
    }
  }
  return out;
}

async function tcpOpen(host, port, timeoutMs = 700) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const fin = (ok) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => fin(true));
    sock.once('timeout', () => fin(false));
    sock.once('error', () => fin(false));
    sock.connect(port, host);
  });
}

async function probeApi(device) {
  const [plain, ssl] = await Promise.all([tcpOpen(device.ip, 8728), tcpOpen(device.ip, 8729)]);
  device.apiPort = plain ? 8728 : null;
  device.apiSsl = ssl;
  return device;
}

export async function scanMikrotik({ durationMs = 3500, probePorts = true } = {}) {
  const packets = [];
  return await new Promise((resolve) => {
    let socket;
    try {
      socket = dgram.createSocket('udp4');
    } catch (e) {
      logger.warn({ event: 'discover', operation: 'discovery', result: 'socket_failed', error: e.message });
      return resolve([]);
    }
    const cleanup = () => {
      try { socket.close(); } catch { /* already closed */ }
    };
    socket.on('message', (msg, rinfo) => {
      if (msg.length < 3) return;
      packets.push({ rinfo, parsed: parseMndp(msg) });
    });
    socket.on('error', (e) => {
      logger.warn({ event: 'discover', operation: 'discovery', result: 'error', error: e.message });
      cleanup();
      resolve([]);
    });
    socket.bind({ port: MNDP_PORT, exclusive: false }, () => {
      try { socket.setBroadcast(true); } catch { /* ignore */ }
      socket.send(QUERY, 0, QUERY.length, MNDP_PORT, '255.255.255.255', (err) => {
        if (err) logger.warn({ event: 'discover', operation: 'discovery', result: 'send_failed', error: err.message });
      });
    });
    setTimeout(async () => {
      cleanup();
      const map = new Map();
      for (const { rinfo, parsed } of packets) {
        if (!parsed.ips?.length && !parsed.identity && !parsed.mac && !parsed.version) continue;
        const key = parsed.ips?.[0] || rinfo.address;
        const dev = map.get(key) || { ip: key, identity: '', mac: '', version: '', platform: '', hardware: '', uptime: '', softwareId: '', apiPort: null, apiSsl: null };
        Object.assign(dev, parsed);
        dev.ips = undefined;
        map.set(key, dev);
      }
      const devices = [...map.values()];
      if (probePorts && devices.length) {
        await Promise.all(devices.map((d) => probeApi(d).catch(() => d)));
      }
      resolve(devices);
    }, durationMs);
  });
}

export function selfTest() {
  const resp = Buffer.concat([
    Buffer.from([0x02]),
    Buffer.from([0x0f, 0x03]), Buffer.from('AP1'),
    Buffer.from([0x02, 0x06, 0x00, 0x0c, 0x42, 0x01, 0x02, 0x03]),
    Buffer.from([0x0b, 0x05]), Buffer.from('6.49.17'),
    Buffer.from([0x03, 0x08]), Buffer.from('RouterOS'),
    Buffer.from([0x0c, 0x04, 20, 20, 20, 1]),
  ]);
  const p = parseMndp(resp);
  if (p.identity !== 'AP1') throw new Error(`identity: ${p.identity}`);
  if (p.version !== '6.49.17') throw new Error(`version: ${p.version}`);
  if (p.platform !== 'RouterOS') throw new Error(`platform: ${p.platform}`);
  if (p.mac !== '00:0c:42:01:02:03') throw new Error(`mac: ${p.mac}`);
  if (p.ips?.[0] !== '20.20.20.1') throw new Error(`ip: ${p.ips}`);
  logger.info('discovery selfTest: OK');
}