import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Rate Limiting: In-memory sliding window (defense-in-depth: max 60 requests/min per IP)
const ipRateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 60;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = ipRateLimitMap.get(ip);
  if (!record || now > record.resetAt) {
    ipRateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }
  record.count++;
  return true;
}

/**
 * Strict Fail-Closed Bearer Token Authentication
 * Rejects with 500 if MITHRAMANDALI_API_SECRET is unset in environment.
 * Rejects with 401 if Bearer token is missing or does not match.
 */
function verifyBearerAuth(req: NextRequest): { authorized: boolean; status?: number; error?: string } {
  const expectedSecret = process.env.MITHRAMANDALI_API_SECRET;
  if (!expectedSecret) {
    console.error("[Mithramandali External API] Server Misconfiguration: MITHRAMANDALI_API_SECRET is unset.");
    return {
      authorized: false,
      status: 500,
      error: "Server misconfiguration: MITHRAMANDALI_API_SECRET is not configured on server",
    };
  }

  const authHeader = req.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;
  if (!bearerToken || bearerToken !== expectedSecret) {
    return {
      authorized: false,
      status: 401,
      error: "Unauthorized: Invalid or missing Bearer token",
    };
  }

  return { authorized: true };
}

/**
 * OPTIONS /api/external/mithramandali
 * Preflight handler for browser CORS requests
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

/**
 * GET /api/external/mithramandali
 * Authenticated status inspection
 */
export async function GET(req: NextRequest) {
  try {
    const forwardedFor = req.headers.get("x-forwarded-for");
    const clientIp = forwardedFor ? forwardedFor.split(",")[0].trim() : "127.0.0.1";
    if (!checkRateLimit(clientIp)) {
      return NextResponse.json(
        { success: false, error: "Too many requests: Rate limit exceeded (60 req/min)" },
        { status: 429, headers: corsHeaders }
      );
    }

    const auth = verifyBearerAuth(req);
    if (!auth.authorized) {
      return NextResponse.json(
        { success: false, error: auth.error },
        { status: auth.status || 401, headers: corsHeaders }
      );
    }

    const account = await prisma.instagramAccount.findFirst({
      select: {
        id: true,
        username: true,
        name: true,
        connectedAt: true,
      },
      orderBy: { connectedAt: "desc" },
    });

    if (!account) {
      return NextResponse.json(
        {
          success: false,
          error: "No active Instagram account connected in OpenReply",
        },
        { status: 404, headers: corsHeaders }
      );
    }

    return NextResponse.json(
      {
        success: true,
        connectedAccount: account.username,
        accountName: account.name,
        status: "ACTIVE",
        endpoints: {
          registrationSync: "POST /api/external/mithramandali",
        },
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500, headers: corsHeaders }
    );
  }
}

/**
 * POST /api/external/mithramandali
 * Syncs new member registration from Mithramandali Cloud Functions to OpenReply
 */
export async function POST(req: NextRequest) {
  try {
    // 1. Rate Limiting (Defense in Depth)
    const forwardedFor = req.headers.get("x-forwarded-for");
    const clientIp = forwardedFor ? forwardedFor.split(",")[0].trim() : "127.0.0.1";
    if (!checkRateLimit(clientIp)) {
      return NextResponse.json(
        { success: false, error: "Too many requests: Rate limit exceeded (60 req/min)" },
        { status: 429, headers: corsHeaders }
      );
    }

    // 2. Strict Fail-Closed Bearer Token Authentication
    const auth = verifyBearerAuth(req);
    if (!auth.authorized) {
      return NextResponse.json(
        { success: false, error: auth.error },
        { status: auth.status || 401, headers: corsHeaders }
      );
    }

    const body = await req.json();
    const { memberName, memberId, passType, instagramHandle } = body;

    if (!memberId) {
      return NextResponse.json(
        { success: false, error: "memberId is required" },
        { status: 400, headers: corsHeaders }
      );
    }

    // Get active Instagram account
    const account = await prisma.instagramAccount.findFirst({
      select: {
        id: true,
        username: true,
        workspaceId: true,
      },
      orderBy: { connectedAt: "desc" },
    });

    const botHandle = account?.username ?? "mithramandalii_";
    const cleanHandle = (instagramHandle || "").replace(/^@/, "").trim();
    const nameStr = memberName || "Mitrama";
    const passStr = passType || "Mithramandali Pass";

    // Build the dynamic branded welcome message
    const welcomeMessage = `Namaste ${nameStr} bro! 🔥 Welcome to Mithramandali!\n\nMee Member ID: ${memberId}\nMee Pass: ${passStr}\n\nMee membership confirm aipoindi! Explore more here: https://mithramandali.com`;

    // Instagram direct message trigger URL (opens Instagram app with pre-filled trigger text)
    const triggerText = encodeURIComponent(`CLAIM ${memberId}`);
    const dmDeepLink = `https://ig.me/m/${botHandle}?text=${triggerText}`;

    // Record operational event for tracking
    if (account?.workspaceId) {
      await prisma.operationalEvent
        .create({
          data: {
            workspaceId: account.workspaceId,
            source: "WORKER",
            level: "INFO",
            message: `Mithramandali Registration: ${nameStr} (${memberId}) registered with IG @${cleanHandle}`,
            payload: {
              memberId,
              memberName: nameStr,
              passType: passStr,
              instagramHandle: cleanHandle,
            },
          },
        })
        .catch(() => {});
    }

    return NextResponse.json(
      {
        success: true,
        memberId,
        connectedBotHandle: botHandle,
        dmDeepLink,
        welcomeMessage,
        action: "Direct user to dmDeepLink to trigger automatic Instagram DM delivery",
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500, headers: corsHeaders }
    );
  }
}
