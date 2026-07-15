import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';

const PORT = 3000;
const TTL_MS = 10 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;
const rooms = new Map();

const TURN_SECRET = process.env.TURN_SECRET ?? '';
const TURN_URLS = (process.env.TURN_URLS ?? '').split(',').filter(Boolean);
// 凭据有效期必须覆盖整个会话：中继期间凭据过期会导致 allocation 刷新失败而断流
const TURN_CRED_TTL_S = 12 * 60 * 60;

function getRoom(code) {
  const room = rooms.get(code);
  if (!room) return null;
  if (room.expiresAt <= Date.now()) {
    rooms.delete(code);
    return null;
  }
  return room;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;

    request.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    request.on('end', () => {
      if (tooLarge) reject(new Error('body too large'));
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
    request.on('error', reject);
  });
}

function respond(response, status, body = '') {
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

const server = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/healthz') {
    return respond(response, 200, 'ok');
  }

  // TURN REST 凭据（coturn use-auth-secret 约定）：username 是过期时间戳，credential 是它的 HMAC
  if (request.method === 'GET' && request.url === '/turn') {
    const username = String(Math.floor(Date.now() / 1000) + TURN_CRED_TTL_S);
    const credential = createHmac('sha1', TURN_SECRET).update(username).digest('base64');
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return response.end(JSON.stringify({ urls: TURN_URLS, username, credential }));
  }

  const pathname = new URL(request.url, 'http://localhost').pathname;
  const match = pathname.match(/^\/room\/([A-Z0-9]{4})\/(offer|answer)$/);
  if (!match) return respond(response, 404, 'not found');

  const [, code, slot] = match;

  if (request.method === 'POST') {
    try {
      const value = await readBody(request);
      const room = getRoom(code) ?? { expiresAt: 0 };
      room[slot] = value;
      room.expiresAt = Date.now() + TTL_MS;
      rooms.set(code, room);
      return respond(response, 200, 'ok');
    } catch {
      return respond(response, 413, 'payload too large');
    }
  }

  if (request.method === 'GET') {
    const value = getRoom(code)?.[slot];
    return value === undefined
      ? respond(response, 404)
      : respond(response, 200, value);
  }

  return respond(response, 405, 'method not allowed');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`peer-drop signal listening on :${PORT}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
