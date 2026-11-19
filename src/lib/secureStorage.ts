/**
 * Encrypted at-rest browser/WebView storage for server URLs, API tokens, and session JWTs.
 *
 * Uses WebCrypto AES-256-GCM (`window.crypto.subtle`) when running in a secure context
 * (HTTPS, localhost, Tauri, Capacitor) with a non-extractable key stored in IndexedDB
 * (falling back to a PBKDF2-derived key when IndexedDB is unavailable).
 *
 * When `crypto.subtle` is unavailable (e.g. plain HTTP LAN access in a browser or WebView),
 * falls back cleanly and non-blockingly to an obfuscated payload format so LAN HTTP
 * never breaks, while transparently migrating any legacy plaintext entries on load.
 */

export type SecureStorageMode = 'webcrypto-aes-gcm' | 'fallback-obfuscated' | 'unavailable';

export interface SecureStorageStatus {
  mode: SecureStorageMode;
  initialized: boolean;
  subtleAvailable: boolean;
}

const ENC_PREFIX = 'enc:v1:';
const OBF_PREFIX = 'obf:v1:';
const VAULT_SEED_KEY = '__pve_panel_vault_seed_v1';
const IDB_NAME = 'pve_center_secure_keystore';
const IDB_STORE = 'keys';
const IDB_KEY_ID = 'aes_gcm_master_v1';
const IDB_TIMEOUT_MS = 400;

const memoryCache = new Map<string, string>();
const keyVersions = new Map<string, number>();
const keyWriteChains = new Map<string, Promise<void>>();
const knownKeys = new Set<string>();

let initPromise: Promise<void> | null = null;
let initialized = false;
let activeMode: SecureStorageMode = 'unavailable';
let cachedIdbKey: CryptoKey | null | undefined;
let cachedDerivedKey: CryptoKey | null | undefined;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function hasSubtleCrypto(): boolean {
  return isBrowser() && Boolean(window.crypto?.subtle);
}

function safeLocalStorageGet(key: string): string | null {
  if (!isBrowser()) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key: string, value: string): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage quota or restricted-mode errors; memoryCache still holds the value
  }
}

function safeLocalStorageRemove(key: string): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore restricted storage errors
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(encoded: string): Uint8Array | null {
  if (!encoded) return null;
  try {
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (padded.length % 4)) % 4;
    const binary = atob(padded + '='.repeat(padLen));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

function getRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  if (isBrowser() && window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(bytes);
    return bytes;
  }
  for (let i = 0; i < length; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

function getOrCreateVaultSeed(): Uint8Array {
  const existing = safeLocalStorageGet(VAULT_SEED_KEY);
  if (existing) {
    const decoded = fromBase64Url(existing);
    if (decoded && decoded.length === 32) {
      return decoded;
    }
  }
  const fresh = getRandomBytes(32);
  safeLocalStorageSet(VAULT_SEED_KEY, toBase64Url(fresh));
  return fresh;
}

function deriveKeystream(seed: Uint8Array, nonce: Uint8Array, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < seed.length; i += 1) {
    h1 = Math.imul(h1 ^ seed[i], 0x01000193) >>> 0;
  }
  for (let i = 0; i < nonce.length; i += 1) {
    h2 = Math.imul(h2 ^ nonce[i], 0x85ebca6b) >>> 0;
  }
  for (let i = 0; i < length; i += 1) {
    h1 = Math.imul(h1 ^ (seed[i % seed.length] + i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (nonce[i % nonce.length] + (i * 7)), 0xc2b2ae35) >>> 0;
    const mixed = (h1 ^ (h2 >>> 13) ^ (h1 << 7)) >>> 0;
    out[i] = (mixed ^ (mixed >>> 16)) & 0xff;
  }
  return out;
}

function obfuscateFallback(plaintext: string): string {
  const seed = getOrCreateVaultSeed();
  const nonce = getRandomBytes(16);
  const plainBytes = textEncoder.encode(plaintext);
  const stream = deriveKeystream(seed, nonce, plainBytes.length);
  const masked = new Uint8Array(plainBytes.length);
  for (let i = 0; i < plainBytes.length; i += 1) {
    masked[i] = plainBytes[i] ^ stream[i];
  }
  return `${OBF_PREFIX}${toBase64Url(nonce)}.${toBase64Url(masked)}`;
}

function deobfuscateFallback(payload: string): string | null {
  if (!payload.startsWith(OBF_PREFIX)) return null;
  const body = payload.slice(OBF_PREFIX.length);
  const sep = body.indexOf('.');
  if (sep <= 0) return null;
  const nonce = fromBase64Url(body.slice(0, sep));
  const masked = fromBase64Url(body.slice(sep + 1));
  if (!nonce || !masked) return null;
  const seed = getOrCreateVaultSeed();
  const stream = deriveKeystream(seed, nonce, masked.length);
  const plainBytes = new Uint8Array(masked.length);
  for (let i = 0; i < masked.length; i += 1) {
    plainBytes[i] = masked[i] ^ stream[i];
  }
  try {
    return textDecoder.decode(plainBytes);
  } catch {
    return null;
  }
}

async function openKeystoreDb(): Promise<IDBDatabase | null> {
  if (!isBrowser() || typeof window.indexedDB === 'undefined') {
    return null;
  }

  return new Promise<IDBDatabase | null>((resolve) => {
    let settled = false;
    const finish = (db: IDBDatabase | null) => {
      if (settled) return;
      settled = true;
      resolve(db);
    };

    const timer = window.setTimeout(() => finish(null), IDB_TIMEOUT_MS);

    try {
      const req = window.indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        try {
          const db = req.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) {
            db.createObjectStore(IDB_STORE);
          }
        } catch {
          // Ignore upgrade errors; handled below
        }
      };
      req.onsuccess = () => {
        window.clearTimeout(timer);
        finish(req.result);
      };
      req.onerror = () => {
        window.clearTimeout(timer);
        finish(null);
      };
      req.onblocked = () => {
        window.clearTimeout(timer);
        finish(null);
      };
    } catch {
      window.clearTimeout(timer);
      finish(null);
    }
  });
}

