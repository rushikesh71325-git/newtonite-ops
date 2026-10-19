import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import OutboxJobModel from "../models/outboxJob.model";
import NotificationModel from "../models/notification.model";
import {
  processNextJob,
  reclaimStuckJobs,
  calculateBackoffMs,
  registerJobHandler,
  unregisterJobHandler,
  defaultNotifyHandler,
} from "../worker";
import { setupTestDatabase, teardownTestDatabase } from "./testHelper";

describe("Phase 6: Asynchronous Outbox Worker & Resilience", () => {
  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await OutboxJobModel.deleteMany({});
    await NotificationModel.deleteMany({});
    registerJobHandler("notify", defaultNotifyHandler);
  });

  it("calculates exponential backoff correctly", () => {
    expect(calculateBackoffMs(1, 5000)).toBe(5000);
    expect(calculateBackoffMs(2, 5000)).toBe(10000);
    expect(calculateBackoffMs(3, 5000)).toBe(20000);
    expect(calculateBackoffMs(4, 5000)).toBe(40000);
    expect(calculateBackoffMs(10, 5000)).toBe(300000); // Capped at 5m
  });

  it("processes pending notification job and writes notification idempotently", async () => {
    const userId = new mongoose.Types.ObjectId();
    const workspaceId = new mongoose.Types.ObjectId();
    const eventId = new mongoose.Types.ObjectId();

    const job = await OutboxJobModel.create({
      type: "notify",
      payload: {
        recipientId: userId.toString(),
        workspaceId: workspaceId.toString(),
        title: "Test Alert",
        message: "An item was assigned to you",
      },
      status: "pending",
      runAt: new Date(Date.now() - 1000), // Ready
      dedupeKey: `${eventId}:${userId}`,
    });

    const processed = await processNextJob();
    expect(processed).toBe(true);

    const updatedJob = await OutboxJobModel.findById(job._id);
    expect(updatedJob?.status).toBe("done");
    expect(updatedJob?.attempts).toBe(1);

    const notification = await NotificationModel.findOne({ dedupeKey: `${eventId}:${userId}` });
    expect(notification).not.toBeNull();
    expect(notification?.title).toBe("Test Alert");

    // 1. Enqueue deduplication: Attempting to insert duplicate dedupeKey fails unique index
    await expect(
      OutboxJobModel.create({
        type: "notify",
        payload: {
          recipientId: userId.toString(),
          workspaceId: workspaceId.toString(),
          title: "Test Alert Duplicate",
          message: "Duplicate attempt",
        },
        status: "pending",
        runAt: new Date(Date.now() - 1000),
        dedupeKey: `${eventId}:${userId}`, // Same dedupe key
      })
    ).rejects.toThrow();

    // 2. Execution idempotency: Reset job to 'pending' to simulate retry after worker restart
    await OutboxJobModel.updateOne(
      { _id: job._id },
      { $set: { status: "pending", runAt: new Date(Date.now() - 1000) } }
    );

    const secondProcessed = await processNextJob();
    expect(secondProcessed).toBe(true);

    const reProcessedJob = await OutboxJobModel.findById(job._id);
    expect(reProcessedJob?.status).toBe("done");

    const totalNotifications = await NotificationModel.countDocuments({
      dedupeKey: `${eventId}:${userId}`,
    });
    expect(totalNotifications).toBe(1); // Exactly 1 notification despite duplicate execution
  });

  it("retries failed job with backoff and marks dead after max attempts", async () => {
    let callCount = 0;
    registerJobHandler("failing_job", async () => {
      callCount++;
      throw new Error("Downstream service unreachable");
    });

    const job = await OutboxJobModel.create({
      type: "failing_job",
      payload: { test: true },
      status: "pending",
      runAt: new Date(Date.now() - 1000),
      dedupeKey: `fail-test-${Date.now()}`,
    });

    // Attempt 1: Should fail and back off to pending
    const p1 = await processNextJob({ maxAttempts: 3, backoffBaseMs: 100 });
    expect(p1).toBe(true);
    let currentJob = await OutboxJobModel.findById(job._id);
    expect(currentJob?.status).toBe("pending");
    expect(currentJob?.attempts).toBe(1);
    expect(currentJob?.lastError).toContain("Downstream service unreachable");

    // Force runAt to past for Attempt 2
    await OutboxJobModel.updateOne({ _id: job._id }, { $set: { runAt: new Date(Date.now() - 100) } });
    await processNextJob({ maxAttempts: 3, backoffBaseMs: 100 });
    currentJob = await OutboxJobModel.findById(job._id);
    expect(currentJob?.status).toBe("pending");
    expect(currentJob?.attempts).toBe(2);

    // Force runAt to past for Attempt 3 (Final attempt)
    await OutboxJobModel.updateOne({ _id: job._id }, { $set: { runAt: new Date(Date.now() - 100) } });
    await processNextJob({ maxAttempts: 3, backoffBaseMs: 100 });
    currentJob = await OutboxJobModel.findById(job._id);
    expect(currentJob?.status).toBe("dead");
    expect(currentJob?.attempts).toBe(3);
    expect(currentJob?.lastError).toContain("Max attempts (3) exceeded");

    unregisterJobHandler("failing_job");
  });

  it("reclaims stuck jobs whose lockedUntil has expired", async () => {
    const expiredLock = new Date(Date.now() - 10000);
    const validLock = new Date(Date.now() + 60000);

    const stuckJob = await OutboxJobModel.create({
      type: "notify",
      payload: { test: 1 },
      status: "processing",
      lockedUntil: expiredLock,
      dedupeKey: `stuck-${Date.now()}`,
    });

    const activeJob = await OutboxJobModel.create({
      type: "notify",
      payload: { test: 2 },
      status: "processing",
      lockedUntil: validLock,
      dedupeKey: `active-${Date.now()}`,
    });

    const reclaimedCount = await reclaimStuckJobs();
    expect(reclaimedCount).toBe(1);

    const reloadedStuck = await OutboxJobModel.findById(stuckJob._id);
    expect(reloadedStuck?.status).toBe("pending");
    expect(reloadedStuck?.lockedUntil).toBeNull();

    const reloadedActive = await OutboxJobModel.findById(activeJob._id);
    expect(reloadedActive?.status).toBe("processing");
  });
});
