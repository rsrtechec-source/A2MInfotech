import { Pool, types } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL must be set to a PostgreSQL connection URL.");
}

types.setTypeParser(types.builtins.INT8, (value) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("PostgreSQL integer exceeds JavaScript's safe integer range.");
  }
  return parsed;
});

const pool = new Pool({
  connectionString,
  ...(process.env.DATABASE_SSL === "true" ? { ssl: { rejectUnauthorized: true } } : {}),
});

export default pool;