async function readIdbKey(db: IDBDatabase): Promise<CryptoKey | null> {
  return new Promise<CryptoKey | null>((resolve) => {
    let settled = false;
    const finish = (val: CryptoKey | null) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };
    const timer = window.setTimeout(() => finish(null), IDB_TIMEOUT_MS);
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(IDB_KEY_ID);
      req.onsuccess = () => {
        window.clearTimeout(timer);
        const val = req.result;
        finish(val instanceof CryptoKey ? val : null);
      };
      req.onerror = () => {
        window.clearTimeout(timer);
        finish(null);
      };
    } catch {
      window.clearTimeout(timer);
      finish(null);
    }
  });
}

async function writeIdbKey(db: IDBDatabase, key: CryptoKey): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const timer = window.setTimeout(() => finish(false), IDB_TIMEOUT_MS);
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const req = store.put(key, IDB_KEY_ID);
      tx.oncomplete = () => {
        window.clearTimeout(timer);
        finish(true);
      };
      req.onerror = () => {
        window.clearTimeout(timer);
        finish(false);
      };
      tx.onerror = () => {
        window.clearTimeout(timer);
        finish(false);
      };
    } catch {
      window.clearTimeout(timer);
      finish(false);
    }
  });
}

async function getIdbAesKey(): Promise<CryptoKey | null> {
  if (cachedIdbKey !== undefined) return cachedIdbKey;
  if (!hasSubtleCrypto()) {
    cachedIdbKey = null;
    return null;
  }

  let db: IDBDatabase | null = null;
  try {
    db = await openKeystoreDb();
    if (!db) {
      cachedIdbKey = null;
      return null;
    }

    const existing = await readIdbKey(db);
    if (existing) {
      cachedIdbKey = existing;
      return existing;
    }

    const generated = await window.crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
    const saved = await writeIdbKey(db, generated);
    if (saved) {
      cachedIdbKey = generated;
      return generated;
    }
    cachedIdbKey = null;
    return null;
  } catch {
    cachedIdbKey = null;
    return null;
  } finally {
    if (db) {
      try {
        db.close();
      } catch {
        // Ignore close errors
      }
    }
  }
}

async function getDerivedAesKey(): Promise<CryptoKey | null> {
  if (cachedDerivedKey !== undefined) return cachedDerivedKey;
  if (!hasSubtleCrypto()) {
    cachedDerivedKey = null;
    return null;
  }

  try {
    const seed = getOrCreateVaultSeed();
    const seedCopy = new Uint8Array(seed.length);
    seedCopy.set(seed);
    const origin = window.location?.origin || 'local';
    const salt = textEncoder.encode(`pve-center-clients:aes256-gcm:v1:${origin}`);

    const baseKey = await window.crypto.subtle.importKey(
      'raw',
      seedCopy,
      'PBKDF2',
      false,
      ['deriveKey']
    );

    const derived = await window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: 10_000,
        hash: 'SHA-256',
      },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
    cachedDerivedKey = derived;
    return derived;
  } catch {
    cachedDerivedKey = null;
    return null;
  }
}

