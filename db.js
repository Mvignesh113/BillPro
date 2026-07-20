/**
 * db.js — IndexedDB abstraction layer for BillPro
 * Stores: items, bills, settings
 */

const DB_NAME = 'BillingAppDB';
const DB_VERSION = 2;

let db = null;

export function openDB() {
  return new Promise((resolve, reject) => {
    if (db) return resolve(db);
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = e => {
      const d = e.target.result;

      if (!d.objectStoreNames.contains('items')) {
        const items = d.createObjectStore('items', { keyPath: 'id', autoIncrement: true });
        items.createIndex('category', 'category', { unique: false });
        items.createIndex('name', 'name', { unique: false });
      }

      if (!d.objectStoreNames.contains('bills')) {
        const bills = d.createObjectStore('bills', { keyPath: 'id', autoIncrement: true });
        bills.createIndex('date', 'date', { unique: false });
        bills.createIndex('billNumber', 'billNumber', { unique: false });
        bills.createIndex('customer', 'customer', { unique: false });
      }

      if (!d.objectStoreNames.contains('settings')) {
        d.createObjectStore('settings', { keyPath: 'key' });
      }
    };

    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror = e => reject(e.target.error);
  });
}

/* ── Generic helpers ── */
function tx(store, mode = 'readonly') {
  return db.transaction(store, mode).objectStore(store);
}

export function dbGetAll(store) {
  return new Promise((resolve, reject) => {
    const req = tx(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = e => reject(e.target.error);
  });
}

export function dbGet(store, key) {
  return new Promise((resolve, reject) => {
    const req = tx(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = e => reject(e.target.error);
  });
}

export function dbAdd(store, data) {
  return new Promise((resolve, reject) => {
    const req = tx(store, 'readwrite').add(data);
    req.onsuccess = () => resolve(req.result);
    req.onerror = e => reject(e.target.error);
  });
}

export function dbPut(store, data) {
  return new Promise((resolve, reject) => {
    const req = tx(store, 'readwrite').put(data);
    req.onsuccess = () => resolve(req.result);
    req.onerror = e => reject(e.target.error);
  });
}

export function dbDelete(store, key) {
  return new Promise((resolve, reject) => {
    const req = tx(store, 'readwrite').delete(key);
    req.onsuccess = () => resolve(true);
    req.onerror = e => reject(e.target.error);
  });
}

export function dbClear(store) {
  return new Promise((resolve, reject) => {
    const req = tx(store, 'readwrite').clear();
    req.onsuccess = () => resolve(true);
    req.onerror = e => reject(e.target.error);
  });
}

/* ── Settings helpers ── */
export async function getSetting(key) {
  const row = await dbGet('settings', key);
  return row ? row.value : null;
}

export async function setSetting(key, value) {
  await dbPut('settings', { key, value });
}

/* ── Bill number generator ── */
export async function nextBillNumber() {
  const bills = await dbGetAll('bills');
  if (!bills.length) return 'BILL-0001';
  const nums = bills.map(b => {
    const n = parseInt((b.billNumber || '0').replace(/\D/g, ''), 10);
    return isNaN(n) ? 0 : n;
  });
  const max = Math.max(...nums);
  return 'BILL-' + String(max + 1).padStart(4, '0');
}

/* ── Full backup / restore ── */
export async function exportBackup() {
  const [items, bills, settings] = await Promise.all([
    dbGetAll('items'),
    dbGetAll('bills'),
    dbGetAll('settings'),
  ]);
  return JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), items, bills, settings }, null, 2);
}

export async function importBackup(json) {
  const data = JSON.parse(json);
  if (!data.items && !data.bills && !data.settings) {
    throw new Error('Invalid backup format');
  }
  await dbClear('items');
  await dbClear('bills');
  await dbClear('settings');

  // Strip IDs so autoIncrement works correctly, then re-add
  for (const r of (data.items || [])) {
    const { id, ...rest } = r;
    await dbAdd('items', rest);
  }
  for (const r of (data.bills || [])) {
    const { id, ...rest } = r;
    await dbAdd('bills', rest);
  }
  for (const r of (data.settings || [])) {
    await dbPut('settings', r);
  }
}
