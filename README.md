# Newtonite: Operations Under Pressure
### Resilient Operational Work Coordination Platform

Newtonite Operations Under Pressure is a resilient full-stack work-item coordination platform built from scratch to orchestrate mission-critical operational incident triage and cross-team workflows under extreme concurrent load. In operational crisis environments, multiple operators simultaneously triage, claim, transition, and update shared records—creating severe risks of race conditions, lost updates, double claims, unauthorized actions, and phantom notifications. The platform eliminates these failure modes from the ground up through multi-document ACID transactions, database-level atomic claim primitives, optimistic concurrency control with in-browser draft conflict reconciliation, an asynchronous transactional outbox worker, and a pure central authorization policy enforcing strict team boundaries with 404 existence hiding.

---

## 1. System Prerequisites

The following exact versions have been verified:

| Component | Minimum Version | Verified Version | Notes |
|---|---|---|---|
| **Node.js** | `>= 18.0.0` | `v22.20.0` (LTS) | Runtime engine for API server and outbox worker |
| **npm** | `>= 9.0.0` | `11.2.0` | Package manager |
| **Docker** | `>= 24.0.0` | `29.2.1` | Required to host containerized MongoDB |
| **Docker Compose** | `>= 2.0.0` | `v5.0.2` | Orchestrates single-node replica set with healthcheck |
| **MongoDB** | `7.0` | `7.0.x` (`mongo:7.0`) | Single-node replica set (`rs0`) required for multi-document ACID transactions |
| **Web Browser** | Evergreen | Chrome / Firefox / Safari / Edge | Modern browser with JavaScript enabled |

---

## 2. Core Operational & Architectural Assumptions

The candidate brief intentionally leaves several product and workflow decisions unspecified. The following core assumptions define the operational boundary of this solution:

- **Single-Workspace Primary Operational Tenancy**: The organization operates within a single primary workspace (`Acme Operations`). Multi-tenancy boundaries (`External Partner Workspace`) serve as isolated security firewalls where cross-tenant queries strictly return HTTP 404 to hide resource existence.
- **Two-Tier Identity Model**: Workspace roles (`OWNER`, `ADMIN`, `MEMBER`) govern workspace-level governance and administrative overrides, while day-to-day operational scope and queue filtering are dictated by functional team memberships (`TeamMember` records with `LEAD` or `MEMBER` roles).
- **Separation of Duties on Approvals**: Only designated approvers (`approverId`) or functional team leads can approve an item in `PENDING_APPROVAL`. The item owner and the original requester are strictly forbidden from self-approving (`403 Forbidden`), even if they hold Admin or Owner workspace privileges.
- **Administrative Deadlock Breaker**: If an assigned approver is on leave or unavailable during an active crisis, Workspace Owners, Admins, or Team Leads can execute an administrative `cancel` action to move the item to `CLOSED`, with a mandatory non-empty reason string logged to the audit trail.
- **Short Polling Over WebSockets**: The Needs-Attention triage dashboard relies on 20-second background polling rather than stateful WebSockets or Server-Sent Events (SSE). This maintains stateless horizontal scalability and prevents reconnection storms and socket-drain deadlocks during incident surges.
- **Server-Side Authority with Local Draft Preservation**: The UI avoids speculative optimistic mutations that risk displaying phantom "resolved" states during race conditions. When concurrent writes yield HTTP 409 Conflict, form inputs are retained in React component state, and `<ConflictBanner>` presents a side-by-side diff allowing the operator to reconcile without data loss.
- **Seed Volume & Scale Benchmark**: Standard seeding (`npm run seed`) loads scenario accounts and items for immediate demonstration. Setting `BULK=true` (`BULK=true npm run seed`) populates 5,000 realistic work items across teams to benchmark compound covered indexes and cursor pagination stability under heavy volume.
- **Single-Node Replica Set Local Footprint**: Docker Compose initializes MongoDB 7.0 as a single-node replica set (`rs0`) with automated healthcheck initiation (`rs.initiate()`) to unlock multi-document ACID transactions without the operational overhead of a distributed 3-node cluster on local machines.
- **Sub-Resource Comment Version Decoupling**: Comments append immutable timeline events (`COMMENT_ADDED`) and increment `commentCount` via atomic `$inc`, but deliberately do not bump the parent work item's optimistic `version`. This prevents active investigation drafts from being spuriously invalidated by concurrent commentary.
- **Crash-Safe Idempotency Leases**: The `Idempotency-Key` middleware enforces 2-minute lease timeouts for `in_progress` requests to recover from unexpected server crashes. Additionally, error responses (HTTP 4xx/5xx) are purged immediately, allowing operators to correct validation errors or resolve conflicts and retry under the same key.
- **At-Least-Once Asynchronous Delivery**: The Transactional Outbox pattern guarantees at-least-once delivery of notifications across process restarts. Idempotency is enforced downstream at the database level via unique compound indexes (`${eventId}:${recipientId}`).
- **Immutable Timeline with Soft-Delete Preservation**: Operational items are never hard-deleted; soft-deletion (`deletedAt`) hides them from active operator queues while preserving the full regulatory audit timeline (`ItemEvent`) for administrative review.

