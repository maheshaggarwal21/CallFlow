import dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// An idle connection dropped by the server (pooler restart, network blip) emits "error" on the pool;
// without a listener that crashes the receiver, and an upload arriving at that moment fails.
// Log it; the pool opens a fresh connection for the next query.
pool.on("error", (err) => console.error("[db] idle connection error (pool will reconnect):", err.message));

export default pool;
