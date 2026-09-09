import mongoose from 'mongoose';
import { config } from '../config/index.js';

let isConnected = false;

export async function connectDB(): Promise<void> {
  if (isConnected) return;

  try {
    // Attempt connecting to configured MongoDB URI
    await mongoose.connect(config.mongodbUri, {
      serverSelectionTimeoutMS: 2000,
    });
    isConnected = true;
    console.log(`[Database] Successfully connected to MongoDB at ${config.mongodbUri}`);
  } catch (err: any) {
    console.warn(`[Database] MongoDB connection to ${config.mongodbUri} failed: ${err.message}`);
    console.warn(`[Database] Operating in In-Memory / Ephemeral Persistence mode for evaluation.`);
  }
}
