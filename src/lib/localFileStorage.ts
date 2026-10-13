// IndexedDB Local File Storage for SOMA Academic Hub
// Bypasses Firebase Storage Blaze billing requirement and Firestore 1MB limit.

const DB_NAME = 'soma_local_files_db';
const STORE_NAME = 'files';
const DB_VERSION = 1;

export const openLocalFilesDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
};

export const saveLocalFile = async (fileId: string, file: File | Blob): Promise<string> => {
  const db = await openLocalFilesDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(file, fileId);
    request.onsuccess = () => {
      const blobUrl = URL.createObjectURL(file);
      resolve(blobUrl);
    };
    request.onerror = () => reject(request.error);
  });
};

export const getLocalFile = async (fileId: string): Promise<Blob | null> => {
  const db = await openLocalFilesDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(fileId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
};

export const getLocalFileUrl = async (fileId: string): Promise<string | null> => {
  const blob = await getLocalFile(fileId);
  if (!blob) return null;
  return URL.createObjectURL(blob);
};

export const deleteLocalFile = async (fileId: string): Promise<void> => {
  const db = await openLocalFilesDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(fileId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};
