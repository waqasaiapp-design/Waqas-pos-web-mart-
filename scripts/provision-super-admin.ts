import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = process.env.WAQAS_DATA_DIR
  ? path.resolve(process.env.WAQAS_DATA_DIR)
  : path.resolve(process.cwd(), 'data');
const AUTH_DB_FILE = path.join(DATA_DIR, 'auth_db.json');

function hashPassword(password: string, salt: string): string {
  return 'scrypt:' + crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
}

function main() {
  const [, , rawGmail, rawPassword, rawFullName] = process.argv;

  if (!rawGmail || !rawPassword) {
    console.error('Usage: npx tsx scripts/provision-super-admin.ts <gmail> <waqas_pos_password> [fullName]');
    process.exit(1);
  }

  const gmail = rawGmail.trim().toLowerCase();
  const password = String(rawPassword);
  const fullName = (rawFullName || 'Muhammad Waqas').trim();

  if (!gmail.includes('@') || !gmail.endsWith('@gmail.com')) {
    console.error('Error: Provide a valid @gmail.com email address for the permanent Super Admin.');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Error: WAQAS POS Password must be at least 8 characters long.');
    process.exit(1);
  }

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  let authDb: any = {
    superAdmin: null,
    superAdminSetupLocked: false,
    users: [],
    sessions: {},
    pendingOtps: {},
    failedAttempts: {},
  };

  if (fs.existsSync(AUTH_DB_FILE)) {
    try {
      authDb = JSON.parse(fs.readFileSync(AUTH_DB_FILE, 'utf-8'));
    } catch (err) {
      console.error('Error reading existing auth_db.json:', err);
      process.exit(1);
    }
  }

  if (authDb.superAdmin || authDb.superAdminSetupLocked) {
    console.error(
      `LOCKED: A permanent Super Admin (${authDb.superAdmin?.gmail || 'existing'}) is already provisioned and setup is permanently locked.`
    );
    process.exit(1);
  }

  const salt = crypto.randomBytes(16).toString('hex');
  authDb.superAdmin = {
    id: 'SUPER-ADMIN-01',
    gmail,
    fullName,
    status: 'active',
    verifiedGmail: true,
    passwordSalt: salt,
    passwordHash: hashPassword(password, salt),
    createdAt: new Date().toISOString(),
  };
  authDb.superAdminSetupLocked = true;

  const tmpFile = `${AUTH_DB_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(authDb, null, 2), 'utf-8');
  fs.renameSync(tmpFile, AUTH_DB_FILE);

  console.log(`SUCCESS: Permanent Super Admin provisioned (${gmail}) and setup permanently locked.`);
}

main();
