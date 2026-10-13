import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, limit, query } from 'firebase/firestore';

const firebaseConfig = {
  projectId: 'gen-lang-client-0955648490',
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function checkData() {
  try {
    const q = query(collection(db, 'topics'), limit(5));
    const snapshot = await getDocs(q);
    console.log(`Found ${snapshot.docs.length} materials.`);
    snapshot.docs.forEach(doc => {
      console.log('Doc:', doc.id, 'Data keys:', Object.keys(doc.data()));
    });
  } catch (error) {
    console.error('Error:', error);
  }
}

checkData();
