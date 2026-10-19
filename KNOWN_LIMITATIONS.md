# Known Limitations & Operational Boundaries

This document provides a candid engineering assessment of the platform's current architectural boundaries, trade-offs, and failure modes under operational pressure.

---

### 1. Correctness and Data-Integrity Risks

- **Post-Commit Idempotency Crash Window**: In `idempotency.middleware.ts`, the idempotency record transitions to `completed` in the HTTP response finish hook *after* the core database transaction commits. If the server process crashes (OOM, SIGKILL) in that millisecond interval, the record remains stuck in `in_progress`.
  - *Why accepted*: Moving idempotency records inside `tx(session)` requires coupling transport-layer HTTP response serialization into domain transactions.
  - *Next step*: Persist the idempotency completion record directly within the business transaction session.

- **Outbox Worker Clock Drift & Lease Overlap**: In `worker.ts`, workers lock pending jobs using lease timestamps (`lockedUntil = now + 60s`). If an asynchronous handler hangs longer than 60 seconds or severe system clock skew occurs between nodes, `reclaimStuckJobs()` reclaims the job while the first worker is still active, causing duplicate processing.
  - *Why accepted*: Compound deduplication keys (`${eventId}:${recipientId}`) and unique MongoDB indexes prevent duplicate in-app notification records.
  - *Next step*: Enforce a hard timeout (`AbortSignal.timeout(50000)`) on job handlers and migrate worker coordination to PostgreSQL `SKIP LOCKED` or Redis Redlock.

---

### 2. Security and Authorization Caveats

- **Collection-Wide MongoDB Text Search Scoping**: The `$text` search index in `workItem.model.ts` is global across all workspaces. While all search queries enforce `{ workspaceId: ctx.workspaceId, deletedAt: null }`, MongoDB's text search stage inspects collection-wide token trees before applying the tenant equality filter, presenting potential timing-side-channel leakage at massive scale.
  - *Why accepted*: Single-cluster simplicity without running external search infrastructure.
  - *Next step*: Prefix text search with tenant routing or migrate to an external partitioned search cluster (Elasticsearch / Atlas Search).

- **Active Session Invalidation on Team Removal**: When an administrator removes a user from a team via `DELETE /api/teams/:teamId/members/:userId`, their assigned items are released and audited, but their active HTTP cookie session retains cached workspace context until the next request reloads team memberships.
  - *Why accepted*: Context is freshly re-queried by `authContext.middleware.ts` on subsequent API calls, but client-side React Query state holds stale navigation tabs until refreshed.
  - *Next step*: Emit a WebSocket cache-invalidation event or invalidate the user's session version in Redis on membership mutation.

---

### 3. Scalability Limits

- **Single-Job Outbox Worker Throughput**: `worker.ts` polls once per second and claims a single job (`limit: 1`) per cycle.
  - *Degradation point*: Degrades when mutation throughput exceeds ~100 transitions per second, creating an outbox backlog.
  - *Next step*: Claim jobs in batches of 50 via atomic `updateMany` or wire the worker to a MongoDB Change Stream for reactive event-driven wakeups.

- **Unpartitioned Append-Only Audit History**: `ItemEventModel` never purges or partitions historical events, and `WorkItemModel` relies on soft-delete (`deletedAt`).
  - *Degradation point*: Beyond ~5 million events, B-tree index depths degrade write latency.
  - *Next step*: Implement date-based collection partitioning or archive events older than 90 days to cold blob storage.

---

### 4. Reliability and Operations Gaps

- **Single-Node Replica Set Local Footprint**: The database runs as a single-node replica set (`rs0`) in Docker Compose to enable ACID multi-document transactions locally.
  - *Why accepted*: Avoided distributed network orchestration overhead for local development and review.
  - *Next step*: Deploy a standard 3-node MongoDB replica set (Primary-Secondary-Secondary) across distinct availability zones.

- **Shallow Health Checks**: `GET /health` returns `{ status: "ok" }` without verifying active MongoDB connection health (`mongoose.connection.readyState`).
  - *Why accepted*: Kept health checking decoupled from transient database latency during warm-up.
  - *Next step*: Add `/health/ready` that pings MongoDB replica set status and worker heartbeat.

---

### 5. Product and UX Scope Cuts

- **20-Second Polling Latency vs Push**: The `/attention` dashboard polls every 20 seconds. New items or claims by teammates are not visible instantly without manual focus.
  - *Why accepted*: WebSockets introduce connection state management and reconnect storms under load; short polling preserved stateless horizontal scaling.
  - *Next step*: Implement Server-Sent Events (SSE) for lightweight cache-invalidation pings.

- **Detail Page Write-Time Staleness**: `WorkItemDetail.tsx` intentionally omits background polling to avoid clobbering an operator's active form edits, deferring conflict detection to save time (HTTP 409).
  - *Why accepted*: Prevents disruptive form state loss during active typing.
  - *Next step*: Add a non-intrusive floating indicator ("Item updated by Charlie Lead-Ops. View changes") when background versions change.

---

### 6. Testing Gaps

- **Lack of Multi-Node Replica Split-Brain Tests**: Vitest integration tests run against `MongoMemoryReplSet`.
  - *Why accepted*: In-memory replica sets adequately verify transaction rollbacks and atomic write locks.
  - *Next step*: Run Chaos Mesh or Jepsen tests against a multi-node cluster simulating network partitions.

---

## If I Had Another Week (Prioritized Top 5)

1. **Transactional Idempotency Commit**: Commit the idempotency completion record atomically within the primary `tx(session)` to eliminate the post-commit crash window.
2. **Batch Outbox Processing**: Convert single-job polling into batched 50-job claims backed by Change Stream triggers.
3. **SSE Cache Invalidation**: Add Server-Sent Events for instant queue invalidation without replacing optimistic write reconciliation.
4. **Deep Health & Prometheus Metrics**: Export Prometheus metrics (`p99_latency`, `outbox_lag_seconds`, `dead_jobs_count`) and deep database readiness checks.
5. **Field-Level Diff Merging**: Automatically merge non-conflicting concurrent edits (e.g. Title vs Due Date) on 409 instead of requiring manual resolution.
