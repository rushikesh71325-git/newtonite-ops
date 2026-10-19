import mongoose, { ClientSession } from "mongoose";

/**
 * Execute a unit of work inside a managed MongoDB transaction session.
 * Handles starting session, withTransaction (with transient error retries),
 * and terminating the session safely in finally block.
 */
export async function tx<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      return await fn(session);
    });
  } finally {
    await session.endSession();
  }
}
