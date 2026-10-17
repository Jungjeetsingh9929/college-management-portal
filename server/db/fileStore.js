import { promises as fs } from "fs";
import os from "node:os";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { seedData } from "./seedData.js";

const { Pool, Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_FILE_PATH
  ? path.resolve(process.env.DB_FILE_PATH)
  : process.env.NODE_ENV === "test"
    ? path.join(os.tmpdir(), `college-portal-test-${process.pid}.json`)
    : path.join(__dirname, "database.json");
export const usePostgres = Boolean(process.env.DATABASE_URL);
if (!usePostgres && !["development", "test"].includes(process.env.NODE_ENV)) {
  console.warn("[startup] DATABASE_URL is not configured; using the local JSON fallback. Use PostgreSQL for staging/production and never distribute server/db/database.json.");
}
// connectionTimeoutMillis bounds how long a checkout can hang waiting on a TCP handshake that will never complete (network black hole, wrong security group).
// Verify the database certificate by default. If your host uses a self-signed
// certificate, set PGSSL_REJECT_UNAUTHORIZED=false (not recommended).
function sslOptions() {
  return { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== "false" };
}
export const pool = usePostgres ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: sslOptions(), connectionTimeoutMillis: 10_000 }) : null;
// node-postgres emits 'error' on a Pool whenever an *idle* client's connection drops (a DB restart, a network blip, a managed-Postgres failover).
if (pool) pool.on("error", (error) => console.error("[fileStore] Postgres pool error (idle connection dropped):", error.message));
const stateTable = "college_portal_state";
const rateLimitTable = "college_portal_rate_limits";
const filesTable = "college_portal_files";
let writeQueue = Promise.resolve();
let requestLock = Promise.resolve();
let databaseInitialization;

// --- Distributed write lock (Postgres mode only) ------------------------ `requestLock` below only ever coordinated requests inside ONE Node process: it's a module-level variable.
const WRITE_LOCK_KEY = 727476551; // arbitrary; must be identical across every instance/process
let lockClient = null;
let lockClientConnecting = null;

async function getLockClient() {
  if (lockClient) return lockClient;
  if (!lockClientConnecting) {
    lockClientConnecting = (async () => {
      const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: sslOptions(), connectionTimeoutMillis: 10_000, query_timeout: 10_000 });
      client.on("error", (error) => {
        console.error("[fileStore] Distributed write-lock connection dropped; will reconnect on next use:", error.message);
        lockClient = null;
      });
      await client.connect();
      lockClient = client;
      return client;
    })();
    try {
      return await lockClientConnecting;
    } finally {
      lockClientConnecting = null;
    }
  }
  return lockClientConnecting;
}

// Retries rather than failing on the first hiccup (a lock client reconnect mid-retry is normal and should be transparent).
async function acquireDistributedLock() {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      const client = await getLockClient();
      await client.query("SELECT pg_advisory_lock($1)", [WRITE_LOCK_KEY]);
      return client;
    } catch (error) {
      lockClient = null;
      if (Date.now() >= deadline) {
        throw new Error(`Could not acquire the distributed write lock within ${LOCK_TIMEOUT_MS}ms: ${error.message}`);
      }
      console.error("[fileStore] Failed to acquire distributed write lock, retrying in 200ms:", error.message);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}

async function releaseDistributedLock(client) {
  try {
    await client.query("SELECT pg_advisory_unlock($1)", [WRITE_LOCK_KEY]);
  } catch (error) {
    // If the connection already dropped, Postgres has already released the
    // lock on its own (advisory locks die with the session) - nothing to
    // clean up, so just log and move on.
    console.error("[fileStore] Failed to release distributed write lock (harmless if the connection dropped - Postgres auto-releases session locks):", error.message);
  }
}

// A request should never be able to wedge every future write for every user forever. If something inside the locked window hangs indefinitely (see server/services/emailService.js.
const LOCK_TIMEOUT_MS = Number(process.env.WRITE_LOCK_TIMEOUT_MS) || 30000;

