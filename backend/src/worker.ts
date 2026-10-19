import mongoose from "mongoose";
import OutboxJobModel, { OutboxJobDocument } from "./models/outboxJob.model";
import NotificationModel from "./models/notification.model";
import connectDatabase from "./config/database.config";
import { config } from "./config/app.config";

export interface WorkerOptions {
  pollIntervalMs?: number;
  lockDurationMs?: number;
  maxAttempts?: number;
  backoffBaseMs?: number;
  verbose?: boolean;
}

export type JobHandler = (job: OutboxJobDocument) => Promise<void>;

// In-memory handler registry
const handlers: Map<string, JobHandler> = new Map();

/**
 * Default idempotent notification handler.
 * Creates an in-app Notification record.
 * Uses dedupeKey to ensure idempotency.
 */
export const defaultNotifyHandler: JobHandler = async (job) => {
  const payload = job.payload;
  if (!payload || !payload.recipientId || !payload.workspaceId) {
    throw new Error(`Invalid notification payload for job ${job._id}`);
  }

  try {
    await NotificationModel.findOneAndUpdate(
      { dedupeKey: job.dedupeKey },
      {
        $setOnInsert: {
          userId: new mongoose.Types.ObjectId(payload.recipientId),
          workspaceId: new mongoose.Types.ObjectId(payload.workspaceId),
          itemId: payload.itemId ? new mongoose.Types.ObjectId(payload.itemId) : null,
          title: payload.title || "Notification",
          message: payload.message || "",
          dedupeKey: job.dedupeKey,
          read: false,
          createdAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );
    console.log(
      `[Worker:Notify] Created notification for user ${payload.recipientId} (dedupeKey: ${job.dedupeKey})`
    );
  } catch (err: any) {
    // If duplicate key error (code 11000), it has already been processed idempotently
    if (err.code === 11000) {
      console.log(
        `[Worker:Notify] Notification already exists for dedupeKey ${job.dedupeKey} - idempotent skip`
      );
      return;
    }
    throw err;
  }
};

// Register default handler
registerJobHandler("notify", defaultNotifyHandler);

/**
 * Register a custom or replacement job handler (useful for tests and custom workers).
 */
export function registerJobHandler(type: string, handler: JobHandler) {
  handlers.set(type, handler);
}

/**
 * Unregister a job handler.
 */
export function unregisterJobHandler(type: string) {
  handlers.delete(type);
}

/**
 * Calculate exponential backoff duration based on attempt number.
 * Defaults: 5s, 10s, 20s, 40s... capped at 5 minutes (300,000ms).
 */
export function calculateBackoffMs(attempts: number, baseMs = 5000): number {
  const exponent = Math.max(0, attempts - 1);
  const backoff = baseMs * Math.pow(2, exponent);
  return Math.min(backoff, 300000);
}

/**
 * Crash recovery: Reclaims jobs stuck in 'processing' whose lockedUntil has expired.
 * Moves them back to 'pending' so another worker can retry them.
 */
export async function reclaimStuckJobs(): Promise<number> {
  const now = new Date();
  const result = await OutboxJobModel.updateMany(
    {
      status: "processing",
      lockedUntil: { $lt: now },
    },
    {
      $set: {
        status: "pending",
        lockedUntil: null,
      },
    }
  );

  if (result.modifiedCount > 0) {
    console.warn(
      `[Worker:Recovery] Reclaimed ${result.modifiedCount} stuck processing jobs whose locks expired.`
    );
  }
  return result.modifiedCount;
}

/**
 * Process a single eligible job atomically.
 * Returns true if a job was found and processed, false if no job was ready.
 */
export async function processNextJob(options: WorkerOptions = {}): Promise<boolean> {
  const lockDurationMs = options.lockDurationMs || 60000;
  const maxAttempts = options.maxAttempts || 5;
  const backoffBaseMs = options.backoffBaseMs || 5000;
  const now = new Date();

  // Atomically claim one job ready to run
  const job = (await OutboxJobModel.findOneAndUpdate(
    {
      status: "pending",
      runAt: { $lte: now },
    },
    {
      $set: {
        status: "processing",
        lockedUntil: new Date(now.getTime() + lockDurationMs),
      },
      $inc: { attempts: 1 },
    },
    {
      sort: { runAt: 1 },
      new: true,
    }
  )) as OutboxJobDocument | null;

  if (!job) {
    return false;
  }

  const handler = handlers.get(job.type);
  if (!handler) {
    console.error(
      `[Worker] No handler registered for job type '${job.type}'. Marking job ${job._id} dead.`
    );
    await OutboxJobModel.updateOne(
      { _id: job._id },
      {
        $set: {
          status: "dead",
          lockedUntil: null,
          lastError: `Unknown job type '${job.type}'`,
        },
      }
    );
    return true;
  }

  try {
    // Execute handler
    await handler(job);

    // Success: Mark completed
    await OutboxJobModel.updateOne(
      { _id: job._id },
      {
        $set: {
          status: "done",
          lockedUntil: null,
          lastError: null,
        },
      }
    );
    if (options.verbose) {
      console.log(`[Worker] Job ${job._id} (${job.type}) completed successfully.`);
    }
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    console.error(
      `[Worker] Job ${job._id} (${job.type}) failed on attempt ${job.attempts}: ${errorMsg}`
    );

    if (job.attempts >= maxAttempts) {
      // Exceeded max attempts: Mark dead
      await OutboxJobModel.updateOne(
        { _id: job._id },
        {
          $set: {
            status: "dead",
            lockedUntil: null,
            lastError: `Max attempts (${maxAttempts}) exceeded. Last error: ${errorMsg}`,
          },
        }
      );
      console.error(
        `[Worker:DEAD] Job ${job._id} moved to DEAD status after ${job.attempts} attempts.`
      );
    } else {
      // Schedule retry with exponential backoff
      const backoffMs = calculateBackoffMs(job.attempts, backoffBaseMs);
      const nextRunAt = new Date(Date.now() + backoffMs);

      await OutboxJobModel.updateOne(
        { _id: job._id },
        {
          $set: {
            status: "pending",
            runAt: nextRunAt,
            lockedUntil: null,
            lastError: errorMsg,
          },
        }
      );
      if (options.verbose) {
        console.log(
          `[Worker] Job ${job._id} rescheduled for ${nextRunAt.toISOString()} (backoff: ${backoffMs}ms)`
        );
      }
    }
  }

  return true;
}

let isRunning = false;
let workerTimer: NodeJS.Timeout | null = null;

/**
 * Start the polling worker loop.
 */
export function startOutboxWorker(options: WorkerOptions = {}) {
  if (isRunning) return;
  isRunning = true;

  const pollIntervalMs = options.pollIntervalMs || 1000;
  console.log(
    `[Worker] Outbox worker started (pollInterval: ${pollIntervalMs}ms, maxAttempts: ${
      options.maxAttempts || 5
    })`
  );

  const loop = async () => {
    if (!isRunning) return;

    try {
      // Reclaim any expired stuck locks before processing
      await reclaimStuckJobs();

      // Drain ready jobs until none left in this cycle
      let hasMore = true;
      while (hasMore && isRunning) {
        hasMore = await processNextJob(options);
      }
    } catch (loopErr) {
      console.error("[Worker] Error in worker tick:", loopErr);
    } finally {
      if (isRunning) {
        workerTimer = setTimeout(loop, pollIntervalMs);
      }
    }
  };

  loop();
}

/**
 * Stop the polling worker loop gracefully.
 */
export function stopOutboxWorker() {
  isRunning = false;
  if (workerTimer) {
    clearTimeout(workerTimer);
    workerTimer = null;
  }
  console.log("[Worker] Outbox worker stopped.");
}

// Standalone execution entrypoint
if (require.main === module) {
  (async () => {
    console.log("Connecting to database for worker...");
    await connectDatabase();

    startOutboxWorker({
      pollIntervalMs: 1000,
      verbose: true,
    });

    const shutdown = async (signal: string) => {
      console.log(`Received ${signal}. Shutting down worker gracefully...`);
      stopOutboxWorker();
      await mongoose.disconnect();
      console.log("Database disconnected. Worker exit complete.");
      process.exit(0);
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  })().catch((err) => {
    console.error("Fatal worker startup error:", err);
    process.exit(1);
  });
}
