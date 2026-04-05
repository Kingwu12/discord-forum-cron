import 'dotenv/config';

import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';

let cachedApp: App | null = null;

function readServiceAccountFromEnv(): {
  projectId: string;
  clientEmail: string;
  privateKey: string;
} {
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const rawKey = process.env.FIREBASE_PRIVATE_KEY;
  if (!projectId || !clientEmail || !rawKey) {
    throw new Error(
      'Firebase Admin: set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY (no ADC fallback).',
    );
  }
  const privateKey = rawKey.replace(/\\n/g, '\n');
  return { projectId, clientEmail, privateKey };
}

/**
 * Firebase Admin app from explicit service-account env vars.
 * Loads `dotenv` when this module is first evaluated so env is present before `initializeApp`.
 * Idempotent: reuses an existing app if one is already registered.
 */
export function getFirebaseAdminApp(): App {
  if (cachedApp) return cachedApp;
  const existing = getApps()[0];
  if (existing) {
    cachedApp = existing;
    return existing;
  }
  const { projectId, clientEmail, privateKey } = readServiceAccountFromEnv();
  cachedApp = initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
  return cachedApp;
}
