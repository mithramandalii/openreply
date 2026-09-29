const fs = require('fs');
const { Client } = require('pg');

const envContent = fs.readFileSync('.env', 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const parts = line.split('=');
  if (parts.length >= 2) {
    const key = parts[0].trim();
    const val = parts.slice(1).join('=').replace(/["']/g, '').trim();
    env[key] = val;
  }
}

const client = new Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  await client.connect();

  const accRes = await client.query('SELECT * FROM "InstagramAccount" LIMIT 1;');
  const account = accRes.rows[0];
  if (!account) {
    console.error('No Instagram account found!');
    return;
  }
  console.log('Linking to account:', account.username, account.id, account.workspaceId);

  // Clean any old automations
  await client.query('DELETE FROM "Automation" WHERE "instagramAccountId" = $1;', [account.id]);

  // Insert fresh automation
  const keywords = [
    "Verify",
    "verify",
    "VERIFY",
    "🎟️Verify my Mandali Pass✨",
    "🎟️ Verify my Mandali Pass ✨",
    "🎟️ Verify my Mandali Pass✨",
    "Verify my Mandali Pass",
    "verify my mandali pass",
    "Verify my Member Pass",
    "verify my member pass",
    "Verify my insta",
    "verify my insta",
    "Verify My Insta",
    "CLAIM",
    "claim",
    "mandali",
    "pass"
  ];

  const insertQuery = `
    INSERT INTO "Automation" (
      "id",
      "workspaceId",
      "instagramAccountId",
      "name",
      "goal",
      "keywords",
      "dmMessage",
      "followUpMessage",
      "followPromptMessage",
      "followPromptButtonLabel",
      "linkButtonLabel",
      "requireFollow",
      "matchAnyWord",
      "matchAnyPost",
      "dmTriggerEnabled",
      "isActive",
      "wholeWordMatch",
      "publicReplyEnabled",
      "openingDmEnabled",
      "reportShareEnabled",
      "createdAt",
      "updatedAt"
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, NOW(), NOW()
    ) RETURNING *;
  `;

  const cuid = 'auto_' + Math.random().toString(36).substring(2, 15);
  const values = [
    cuid,
    account.workspaceId,
    account.id,
    "Mithramandali Member Pass Verification & Welcome DM",
    "Mithramandali website pass claim and follow-gate verification",
    keywords,
    "Welcome to Fam !❤️‍🔥\nYour pass 🎟️ is officially verified & active !\nHere's your ID 🔑",
    "Btw... I'm very glad you're here🫂\nMore then a follower, we're family now.💗\nLowkey be part of what comes next...👀\nWelcome to MithraMandali✨",
    "Almost there! Follow me and tap the button below to grab your ID 💛\n\n(Or once you've followed, simply send '🎟️ Verify my Mandali Pass✨' — that always works!)",
    "Yeaa i did ✦👊",
    "Open link 💥",
    true,   // requireFollow
    true,   // matchAnyWord
    true,   // matchAnyPost
    true,   // dmTriggerEnabled
    true,   // isActive
    false,  // wholeWordMatch
    false,  // publicReplyEnabled
    false,  // openingDmEnabled
    true    // reportShareEnabled
  ];

  const result = await client.query(insertQuery, values);
  console.log('Successfully created Automation:', result.rows[0].id, result.rows[0].name);

  // Clear trigger cooldown so Akshu can test immediately
  await client.query('DELETE FROM "TriggerCooldown";');
  console.log('Cleared TriggerCooldown table for instant testing.');

  await client.end();
}

main().catch(console.error);
