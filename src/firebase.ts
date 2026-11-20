import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, type User } from 'firebase/auth';
import {
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import type { CampNightDTO, SlotSummaryDTO } from './shared/constants';

const app = initializeApp(firebaseConfig);

/* CRITICAL: Always pass firebaseConfig.firestoreDatabaseId to getFirestore */
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<'connected' | 'offline' | 'error'> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return 'connected';
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
      return 'offline';
    }
    return 'error';
  }
}

void testConnection();

function mapReportStatus(
  status: SlotSummaryDTO['reportStatus']
): 'not_started' | 'draft' | 'submitted' {
  if (status === 'Menunggu pengesahan' || status === 'Diterima oleh penyelaras') {
    return 'submitted';
  }
  if (status === 'Draf') return 'draft';
  return 'not_started';
}

function clampString(value: string | null | undefined, maxLen: number): string {
  return (value ?? '').trim().slice(0, maxLen);
}

export async function upsertUserPrivateProfile(user: User): Promise<void> {
  if (!user.emailVerified || !user.email) return;
  const path = `users_private/${user.uid}`;
  const ref = doc(db, 'users_private', user.uid);
  const displayName = clampString(user.displayName || user.email.split('@')[0], 120) || 'Guru';
  const email = clampString(user.email, 180);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        uid: user.uid,
        email,
        displayName,
        role: 'teacher',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        displayName,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function syncScheduleSnapshotToFirestore(
  user: User,
  campNight: CampNightDTO,
  slots: SlotSummaryDTO[]
): Promise<void> {
  if (!user.emailVerified) {
    throw new Error('Akaun Google mesti mempunyai e-mel yang disahkan sebelum menyelaraskan ke Firestore.');
  }

  const nightDocId = `night_${campNight.id}`;
  const nightPath = `camp_nights/${nightDocId}`;
  const nightRef = doc(db, 'camp_nights', nightDocId);

  const safeTitle = clampString(campNight.title, 200) || `Malam Perkhemahan ${campNight.id}`;
  const safeStartDate = /^\d{4}-\d{2}-\d{2}$/.test(campNight.startDate)
    ? campNight.startDate
    : '2026-01-01';

  try {
    const nightSnap = await getDoc(nightRef);
    if (!nightSnap.exists()) {
      await setDoc(nightRef, {
        nightId: campNight.id,
        title: safeTitle,
        startDate: safeStartDate,
        isActive: Boolean(campNight.isActive),
        ownerUid: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(nightRef, {
        title: safeTitle,
        startDate: safeStartDate,
        isActive: Boolean(campNight.isActive),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, nightPath);
  }

  for (const slot of slots) {
    const slotDocId = `slot_${slot.slotNumber}`;
    const slotPath = `${nightPath}/slots/${slotDocId}`;
    const slotRef = doc(db, 'camp_nights', nightDocId, 'slots', slotDocId);
    const reportStatus = mapReportStatus(slot.reportStatus);
    const safeMembers = slot.members
      .slice(0, 30)
      .map((m) => clampString(m.name, 150))
      .filter(Boolean);

    const slotStart = /^\d{4}-\d{2}-\d{2}$/.test(slot.startDate) ? slot.startDate : safeStartDate;
    const slotEnd = /^\d{4}-\d{2}-\d{2}$/.test(slot.endDate) ? slot.endDate : safeStartDate;

    try {
      const slotSnap = await getDoc(slotRef);
      if (!slotSnap.exists()) {
        await setDoc(slotRef, {
          campNightId: nightDocId,
          slotNumber: slot.slotNumber,
          displayTime: clampString(slot.displayTime, 100) || `Slot ${slot.slotNumber}`,
          startDate: slotStart,
          endDate: slotEnd,
          quota: typeof slot.quota === 'number' ? Math.max(0, Math.min(50, slot.quota)) : 0,
          leaderName: clampString(slot.leaderName, 150),
          memberNames: safeMembers,
          reportStatus,
          ownerUid: user.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(slotRef, {
          displayTime: clampString(slot.displayTime, 100) || `Slot ${slot.slotNumber}`,
          startDate: slotStart,
          endDate: slotEnd,
          quota: typeof slot.quota === 'number' ? Math.max(0, Math.min(50, slot.quota)) : 0,
          leaderName: clampString(slot.leaderName, 150),
          memberNames: safeMembers,
          reportStatus,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, slotPath);
    }

    const reportPath = `${nightPath}/reports/${slotDocId}`;
    const reportRef = doc(db, 'camp_nights', nightDocId, 'reports', slotDocId);
    const hasIncident =
      slot.followUpStatus === 'Ada tindakan susulan'
        ? 'Ya'
        : slot.followUpStatus === 'Tiada'
        ? 'Tidak'
        : '';

    try {
      const repSnap = await getDoc(reportRef);
      if (!repSnap.exists()) {
        await setDoc(reportRef, {
          campNightId: nightDocId,
          slotNumber: slot.slotNumber,
          status: reportStatus,
          leaderName: clampString(slot.leaderName, 150),
          submittedByName: clampString(slot.submittedByName, 150),
          hasIncident,
          handoverStatus: clampString(slot.followUpStatus, 120),
          photoCount: Math.max(0, Math.min(2, slot.photoCount || 0)),
          ownerUid: user.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        const currentStatus = repSnap.data()?.status;
        if (currentStatus !== 'submitted' || user.email === 'g-01294773@moe-dl.edu.my') {
          await updateDoc(reportRef, {
            status: reportStatus,
            leaderName: clampString(slot.leaderName, 150),
            submittedByName: clampString(slot.submittedByName, 150),
            hasIncident,
            handoverStatus: clampString(slot.followUpStatus, 120),
            photoCount: Math.max(0, Math.min(2, slot.photoCount || 0)),
            updatedAt: serverTimestamp(),
          });
        }
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, reportPath);
    }
  }
}
