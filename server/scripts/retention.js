#!/usr/bin/env node
/** Run the retention policy once:  npm run retention */
import mongoose from 'mongoose';
import { connectDb } from '../src/db.js';
import '../src/models/index.js';
import { runRetention } from '../src/services/retention.js';

await connectDb();
console.log(await runRetention());
await mongoose.disconnect();
