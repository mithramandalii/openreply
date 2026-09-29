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
  const res = await client.query('SELECT id, status, payload, "errorMessage", "createdAt", "processedAt" FROM "WebhookEvent" WHERE id = \'cmum5nrbr000004jqvprnyb77\';');
  console.log('Webhook Event Details:');
  console.log(JSON.stringify(res.rows[0], null, 2));

  console.log('\nAll DmLogs created in last 10 minutes:');
  const dms = await client.query('SELECT * FROM "DmLog" WHERE "createdAt" > NOW() - INTERVAL \'10 minutes\' ORDER BY "createdAt" DESC;');
  console.log(JSON.stringify(dms.rows, null, 2));

  console.log('\nOperationalEvents created in last 10 minutes:');
  const ops = await client.query('SELECT * FROM "OperationalEvent" WHERE "createdAt" > NOW() - INTERVAL \'10 minutes\' ORDER BY "createdAt" DESC LIMIT 10;');
  console.log(JSON.stringify(ops.rows, null, 2));

  await client.end();
}

main().catch(console.error);
