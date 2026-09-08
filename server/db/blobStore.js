import { promises as fs } from "node:fs";
import path from "node:path";
import { pool, usePostgres } from "./fileStore.js";

// Persists an uploaded file's bytes, keyed by its randomly-generated stored
// name. In production (DATABASE_URL set) this writes to Postgres so files
// survive a Render redeploy/restart. In dev/test it writes to disk under
// `localDir`, exactly as before.
export async function saveFile({ storedName, buffer, localDir }) {
  if (usePostgres) {
    await pool.query(
      `INSERT INTO college_portal_files (stored_name, data) VALUES ($1, $2)
       ON CONFLICT (stored_name) DO UPDATE SET data = EXCLUDED.data`,
      [storedName, buffer]
    );
    return;
  }
  await fs.mkdir(localDir, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(localDir, storedName), buffer, { mode: 0o600 });
}

// Loads a previously-saved file's bytes. Returns null if not found. The
// caller already has the file's mimetype/filename from its own database
// record (note.file / submissionFile), so this only needs to return bytes.
export async function loadFile({ storedName, localDir }) {
  if (usePostgres) {
    const result = await pool.query(`SELECT data FROM college_portal_files WHERE stored_name = $1`, [storedName]);
    return result.rowCount ? result.rows[0].data : null;
  }
  try {
    return await fs.readFile(path.join(localDir, storedName));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function deleteFile({ storedName, localDir }) {
  if (usePostgres) {
    await pool.query(`DELETE FROM college_portal_files WHERE stored_name = $1`, [storedName]);
    return;
  }
  await fs.rm(path.join(localDir, storedName), { force: true });
}