---

## 3. Quick Start

Follow these verified steps to launch the entire stack from a clean machine:

### Step 1: Start the MongoDB Replica Set
Multi-document ACID transactions in MongoDB require a replica set. Start the pre-configured single-node replica set (`rs0`) in Docker Compose:

```bash
docker compose up -d
```

*What happens*: The container launches MongoDB 7.0 with `--replSet rs0` on port `27017`. The built-in healthcheck automatically runs `rs.initiate()` and waits until the replica set is primary and healthy.

Verify the container is healthy:
```bash
docker compose ps
```

### Step 2: Configure Environment Variables
Copy the sample environment files into active configuration files:

```bash
# In project root
cp .env.example backend/.env
cp client/.env.example client/.env
```

### Step 3: Install Dependencies, Seed Data, and Start Backend
In your first terminal:

```bash
cd backend
npm install
npm run seed
npm run dev
```
*The API server will listen on `http://localhost:8000`.*

### Step 4: Start the Transactional Outbox Worker
In a second terminal, launch the decoupled outbox notification processor:

```bash
cd backend
npm run worker
```
*The worker polls every 1 second, atomically claiming pending outbox jobs and delivering in-app notifications idempotently.*

### Step 5: Start the Frontend Application
In a third terminal, start the Vite development server:

```bash
cd client
npm install
npm run dev
```

### Step 6: Open the Application
Open your browser at:
**`http://localhost:5173`**

Sign in with the seeded Workspace Owner account:
- **Email**: `owner@example.com`
- **Password**: `Password123!`

---

## 4. Manual (Non-Docker) Setup

If you prefer to run MongoDB natively without Docker:

1. **Install MongoDB 7.0 Community Edition** and verify `mongod` and `mongosh` are in your system PATH.
2. **Create a local database directory**:
   ```bash
   mkdir -p ~/data/mongo-rs0
   ```
3. **Start MongoDB with replica set flags**:
   ```bash
   mongod --replSet rs0 --bind_ip_all --dbpath ~/data/mongo-rs0 --port 27017
   ```
4. **Initiate the replica set in `mongosh`**:
   In another terminal, connect and initialize:
   ```bash
   mongosh --eval 'rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "localhost:27017" }] })'
   ```
   Verify initialization:
   ```bash
   mongosh --eval 'rs.status().ok'
   ```
   *(Must return `1`)*.
5. **Configure `backend/.env`**:
   Ensure `MONGO_URI` is set to:
   ```env
   PORT=8000
   NODE_ENV=development
   MONGO_URI="mongodb://localhost:27017/newtonite_ops?replicaSet=rs0&directConnection=true"
   SESSION_SECRET="newtonite-operations-under-pressure-secret-key-32chars"
   SESSION_EXPIRES_IN="1d"
   FRONTEND_ORIGIN="http://localhost:5173"
   ```
6. **Install dependencies and seed**:
   ```bash
   cd backend && npm install && npm run seed
   cd ../client && npm install
   ```
7. **Start services**: Run `npm run dev` in `backend`, `npm run worker` in `backend`, and `npm run dev` in `client`.

---

## 5. Environment Variables

The table below lists all supported environment variables across services:

