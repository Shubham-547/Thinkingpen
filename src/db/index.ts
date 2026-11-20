import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

export const createPool = () => {
  if (!global._postgresPool) {
    const useConnectionString = !process.env.SQL_HOST && Boolean(process.env.DATABASE_URL);
    // Keep pool modest by default so Render free/starter PostgreSQL connection caps (~20–97) are never exhausted
    const maxConnections = Math.max(
      4,
      Math.min(30, Number(process.env.PG_POOL_MAX || (process.env.NODE_ENV === 'production' ? 12 : 16)))
    );
    const commonConfig = {
      max: maxConnections,
      idleTimeoutMillis: 20_000,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 15_000,
      query_timeout: 15_000,
      keepAlive: true,
      allowExitOnIdle: false,
    };

    const poolConfig = useConnectionString
      ? {
          connectionString: process.env.DATABASE_URL,
          ssl: process.env.DATABASE_URL?.includes('localhost')
            ? undefined
            : { rejectUnauthorized: false },
          ...commonConfig,
        }
      : {
          host: process.env.SQL_HOST,
          user: process.env.SQL_USER,
          password: process.env.SQL_PASSWORD,
          database: process.env.SQL_DB_NAME,
          ...commonConfig,
        };

    global._postgresPool = new Pool(poolConfig);

    global._postgresPool.on('error', (err) => {
      console.error('Unexpected error on idle SQL pool client:', err);
    });
  }
  return global._postgresPool;
};

const pool = createPool();
export const db = drizzle(pool, { schema });
export { pool };
