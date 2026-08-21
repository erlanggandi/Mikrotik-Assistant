import express from 'express';
import path from 'node:path';
import { config } from './src/config.js';
import { seedAdmin } from './src/db.js';
import { app } from './src/routes.js';
import { logger } from './src/logger.js';

seedAdmin();

app.use(
  express.static(path.join(config.root, 'public'), {
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
  })
);

app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(config.root, 'public', 'index.html'));
});

app.listen(config.port, config.host, () => {
  logger.info({
    event: 'server_start', operation: 'server', result: 'success',
    host: config.host, port: config.port,
  });
  console.log(`AI MikroTik Assistant berjalan di http://${config.host}:${config.port}`);
});