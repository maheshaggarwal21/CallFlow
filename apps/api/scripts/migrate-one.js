#!/usr/bin/env node
//
// Apply ONE migration file to the database in DATABASE_URL (read from ./.env).
//
//   node scripts/migrate-one.js 007_audio_format.sql
//
// Use this on production instead of `dist/migrate.js`, which re-runs every
// migration from 001 (and can't find the .sql files under dist/ anyway — tsc
// doesn't copy them). Write migrations to be re-runnable (IF NOT EXISTS etc.).
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const name = process.argv[2];
if (!name) {
  console.error("usage: node scripts/migrate-one.js <file in src/db/migrations>");
  process.exit(1);
}
const file = path.join(__dirname, "..", "src", "db", "migrations", path.basename(name));
const sql = fs.readFileSync(file, "utf8");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool
  .query(sql)
  .then(() => console.log(`applied ${path.basename(file)}`))
  .catch((err) => {
    console.error(`FAILED ${path.basename(file)}: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