async function getPreferredAesKey(): Promise<{ key: CryptoKey; kind: 'idb' | 'drv' } | null> {
  const idbKey = await getIdbAesKey();
  if (idbKey) return { key: idbKey, kind: 'idb' };
  const drvKey = await getDerivedAesKey();
  if (drvKey) return { key: drvKey, kind: 'drv' };
  return null;
}

async function encryptPayload(plaintext: string): Promise<string> {
  const aes = await getPreferredAesKey();
  if (aes) {
    try {
      const iv = new Uint8Array(12);
      if (window.crypto?.getRandomValues) {
        window.crypto.getRandomValues(iv);
      } else {
        iv.set(getRandomBytes(12));
      }
      const cipherBuffer = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        aes.key,
        textEncoder.encode(plaintext)
      );
      const cipherBytes = new Uint8Array(cipherBuffer);
      return `${ENC_PREFIX}${aes.kind}:${toBase64Url(iv)}.${toBase64Url(cipherBytes)}`;
    } catch {
      // Fall back cleanly if subtle encrypt fails in a restricted WebView
    }
  }
  return obfuscateFallback(plaintext);
}

async function decryptPayload(payload: string): Promise<string | null> {
  if (!payload.startsWith(ENC_PREFIX)) return null;
  if (!hasSubtleCrypto()) return null;

  const rest = payload.slice(ENC_PREFIX.length);
  const colonIdx = rest.indexOf(':');
  if (colonIdx <= 0) return null;

  const kind = rest.slice(0, colonIdx);
  const cipherPart = rest.slice(colonIdx + 1);
  const dotIdx = cipherPart.indexOf('.');
  if (dotIdx <= 0) return null;

  const iv = fromBase64Url(cipherPart.slice(0, dotIdx));
  const cipherBytes = fromBase64Url(cipherPart.slice(dotIdx + 1));
  if (!iv || !cipherBytes) return null;

  const key = kind === 'idb' ? await getIdbAesKey() : kind === 'drv' ? await getDerivedAesKey() : null;
  if (!key) return null;

  try {
    const ivCopy = new Uint8Array(iv.length);
    ivCopy.set(iv);
    const cipherCopy = new Uint8Array(cipherBytes.length);
    cipherCopy.set(cipherBytes);
    const plainBuffer = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivCopy },
      key,
      cipherCopy
    );
    return textDecoder.decode(plainBuffer);
  } catch {
    return null;
  }
}

async function hydrateKey(key: string): Promise<void> {
  const versionAtStart = keyVersions.get(key) ?? 0;
  const raw = safeLocalStorageGet(key);
  if (raw === null || raw === '') return;

  if (raw.startsWith(ENC_PREFIX)) {
    const decrypted = await decryptPayload(raw);
    if ((keyVersions.get(key) ?? 0) !== versionAtStart) return;
    if (decrypted !== null) {
      memoryCache.set(key, decrypted);
    } else if (hasSubtleCrypto()) {
      // Unrecoverable ciphertext (e.g., cleared IndexedDB keystore); clear cleanly
      safeLocalStorageRemove(key);
      memoryCache.delete(key);
    }
    return;
  }

  if (raw.startsWith(OBF_PREFIX)) {
    const decoded = deobfuscateFallback(raw);
    if ((keyVersions.get(key) ?? 0) !== versionAtStart) return;
    if (decoded === null) {
      safeLocalStorageRemove(key);
      memoryCache.delete(key);
      return;
    }
    memoryCache.set(key, decoded);
    if (activeMode === 'webcrypto-aes-gcm') {
      const upgraded = await encryptPayload(decoded);
      if ((keyVersions.get(key) ?? 0) === versionAtStart) {
        safeLocalStorageSet(key, upgraded);
      }
    }
    return;
  }

  // Legacy plaintext value found in localStorage -> cache & migrate at rest immediately
  if ((keyVersions.get(key) ?? 0) !== versionAtStart) return;
  memoryCache.set(key, raw);
  const encrypted = await encryptPayload(raw);
  if ((keyVersions.get(key) ?? 0) === versionAtStart) {
    safeLocalStorageSet(key, encrypted);
  }
}

function enqueuePersist(key: string, value: string, version: number): Promise<void> {
  const prev = keyWriteChains.get(key) ?? Promise.resolve();
  const next = prev
    .catch(() => {
      // Isolate prior task errors
    })
    .then(async () => {
      if (initPromise) {
        await initPromise;
      }
      if ((keyVersions.get(key) ?? 0) !== version) return;
      const encoded = await encryptPayload(value);
      if ((keyVersions.get(key) ?? 0) !== version) return;
      safeLocalStorageSet(key, encoded);
    });
  keyWriteChains.set(key, next);
  return next;
}