| Variable | Target | Purpose | Default Value | Required? |
|---|---|---|---|---|
| `PORT` | Backend | HTTP port for the Express API server | `8000` | No |
| `NODE_ENV` | Backend | Application environment (`development`, `production`, `test`) | `development` | No |
| `MONGO_URI` | Backend | MongoDB replica set connection URI | `mongodb://localhost:27017/newtonite_ops?replicaSet=rs0&directConnection=true` | No (in dev; defaults if unset) |
| `SESSION_SECRET` | Backend | Cryptographic secret for signing cookie sessions (min 32 chars) | None | **Yes** *(Server crashes on startup if omitted in non-test mode)* |
| `SESSION_EXPIRES_IN` | Backend | Session cookie lifespan | `1d` | No |
| `FRONTEND_ORIGIN` | Backend | Allowed CORS origin for web client credentials | `http://localhost:5173` | No |
| `BASE_PATH` | Backend | API routing prefix | `/api` | No |
| `BULK` | Backend (Seed) | Set to `"true"` to generate 5,000 bulk work items during seeding | `false` | No |
| `VITE_API_BASE_URL` | Client | Target API URL accessed by the client HTTP client | `http://localhost:8000/api` | **Yes** *(Required in client build)* |

> [!IMPORTANT]
> **Undocumented Variable Flag**: `SESSION_SECRET` is strictly enforced. The application executes a fail-fast assertion on startup (`if (nodeEnv !== "test" && !sessionSecret) throw new Error(...)`) to prevent launching with insecure default keys.

---

## 6. Seeded Demo Accounts

The seed script (`npm run seed`) clears collections and establishes two distinct workspaces to demonstrate role hierarchy and tenant isolation:
- **Primary Workspace**: `Acme Operations` (Contains Customer Operations and Platform Engineering teams)
- **Foreign Workspace**: `External Partner Workspace` (Tenant isolation boundary)

All accounts share the exact same password: **`Password123!`**

| User Name | Email Address | Password | Workspace Role | Team Memberships & Role | Primary Operational Scope |
|---|---|---|---|---|---|
| **Alice Owner** | `owner@example.com` | `Password123!` | `OWNER` | All teams (Executive) | Global workspace oversight, administrative overrides, workspace settings |
| **Bob Admin** | `admin@example.com` | `Password123!` | `ADMIN` | Customer Operations (Member)<br/>Platform Engineering (Member) | Full cross-team visibility, dead-letter outbox queue inspection |
| **Charlie Lead-Ops** | `lead1@example.com` | `Password123!` | `MEMBER` | `Customer Operations` (**Lead**) | Designated approver for Customer Ops, team reassignment, operational triage |
| **David Member-Ops** | `member1@example.com` | `Password123!` | `MEMBER` | `Customer Operations` (Member) | Customer Ops task execution, item creation, claiming |
| **Elena Lead-Eng** | `lead2@example.com` | `Password123!` | `MEMBER` | `Platform Engineering` (**Lead**) | Designated approver for Platform Eng, team reassignment, engineering lead |
| **Frank Member-Eng** | `member2@example.com` | `Password123!` | `MEMBER` | `Platform Engineering` (Member) | Platform Eng task execution, item creation, claiming |
| **Oscar Outsider** | `outsider@example.com` | `Password123!` | `OWNER` | `External Partner Workspace` (Lead) | Cross-tenant test boundary; all requests to Acme items return **404 Not Found** |

---

## 7. Running the Automated Tests

The test suite runs against an isolated in-memory replica set (`MongoMemoryReplSet`), executing real multi-document ACID transactions with genuine `Promise.all` parallel concurrency.

> [!NOTE]
> **First Test Run & Internet Access Requirement**: The automated test suite uses `mongodb-memory-server` in replica set mode (`MongoMemoryReplSet`). On its initial run, it automatically downloads the official MongoDB binary archive (~100 MB) and caches it locally. Therefore, **the first `npm test` run requires an active internet connection** and may take 30–60 seconds to initiate. Subsequent test runs use the cached binary and execute completely offline.

### Running All Test Suites:
```bash
cd backend
npm test
```

### What Each Test Suite Covers:

