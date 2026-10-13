import { initializeApp } from 'firebase/app';
import { getStorage, ref, listAll, getMetadata } from 'firebase/storage';

const firebaseConfig = {
  projectId: 'gen-lang-client-0955648490',
  storageBucket: 'gen-lang-client-0955648490.firebasestorage.app'
};

const app = initializeApp(firebaseConfig);
const storage = getStorage(app);

async function listFiles() {
  const listRef = ref(storage, '/');
  try {
    const res = await listAll(listRef);
    console.log('Files in storage:');
    res.items.forEach((itemRef) => {
      console.log(itemRef.fullPath);
    });
    res.prefixes.forEach((folderRef) => {
      console.log('Folder:', folderRef.fullPath);
    });
  } catch (error) {
    console.error('Error listing files:', error);
  }
}

listFiles();