/**
 * Initialize WebCrypto key resolution and transparently migrate/decrypt any persisted
 * entries for `keysToPreload`. Safe to call multiple times; never throws.
 */
export async function initSecureStorage(keysToPreload: string[] = []): Promise<void> {
  for (const key of keysToPreload) {
    if (key) knownKeys.add(key);
  }

  if (!isBrowser()) {
    initialized = true;
    activeMode = 'unavailable';
    return;
  }

  if (!initPromise) {
    initPromise = (async () => {
      const aes = await getPreferredAesKey();
      if (aes) {
        activeMode = 'webcrypto-aes-gcm';
      } else {
        activeMode = 'fallback-obfuscated';
      }

      const initialKeys = Array.from(knownKeys);
      await Promise.all(initialKeys.map((k) => hydrateKey(k)));
      initialized = true;
    })().catch(() => {
      activeMode = hasSubtleCrypto() ? 'webcrypto-aes-gcm' : 'fallback-obfuscated';
      initialized = true;
    });
  }

  await initPromise;

  // Hydrate any keys added after initial init call
  const missing = keysToPreload.filter((k) => k && !memoryCache.has(k) && safeLocalStorageGet(k) !== null);
  if (missing.length > 0) {
    await Promise.all(missing.map((k) => hydrateKey(k)));
  }
}

/**
 * Synchronously read a credential or URL from the decrypted in-memory cache (or decode
 * legacy plaintext / obfuscated fallback values on the fly while scheduling migration).
 */
export function getSecureItem(key: string): string {
  if (!isBrowser() || !key) return '';
  if (memoryCache.has(key)) {
    return memoryCache.get(key) || '';
  }

  const raw = safeLocalStorageGet(key);
  if (!raw) return '';

  if (raw.startsWith(OBF_PREFIX)) {
    const decoded = deobfuscateFallback(raw);
    if (decoded === null) return '';
    memoryCache.set(key, decoded);
    if (hasSubtleCrypto()) {
      const ver = keyVersions.get(key) ?? 0;
      void enqueuePersist(key, decoded, ver);
    }
    return decoded;
  }

  if (raw.startsWith(ENC_PREFIX)) {
    // Needs async WebCrypto decryption; trigger hydration if not already started
    void initSecureStorage([key]);
    return '';
  }

  // Legacy plaintext value read before initSecureStorage ran: return & schedule migration
  memoryCache.set(key, raw);
  knownKeys.add(key);
  const ver = keyVersions.get(key) ?? 0;
  void enqueuePersist(key, raw, ver);
  return raw;
}

/**
 * Synchronously update the decrypted in-memory cache and asynchronously encrypt & persist
 * the value at rest.
 */
export function setSecureItem(key: string, value: string): void {
  if (!isBrowser() || !key) return;
  knownKeys.add(key);
  const nextVer = (keyVersions.get(key) ?? 0) + 1;
  keyVersions.set(key, nextVer);

  if (!value) {
    memoryCache.delete(key);
    safeLocalStorageRemove(key);
    return;
  }

  memoryCache.set(key, value);
  if (!hasSubtleCrypto()) {
    // Synchronous write when subtle is unavailable
    safeLocalStorageSet(key, obfuscateFallback(value));
    return;
  }
  void enqueuePersist(key, value, nextVer);
}

/**
 * Update a credential and await its encrypted persistence to storage.
 */
export async function setSecureItemAsync(key: string, value: string): Promise<void> {
  if (!isBrowser() || !key) return;
  knownKeys.add(key);
  const nextVer = (keyVersions.get(key) ?? 0) + 1;
  keyVersions.set(key, nextVer);

  if (!value) {
    memoryCache.delete(key);
    safeLocalStorageRemove(key);
    return;
  }

  memoryCache.set(key, value);
  if (!hasSubtleCrypto()) {
    safeLocalStorageSet(key, obfuscateFallback(value));
    return;
  }
  await enqueuePersist(key, value, nextVer);
}

/**
 * Immediately purge a key from memory cache and underlying storage.
 */
export function removeSecureItem(key: string): void {
  if (!isBrowser() || !key) return;
  const nextVer = (keyVersions.get(key) ?? 0) + 1;
  keyVersions.set(key, nextVer);
  memoryCache.delete(key);
  safeLocalStorageRemove(key);
}

export function getSecureStorageStatus(): SecureStorageStatus {
  return {
    mode: activeMode,
    initialized,
    subtleAvailable: hasSubtleCrypto(),
  };
}
