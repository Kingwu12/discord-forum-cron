import { applicationDefault, getApps, initializeApp, type App } from 'firebase-admin/app';

let cachedApp: App | null = null;

/**
 * Default Firebase Admin app (ADC / GOOGLE_APPLICATION_CREDENTIALS).
 * Idempotent: reuses an existing app if one is already registered.
 */
export function getFirebaseAdminApp(): App {
  if (cachedApp) return cachedApp;
  const existing = getApps()[0];
  if (existing) {
    cachedApp = existing;
    return existing;
  }
  cachedApp = initializeApp({
    credential: applicationDefault(),
  });
  return cachedApp;
}
