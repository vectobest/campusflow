#!/usr/bin/env node
/** Check the MongoDB connection:  npm run db:check -w server  (reads MONGODB_URI) */
import mongoose from 'mongoose';
import { config } from '../src/config.js';

const masked = config.mongoUri.replace(/\/\/([^:/@]+):([^@]+)@/, '//$1:****@');
console.log(`Connecting to ${masked}`);
try {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db;
  await db.admin().ping();
  const names = (await db.listCollections().toArray()).map((c) => c.name).sort();
  console.log(`✓ Connected. Database "${db.databaseName}", ${names.length} collections`);
  for (const n of names) console.log(`  ${n.padEnd(22)} ${await db.collection(n).estimatedDocumentCount()}`);
  await mongoose.disconnect();
} catch (err) {
  console.error(`✗ Could not connect: ${err.message}`);
  if (/ENOTFOUND|querySrv/.test(err.message)) console.error('  Check the cluster address in the connection string.');
  if (/auth|Authentication/i.test(err.message)) console.error('  Check the database username and password.');
  if (/timed out|Server selection/i.test(err.message)) console.error('  In Atlas → Network Access, allow your IP (or 0.0.0.0/0).');
  process.exit(1);
}
