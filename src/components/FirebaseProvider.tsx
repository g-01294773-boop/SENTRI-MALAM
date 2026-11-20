import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  auth,
  googleProvider,
  syncScheduleSnapshotToFirestore,
  testConnection,
  upsertUserPrivateProfile,
} from '../firebase';
import type { CampNightDTO, SlotSummaryDTO } from '../shared/constants';

interface FirebaseContextValue {
  firebaseUser: User | null;
  firebaseReady: boolean;
  connectionStatus: 'checking' | 'connected' | 'offline' | 'error';
  syncing: boolean;
  lastSyncedAt: string | null;
  syncError: string | null;
  signInWithGoogle: () => Promise<User | null>;
  signOutFirebase: () => Promise<void>;
  syncScheduleNow: (campNight: CampNightDTO, slots: SlotSummaryDTO[]) => Promise<void>;
}

const FirebaseContext = createContext<FirebaseContextValue | null>(null);

export function FirebaseProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [firebaseReady, setFirebaseReady] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<
    'checking' | 'connected' | 'offline' | 'error'
  >('checking');
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    void testConnection().then((status) => {
      setConnectionStatus(status);
    });

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setFirebaseReady(true);
      if (user) {
        void upsertUserPrivateProfile(user).catch((err) => {
          console.error('Gagal mengemas kini profil pengguna Firebase:', err);
        });
      }
    });

    return () => unsubscribe();
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setSyncError(null);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      await upsertUserPrivateProfile(cred.user);
      return cred.user;
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Log masuk Google Firebase gagal.';
      setSyncError(msg);
      return null;
    }
  }, []);

  const signOutFirebase = useCallback(async () => {
    setSyncError(null);
    await signOut(auth);
  }, []);

  const syncScheduleNow = useCallback(
    async (campNight: CampNightDTO, slots: SlotSummaryDTO[]) => {
      if (!auth.currentUser) {
        setSyncError('Sila log masuk akaun Google terlebih dahulu untuk menyelaras ke Firestore.');
        return;
      }
      setSyncing(true);
      setSyncError(null);
      try {
        await syncScheduleSnapshotToFirestore(auth.currentUser, campNight, slots);
        setLastSyncedAt(
          new Intl.DateTimeFormat('ms-MY', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          }).format(new Date())
        );
      } catch (err) {
        let friendly = 'Penyelarasan ke Firestore gagal.';
        if (err instanceof Error) {
          try {
            const parsed = JSON.parse(err.message) as { error?: string };
            friendly = parsed.error || err.message;
          } catch {
            friendly = err.message;
          }
        }
        setSyncError(friendly);
      } finally {
        setSyncing(false);
      }
    },
    []
  );

  return (
    <FirebaseContext.Provider
      value={{
        firebaseUser,
        firebaseReady,
        connectionStatus,
        syncing,
        lastSyncedAt,
        syncError,
        signInWithGoogle,
        signOutFirebase,
        syncScheduleNow,
      }}
    >
      {children}
    </FirebaseContext.Provider>
  );
}

export function useFirebase(): FirebaseContextValue {
  const ctx = useContext(FirebaseContext);
  if (!ctx) {
    throw new Error('useFirebase mesti digunakan dalam FirebaseProvider.');
  }
  return ctx;
}
