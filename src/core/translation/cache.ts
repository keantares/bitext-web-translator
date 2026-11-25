import type { ProviderId } from '../storage/types';
import type { TranslateFormat } from './types';

export interface CacheKeyParts {
  provider: ProviderId;
  model: string;
  promptVersion: string;
  targetLang: string;
  format: TranslateFormat;
  sourceText: string;
}

export interface CacheStats {
  count: number;
  estimatedBytes: number;
}

interface CacheRecord {
  key: string;
  value: string;
  updatedAt: number;
  bytes: number;
}

const DB_NAME = 'bitext-translation-cache';
const DB_VERSION = 1;
const STORE_NAME = 'entries';

/** Fast non-cryptographic 64-bit FNV-1a-like double hash for compact deterministic cache keys */
function hashText(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(36)}-${(h2 >>> 0).toString(36)}-${input.length}`;
}

export function buildCacheKey(parts: CacheKeyParts): string {
  return [
    parts.provider,
    parts.model || 'default',
    parts.promptVersion,
    parts.targetLang,
    parts.format,
    hashText(parts.sourceText),
  ].join('|');
}

export class TranslationCache {
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  private memoryFallback = new Map<string, CacheRecord>();
  private maxEntries: number;

  constructor(maxEntries = 5000) {
    this.maxEntries = Math.max(100, maxEntries);
  }

  setMaxEntries(limit: number): void {
    this.maxEntries = Math.max(100, limit);
  }

  private openDb(): Promise<IDBDatabase | null> {
    if (this.dbPromise) return this.dbPromise;
    if (typeof indexedDB === 'undefined') {
      this.dbPromise = Promise.resolve(null);
      return this.dbPromise;
    }
    this.dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
            store.createIndex('updatedAt', 'updatedAt', { unique: false });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return this.dbPromise;
  }

  async get(key: string): Promise<string | null> {
    const db = await this.openDb();
    if (!db) {
      const hit = this.memoryFallback.get(key);
      if (!hit) return null;
      hit.updatedAt = Date.now();
      return hit.value;
    }
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(key);
        req.onsuccess = () => {
          const rec = req.result as CacheRecord | undefined;
          resolve(rec ? rec.value : null);
        };
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async put(key: string, value: string): Promise<void> {
    const record: CacheRecord = {
      key,
      value,
      updatedAt: Date.now(),
      bytes: (key.length + value.length) * 2,
    };
    const db = await this.openDb();
    if (!db) {
      this.memoryFallback.set(key, record);
      if (this.memoryFallback.size > this.maxEntries) {
        const entries = [...this.memoryFallback.values()].sort((a, b) => a.updatedAt - b.updatedAt);
        const excess = entries.length - this.maxEntries;
        for (let i = 0; i < excess; i++) {
          const entry = entries[i];
          if (entry) this.memoryFallback.delete(entry.key);
        }
      }
      return;
    }
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
    await this.prune(db);
  }

  private async prune(db: IDBDatabase): Promise<void> {
    const count = await new Promise<number>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(0);
      } catch {
        resolve(0);
      }
    });
    const excess = count - this.maxEntries;
    if (excess <= 0) return;

    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const idx = tx.objectStore(STORE_NAME).index('updatedAt');
        let removed = 0;
        const cursorReq = idx.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor || removed >= excess) return;
          cursor.delete();
          removed++;
          cursor.continue();
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  async stats(): Promise<CacheStats> {
    const db = await this.openDb();
    if (!db) {
      let estimatedBytes = 0;
      for (const rec of this.memoryFallback.values()) {
        estimatedBytes += rec.bytes;
      }
      return { count: this.memoryFallback.size, estimatedBytes };
    }
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        let count = 0;
        let estimatedBytes = 0;
        const req = tx.objectStore(STORE_NAME).openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) {
            resolve({ count, estimatedBytes });
            return;
          }
          const rec = cursor.value as CacheRecord;
          count++;
          estimatedBytes += rec.bytes || (rec.key.length + rec.value.length) * 2;
          cursor.continue();
        };
        req.onerror = () => resolve({ count: 0, estimatedBytes: 0 });
      } catch {
        resolve({ count: 0, estimatedBytes: 0 });
      }
    });
  }

  async clear(): Promise<void> {
    this.memoryFallback.clear();
    const db = await this.openDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }
}
