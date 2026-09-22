import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue, type Firestore } from "firebase-admin/firestore";
import path from "node:path";
import fs from "node:fs";

let dbInstance: Firestore | null = null;

export function getMithramandaliFirestore(): Firestore {
  if (dbInstance) return dbInstance;

  if (getApps().length === 0) {
    let serviceAccount: any = null;
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      try {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      } catch (e) {
        console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT environment variable:", e);
      }
    }

    if (!serviceAccount) {
      const keyPath = path.resolve(process.cwd(), "mithramandali-service-account.json");
      if (fs.existsSync(keyPath)) {
        serviceAccount = JSON.parse(fs.readFileSync(keyPath, "utf8"));
      } else {
        throw new Error(`Mithramandali service account key not found on disk or environment`);
      }
    }

    initializeApp({
      credential: cert(serviceAccount),
      projectId: "mithramandali-2e7ed",
    });
  }

  dbInstance = getFirestore();
  return dbInstance;
}

const CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function generatePassIdSuffix(): string {
  let res = "";
  for (let i = 0; i < 4; i++) {
    res += CHARSET[Math.floor(Math.random() * CHARSET.length)];
  }
  return res;
}

export async function mintUniquePassId(db: Firestore): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = `MM-MMXXVI-${generatePassIdSuffix()}`;
    const snap = await db.collection("members").doc(candidate).get();
    if (!snap.exists) {
      return candidate;
    }
  }
  return `MM-MMXXVI-${Date.now().toString(36).toUpperCase().slice(-4)}`;
}

export async function unlockMemberPass({
  username,
  igsid,
  fallbackName,
}: {
  username?: string | null;
  igsid?: string | null;
  fallbackName?: string | null;
}): Promise<{ passId: string; name: string; alreadyActive: boolean }> {
  const db = getMithramandaliFirestore();
  const cleanInsta = (username || "").trim().replace(/^@/, "").toLowerCase();

  // 1. Check if member already has an active pass by IGSID or Insta
  if (igsid) {
    const byIgsid = await db.collection("members").where("igsid", "==", igsid).limit(1).get();
    if (!byIgsid.empty) {
      const doc = byIgsid.docs[0];
      return { passId: doc.id, name: doc.data().name || "Mithrudu", alreadyActive: true };
    }
  }

  if (cleanInsta) {
    const byInsta = await db.collection("members").where("insta", "==", cleanInsta).limit(1).get();
    if (!byInsta.empty) {
      const doc = byInsta.docs[0];
      return { passId: doc.id, name: doc.data().name || "Mithrudu", alreadyActive: true };
    }
  }

  // 2. Lookup pending verification doc
  let memberName = fallbackName || "Mithrudu";
  if (cleanInsta) {
    const pendingDoc = await db.collection("pending_verifications").doc(cleanInsta).get();
    if (pendingDoc.exists) {
      const data = pendingDoc.data();
      if (data?.name) memberName = data.name;
      if (data?.status === "UNLOCKED" && data?.passId) {
        return { passId: data.passId, name: memberName, alreadyActive: true };
      }
    }
  }

  // 3. Mint new pass
  const passId = await mintUniquePassId(db);

  // 4. Write to members collection
  await db.collection("members").doc(passId).set({
    passId,
    name: memberName,
    insta: cleanInsta || "mithrudu",
    isVip: true,
    editsLeft: 2,
    syncedToOpenReply: true,
    igsid: igsid || null,
    createdAt: FieldValue.serverTimestamp(),
  });

  // 5. Update pending_verifications so client onSnapshot immediately fires and reveals
  if (cleanInsta) {
    await db.collection("pending_verifications").doc(cleanInsta).set(
      {
        status: "UNLOCKED",
        passId,
        name: memberName,
        insta: cleanInsta,
        igsid: igsid || null,
        unlockedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  return { passId, name: memberName, alreadyActive: false };
}
