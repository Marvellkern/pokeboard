// Firebase config from VITE_FIREBASE_* env vars. With none set, online play is simply unavailable
// and local play works as before.

export interface NetConfig {
  apiKey: string;
  authDomain?: string;
  projectId: string;
  databaseURL: string;
  appId?: string;
  /** Talk to the local Firebase Emulator (auth :9099, database from databaseURL). */
  emulator: boolean;
  /**
   * Give every browser tab its own anonymous player (session-scoped sign-in). For testing several
   * players in one browser; real players use one tab each on their own device.
   */
  tabIdentity: boolean;
}

export function readNetConfig(env: Record<string, string | undefined> = import.meta.env): NetConfig | null {
  const apiKey = env.VITE_FIREBASE_API_KEY;
  const projectId = env.VITE_FIREBASE_PROJECT_ID;
  const databaseURL = env.VITE_FIREBASE_DATABASE_URL;
  if (!apiKey || !projectId || !databaseURL) return null;
  return {
    apiKey,
    projectId,
    databaseURL,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || undefined,
    appId: env.VITE_FIREBASE_APP_ID || undefined,
    emulator: env.VITE_FIREBASE_EMULATOR === 'true',
    tabIdentity: env.VITE_FIREBASE_TAB_IDENTITY === 'true',
  };
}

export const NOT_SET_UP_MESSAGE = "Online play isn't set up yet.";
