const fs = require('fs');
const crypto = require('crypto');
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

const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function decryptToken(encryptedBase64) {
  const key = Buffer.from(env.ENCRYPTION_KEY, 'hex');
  const combined = Buffer.from(encryptedBase64, 'base64');
  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

const client = new Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  await client.connect();
  const acc = await client.query('SELECT * FROM "InstagramAccount" LIMIT 1;');
  const account = acc.rows[0];
  const token = decryptToken(account.accessToken);
  console.log('Account ID:', account.instagramId, 'Username:', account.username);
  console.log('Token expires at:', account.tokenExpiresAt);

  // Check /me endpoint on graph.instagram.com
  const meRes = await fetch(`https://graph.instagram.com/v22.0/me?fields=id,username&access_token=${token}`);
  console.log('GET /me HTTP status:', meRes.status);
  const meData = await meRes.json();
  console.log('GET /me response:', JSON.stringify(meData, null, 2));

  // Check /me endpoint on graph.facebook.com
  const fbRes = await fetch(`https://graph.facebook.com/v22.0/me?access_token=${token}`);
  console.log('\nGET graph.facebook.com/me HTTP status:', fbRes.status);
  const fbData = await fbRes.json();
  console.log('GET graph.facebook.com/me response:', JSON.stringify(fbData, null, 2));

  await client.end();
}

main().catch(console.error);