| Test Suite File | Tests | Core Behaviors & Verification Scope |
|---|---|---|
| `src/__tests__/concurrency.test.ts` | 10 tests | **High-Contention Concurrency & Idempotency**:<br/>• **Atomic Claim**: 10 simultaneous claims on an unowned item yield exactly one 200, nine 409 `ALREADY_CLAIMED`, 1 version increment, and 1 audit event.<br/>• **Stale Write**: Concurrent edits with identical `expectedVersion` yield one 200 and one 409 `STALE_VERSION` returning current server record.<br/>• **Idempotent Create**: 5 parallel requests with identical `Idempotency-Key` yield identical responses, creating only 1 item.<br/>• **Key Reuse Body Mismatch**: Reusing a key with altered body returns 422.<br/>• **Comment Concurrency**: 10 parallel comments increment `commentCount` to 10 without bumping `version`, preventing spurious 409 draft conflicts.<br/>• **Double Delete Guard**: Two parallel deletes produce one 200, one 404, and 1 `DELETED` event.<br/>• **State-Owner Invariant**: Mathematically validates that an item cannot be in `OPEN` with an owner.<br/>• **Crash Recovery**: Stale `in_progress` locks older than 2 minutes are reclaimed; error responses (409/422) are purged from idempotency cache. |
| `src/__tests__/workflow.test.ts` | 6 tests | **State Machine Transition Rules & Duties Separation**:<br/>• Enforces valid lifecycle transitions; blocks illegal jumps (e.g. `OPEN` to `RESOLVED`) with 409 and server `allowedActions`.<br/>• **Separation of Duties**: Blocks owner/requester self-approval with 403; verifies designated approver validation.<br/>• Reassign state guards: rejects reassigning closed, resolved, or deleted items.<br/>• Administrative cancellation override for deadlocked approval items with mandatory reason. |
| `src/__tests__/authorization.test.ts` | 10 tests | **Scoped Authorization Policy (`can`) & Existence Hiding**:<br/>• Resource-level team scoping: non-admins cannot access or edit other teams' items.<br/>• **404 Existence Hiding**: Requests for items in foreign workspaces or inaccessible teams return HTTP 404 (not 403) to prevent enumeration.<br/>• Mass assignment prevention: strips `ownerId`, `workspaceId`, `version`, and `state` during `PATCH`.<br/>• Admin-only dead-letter outbox visibility: regular members receive 403.<br/>• Attention view scoping: isolates unassigned queues and item views by team. |
| `src/__tests__/historyAndValidation.test.ts` | 5 tests | **Audit Trail Integrity & Input Validation**:<br/>• Soft delete preservation: items marked deleted with `deletedAt`/`deletedBy`; full timeline remains inspectable by admins while hidden from normal queries.<br/>• Field edit state guards: closed/resolved items reject field edits with 400.<br/>• Audit trail diffing: `FIELDS_CHANGED` records structured before/after diffs; no-op edits create no events.<br/>• Query validation: malformed team IDs, invalid dates, and invalid enums return 400 with structured Zod errors, never 500. |
| `src/__tests__/transactions.test.ts` | 1 test | **Multi-Document ACID Rollback**:<br/>• Injects a database failure during `ItemEvent` insertion inside `tx(session)`; verifies complete rollback (item state reverted, no partial events, no outbox jobs committed). |
| `src/__tests__/pagination.test.ts` | 1 test | **Stable Cursor Pagination**:<br/>• Traverses 100 items via base64 `[updatedAt, _id]` cursor under concurrent writes; confirms zero duplicate items and zero skipped records across pages. |
| `src/__tests__/worker.test.ts` | 4 tests | **Transactional Outbox Worker & Resilience**:<br/>• Atomically claims jobs via lease locks (`lockedUntil`); delivers notifications idempotently via compound dedupe keys (`${eventId}:${recipientId}`).<br/>• Exponential backoff retry policy; routes jobs exceeding 5 attempts to dead-letter queue (`status: "dead"`).<br/>• Crash recovery: `reclaimStuckJobs()` reclaims expired locks back to `pending`. |
| `src/__tests__/auth.test.ts` | 3 tests | **Session Authentication**:<br/>• Verifies successful login with bcrypt password hashing; rejects invalid passwords and unregistered emails with 401. |

### Running Index Query Plan Verification:
To execute real `explain('executionStats')` across all 6 core query patterns:
```bash
npm run explain
```
*Outputs verification metrics to `docs/EXPLAIN.md`, confirming that team queues, personal queues, approvals, and cursor pagination utilize compound covered index scans (`IXSCAN`) without in-memory sorting or full collection scans (`COLLSCAN`).*

---

## 8. Interactive Demo Walkthrough (7 Critical Behaviors)

This step-by-step walkthrough demonstrates the core resilience behaviors required under high operational pressure:

### Step 1: Real-Time Needs-Attention Dashboard
1. Open `http://localhost:5173` and log in as Customer Ops Lead:
   - **Email**: `lead1@example.com`
   - **Password**: `Password123!`
2. The landing dashboard displays the 5 high-priority triage buckets:
   - *Waiting on My Approval*
   - *Assigned to Me & Overdue*
   - *Unassigned Urgent Items*
   - *Stale Work Items*
   - *Changed Since Last Seen*
