import { prisma } from "@/lib/db/client";

const COOLDOWN_MS = 60_000; // 60 seconds per-user duplicate suppression

/**
 * Atomic 60-second cooldown check and consumption per IGSID.
 * Returns `true` if the trigger is allowed to proceed, or `false` if suppressed.
 */
export async function tryConsumeTriggerCooldown(igsid: string): Promise<boolean> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - COOLDOWN_MS);

  try {
    const existing = await prisma.triggerCooldown.findUnique({
      where: { igsid },
    });

    if (existing && existing.lastTriggeredAt > cutoff) {
      console.log(`[Cooldown] Suppressed rapid duplicate trigger for IGSID: ${igsid} (last triggered at ${existing.lastTriggeredAt.toISOString()})`);
      return false;
    }

    await prisma.triggerCooldown.upsert({
      where: { igsid },
      create: { igsid, lastTriggeredAt: now },
      update: { lastTriggeredAt: now },
    });

    return true;
  } catch (err) {
    console.warn("[Cooldown] Error checking trigger cooldown, failing open:", err);
    return true;
  }
}
