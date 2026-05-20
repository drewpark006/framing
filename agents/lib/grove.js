/**
 * agents/lib/grove.js — Read-projection + action-POST helpers for Framing.
 *
 * Read pattern: open the `order` SQLite table read-only and SELECT rows.
 * Each row has the order's typed fields plus Grove bookkeeping (id, version,
 * created_at, updated_at, ...). We surface the aggregate id as `_id` to
 * match the historical agent shape.
 *
 * Write pattern: POST JSON to `/api/order/<action>` on grove-server. The
 * server auto-generates aggregate ids (prefixed with the record `kind`).
 */

import Database from "better-sqlite3";
import { existsSync } from "node:fs";

export const DEFAULT_API = "http://127.0.0.1:3000";

function openReadOnly(dbPath) {
  if (!existsSync(dbPath)) {
    throw new Error(`Grove DB not found at ${dbPath}. Start the server first: ./start.sh --db`);
  }
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

function withDb(dbPath, fn) {
  const db = openReadOnly(dbPath);
  try { return fn(db); } finally { db.close(); }
}

function decorate(row) {
  if (!row) return row;
  row._id = row.id;
  return row;
}

export function loadOrders(dbPath, { stage = null } = {}) {
  return withDb(dbPath, db => {
    const sql = stage
      ? "SELECT * FROM `order` WHERE stage = ? ORDER BY created_at DESC"
      : "SELECT * FROM `order` ORDER BY created_at DESC";
    const stmt = db.prepare(sql);
    const rows = stage ? stmt.all(stage) : stmt.all();
    return rows.map(decorate);
  });
}

export function loadOrder(dbPath, id) {
  return withDb(dbPath, db => {
    const row = db.prepare("SELECT * FROM `order` WHERE id = ?").get(id);
    return decorate(row);
  });
}

export function tableExists(dbPath, table) {
  if (!existsSync(dbPath)) return false;
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?"
    ).get(table);
    return !!row;
  } finally { db.close(); }
}

/**
 * POST an action to grove-server. Throws on non-2xx.
 * Returns the parsed JSON response (typically `{ record, events, deleted }`).
 */
export async function callAction(action, payload, apiBase = DEFAULT_API) {
  const url = `${apiBase}/api/order/${action}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "(no body)");
    throw new Error(`POST ${url} → ${res.status}: ${errText.slice(0, 500)}`);
  }
  return res.json();
}

/**
 * Run a batch of POSTs with bounded concurrency. Returns { ok, fail, results }.
 */
export async function callActionBatch(action, payloads, { apiBase = DEFAULT_API, concurrency = 8 } = {}) {
  const results = new Array(payloads.length);
  let ok = 0, fail = 0;
  let idx = 0;
  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= payloads.length) return;
      try {
        results[i] = { ok: true, value: await callAction(action, payloads[i], apiBase) };
        ok++;
      } catch (e) {
        results[i] = { ok: false, error: e.message };
        fail++;
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, payloads.length) }, worker);
  await Promise.all(workers);
  return { ok, fail, results };
}