3. The dashboard executes background short polling (20-second interval) to keep operational queues fresh without disruptive page refreshes.

### Step 2: Two Users Claiming the Same Item (Race Condition & 409 Conflict)
1. Open two browser windows side-by-side:
   - **Window A**: Logged in as `member1@example.com` (David Member-Ops)
   - **Window B**: Logged in as `lead1@example.com` (Charlie Lead-Ops)
2. In both windows, navigate to **Work Items** and locate the unassigned urgent item:
   `"Critical Payment Gateway Timeout"` (State: `OPEN`, Owner: unassigned).
3. Click the **Claim** button simultaneously in both windows.
4. **Observed Behavior**:
   - **Window A** succeeds: item state immediately transitions to `IN_PROGRESS` and assigns to David Member-Ops.
   - **Window B** receives an **HTTP 409 Conflict** banner (`ALREADY_CLAIMED`): *"This work item has already been claimed by another team member."*
   - Inspect the audit trail: exactly **one** `CLAIMED` event exists in `ItemEvent`, and `version` incremented exactly once. Check-then-write race conditions are completely eliminated at the database level.

### Step 3: Stale-Version Edit Conflict & In-Browser Draft Reconciliation
1. In both windows, open the newly claimed work item detail page (both windows now view Version 2).
2. In **Window A**, click **Edit Details**:
   - Change Title to: `"Critical Payment Gateway Timeout - Investigating Stripe Webhooks"`
   - Click **Save Changes**.
   - Window A succeeds: Version increments from 2 to 3.
3. In **Window B** (which still holds Version 2 in memory), click **Edit Details**:
   - Change Title to: `"Critical Payment Gateway Timeout - Database Connection Pool Exhausted"`
   - Change Description to: `"Elevated connection count observed in staging cluster."`
   - Click **Save Changes**.
4. **Observed Behavior**:
   - The API rejects Window B's write with **HTTP 409 Conflict (`STALE_VERSION`)**.
   - **Window B does NOT lose their typed draft**.
   - The UI automatically renders `<ConflictBanner>` displaying a side-by-side diff comparing Window B's local draft against Window A's committed server record.
   - Window B can inspect conflicting fields and choose either **"Apply My Draft to Latest Version"** (which automatically binds to Version 3) or **"Accept Server State"** (discarding draft).

### Step 4: Repeated Request with Identical `Idempotency-Key`
1. Open your browser Developer Tools Network tab.
2. Click **Create Work Item**, fill in title and description, and rapidly double-click the **Submit** button (or replay the request via `curl` with the same `Idempotency-Key` header).
3. **Observed Behavior**:
   - Both requests transmit the identical `Idempotency-Key` header.
   - The initial request completes and caches its response.
   - The second request returns the cached response with identical payload and status.
   - Inspect the database: exactly **one** work item was created, and exactly **one** `CREATED` event was appended to the audit log.

### Step 5: Separation of Duties & Forbidden Self-Approval (HTTP 403)
1. In Window A (logged in as `member1@example.com`), create a work item with **Requires Approval** checked:
   - **Title**: `"Customer SLA Breach Credit Request ($5,000)"`
   - **Request Type**: `payment`
   - **Priority**: `URGENT`
   - **Team**: `Customer Operations`
2. Claim the item and click **Request Approval**, designating `lead1@example.com` as approver. The state moves to `PENDING_APPROVAL`.
3. While still in Window A (`member1@example.com`, the item owner and requester), attempt to approve the item:
   - The frontend UI suppresses the Approve button for the owner.
   - If an operator manually submits `POST /api/items/:id/transition` with `action: "approve"`, the API policy strictly rejects the call with **HTTP 403 Forbidden**:
     `"Separation of duties: Cannot approve your own work item"`.
4. Switch to Window B (logged in as `lead1@example.com`, the designated approver). The **Approve** and **Reject** buttons are active. Clicking **Approve** successfully transitions the item to `RESOLVED`.

### Step 6: Cross-Team Access Returning HTTP 404 (Existence Hiding)
1. While logged in as `member1@example.com` (a member only of `Customer Operations`), obtain the ID of an item belonging to `Platform Engineering` (e.g. `"Deploy database migration v2.4"`).
2. Attempt to navigate directly to `/workspace/<workspaceId>/items/<engItemId>` in the URL bar, or issue a `GET /api/items/<engItemId>` request with Member-Ops credentials.
3. **Observed Behavior**:
   - The server responds with **HTTP 404 Not Found**, never HTTP 403 Forbidden.
   - This prevents cross-team resource enumeration and conceals the existence of confidential tickets across organizational silos.

