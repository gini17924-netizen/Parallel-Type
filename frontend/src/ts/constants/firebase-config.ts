/**
 * Build-time resolution for the dynamic import in ts/firebase.ts.
 *
 * vite.config.ts aliases this specifier to ./firebase-config-live at build
 * time (desktop offline build). This module exists so `tsc --noEmit`
 * (npm run ts-check) can resolve the same specifier statically; it
 * re-exports the same intentionally empty config as a fallback.
 */
export { firebaseConfig } from "./firebase-config-live";
