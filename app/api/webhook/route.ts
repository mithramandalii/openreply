// app/api/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import {
  parseCommentEvents,
  verifyWebhookSignature,
} from "@/lib/meta/webhook";
import { processInstagramWebhook } from "@/lib/queue/process-webhook";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json(
    { success: false, error: "Verification failed" },
    { status: 403 }
  );
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  if (!verifyWebhookSignature(rawBody, signature)) {
    await prisma.operationalEvent
      .create({
        data: {
          source: "SYSTEM",
          level: "WARNING",
          message: "Webhook signature verification failed",
          payload: {
            hadSignatureHeader: Boolean(signature),
            bodyLength: rawBody.length,
            bodyPreview: rawBody.slice(0, 200),
          },
        },
      })
      .catch(() => {});
    return NextResponse.json(
      { success: false, error: "Invalid signature" },
      { status: 401 }
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON" },
      { status: 400 }
    );
  }

  // CHANGED: await this directly instead of wrapping it in waitUntil().
  // The 3 stuck "PENDING" webhookEvent rows with zero dmLog entries prove
  // the background continuation was getting killed before it finished —
  // meaning Message 1/2 were never even attempted. Awaiting here means
  // Meta gets its 200 only once the actual send has happened, so it can't
  // be silently dropped. This costs a bit of response latency (a couple of
  // seconds), which Meta's webhook tolerates fine — it does not need <50ms.
  //
  // The 30-second delayed Message 3 is still handled separately via
  // waitUntil inside dm-worker.ts's sendRevealDirectMessage — that one is
  // fine to lose occasionally; Message 1/2 are not.
  try {
    await processInstagramWebhook({
      payload: payload as Parameters<typeof parseCommentEvents>[0],
      provider: "META",
    });
  } catch (err) {
    console.error("[Webhook Handler] Processing error:", err);
    // Still return 200 — Meta retries on non-200, and a retry would just
    // re-attempt the same broken thing. The error is already logged to
    // webhookEvent/operationalEvent for you to see, which is what matters.
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