### Step 7: Outbox Worker, Retry Resilience, and Dead-Letter Queue
1. Stop the outbox worker process in your second terminal by pressing `Ctrl + C`.
2. In the web application, add a comment or trigger a transition on an item. The mutation succeeds instantly because side-effects are decoupled from the request cycle.
3. In MongoDB, inspect the `outboxjobs` collection: an `OutboxJob` document has been committed atomically with `status: "pending"`.
4. Restart the worker:
   ```bash
   npm run worker
   ```
5. **Observed Behavior**:
   - The worker claims the pending job atomically via `findOneAndUpdate` with a 60-second lease lock (`lockedUntil`).
   - The notification is written to the `Notification` collection using the unique deduplication key (`${eventId}:${recipientId}`).
   - If a handler fails repeatedly, the worker executes exponential backoff (`5s`, `10s`, `20s`, `40s`). After 5 failed attempts, the job transitions to `status: "dead"`, logging the exact error stack for administrative inspection.
   - Log in as `admin@example.com` and navigate to `/api/notifications/dead-jobs` to inspect dead-lettered jobs across the workspace.

---

## 9. Project Structure

```
.
├── backend/
│   ├── src/
│   │   ├── config/             # Environment, Database, and Passport configuration
│   │   │   ├── app.config.ts   # Fail-fast environment variable loader
│   │   │   └── database.config.ts # MongoDB Mongoose connection manager
│   │   ├── controllers/        # HTTP handlers parsing inputs and returning status codes
│   │   │   ├── auth.controller.ts
│   │   │   ├── item.controller.ts
│   │   │   └── notification.controller.ts
│   │   ├── enums/              # Core domain enums (WorkItemState, Priority, EventType)
│   │   ├── middlewares/        # Express pipeline middlewares
│   │   │   ├── authContext.middleware.ts    # Extracts workspace/team membership context
│   │   │   ├── errorHandler.middleware.ts   # Translates domain errors to standard HTTP codes
│   │   │   ├── idempotency.middleware.ts    # Replay protection with SHA-256 hash checks
│   │   │   └── requestId.middleware.ts      # UUID v4 correlation IDs on req.id & headers
│   │   ├── models/             # Mongoose schemas with strict index definitions
│   │   │   ├── idempotencyRecord.model.ts   # 24h TTL store for deduplication keys
│   │   │   ├── itemEvent.model.ts           # Append-only timeline audit events
│   │   │   ├── notification.model.ts        # In-app notifications with unique dedupeKey
│   │   │   ├── outboxJob.model.ts           # Transactional outbox queue with status index
│   │   │   ├── team.model.ts & teamMember.model.ts # Functional team partition models
│   │   │   └── workItem.model.ts            # Core work item schema ({ strict: 'throw' })
│   │   ├── policy/             # Pure centralized authorization rules
│   │   │   └── policy.ts       # can(ctx, action, item) with team & separation of duties
│   │   ├── routes/             # REST route endpoints mounted under /api
│   │   ├── scripts/            # Database utility scripts
│   │   │   └── explainRunner.ts # Automated explain('executionStats') verifier
│   │   ├── seeders/            # Deterministic database seeder
│   │   │   └── seed.ts         # Seeds roles, users, teams, and sample/bulk items
│   │   ├── services/           # Core transactional business logic
│   │   │   └── item.service.ts # tx(session) transactions, atomic claims, cursor feeds
│   │   ├── utils/              # Helper utilities
│   │   │   └── transaction.ts  # tx() wrapper for Mongoose withTransaction
│   │   ├── validation/         # Zod schemas for payload and query validation
│   │   ├── workflow/           # Pure workflow transition table
│   │   │   └── workflow.ts     # Pure transition definitions and allowedActions generator
│   │   ├── worker.ts           # Asynchronous transactional outbox polling worker
│   │   └── index.ts            # Express application bootstrap and server entrypoint
│   └── vitest.config.ts        # Vitest test runner configuration
│
├── client/
│   ├── src/
│   │   ├── components/         # Reusable UI components
│   │   │   ├── asidebar/       # Navigation sidebar with team links
│   │   │   └── workspace/
│   │   │       ├── item/
│   │   │       │   ├── conflict-banner.tsx  # In-browser draft conflict reconciliation diff
│   │   │       │   └── create-item-dialog.tsx # Modal for creating operational work items
│   │   │       └── settings/   # Workspace and team configuration components
│   │   ├── context/            # React context providers (AuthContext)
│   │   ├── hooks/              # Custom React Query and URL state hooks
│   │   ├── page/workspace/     # Primary application views
│   │   │   ├── NeedsAttention.tsx  # 5-way parallel operational attention dashboard
│   │   │   ├── WorkItems.tsx       # Cursor-paginated queue with multi-filter controls
│   │   │   └── WorkItemDetail.tsx  # Timeline audit feed, transitions, and field editing
│   │   ├── routes/             # Client-side routing definitions
│   │   └── types/              # TypeScript API contract definitions
│   ├── package.json
│   └── vite.config.ts
│
├── docker-compose.yml          # Single-node MongoDB 7.0 replica set (rs0) definition
├── ENGINEERING_DECISIONS.md    # In-depth architectural trade-off analysis
├── KNOWN_LIMITATIONS.md        # Documented operational boundaries and scaling trade-offs
└── docs/
    ├── ASSUMPTIONS.md          # Documented architectural and domain assumptions
    └── EXPLAIN.md              # Verbatim query execution plans from explain()
```

