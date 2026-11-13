// Standalone Club room service (no static files, no test mocks), optional: production rooms run on Vercel (api/rooms.js).
import http from 'node:http';
import { createRooms, roomsKv, memoryRoomsKv, roomsHandler } from './api/_lib/rooms.js';

const PORT = +(process.env.PORT || 8080);
const rooms = createRooms({ kv: roomsKv() || memoryRoomsKv() });
const handle = roomsHandler(rooms, { allowedOrigin: process.env.ROOMS_ALLOWED_ORIGIN || '*' });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://rooms');
  try {
    if (url.pathname === '/healthz' || url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ ok: true, service: 'untergrund-rooms', persistence: rooms.kind }));
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
server.listen(PORT, () => console.log(`UNTERGRUND rooms on :${PORT} (persistence: ${rooms.kind})`));

const shutdown = async () => {
  server.close();
  await rooms.flush();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
