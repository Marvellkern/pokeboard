// In-memory Backend for tests: one shared store, one Backend per simulated device.
// Mirrors the Firebase behaviors the room logic relies on: atomic transactions, subscriptions,
// dropped nulls/undefined, onDisconnect writes, and connection state.

import { clean, type Backend } from './backend';

type Listener = { path: string; cb: (v: unknown) => void };

export class MemoryStore {
  root: Record<string, unknown> = {};
  listeners = new Set<Listener>();
  now = 1_000_000;

  get(path: string): unknown {
    let node: unknown = this.root;
    for (const key of split(path)) {
      if (node === null || typeof node !== 'object') return null;
      node = (node as Record<string, unknown>)[key];
    }
    return node === undefined ? null : structuredClone(node);
  }

  set(path: string, value: unknown): void {
    const keys = split(path);
    const v = value === null || value === undefined ? null : structuredClone(clean(value));
    if (!keys.length) {
      this.root = (v as Record<string, unknown>) ?? {};
    } else {
      let node = this.root;
      for (const key of keys.slice(0, -1)) {
        if (typeof node[key] !== 'object' || node[key] === null) node[key] = {};
        node = node[key] as Record<string, unknown>;
      }
      const last = keys[keys.length - 1];
      if (v === null) delete node[last];
      else node[last] = v;
    }
    for (const l of this.listeners) {
      if (path.startsWith(l.path) || l.path.startsWith(path)) l.cb(this.get(l.path));
    }
  }
}

const split = (path: string) => path.split('/').filter(Boolean);

export class MemoryBackend implements Backend {
  connected = true;
  private disconnectWrites: [string, unknown][] = [];
  private connListeners = new Set<(c: boolean) => void>();

  constructor(
    readonly store: MemoryStore,
    readonly uid: string,
  ) {}

  async signIn() {
    return this.uid;
  }
  async read(path: string) {
    return this.store.get(path);
  }
  async write(path: string, value: unknown) {
    this.store.set(path, value);
  }
  async transaction<T>(path: string, fn: (current: T | null) => T | null | undefined) {
    const next = fn(this.store.get(path) as T | null);
    if (next === undefined) return { committed: false, value: this.store.get(path) as T | null };
    this.store.set(path, next);
    return { committed: true, value: this.store.get(path) as T | null };
  }
  subscribe(path: string, cb: (v: unknown) => void) {
    const l = { path, cb };
    this.store.listeners.add(l);
    cb(this.store.get(path));
    return () => void this.store.listeners.delete(l);
  }
  onConnection(cb: (c: boolean) => void) {
    this.connListeners.add(cb);
    cb(this.connected);
    return () => void this.connListeners.delete(cb);
  }
  async onDisconnectWrite(path: string, value: unknown) {
    this.disconnectWrites.push([path, value]);
  }
  serverTime() {
    return this.store.now;
  }

  /** Test helper: drop the connection; the server applies this device's onDisconnect writes. */
  disconnect() {
    this.connected = false;
    for (const [p, v] of this.disconnectWrites) this.store.set(p, v);
    this.disconnectWrites = [];
    for (const cb of this.connListeners) cb(false);
  }
  reconnect() {
    this.connected = true;
    for (const cb of this.connListeners) cb(true);
  }
}
