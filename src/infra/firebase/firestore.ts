import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getFirebaseAdminApp } from './admin';

let cachedDb: Firestore | null = null;

/** Shared Firestore instance for server-side repositories. */
export function getFirestoreDb(): Firestore {
  if (cachedDb) return cachedDb;
  cachedDb = getFirestore(getFirebaseAdminApp());
  return cachedDb;
}
