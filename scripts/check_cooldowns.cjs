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
  const cooldowns = await client.query('SELECT * FROM "TriggerCooldown";');
  console.log('TriggerCooldown table rows:');
  console.log(JSON.stringify(cooldowns.rows, null, 2));

  const accounts = await client.query('SELECT id, "instagramId", username, provider, "tokenExpiresAt", "workspaceId" FROM "InstagramAccount";');
  console.log('\nInstagram Accounts:');
  console.log(JSON.stringify(accounts.rows, null, 2));

  await client.end();
}

main().catch(console.error);
