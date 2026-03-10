import admin from 'firebase-admin';
import type { messaging } from 'firebase-admin';
import { env } from './env.js';

let firebaseInitialized = false;

try {
  const raw = env.FIREBASE_SERVICE_ACCOUNT;
  if (raw && raw.trim()) {
    const serviceAccount = JSON.parse(raw);
    if (serviceAccount.project_id) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      firebaseInitialized = true;
      console.log('[Firebase] ✓ Initialized with project:', serviceAccount.project_id);
    } else {
      console.warn('[Firebase] ✗ FIREBASE_SERVICE_ACCOUNT missing project_id — FCM disabled');
    }
  } else {
    console.warn('[Firebase] ✗ FIREBASE_SERVICE_ACCOUNT not configured — FCM disabled');
  }
} catch (err) {
  console.error('[Firebase] ✗ Failed to parse FIREBASE_SERVICE_ACCOUNT:', (err as Error).message);
}

export const firebaseAdmin = admin;

export function isFcmAvailable(): boolean {
  return firebaseInitialized;
}

export function getFcm(): messaging.Messaging | null {
  if (!firebaseInitialized) return null;
  return admin.messaging();
}
