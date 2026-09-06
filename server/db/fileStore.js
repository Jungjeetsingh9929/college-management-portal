import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { seedData } from "./seedData.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "database.json");
let writeQueue = Promise.resolve();
let requestLock = Promise.resolve();
let databaseInitialization;

export async function ensureDatabase() {
  if (!databaseInitialization) databaseInitialization = initializeDatabase();
  return databaseInitialization;
}

async function initializeDatabase() {
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
    if (account && !db[collection].some((item) => item.id === id)) {
      db[collection].push(account);
      changed = true;
    }
  }
  db.schedules ||= [];
  for (const schedule of (seedData.schedules || []).filter((item) => String(item.id).startsWith("sch-e2e-demo-"))) {
    if (!db.schedules.some((item) => item.id === schedule.id)) {
      db.schedules.push(schedule);
      changed = true;
    }
  }
  if (changed) await atomicWrite(db);
}

export async function readDb() {
  await ensureDatabase();
  const raw = await fs.readFile(dbPath, "utf8");
  return JSON.parse(raw);
}

export async function writeDb(data) {
  writeQueue = writeQueue
    .catch(() => {})
    .then(() => atomicWrite(data));
  return writeQueue;
}

export async function resetDb() {
  await writeDb(structuredClone(seedData));
}

export function databaseWriteLock(req, res, next) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();

  const previous = requestLock;
  let release;
  requestLock = new Promise((resolve) => {
    release = resolve;
  });

  previous
    .catch(() => {})
    .then(() => {
      let released = false;
      const unlock = () => {
        if (released) return;
        released = true;
        release();
      };
      res.once("finish", unlock);
      res.once("close", unlock);
      next();
    })
    .catch(next);
}

async function atomicWrite(data) {
  const tempPath = `${dbPath}.${process.pid}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(data, null, 2), { mode: 0o600 });
  await fs.rename(tempPath, dbPath);
}

export function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
