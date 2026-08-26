import { DurableObject } from 'cloudflare:workers';

const MAX_BODY_BYTES = 64 * 1024;
const TURN_CRED_TTL_S = 12 * 60 * 60;
const NO_STORE = { 'Cache-Control': 'no-store' };

export class Room extends DurableObject {
  async putSlot(slot, value) {
    const expiresAt = Date.now() + Number(this.env.ROOM_TTL_MS);
    await Promise.all([
      this.ctx.storage.put({ [slot]: value, expiresAt }),
      this.ctx.storage.setAlarm(expiresAt),
    ]);
  }

  async getSlot(slot) {
    const values = await this.ctx.storage.get(['expiresAt', slot]);
    if ((values.get('expiresAt') ?? 0) <= Date.now()) {
      await this.ctx.storage.deleteAll();
      return null;
    }
    return values.get(slot) ?? null;
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

async function allowed(request, env, kind) {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  return (await env.API_WRITE_LIMIT.limit({ key: `${kind}:${ip}` })).success;
}

async function issueTurnCredentials(request, env) {
  if (!(await allowed(request, env, 'turn'))) return respond(429, 'rate limited');
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

async function handleRoom(request, env, code, slot) {
  const room = env.ROOMS.getByName(code);

  if (request.method === 'POST') {
    if (!(await allowed(request, env, 'room-write'))) return respond(429, 'rate limited');
    try {
      await room.putSlot(slot, await readBody(request));
      return respond(200, 'ok');
    } catch (error) {
      if (error instanceof Error && error.message === 'body too large') {
        return respond(413, 'payload too large');
      }
      throw error;
    }
  }

  if (request.method === 'GET') {
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
      if (request.method === 'GET' && url.pathname === '/api/turn') {
        return await issueTurnCredentials(request, env);
      }

      const match = url.pathname.match(/^\/api\/room\/([A-Z0-9]{4})\/(offer|answer)$/);
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
