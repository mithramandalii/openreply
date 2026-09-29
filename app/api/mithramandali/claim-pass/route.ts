import { NextRequest, NextResponse } from "next/server";
import { getMithramandaliFirestore } from "@/lib/mithramandali/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

const CROCKFORD_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function generateRandomSuffix(): string {
  let s = "";
  for (let i = 0; i < 4; i++) {
    s += CROCKFORD_CHARS.charAt(Math.floor(Math.random() * CROCKFORD_CHARS.length));
  }
  return s;
}

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return req.headers.get("x-real-ip") || "127.0.0.1";
}

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = String(body?.name || "").trim();
    const deviceId = String(body?.deviceId || "").trim();

    if (!name || name.length < 2) {
      return NextResponse.json(
        { ok: false, error: "NAME_TOO_SHORT", message: "Name must be at least 2 characters." },
        { status: 400, headers: corsHeaders }
      );
    }

    if (name.length > 100) {
      return NextResponse.json(
        { ok: false, error: "NAME_TOO_LONG", message: "Name must be less than 100 characters." },
        { status: 400, headers: corsHeaders }
      );
    }

    if (!deviceId || deviceId.length < 6) {
      return NextResponse.json(
        { ok: false, error: "INVALID_DEVICE_ID", message: "Valid device identifier required." },
        { status: 400, headers: corsHeaders }
      );
    }

    const clientIp = getClientIp(req);
    const ipDocId = Buffer.from(clientIp).toString("hex").slice(0, 60);

    const db = getMithramandaliFirestore();

    // 1. Device-Lock Check: 1 pass per device
    const deviceRef = db.collection("deviceClaims").doc(deviceId);
    const deviceSnap = await deviceRef.get();
    if (deviceSnap.exists) {
      const existing = deviceSnap.data();
      return NextResponse.json(
        {
          ok: false,
          error: "DEVICE_ALREADY_CLAIMED",
          message: "A pass has already been claimed on this device.",
          passId: existing?.passId,
          name: existing?.name,
        },
        { status: 409, headers: corsHeaders }
      );
    }

    // 2. IP Rate-Limiting: max 5 claims per 10 minutes
    const ipRef = db.collection("ipClaims").doc(ipDocId);
    const ipSnap = await ipRef.get();
    const now = Date.now();
    const TEN_MINUTES_MS = 10 * 60 * 1000;

    let ipCount = 1;
    let windowStartTime = now;

    if (ipSnap.exists) {
      const ipData = ipSnap.data();
      const wStart = ipData?.windowStart?.toMillis ? ipData.windowStart.toMillis() : (ipData?.windowStartMs || now);
      if (now - wStart < TEN_MINUTES_MS) {
        if ((ipData?.count || 0) >= 5) {
          return NextResponse.json(
            {
              ok: false,
              error: "IP_RATE_LIMITED",
              message: "Too many claims from this network. Please wait a few minutes.",
            },
            { status: 429, headers: corsHeaders }
          );
        }
        ipCount = (ipData?.count || 0) + 1;
        windowStartTime = wStart;
      } else {
        ipCount = 1;
        windowStartTime = now;
      }
    }

    // 3. Generate Pass ID
    const cleanLower = name.toLowerCase().trim();
    let isFounder = false;
    let targetPassId = "";

    if (cleanLower === "akshith") {
      targetPassId = "MM-MMXXVI-0001";
      isFounder = true;
    } else if (cleanLower === "pranu") {
      targetPassId = "MM-MMXXVI-0002";
      isFounder = true;
    } else if (cleanLower === "joshvika") {
      targetPassId = "MM-MMXXVI-0003";
      isFounder = true;
    } else {
      let attempts = 0;
      while (attempts < 10) {
        const candidate = `MM-MMXXVI-${generateRandomSuffix()}`;
        const checkSnap = await db.collection("members").doc(candidate).get();
        if (!checkSnap.exists) {
          targetPassId = candidate;
          break;
        }
        attempts++;
      }
      if (!targetPassId) {
        targetPassId = `MM-MMXXVI-${generateRandomSuffix()}${attempts}`;
      }
    }

    // 4. Atomic Write
    const batch = db.batch();

    const memberRef = db.collection("members").doc(targetPassId);
    batch.set(
      memberRef,
      {
        passId: targetPassId,
        name: name,
        tier: isFounder ? "FOUNDER" : "Royal Founding Citizen",
        isVip: isFounder,
        status: "ACTIVE",
        deviceId: deviceId,
        editsLeft: 1,
        joinedAt: now,
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    batch.set(deviceRef, {
      deviceId: deviceId,
      passId: targetPassId,
      name: name,
      clientIp: clientIp,
      claimedAt: FieldValue.serverTimestamp(),
    });

    batch.set(ipRef, {
      ip: clientIp,
      count: ipCount,
      windowStart: Timestamp.fromMillis(windowStartTime),
      windowStartMs: windowStartTime,
      lastClaimAt: FieldValue.serverTimestamp(),
    });

    await batch.commit();

    return NextResponse.json(
      {
        ok: true,
        passId: targetPassId,
        displayName: name,
        tier: isFounder ? "FOUNDER" : "CITIZEN",
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (err: any) {
    console.error("[claimPass route error]:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Failed to mint pass. Please try again." },
      { status: 500, headers: corsHeaders }
    );
  }
}
