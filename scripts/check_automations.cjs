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

  const cols = await client.query('SELECT column_name FROM information_schema.columns WHERE table_name = \'Automation\';');
  console.log('Columns in Automation:', cols.rows.map(r => r.column_name));

  const rows = await client.query('SELECT * FROM "Automation";');
  console.log('\nAutomation rows:');
  console.log(JSON.stringify(rows.rows, null, 2));

  await client.end();
}

main().catch(console.error);
