import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import express from 'express';
import wisp from 'wisp-server-node';
import { uvPath } from '@titaniumnetwork-dev/ultraviolet';
import { epoxyPath } from '@mercuryworkshop/epoxy-transport';
import { baremuxPath } from '@mercuryworkshop/bare-mux/node';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.get('/healthz', (_req, res) => res.type('text').send('ok'));

// public primero: public/uv/uv.config.js tiene prioridad sobre uvPath
app.use(
  express.static(join(__dirname, 'public'), {
    setHeaders(res, filePath) {
      if (filePath.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
    },
  })
);
app.use('/uv/', express.static(uvPath));
app.use('/epoxy/', express.static(epoxyPath));
app.use('/baremux/', express.static(baremuxPath));

app.use((_req, res) => res.status(404).type('text').send('Not found'));

const server = createServer(app);

// Transporte Wisp (WebSocket) usado por Epoxy
server.on('upgrade', (req, socket, head) => {
  if (req.url && req.url.startsWith('/wisp/')) wisp.routeRequest(req, socket, head);
  else socket.destroy();
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Shadow Proxy escuchando en http://localhost:${PORT}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
