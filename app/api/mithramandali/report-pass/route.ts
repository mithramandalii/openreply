import { NextRequest, NextResponse } from "next/server";
import { getMithramandaliFirestore } from "@/lib/mithramandali/firestore";
import { FieldValue } from "firebase-admin/firestore";

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return req.headers.get("x-real-ip") || "127.0.0.1";
}

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
    const passId = String(body?.passId || "").trim();
    const reason = String(body?.reason || "").trim();

    if (!passId || passId.length < 5) {
      return NextResponse.json(
        { ok: false, error: "INVALID_PASS_ID", message: "A valid pass ID is required." },
        { status: 400, headers: corsHeaders }
      );
    }

    if (!reason) {
      return NextResponse.json(
        { ok: false, error: "MISSING_REASON", message: "Please specify a reason for the report." },
        { status: 400, headers: corsHeaders }
      );
    }

    const clientIp = getClientIp(req);
    const db = getMithramandaliFirestore();

    const reportRef = await db.collection("reports").add({
      passId,
      reason,
      status: "PENDING",
      reporterIp: clientIp,
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json(
      { ok: true, reportId: reportRef.id },
      { status: 200, headers: corsHeaders }
    );
  } catch (err: any) {
    console.error("[reportPass route error]:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: "Failed to submit report. Please try again." },
      { status: 500, headers: corsHeaders }
    );
  }
}
