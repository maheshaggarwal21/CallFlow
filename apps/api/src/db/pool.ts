import dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config();

type PoolConfig = {
  connectionString?: string;
};

const config: PoolConfig = {
  connectionString: process.env.DATABASE_URL,
};

const pool = new Pool(config);

export default pool;
