import { buildApp } from './app.js';
import { config } from './config/env.js';
import { testDbConnection } from './db/knex.js';

async function start() {
  try {
    // 1. Verify DB connectivity before accepting traffic
    await testDbConnection();

    // 2. Build and start the Fastify server
    const app = await buildApp();

    const address = await app.listen({
      port: config.server.port,
      host: config.server.host,
    });

    console.log(`🚀 Server listening at ${address}`);
    console.log(`📡 API available at ${address}/api`);
    console.log(`💚 Health check at ${address}/health`);

  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\nSIGINT received, shutting down...');
  process.exit(0);
});

start();
