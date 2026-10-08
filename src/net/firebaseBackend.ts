// Firebase implementation of Backend. Only Auth and Realtime Database are imported (no analytics).

import { getApps, initializeApp } from 'firebase/app';
import {
  browserSessionPersistence,
  connectAuthEmulator,
  getAuth,
  setPersistence,
  signInAnonymously,
} from 'firebase/auth';
import {
  connectDatabaseEmulator,
  get,
  getDatabase,
  onDisconnect,
  onValue,
  ref,
  runTransaction,
  serverTimestamp,
  set,
  type Database,
} from 'firebase/database';
import { clean, type Backend } from './backend';
import type { NetConfig } from './config';

const EMULATOR_HOST = '127.0.0.1';

/** `appName` lets tests run several independent clients in one process. */
export function createFirebaseBackend(cfg: NetConfig, appName?: string): Backend {
  const app =
    (appName ? getApps().find((a) => a.name === appName) : getApps()[0]) ??
    initializeApp({
      apiKey: cfg.apiKey,
      authDomain: cfg.authDomain,
      projectId: cfg.projectId,
      databaseURL: cfg.databaseURL,
      appId: cfg.appId,
    }, appName);
  const auth = getAuth(app);
  const db: Database = getDatabase(app);
  if (cfg.emulator) {
    connectAuthEmulator(auth, `http://${EMULATOR_HOST}:9099`, { disableWarnings: true });
    connectDatabaseEmulator(db, EMULATOR_HOST, 9000);
  }

  let uid: Promise<string> | null = null;

  return {
    signIn() {
      uid ??= (async () => {
        // Same browser → same anonymous user (that's how rejoining works). Tab identity is for testing.
        if (cfg.tabIdentity) await setPersistence(auth, browserSessionPersistence);
        await auth.authStateReady();
        const user = auth.currentUser ?? (await signInAnonymously(auth)).user;
        return user.uid;
      })();
      uid.catch(() => (uid = null)); // a failed sign-in can be retried without a reload
      return uid;
    },
    async read(path) {
      return (await get(ref(db, path))).val();
    },
    async write(path, value) {
      await set(ref(db, path), clean(value));
    },
    async transaction(path, fn) {
      const res = await runTransaction(ref(db, path), (cur) => {
        const next = fn(cur);
        return next === undefined ? undefined : clean(next);
      }, { applyLocally: false });
      return { committed: res.committed, value: res.snapshot.val() };
    },
    subscribe(path, cb) {
      return onValue(ref(db, path), (snap) => cb(snap.val()));
    },
    onConnection(cb) {
      return onValue(ref(db, '.info/connected'), (snap) => cb(snap.val() === true));
    },
    async onDisconnectWrite(path, value) {
      await onDisconnect(ref(db, path)).set(value);
    },
    serverTime() {
      return serverTimestamp();
    },
  };
}
