import express from 'express';
import path from 'node:path';
import { config } from './src/config.js';
import { seedAdmin } from './src/db.js';
import { app } from './src/routes.js';
import { logger } from './src/logger.js';
import { startTelegramBot, stopTelegramBot } from './src/telegram.js';

seedAdmin();

app.use(
  express.static(path.join(config.root, 'public'), {
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
  })
);

app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(config.root, 'public', 'index.html'));
});

const server = app.listen(config.port, config.host, () => {
  logger.info({
    event: 'server_start', operation: 'server', result: 'success',
    host: config.host, port: config.port,
  });
  console.log(`AI MikroTik Assistant berjalan di http://${config.host}:${config.port}`);

  // Start Telegram bot long polling if enabled
  try {
    startTelegramBot();
  } catch (err) {
    logger.warn({ event: 'telegram_bot_init_error', error: err.message });
  }
});

function shutdown() {
  logger.info({ event: 'server_shutdown', operation: 'server' });
  stopTelegramBot();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);