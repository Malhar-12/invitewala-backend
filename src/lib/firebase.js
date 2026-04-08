// ═══════════════════════════════════════════════════════════════
// Firebase Admin SDK — verifies phone OTP tokens from the app
// ═══════════════════════════════════════════════════════════════
const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

let initialized = false;

function initFirebase() {
  if (initialized) return admin;

  let credential;

  // Production (Render): full JSON pasted into env var
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      credential = admin.credential.cert(serviceAccount);
      console.log("🔥 Firebase Admin: using FIREBASE_SERVICE_ACCOUNT_JSON env var");
    } catch (e) {
      console.error("❌ FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON:", e.message);
      process.exit(1);
    }
  }
  // Local dev: read from file in backend/ root
  else {
    const localPath = path.join(__dirname, "..", "..", "firebase-service-account.json");
    if (fs.existsSync(localPath)) {
      credential = admin.credential.cert(require(localPath));
      console.log("🔥 Firebase Admin: using local firebase-service-account.json");
    } else {
      console.error("❌ Firebase credentials missing.");
      console.error("   Local: place firebase-service-account.json in backend/ root");
      console.error("   Render: set FIREBASE_SERVICE_ACCOUNT_JSON env var");
      process.exit(1);
    }
  }

  admin.initializeApp({
    credential,
    projectId: process.env.FIREBASE_PROJECT_ID || undefined,
  });

  initialized = true;
  console.log("✅ Firebase Admin initialized");
  return admin;
}

/**
 * Verifies a Firebase ID token (sent from the app after Phone OTP success).
 * Returns { uid, phone_number } on success, throws on failure.
 */
async function verifyPhoneToken(idToken) {
  if (!idToken || typeof idToken !== "string") {
    throw new Error("Missing ID token");
  }
  const decoded = await admin.auth().verifyIdToken(idToken, true);
  if (!decoded.phone_number) {
    throw new Error("Token does not contain a verified phone number");
  }
  return {
    uid: decoded.uid,
    phone: decoded.phone_number, // E.164 format, e.g. +919876543210
  };
}

module.exports = { initFirebase, verifyPhoneToken, admin };
