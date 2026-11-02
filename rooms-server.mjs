// Production Club room service (no static files, no test mocks). Deployed to Fly.io; see README.
import http from 'node:http';
import { createRooms, redisRooms, roomsHandler } from './api/_lib/rooms.js';

const PORT = +(process.env.PORT || 8080);
const store = redisRooms();
const rooms = createRooms({ store });
const handle = roomsHandler(rooms, { allowedOrigin: process.env.ROOMS_ALLOWED_ORIGIN || '*' });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://rooms');
  try {
    if (url.pathname === '/healthz' || url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ ok: true, service: 'untergrund-rooms', rooms: rooms.size(), persistence: store ? store.kind : 'memory' }));
    }
    if (await handle(req, res, url)) return;
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'server_error' }));
  }
});
server.keepAliveTimeout = 65000;
server.listen(PORT, () => console.log(`UNTERGRUND rooms on :${PORT} (persistence: ${store ? store.kind : 'memory only'})`));

const shutdown = async () => {
  server.close();
  await rooms.flush();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
