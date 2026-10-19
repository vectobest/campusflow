import mongoose from 'mongoose';
import { config } from './config.js';

export async function connectDb(uri = config.mongoUri) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri);
  // Make sure unique indexes (e.g. sessionId+sequence) exist before ingestion starts.
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  return mongoose.connection;
}

export const disconnectDb = () => mongoose.disconnect();
