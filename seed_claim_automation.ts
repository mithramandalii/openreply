import "dotenv/config";
import { prisma } from "./lib/db/client";

async function seedClaimAutomation() {
  const account = await prisma.instagramAccount.findFirst();
  if (!account) {
    console.error("No Instagram account found!");
    process.exit(1);
  }

  console.log(`Found Instagram Account: @${account.username} (ID: ${account.id}, Workspace: ${account.workspaceId})`);

  // Check if CLAIM automation already exists
  const existing = await prisma.automation.findFirst({
    where: {
      instagramAccountId: account.id,
      keywords: { has: "CLAIM" }
    }
  });

  if (existing) {
    console.log("CLAIM automation already exists:", existing.id, existing.name);
    return;
  }

  const newAuto = await prisma.automation.create({
    data: {
      workspaceId: account.workspaceId,
      instagramAccountId: account.id,
      name: "Mithramandali Member Pass Verification & Welcome DM",
      goal: "Mithramandali website pass claim and follow-gate verification",
      keywords: ["CLAIM"],
      wholeWordMatch: true,
      matchAnyWord: false,
      matchAnyPost: false,
      dmTriggerEnabled: true,
      requireFollow: true,
      followPromptMessage: "Namaste bro! 🙏 Mee Mithramandali Member Pass claim request receive aindi. But pass officially unlock avvalante please follow @mithramandalii_! Follow ayyaka kindha unna button tap cheyyandi 🎟️",
      followPromptButtonLabel: "I Followed! Verify Pass ✦",
      dmMessage: "Mithramandali Conclave loki swagatham bro! 🔥 Mee Pass officially verified & active! Welcome to the inner circle 🎟️ Visit the vault: https://mithramandali.com",
      linkButtonLabel: "Visit Conclave",
      isActive: true,
    }
  });

  console.log("Successfully created CLAIM Automation:", newAuto.id, newAuto.name);
}

seedClaimAutomation()
  .catch(console.error)
  .finally(() => process.exit(0));
