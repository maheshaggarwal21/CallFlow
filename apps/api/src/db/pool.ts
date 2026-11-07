import dotenv from "dotenv";
import { Pool, type PoolConfig } from "pg";

dotenv.config();

const config: PoolConfig = {
  connectionString: process.env.DATABASE_URL,
  // The database is far away (Supabase Tokyo, ~110 ms a trip) and opening a connection costs several
  // trips (~0.5 s). With pg's 10 s default, every page load after a quiet moment re-opened connections;
  // keep idle ones for 5 minutes instead.
  idleTimeoutMillis: 5 * 60_000,
  keepAlive: true,
};

const pool = new Pool(config);

// An idle connection dropped by the server (pooler restart, network blip) emits "error" on the pool;
// without a listener that crashes the whole API. Log it; the pool replaces the connection.
pool.on("error", (err) => console.error("[db] idle connection error (pool will reconnect):", err.message));

export default pool;
