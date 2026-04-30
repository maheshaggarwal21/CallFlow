import pool from "../db/pool";

export async function findStudentName(phone: string): Promise<string | null> {
  const normalized = phone.replace(/\D/g, "");
  if (!normalized) return null;

  const result = await pool.query(
    "SELECT name FROM students WHERE phone = $1 LIMIT 1",
    [normalized]
  );

  return result.rows[0]?.name || null;
}
