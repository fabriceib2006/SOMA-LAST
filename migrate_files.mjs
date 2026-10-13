import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs, updateDoc } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Buffer } from 'buffer';

const firebaseConfig = {
  projectId: 'gen-lang-client-0955648490',
  storageBucket: 'gen-lang-client-0955648490.firebasestorage.app'
};

const app = initializeApp(firebaseConfig);
// Specify the correct database
const db = getFirestore(app);
const storage = getStorage(app);

async function migrateCollection(collectionName) {
  console.log(`Starting migration for collection: ${collectionName}`);
  const q = query(collection(db, collectionName), where('fileData', '!=', null));
  const snapshot = await getDocs(q);
  
  let count = 0;
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const base64Data = data.fileData;
    
    if (base64Data) {
      console.log(`Migrating doc: ${doc.id}`);
      try {
        const buffer = Buffer.from(base64Data, 'base64');
        const fileName = data.fileName || `migrated_file_${doc.id}`;
        const filePath = `migrated/${doc.id}/${fileName}`;
        const storageRef = ref(storage, filePath);
        
        await uploadBytes(storageRef, buffer, {
          contentType: data.mimeType || 'application/octet-stream'
        });
        
        const url = await getDownloadURL(storageRef);
        
        await updateDoc(doc.ref, {
          storagePath: filePath,
          fileUrl: url,
          fileData: null 
        });
        
        count++;
      } catch (error) {
        console.error(`Error migrating doc ${doc.id}:`, error);
      }
    }
  }
  console.log(`Finished migration for ${collectionName}. Migrated ${count} docs.`);
}

async function runMigration() {
  await migrateCollection('lecture_materials');
  await migrateCollection('assessments');
  await migrateCollection('topics');
  console.log('Migration complete.');
}

runMigration().catch(console.error);
