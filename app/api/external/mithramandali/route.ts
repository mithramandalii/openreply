import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

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
 * Returns active connected Instagram account and integration status
 */
export async function GET() {
  try {
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
 * Syncs new member registration from Mithramandali site to OpenReply
 */
export async function POST(req: NextRequest) {
  try {
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
