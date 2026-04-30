import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import pool from "./db/pool";

dotenv.config();

async function migrate() {
  const migrationsDir = path.join(__dirname, "db", "migrations");
  const files = fs.readdirSync(migrationsDir).sort();

  console.log("Running migrations...");
  for (const file of files) {
    if (!file.endsWith(".sql")) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    console.log(`  Running ${file}...`);
    try {
      await pool.query(sql);
      console.log(`  ✓ ${file}`);
    } catch (err: any) {
      if (err.code === "42P07" || err.message?.includes("already exists")) {
        console.log(`  ~ ${file} (already applied, skipping)`);
      } else {
        throw err;
      }
    }
  }

  console.log("Migrations complete.");
  await pool.end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
