#!/usr/bin/env node
/** Grant a role to an existing account:  npm run set-role -- user@example.com researcher */
import mongoose from 'mongoose';
import { connectDb } from '../src/db.js';
import { ROLES, User } from '../src/models/User.js';
import '../src/models/index.js';
import { audit } from '../src/services/audit.js';

const [email, role] = process.argv.slice(2);
if (!email || !ROLES.includes(role)) {
  console.error(`Usage: npm run set-role -- <email> <${ROLES.join('|')}>`);
  process.exit(1);
}
await connectDb();
const user = await User.findOneAndUpdate({ email: email.toLowerCase() }, { role }, { returnDocument: 'after' });
if (!user) {
  console.error(`No account with email ${email}`);
  process.exitCode = 1;
} else {
  await audit('user.set_role', { targetType: 'user', targetId: user._id.toString(), details: { role, via: 'cli' } });
  console.log(`${user.email} is now ${user.role}`);
}
await mongoose.disconnect();
