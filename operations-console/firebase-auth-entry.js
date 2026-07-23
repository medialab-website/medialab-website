import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";

const firebaseConfig = {
  projectId: "gen-lang-client-0976387792",
  appId: "1:77822634647:web:1035dbc8fe1e9d532157d2",
  storageBucket: "gen-lang-client-0976387792.firebasestorage.app",
  apiKey: "AIzaSyAtFudMvEBfnauEBGYjikkKHt0Q5tEPH_M",
  authDomain: "gen-lang-client-0976387792.firebaseapp.com",
  messagingSenderId: "77822634647",
  measurementId: "G-KMWYT8W14N"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

export { auth, provider, signInWithPopup, signOut, onAuthStateChanged };
