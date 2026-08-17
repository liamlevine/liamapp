import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDoRGt22B3VtDGgVEuNpyyX8V0dvUKio1w",
  authDomain: "liam120.firebaseapp.com",
  projectId: "liam120",
  storageBucket: "liam120.firebasestorage.app",
  messagingSenderId: "110507682579",
  appId: "1:110507682579:web:1a46f5faeb0a71e0a308e6",
  measurementId: "G-YY3FG3B245"
};

const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth = getAuth(app);
const db = getFirestore(app);

export { app, analytics, auth, db };
