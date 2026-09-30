// Usage: npx tsx scripts/reset-password.ts <email> <new-password>
// Only rewrites users.password_hash; sessions, connections and data are untouched.
import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from '../server/security.ts';

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error('Usage: npx tsx scripts/reset-password.ts <email> <new-password>');
  process.exit(1);
}
if (password.length < 12) {
  console.error('Password must be at least 12 characters (same rule as registration).');
  process.exit(1);
}

const db = new DatabaseSync(process.env.DATABASE_PATH ?? 'data/folio.db');
const result = db.prepare('UPDATE users SET password_hash=? WHERE email=?').run(hashPassword(password), email.trim().toLowerCase());
db.close();

if (!result.changes) {
  console.error(`No user found with email ${email}`);
  process.exit(1);
}
console.log(`Password updated for ${email}`);
