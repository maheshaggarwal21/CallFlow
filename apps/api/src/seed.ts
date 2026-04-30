import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import pool from "./db/pool";

dotenv.config();

async function seed() {
  console.log("Seeding database with admin and employee users...");

  const adminHash = await bcrypt.hash("Admin@1234", 12);
  const employeeHash = await bcrypt.hash("Employee@1234", 12);

  // Upsert admin/owner
  await pool.query(
    `INSERT INTO employees (name, email, phone, role, password_hash, color_index, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'active')
     ON CONFLICT (email) DO UPDATE SET
       name = EXCLUDED.name,
       password_hash = EXCLUDED.password_hash,
       role = EXCLUDED.role,
       status = EXCLUDED.status`,
    ["Admin User", "admin@maxmusic.in", "9000000001", "owner", adminHash, 0]
  );

  // Upsert employee
  await pool.query(
    `INSERT INTO employees (name, email, phone, role, password_hash, color_index, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'active')
     ON CONFLICT (email) DO UPDATE SET
       name = EXCLUDED.name,
       password_hash = EXCLUDED.password_hash,
       role = EXCLUDED.role,
       status = EXCLUDED.status`,
    ["Demo Employee", "employee@maxmusic.in", "9000000002", "employee", employeeHash, 1]
  );

  // Seed 10 lines (01-10)
  for (let i = 1; i <= 10; i++) {
    const line = String(i).padStart(2, "0");
    await pool.query(
      `INSERT INTO lines (line_number) VALUES ($1) ON CONFLICT (line_number) DO NOTHING`,
      [line]
    );
  }

  // Seed 10 intercoms (601-610)
  for (let i = 601; i <= 610; i++) {
    await pool.query(
      `INSERT INTO intercoms (intercom_code) VALUES ($1) ON CONFLICT (intercom_code) DO NOTHING`,
      [String(i)]
    );
  }

  // Seed system_state row if missing
  await pool.query(
    `INSERT INTO system_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING`
  );

  console.log("\n=== Seed complete ===");
  console.log("Admin (owner)  -> email: admin@maxmusic.in     | password: Admin@1234");
  console.log("Employee       -> email: employee@maxmusic.in  | password: Employee@1234");
  console.log("Lines 01-10 and Intercoms 601-610 created.");

  await pool.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