---

## 10. Troubleshooting

### Port 8000 or 5173 Already in Use
If starting the server reports `EADDRINUSE`:
```bash
# On Windows PowerShell:
Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue | Select-Object OwningProcess
Stop-Process -Id <PID> -Force

# On macOS / Linux:
lsof -i :8000
kill -9 <PID>
```
Or override the port via environment variables: `PORT=8001 npm run dev` in `backend`, and update `VITE_API_BASE_URL` in `client/.env`.

### MongoDB Replica Set Not Ready / Transaction Errors
If you see `"Transaction numbers are only allowed on a replica set member or mongos"`:
1. Verify the Docker container is running:
   ```bash
   docker compose ps
   ```
2. If the container is stuck in `starting`, inspect the container logs:
   ```bash
   docker compose logs mongodb
   ```
3. Manually trigger replica set initiation if the healthcheck was interrupted:
   ```bash
   docker exec -it newtonite-mongodb mongosh --eval 'rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "localhost:27017" }] })'
   ```

### Missing `SESSION_SECRET` Fatal Error
If backend startup terminates with:
`Error: Fatal: SESSION_SECRET environment variable is required.`
Ensure you have created `backend/.env` with a string value of at least 32 characters for `SESSION_SECRET`:
```bash
cp .env.example backend/.env
```

### CORS / Frontend Origin Mismatch
If the browser console displays CORS errors when communicating with `http://localhost:8000`:
- Verify `FRONTEND_ORIGIN` in `backend/.env` exactly matches the URL in your browser bar (default `http://localhost:5173`).
- If running Vite on a different port (e.g. `5174`), update `FRONTEND_ORIGIN="http://localhost:5174"` in `backend/.env` and restart the backend.

### Outbox Worker Not Executing Notifications
If notifications are not appearing in the top navigation bar:
- Verify that `npm run worker` is active in a dedicated terminal.
- Ensure the worker process is connected to the same `MONGO_URI` replica set. Check worker terminal logs for `[Worker] Outbox worker started`.

---

## 11. Architectural References

- [`ENGINEERING_DECISIONS.md`](./ENGINEERING_DECISIONS.md) - Comprehensive technical justification for the core architectural decisions (Replica Set transactions vs Postgres, optimistic locking vs pessimistic locking, transactional outbox pattern, pure policy function with 404 existence hiding, cursor pagination, and soft delete audit preservation).
- [`KNOWN_LIMITATIONS.md`](./KNOWN_LIMITATIONS.md) - Documented operational boundaries, trade-offs, and scaling paths (short polling vs push updates, lease locks vs distributed lock managers, single-node replica set local footprint, and text search tokenization).
- [`docs/ASSUMPTIONS.md`](./docs/ASSUMPTIONS.md) - Detailed enumeration of domain, identity, concurrency, and infrastructure assumptions.
- [`docs/EXPLAIN.md`](./docs/EXPLAIN.md) - Verbatim execution plan benchmarks verifying compound covered index scans (`IXSCAN`) and zero in-memory sorting.
