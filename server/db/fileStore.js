import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { seedData } from "./seedData.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "database.json");
let writeQueue = Promise.resolve();
let requestLock = Promise.resolve();

export async function ensureDatabase() {
  try {
    await fs.access(dbPath);
  } catch {
    await atomicWrite(seedData);
  }
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
