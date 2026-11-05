// Where the WebSocket lives.
//  - On AWS, the CDK stack writes /config.json with the API Gateway URL.
//  - Locally (dev server, ngrok tunnel, Vite proxy) there is no wsUrl and we
//    use our own origin + /ws, so one tunnel carries both site and socket.
let cached;
export async function getWsUrl() {
  if (cached) return cached;
  let wsUrl = '';
  try {
    const res = await fetch('/config.json', { cache: 'no-store' });
    if (res.ok) wsUrl = (await res.json()).wsUrl || '';
  } catch { /* fall through */ }
  if (!wsUrl) wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  return (cached = wsUrl);
}
