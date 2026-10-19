# Operational & Architectural Assumptions

This document articulates the foundational assumptions made during the design and implementation of Newtonite Operations Under Pressure, as mandated by the engineering challenge specification.

---

### 1. Single-Workspace Primary Operational Tenancy
- The company's internal coordination operates predominantly within a single shared workspace (`Acme Operations`).
- Additional workspaces (`External Partner Workspace`) serve as isolated tenant boundaries to verify that cross-workspace access attempts strictly return **HTTP 404 Not Found**, eliminating information leakage and cross-tenant enumeration.

### 2. Dual-Tier Identity & Team Role Model
- **Workspace Roles (`OWNER`, `ADMIN`, `MEMBER`)**: Govern global system administration, tenant-level audit inspection, and platform settings.
- **Team Roles (`LEAD`, `MEMBER`)**: Scoped within functional teams (`TeamMember` collection) to determine day-to-day item visibility, claim eligibility, and triage routing. An engineer belongs to one or more teams with distinct responsibilities in each.

### 3. Separation of Duties on Approvals
- Only designated approvers (`approverId`) or functional team leads can approve an item in `PENDING_APPROVAL`.
- The current item owner and the original requester are **strictly barred from approving their own work items** (`403 Forbidden`), even if they possess Workspace Owner or Admin privileges.

### 4. Administrative Deadlock Resolution
- If an assigned approver is on leave or unavailable during an active incident, Workspace Owners, Admins, or Team Leads can override deadlocked approval requests via an administrative `cancel` action to transition the item to `CLOSED`.
- To preserve regulatory compliance, a mandatory non-empty `reason` string is strictly enforced and recorded in the audit event.

### 5. Short Polling Over Stateful WebSockets
- The Needs-Attention triage dashboard utilizes 20-second background polling rather than stateful WebSockets or Server-Sent Events (SSE).
- This decision prioritizes stateless horizontal scaling, avoiding sticky sessions, connection draining overhead, and socket reconnection storms during major infrastructure outages.

### 6. Server-Side Truth with In-Browser Draft Preservation
- The application intentionally avoids speculative optimistic mutations that display a ticket as "Resolved" before the database commits.
- On concurrent write conflicts (HTTP 409 Conflict), local React form state is preserved without clobbering typed content, and `<ConflictBanner>` displays a side-by-side diff allowing the operator to reconcile without data loss.

### 7. Seed Volume & Scalability Benchmarking
- The standard seed script (`npm run seed`) loads a curated set of teams, accounts, and realistic incident tickets for immediate interactive review.
- Setting `BULK=true` (`BULK=true npm run seed`) populates 5,000 realistic work items across teams to benchmark compound covered index scans (`IXSCAN`) and cursor pagination performance under heavy volume.

### 8. Single-Node Replica Set for Local Evaluation
- Docker Compose configures MongoDB 7.0 as a single-node replica set (`rs0`) with automated healthcheck initiation (`rs.initiate()`).
- This fulfills the prerequisite for multi-document ACID transactions without the operational overhead of managing a distributed 3-node cluster on a local development machine.

### 9. In-Memory Replica Set for Test Isolation
- Automated tests run against `MongoMemoryReplSet` (via `mongodb-memory-server`), spinning up an isolated in-memory replica set for the duration of the test run.
- On its initial run, `mongodb-memory-server` requires internet access to download the official MongoDB binary archive (~100 MB), which is then cached locally for subsequent offline test runs.

### 10. Sub-Resource Comment Version Decoupling
- Comments append immutable timeline events (`COMMENT_ADDED`) and atomically increment `commentCount` via `$inc`, but deliberately **do not increment the work item's optimistic `version`**.
- This invariant ensures that background team discussions do not invalidate an assigned operator's active field edit drafts with false-positive HTTP 409 conflicts.

### 11. Crash-Safe Idempotency Leases
- The `Idempotency-Key` middleware enforces a 2-minute expiration lease on `in_progress` locks to recover from unexpected server crashes.
- Furthermore, failed client requests (HTTP 4xx/5xx) are purged immediately, allowing operators to correct validation errors or stale versions and retry under the same key.

### 12. At-Least-Once Outbox Delivery Semantics
- The Transactional Outbox pattern guarantees at-least-once delivery of notifications across process crashes.
- Consumer idempotency is enforced downstream at the database level via unique compound indexes (`${eventId}:${recipientId}`) and `$setOnInsert` upserts.

### 13. Immutable Audit Timeline with Soft Deletes
- Work items are soft-deleted (`deletedAt`, `deletedBy`) rather than physically removed from the database.
- Deleted items are hidden from standard operator views and search indexes, while their full audit history (`ItemEvent`) remains inspectable by administrators for compliance investigations.