export async function ensureDatabase() {
  if (!databaseInitialization) {
    // If initializeDatabase() throws (DB unreachable during boot, a transient network blip), the rejected promise used to stay cached forever.
    databaseInitialization = initializeDatabase().catch((error) => {
      databaseInitialization = undefined;
      throw error;
    });
  }
  return databaseInitialization;
}

async function initializeDatabase() {
  if (usePostgres) {
    await pool.query(`CREATE TABLE IF NOT EXISTS ${stateTable} (id integer PRIMARY KEY, state jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`);
    // Distributed rate-limit counters. Kept in Postgres (rather than the in-process Map used in dev/test) so limits are enforced correctly across multiple Render instances instead of each instance keeping.
    await pool.query(`CREATE TABLE IF NOT EXISTS ${rateLimitTable} (key text PRIMARY KEY, count integer NOT NULL, reset_at timestamptz NOT NULL, blocked_until timestamptz NOT NULL DEFAULT to_timestamp(0))`);
    // Uploaded file bytes (faculty notes, assignment submissions). Kept in Postgres in production so files survive a Render redeploy/restart.
    await pool.query(`CREATE TABLE IF NOT EXISTS ${filesTable} (stored_name text PRIMARY KEY, data bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`);
    // Two instances can both boot against a brand-new database at once (a fresh deploy that scales straight to 2+ instances).
    const inserted = await pool.query(`INSERT INTO ${stateTable} (id, state) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING RETURNING id`, [JSON.stringify(seedData)]);
    if (inserted.rowCount > 0) return;
    const result = await pool.query(`SELECT state FROM ${stateTable} WHERE id = 1`);
    if (process.env.ALLOW_DEMO_LOGIN !== "true") return;
    const db = result.rows[0].state;
    let changed = false;
    for (const [collection, id] of [["admins", "admin-demo"], ["admins", "admin-e2e-demo"], ["students", "stu-demo"], ["teachers", "tch-demo"], ["teachers", "tch-e2e-demo"]]) {
      db[collection] ||= [];
      const account = (seedData[collection] || []).find((item) => item.id === id);
      if (account && !db[collection].some((item) => item.id === id)) { db[collection].push(account); changed = true; }
    }
    db.schedules ||= [];
    for (const schedule of (seedData.schedules || []).filter((item) => String(item.id).startsWith("sch-e2e-demo-"))) {
      if (!db.schedules.some((item) => item.id === schedule.id)) { db.schedules.push(schedule); changed = true; }
    }
    if (changed) await atomicWrite(db);
    return;
  }

  try {
    await fs.access(dbPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await atomicWrite(seedData);
    return;
  }
  if (process.env.ALLOW_DEMO_LOGIN !== "true") return;
  const db = JSON.parse(await fs.readFile(dbPath, "utf8"));
  let changed = false;
  for (const [collection, id] of [["admins", "admin-demo"], ["admins", "admin-e2e-demo"], ["students", "stu-demo"], ["teachers", "tch-demo"], ["teachers", "tch-e2e-demo"]]) {
    db[collection] ||= [];
    const account = (seedData[collection] || []).find((item) => item.id === id);
    if (account && !db[collection].some((item) => item.id === id)) { db[collection].push(account); changed = true; }
  }
  db.schedules ||= [];
  for (const schedule of (seedData.schedules || []).filter((item) => String(item.id).startsWith("sch-e2e-demo-"))) {
    if (!db.schedules.some((item) => item.id === schedule.id)) { db.schedules.push(schedule); changed = true; }
  }
  if (changed) await atomicWrite(db);
}

export async function readDb() {
  await ensureDatabase();
  if (usePostgres) {
    const result = await pool.query(`SELECT state FROM ${stateTable} WHERE id = 1`);
    return result.rows[0].state;
  }
  return JSON.parse(await fs.readFile(dbPath, "utf8"));
}

export async function writeDb(data) {
  writeQueue = writeQueue.catch(() => {}).then(() => atomicWrite(data));
  return writeQueue;
}

export async function resetDb() {
  await writeDb(structuredClone(seedData));
}

// Any code path that does its own readDb() -> mutate -> writeDb() cycle *outside* of a request already serialized by databaseWriteLock must still queue onto the same `requestLock` chain.
export async function withWriteLock(fn) {
  const previous = requestLock;
  let release;
  requestLock = new Promise((resolve) => { release = resolve; });
  await previous.catch(() => {});
  let distributedLockClient = null;
  if (usePostgres) {
    try {
      distributedLockClient = await acquireDistributedLock();
    } catch (error) {
      release();
      throw error;
    }
  }
  // Same force-open backstop as databaseWriteLock: a hang inside `fn` must
  // not wedge every future write for every user.
  let released = false;
  const finish = () => {
    if (released) return;
    released = true;
    clearTimeout(timeoutId);
    release();
  };
  const timeoutId = setTimeout(() => {
    if (released) return;
    console.error(`[fileStore] withWriteLock held past ${LOCK_TIMEOUT_MS}ms - force-releasing so other writes aren't blocked indefinitely.`);
    finish();
  }, LOCK_TIMEOUT_MS);
  try {
    return await fn();
  } finally {
    if (distributedLockClient) await releaseDistributedLock(distributedLockClient);
    finish();
  }
}

export function databaseWriteLock(req, res, next) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  // Downstream middleware (the audit-logging middleware in server/index.js) can push its own post-response work here - e.g. recordAudit()'s own independent readDb() -> mutate -> writeDb() cycle.
  req.onWriteLockRelease = [];
  const previous = requestLock;
  let release;
  requestLock = new Promise((resolve) => { release = resolve; });
  previous.catch(() => {}).then(async () => {
    // In Postgres mode, also take the real cross-instance advisory lock described above, so this mutual exclusion holds across every Render instance and not just within this one process.
    let distributedLockClient = null;
    if (usePostgres) {
      try {
        distributedLockClient = await acquireDistributedLock();
      } catch (error) {
        return next(error);
      }
    }
    let released = false;
    const timeoutId = setTimeout(() => {
      if (released) return;
      console.error(`[fileStore] Write lock held past ${LOCK_TIMEOUT_MS}ms for ${req.method} ${req.originalUrl} - force-releasing so other writes aren't blocked indefinitely. That in-flight request may still complete afterwards.`);
      unlock();
    }, LOCK_TIMEOUT_MS);
    const unlock = () => {
      if (released) return;
      released = true;
      clearTimeout(timeoutId);
      // databaseWriteLock's own "finish"/"close" listeners are registered here, before downstream middleware (e.g. the audit-logging middleware in server/index.js) gets a chance to register its own "finish".
      queueMicrotask(() => {
        Promise.allSettled(req.onWriteLockRelease.map((hook) => hook()))
          .catch(() => {})
          .finally(async () => {
            if (distributedLockClient) await releaseDistributedLock(distributedLockClient);
            release();
          });
      });
    };
    res.once("finish", unlock);
    res.once("close", unlock);
    next();
  }).catch(next);
}

async function atomicWrite(data) {
  if (usePostgres) {
    await pool.query(`INSERT INTO ${stateTable} (id, state, updated_at) VALUES (1, $1::jsonb, now()) ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`, [JSON.stringify(data)]);
    return;
  }
  const tempPath = `${dbPath}.${process.pid}.tmp`;
  try {
    await fs.writeFile(tempPath, JSON.stringify(data, null, 2), { mode: 0o600 });
    await fs.rename(tempPath, dbPath);
  } catch (error) {
    // The rename is atomic, so database.json itself can never end up half-written - but a failure between the two steps (disk full, a permissions error) used to leave the temp file behind forever.
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

export function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
