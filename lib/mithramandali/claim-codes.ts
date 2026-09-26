import { getMithramandaliFirestore } from "./firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

// Crockford Base32 alphabet (32 chars): excluding I, L, O, U to avoid visual ambiguity
export const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CLAIM_CODE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function generateRawCrockfordCode(length = 10): string {
  let result = "";
  for (let i = 0; i < length; i++) {
    const idx = Math.floor(Math.random() * CROCKFORD_ALPHABET.length);
    result += CROCKFORD_ALPHABET[idx];
  }
  return result;
}

export function formatCrockfordCode(clean: string): string {
  if (!clean || clean.length !== 10) return clean;
  return `${clean.slice(0, 4)}-${clean.slice(4, 8)}-${clean.slice(8, 10)}`;
}

export function normaliseCode(raw: string): string {
  if (!raw) return "";
  return raw
    .toUpperCase()
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/[^0-9A-HJKMNP-TV-Z]/g, "")
    .slice(0, 10);
}

export interface IssueClaimCodeParams {
  igsid?: string | null;
  username?: string | null;
  name?: string | null;
}

export interface IssueClaimCodeResult {
  ok: boolean;
  alreadyActive: boolean;
  passId?: string;
  name?: string;
  code?: string;
  formattedCode?: string;
  expiresAtMs?: number;
  message?: string;
}

/**
 * Issues a single-use 24-hour Crockford-Base32 Claim Code for Mithramandali.
 * 
 * 1. Checks if the user already has an active pass in Firestore 'members' collection
 *    (matched by permanent IGSID or @handle). If so, returns alreadyActive: true with their passId.
 * 2. Checks if the user already has an active, unexpired claim code in 'claim_codes'.
 *    If so, returns that existing code (idempotent / repeat trigger prevention).
 * 3. Otherwise, generates a fresh 10-char Crockford code and saves it to 'claim_codes/{cleanCode}'.
 */
export async function issueClaimCode({
  igsid,
  username,
  name,
}: IssueClaimCodeParams): Promise<IssueClaimCodeResult> {
  const db = getMithramandaliFirestore();
  const cleanInsta = (username || "").trim().replace(/^@/, "").toLowerCase();
  const cleanIgsid = (igsid || "").trim();
  const now = Date.now();

  // 1. Check if user already has an active pass in 'members'
  let existingPassId: string | null = null;
  let existingName: string = name || "Mithrudu";

  if (cleanIgsid) {
    const snap = await db.collection("members").where("igsid", "==", cleanIgsid).limit(1).get();
    if (!snap.empty) {
      const doc = snap.docs[0];
      existingPassId = doc.id;
      if (doc.data().name) existingName = doc.data().name;
    }
  }

  if (!existingPassId && cleanInsta) {
    const snap = await db.collection("members").where("insta", "==", cleanInsta).limit(1).get();
    if (!snap.empty) {
      const doc = snap.docs[0];
      existingPassId = doc.id;
      if (doc.data().name) existingName = doc.data().name;
    }
  }

  if (existingPassId) {
    return {
      ok: true,
      alreadyActive: true,
      passId: existingPassId,
      name: existingName,
    };
  }

  // 2. Check if user already has an active, unexpired code in 'claim_codes'
  if (cleanIgsid) {
    const activeSnap = await db
      .collection("claim_codes")
      .where("igsid", "==", cleanIgsid)
      .where("status", "==", "ISSUED")
      .limit(1)
      .get();

    if (!activeSnap.empty) {
      const doc = activeSnap.docs[0];
      const data = doc.data();
      const expMs = data.expiresAt ? data.expiresAt.toMillis() : 0;
      if (expMs > now) {
        return {
          ok: true,
          alreadyActive: false,
          name: existingName,
          code: data.code,
          formattedCode: data.formattedCode || formatCrockfordCode(data.code),
          expiresAtMs: expMs,
        };
      }
    }
  }

  // 3. Generate a collision-free fresh 10-char Crockford code
  let cleanCode = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateRawCrockfordCode(10);
    const docCheck = await db.collection("claim_codes").doc(candidate).get();
    if (!docCheck.exists) {
      cleanCode = candidate;
      break;
    }
  }

  if (!cleanCode) {
    cleanCode = generateRawCrockfordCode(10);
  }

  const formattedCode = formatCrockfordCode(cleanCode);
  const expiresAtMs = now + CLAIM_CODE_TTL_MS;

  // 4. Save to Firestore 'claim_codes/{cleanCode}'
  await db.collection("claim_codes").doc(cleanCode).set({
    code: cleanCode,
    formattedCode: formattedCode,
    igsid: cleanIgsid || null,
    insta: cleanInsta || null,
    name: existingName,
    status: "ISSUED",
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(expiresAtMs),
    redeemedAt: null,
    redeemedPassId: null,
  });

  return {
    ok: true,
    alreadyActive: false,
    name: existingName,
    code: cleanCode,
    formattedCode: formattedCode,
    expiresAtMs: expiresAtMs,
  };
}
