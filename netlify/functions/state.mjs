// GET /api/state/:code - the public game state every screen and phone polls.
// Cached at Netlify's CDN for 1s so a room full of phones polling every
// second costs roughly one function invocation per second per edge node.
import { store, keys, cleanCode } from '../../shared/store.js';

export default async (req, context) => {
  const code = cleanCode(context.params.code);
  const raw = code ? await store().get(keys.state(code)) : null;
  if (!raw) {
    return new Response(JSON.stringify({ error: 'Room not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }
  // splice in the server clock so clients can correct for skew
  const body = raw.replace(/^\{/, `{"serverNow":${Date.now()},`);
  return new Response(body, {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=0, must-revalidate',
      'netlify-cdn-cache-control': 'public, durable, max-age=1, stale-while-revalidate=1',
    },
  });
};

export const config = { path: '/api/state/:code', method: 'GET' };
