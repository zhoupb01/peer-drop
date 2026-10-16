import { DurableObject } from 'cloudflare:workers';

const MAX_BODY_BYTES = 64 * 1024;
const TURN_CRED_TTL_S = 12 * 60 * 60;
const NO_STORE = { 'Cache-Control': 'no-store' };
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export class Room extends DurableObject {
  async isLive() {
    const expiresAt = await this.ctx.storage.get('expiresAt');
    if ((expiresAt ?? 0) <= Date.now()) {
      await this.ctx.storage.deleteAll();
      return false;
    }
    return true;
  }

  async reserve() {
    if (await this.isLive()) return false;
    const expiresAt = Date.now() + Number(this.env.ROOM_TTL_MS);
    await Promise.all([
      this.ctx.storage.put({ expiresAt }),
      this.ctx.storage.setAlarm(expiresAt),
    ]);
    return true;
  }

  async putSlot(slot, value) {
    if (!(await this.isLive())) return 404;
    if ((await this.ctx.storage.get(slot)) !== undefined) return 409;
    const expiresAt = Date.now() + Number(this.env.ROOM_TTL_MS);
    await Promise.all([
      this.ctx.storage.put({ [slot]: value, expiresAt }),
      this.ctx.storage.setAlarm(expiresAt),
    ]);
    return 200;
  }

  async getSlot(slot) {
    if (!(await this.isLive())) return null;
    return (await this.ctx.storage.get(slot)) ?? null;
  }

  async alarm() {
    const expiresAt = await this.ctx.storage.get('expiresAt');
    if (expiresAt > Date.now()) {
      await this.ctx.storage.setAlarm(expiresAt);
      return;
    }
    await this.ctx.storage.deleteAll();
  }
}

function respond(status, body = '', contentType = 'text/plain; charset=utf-8') {
  return new Response(body, {
    status,
    headers: { 'Content-Type': contentType, ...NO_STORE },
  });
}

async function readBody(request) {
  const contentLength = Number(request.headers.get('Content-Length') ?? 0);
  if (contentLength > MAX_BODY_BYTES) throw new Error('body too large');
  if (!request.body) return '';

  const bytes = new Uint8Array(MAX_BODY_BYTES);
  const reader = request.body.getReader();
  let size = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error('body too large');
    }
    bytes.set(value, size);
    size += value.byteLength;
  }

  return new TextDecoder().decode(bytes.subarray(0, size));
}

async function allowed(request, limit, kind) {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  return (await limit.limit({ key: `${kind}:${ip}` })).success;
}

async function issueTurnCredentials(env) {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return respond(503, 'turn unavailable');

  const response = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ttl: TURN_CRED_TTL_S }),
    },
  );

  if (!response.ok) {
    console.error(JSON.stringify({ message: 'TURN credential request failed', status: response.status }));
    return respond(502, 'turn unavailable');
  }

  const payload = await response.json();
  const turn = Array.isArray(payload?.iceServers)
    ? payload.iceServers.find(server =>
        Array.isArray(server?.urls) &&
        typeof server?.username === 'string' &&
        typeof server?.credential === 'string')
    : null;

  return turn
    ? respond(200, JSON.stringify(turn), 'application/json; charset=utf-8')
    : respond(502, 'turn unavailable');
}

async function createRoom(request, env) {
  if (request.method !== 'POST') return respond(405, 'method not allowed');
  if (!(await allowed(request, env.API_WRITE_LIMIT, 'room-create'))) return respond(429, 'rate limited');
  for (let i = 0; i < 5; i++) {
    const code = Array.from(crypto.getRandomValues(new Uint8Array(4)), b => CODE_CHARS[b % CODE_CHARS.length]).join('');
    if (await env.ROOMS.getByName(code).reserve()) return respond(200, code);
  }
  return respond(503, 'no free code');
}

async function handleRoom(request, env, code, slot) {
  const room = env.ROOMS.getByName(code);

  if (slot === 'turn') {
    if (request.method !== 'GET') return respond(405, 'method not allowed');
    if (!(await allowed(request, env.API_WRITE_LIMIT, 'turn'))) return respond(429, 'rate limited');
    if (!(await room.isLive())) return respond(404, 'not found');
    return issueTurnCredentials(env);
  }

  if (request.method === 'POST') {
    if (!(await allowed(request, env.API_WRITE_LIMIT, 'room-write'))) return respond(429, 'rate limited');
    try {
      const status = await room.putSlot(slot, await readBody(request));
      return respond(status, { 200: 'ok', 404: 'not found', 409: 'slot taken' }[status]);
    } catch (error) {
      if (error instanceof Error && error.message === 'body too large') {
        return respond(413, 'payload too large');
      }
      throw error;
    }
  }

  if (request.method === 'GET') {
    if (!(await allowed(request, env.API_READ_LIMIT, 'room-read'))) return respond(429, 'rate limited');
    const value = await room.getSlot(slot);
    return value === null ? respond(404) : respond(200, value);
  }

  return respond(405, 'method not allowed');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (request.method === 'GET' && url.pathname === '/api/healthz') {
        return respond(200, 'ok');
      }
      if (url.pathname === '/api/room') return await createRoom(request, env);

      const match = url.pathname.match(/^\/api\/room\/([A-Z0-9]{4})\/(offer|answer|turn)$/);
      if (match) return await handleRoom(request, env, match[1], match[2]);
      if (url.pathname.startsWith('/api/')) return respond(404, 'not found');

      return await env.ASSETS.fetch(request);
    } catch (error) {
      console.error(JSON.stringify({
        message: 'request failed',
        path: url.pathname,
        error: error instanceof Error ? error.message : String(error),
      }));
      return respond(500, 'internal server error');
    }
  },
};
