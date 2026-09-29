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

  console.log('=== LATEST 5 DMLOG ROWS ===');
  const dmlogs = await client.query('SELECT id, "commenterId", "commenterName", status, "errorMessage", "createdAt" FROM "DmLog" ORDER BY "createdAt" DESC LIMIT 5;');
  console.log(JSON.stringify(dmlogs.rows, null, 2));

  console.log('\n=== LATEST 5 WEBHOOK EVENTS ===');
  const webhooks = await client.query('SELECT id, status, "errorMessage", "createdAt", "processedAt" FROM "WebhookEvent" ORDER BY "createdAt" DESC LIMIT 5;');
  console.log(JSON.stringify(webhooks.rows, null, 2));

  console.log('\n=== LATEST 5 OPERATIONAL EVENTS ===');
  const ops = await client.query('SELECT id, source, level, message, "createdAt" FROM "OperationalEvent" ORDER BY "createdAt" DESC LIMIT 5;');
  console.log(JSON.stringify(ops.rows, null, 2));

  await client.end();
}

main().catch(console.error);
