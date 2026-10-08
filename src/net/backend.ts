// The small slice of a realtime database the room logic needs. Firebase implements it in
// firebaseBackend.ts; tests use the in-memory version in memoryBackend.ts.

export type Unsubscribe = () => void;

export interface Backend {
  /** Sign in (anonymously) and return this device's player id. */
  signIn(): Promise<string>;
  read(path: string): Promise<unknown>;
  /** Plain write. Never used for game state (that always goes through `transaction`). */
  write(path: string, value: unknown): Promise<void>;
  /**
   * Atomic read-modify-write. `fn` gets the current value and returns the new one, or `undefined`
   * to abort. Like Firebase, `fn` may run more than once if someone else wrote first.
   */
  transaction<T>(path: string, fn: (current: T | null) => T | null | undefined): Promise<{ committed: boolean; value: T | null }>;
  subscribe(path: string, cb: (value: unknown) => void): Unsubscribe;
  /** Is this device connected to the database right now? */
  onConnection(cb: (connected: boolean) => void): Unsubscribe;
  /** Value the server writes at `path` if this device disconnects. */
  onDisconnectWrite(path: string, value: unknown): Promise<void>;
  /** Placeholder the server replaces with its own clock. */
  serverTime(): unknown;
}

/** The database rejects `undefined`; strip it (deeply) before writing. */
export function clean<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clean) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = clean(v);
    return out as T;
  }
  return value;
}
