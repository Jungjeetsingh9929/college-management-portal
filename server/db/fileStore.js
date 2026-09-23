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
// connectionTimeoutMillis bounds how long a checkout can hang waiting on a
// TCP handshake that will never complete (network black hole, wrong
// security group). Without it, a fully-unreachable Postgres doesn't fail
// fast - it hangs every caller indefinitely, which is worse than an error.
export const pool = usePostgres ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10_000 }) : null;
// node-postgres emits 'error' on a Pool whenever an *idle* client's
// connection drops (a DB restart, a network blip, a managed-Postgres
// failover). That event has no default listener, so Node treats it as an
// uncaught exception and kills the whole process - taking down every
// in-flight request, not just the one that happened to be on that
// connection. Log it and let the pool reconnect its next checkout instead.
if (pool) pool.on("error", (error) => console.error("[fileStore] Postgres pool error (idle connection dropped):", error.message));
const stateTable = "college_portal_state";
const rateLimitTable = "college_portal_rate_limits";
const filesTable = "college_portal_files";
let writeQueue = Promise.resolve();
let requestLock = Promise.resolve();
let databaseInitialization;

// --- Distributed write lock (Postgres mode only) ------------------------
//
// `requestLock` below only ever coordinated requests inside ONE Node
// process: it's a module-level variable, so on Render with 2+ instances
// each instance has its own independent copy that knows nothing about the
// others. Two instances could both readDb() the same state, both mutate
// their own in-memory copy, and both writeDb() - whichever write lands
// second wins and silently discards everything the first one changed. For
// a single JSON-blob-as-one-row store this is a lost-update on literally
// every collection, not just one table, and it happens with no error and
// no log line to notice it by.
//
// Postgres advisory locks (pg_advisory_lock) are exactly the primitive for
// this: they are visible to every session connected to the same database,
// i.e. every server instance, and they auto-release if the holding
// connection dies (crash, deploy, network drop) so a lock can never be
// stranded forever the way a "locked" flag row in a table could be. A
// single dedicated (non-pooled) Client holds the session; the existing
// in-process `requestLock` promise chain still serializes local requests
// exactly as before (including the audit-hook ordering in
// databaseWriteLock), and acquiring/releasing this advisory lock is layered
// on top of that chain only for Postgres mode.
const WRITE_LOCK_KEY = 727476551; // arbitrary; must be identical across every instance/process
let lockClient = null;
let lockClientConnecting = null;

async function getLockClient() {
  if (lockClient) return lockClient;
  if (!lockClientConnecting) {
    lockClientConnecting = (async () => {
      const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10_000, query_timeout: 10_000 });
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

// Retries rather than failing on the first hiccup (a lock client reconnect
// mid-retry is normal and should be transparent), but is still bounded: a
// fully-unreachable Postgres must eventually surface as a 503 to the caller
// instead of hanging the request - and every request behind it in
// `requestLock` - forever.
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

// A request should never be able to wedge every future write for every
// user forever. If something inside the locked window hangs indefinitely
// (see server/services/emailService.js - an SMTP call with no timeout was
// exactly this until this round's fix), force the lock open after a
// generous ceiling so the app degrades instead of freezing outright.
const LOCK_TIMEOUT_MS = Number(process.env.WRITE_LOCK_TIMEOUT_MS) || 30000;

export async function ensureDatabase() {
  if (!databaseInitialization) {
    // If initializeDatabase() throws (DB unreachable during boot, a
    // transient network blip), the rejected promise used to stay cached
    // forever - every readDb()/writeDb() call from then on would reject
    // immediately with the same stale error, even long after the database
    // was reachable again, wedging the app until someone manually restarts
    // the process. Clear the cache on failure so the next call retries.
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
    // Distributed rate-limit counters. Kept in Postgres (rather than the
    // in-process Map used in dev/test) so limits are enforced correctly
    // across multiple Render instances instead of each instance keeping its
    // own independent count.
    await pool.query(`CREATE TABLE IF NOT EXISTS ${rateLimitTable} (key text PRIMARY KEY, count integer NOT NULL, reset_at timestamptz NOT NULL, blocked_until timestamptz NOT NULL DEFAULT to_timestamp(0))`);
    // Uploaded file bytes (faculty notes, assignment submissions). Kept in
    // Postgres in production so files survive a Render redeploy/restart,
    // since the local filesystem (including UPLOAD_DIR under /tmp) does not
    // persist across deploys on Render.
    await pool.query(`CREATE TABLE IF NOT EXISTS ${filesTable} (stored_name text PRIMARY KEY, data bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`);
    // Two instances can both boot against a brand-new database at once
    // (a fresh deploy that scales straight to 2+ instances). Both would see
    // rowCount === 0 from a plain SELECT-then-INSERT and both would try to
    // INSERT id=1: the loser hit an unhandled unique-violation and crashed on
    // startup. ON CONFLICT DO NOTHING plus a RETURNING check makes this
    // idempotent - whichever instance loses the race just falls through to
    // the "already seeded" branch below instead of throwing.
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

// Any code path that does its own readDb() -> mutate -> writeDb() cycle
// *outside* of a request already serialized by databaseWriteLock must still
// queue onto the same `requestLock` chain. The two cases that matter today
// are the audit-logging hook for a non-mutating request (server/index.js)
// and any GET route that lazily persists derived records. Otherwise its
// readDb() can observe state from before a concurrent locked write commits,
// and its later writeDb() - which replaces the *entire* JSON document/row -
// clobbers that write when it lands, silently losing whatever the locked
// request just saved.
//
// Chaining onto the same module-level `requestLock` variable is what makes
// the two mechanisms mutually exclusive in-process; taking the same
// advisory lock in Postgres mode is what makes them mutually exclusive
// across Render instances, exactly as databaseWriteLock does below. Without
// that second half this would serialize against local requests while still
// racing every other instance - which is the harder failure to notice.
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
  // Downstream middleware (the audit-logging middleware in server/index.js)
  // can push its own post-response work here - e.g. recordAudit()'s own
  // independent readDb() -> mutate -> writeDb() cycle - so that it runs
  // and completes *before* the lock below is released, instead of racing
  // against the next request's write once release() fires.
  req.onWriteLockRelease = [];
  const previous = requestLock;
  let release;
  requestLock = new Promise((resolve) => { release = resolve; });
  previous.catch(() => {}).then(async () => {
    // In Postgres mode, also take the real cross-instance advisory lock
    // described above, so this mutual exclusion holds across every Render
    // instance and not just within this one process. In file-store mode
    // there is only ever one process, so this is a no-op.
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
      // databaseWriteLock's own "finish"/"close" listeners are registered
      // here, before downstream middleware (e.g. the audit-logging
      // middleware in server/index.js) gets a chance to register its own
      // "finish" listener and push a hook onto req.onWriteLockRelease - so
      // reading that array synchronously, right here, would always see it
      // empty. queueMicrotask defers the actual read until after every
      // "finish" listener for this event has run (they're all synchronous),
      // so any hook pushed by a later listener is present by the time we
      // read the array, and the lock isn't released until it resolves.
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
    // The rename is atomic, so database.json itself can never end up
    // half-written - but a failure between the two steps (disk full, a
    // permissions error) used to leave the temp file behind forever. Per-pid
    // naming means these silently accumulate across repeated failures/dev
    // restarts instead of colliding, which just hides the problem.
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

export function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
