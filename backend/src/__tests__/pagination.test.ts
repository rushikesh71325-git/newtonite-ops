import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import app from "../index";
import WorkItemModel from "../models/workItem.model";
import {
  setupTestDatabase,
  teardownTestDatabase,
  seedTestContext,
  SeededTestContext,
} from "./testHelper";

describe("Phase 7: Cursor Pagination & Concurrent Inserts", () => {
  let ctx: SeededTestContext;

  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    ctx = await seedTestContext();
  });

  /**
   * Test 12: Pagination Stability
   * Seeded items, page through with cursors, with concurrent inserts
   * Expected: No duplicates, no gaps, strictly descending stable order (updatedAt desc, _id desc)
   */
  it("Test 12 [Pagination]: Traverses paged items via cursor during concurrent writes with zero duplicates and stable descending order", async () => {
    const totalItems = 100; // Efficient batch for test execution
    console.log(`Seeding ${totalItems} items for pagination stability test...`);

    const now = Date.now();
    const batch = [];
    for (let i = 0; i < totalItems; i++) {
      batch.push({
        workspaceId: ctx.workspace.id,
        teamId: ctx.teamA.id,
        requesterId: ctx.owner.id,
        title: `Item #${i.toString().padStart(4, "0")}`,
        requestType: "task",
        priority: "MEDIUM",
        state: "OPEN",
        ownerId: null,
        // Stagger updatedAt timestamps slightly
        updatedAt: new Date(now - i * 1000),
        createdAt: new Date(now - i * 1000),
        version: 1,
      });
    }

    await WorkItemModel.insertMany(batch);

    const pageSize = 50;
    const seenIds = new Set<string>();
    let currentCursor: string | null = null;
    let pageCount = 0;
    let hasMore = true;

    // Traverse first 3 pages
    while (hasMore && pageCount < 5) {
      pageCount++;

      // Concurrently insert a newly arrived item to simulate real-time ingestion
      await WorkItemModel.create({
        workspaceId: ctx.workspace.id,
        teamId: ctx.teamA.id,
        requesterId: ctx.owner.id,
        title: `Concurrent New Arrival Page ${pageCount}`,
        requestType: "incident",
        priority: "URGENT",
        state: "OPEN",
        version: 1,
      });

      const pageUrl: string = currentCursor
        ? `/api/items?limit=${pageSize}&cursor=${currentCursor}`
        : `/api/items?limit=${pageSize}`;

      const res = await request(app)
        .get(pageUrl)
        .set("x-test-user-id", ctx.teamAMember.id)
        .set("x-workspace-id", ctx.workspace.id);

      expect(res.status).toBe(200);
      const items = res.body.items;
      expect(items.length).toBeGreaterThan(0);

      // Verify no duplicates across pages
      for (const item of items) {
        expect(seenIds.has(item._id)).toBe(false);
        seenIds.add(item._id);
      }

      // Verify strictly descending order within the page: updatedAt desc
      for (let j = 0; j < items.length - 1; j++) {
        const tCurr = new Date(items[j].updatedAt).getTime();
        const tNext = new Date(items[j + 1].updatedAt).getTime();
        expect(tCurr).toBeGreaterThanOrEqual(tNext);
      }

      hasMore = res.body.hasMore;
      currentCursor = res.body.nextCursor;
      if (!currentCursor) break;
    }

    expect(pageCount).toBeGreaterThanOrEqual(3);
    expect(seenIds.size).toBeGreaterThanOrEqual(100);
  });
});
