import knex from 'knex';
import { config } from '../config/env.js';

export const db = knex({
  client: 'pg',
  connection: {
    host: config.db.host,
    port: config.db.port,
    database: config.db.database,
    user: config.db.user,
    password: config.db.password,
  },
  pool: {
    min: config.db.pool.min,
    max: config.db.pool.max,
    // Destroy idle connections after 30s to free resources
    idleTimeoutMillis: 30000,
    // Kill connections that take longer than 10s to establish
    acquireTimeoutMillis: 10000,
  },
  acquireConnectionTimeout: 10000,
});

// Test connectivity on startup
export async function testDbConnection(): Promise<void> {
  await db.raw('SELECT 1');
  console.log(`✅ Database connected: ${config.db.database}`);
}
