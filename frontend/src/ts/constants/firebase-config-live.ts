/**
 * Desktop (offline) build: intentionally empty config.
 * Firebase will not initialize and the app boots in signed-out,
 * local-only mode. Results, personal bests and stats are persisted
 * to localStorage via utils/local-persistence.
 */
export const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  databaseURL: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
};
