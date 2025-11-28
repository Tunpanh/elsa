# Real-Time Vocabulary Quiz – System Design

## 1. Overview

The Real-Time Vocabulary Quiz feature allows English learners to:

- Join a quiz session using a **quiz ID**.
- Answer questions in real time.
- See their **scores** and a **live leaderboard** update as everyone submits answers.

This design targets:

- **Correctness**: accurate scoring and consistent leaderboard.
- **Low latency**: near-real-time updates (sub-second in typical cases).
- **Scalability**: ability to support many concurrent users and multiple quiz sessions.
- **Observability**: metrics and logs to understand system behaviour.

---

## 2. High-Level Architecture

### 2.1 Architecture Diagram (textual)

```text
             ┌────────────────────────────┐
             │        Admin / CMS         │
             │ (create quizzes, questions)│
             └────────────┬───────────────┘
                          │ (out of scope for impl)
                          ▼
                 ┌───────────────────┐
                 │ Quiz Management   │
                 │   Service / API   │
                 └────────┬──────────┘
                          │ REST (create quiz, add questions, etc.)
                          │
        ┌─────────────────┴───────────────────┐
        │                                     │
        ▼                                     ▼
┌─────────────────────┐              ┌──────────────────────┐
│  Web / Mobile Client│              │ Real-Time Quiz API   │
│ (Student / Teacher) │              │  (Node.js HTTP + SSE)│
└──────────┬──────────┘              └──────────┬───────────┘
           │  HTTPS REST (join, answer, snapshot)   │
           │  HTTP SSE (subscribe leaderboard)      │
           ▼                                        ▼
    ┌───────────────────────┐               ┌───────────────────────┐
    │   API Gateway / LB    │               │  In-Memory Cache /    │
    │  (optional for scale) │               │  Fast Store (e.g.     │
    └──────────┬────────────┘               │  Redis / in-memory)   │
               │                            └──────────┬────────────┘
               │                                       │
               ▼                                       ▼
        ┌──────────────────────┐            ┌────────────────────────┐
        │  Primary Data Store  │            │  Analytics / Logging / │
        │ (e.g. Postgres)      │            │  Metrics (e.g. Prom,   │
        │ Quizzes, Questions,  │            │  Loki, ELK, etc.)      │
        │ Users, Scores, etc.  │            └────────────────────────┘
        └──────────────────────┘
```

For the coding challenge implementation, I will **focus on the Real-Time Quiz API (Node.js + SSE)** and keep other parts mocked or simplified.

---

## 3. Core Components

### 3.1 Web / Mobile Client

**Responsibilities**

- Allow user to:
  - Enter **quiz ID** and **name/userId** to join.
  - Submit answers (marked as correct/incorrect for the challenge).
  - View **live leaderboard**.
- Maintain an **SSE connection** to receive leaderboard updates in real time.

**Key Interactions**

- `POST /join` – join a quiz.
- `POST /answer` – submit an answer.
- `GET /leaderboard?quizId=...` – optional snapshot.
- `GET /events?quizId=...` – SSE stream for live leaderboard updates.

> For this challenge I will mostly show curl-based manual tests, but the design supports a browser client or mobile app.

---

### 3.2 Real-Time Quiz API (Node.js HTTP + SSE)

This is the **main component** I will implement.

**Responsibilities**

- **Session management**
  - Track active quiz sessions.
  - Track participants per quiz: `userId`, `name`, `score`, `attempts`, `lastUpdated`.
- **Join / Leave**
  - Allow users to join a quiz via `quizId`.
  - Optionally handle leave/disconnect or just rely on timeouts.
- **Scoring**
  - Accept answer submissions.
  - Update scores and other stats atomically.
- **Leaderboard calculation**
  - Maintain a leaderboard per quiz (e.g. sorted by score desc, then by earliest achievement for tie-breaking).
- **Real-time broadcast**
  - Maintain **SSE connections per quizId**.
  - On every score change:
    - Recompute leaderboard.
    - Broadcast updated leaderboard to all connected clients in that quiz.
- **Resilience / validation**
  - Validate input (quizId, userId, etc.).
  - Handle malformed requests and disconnections gracefully.
- **Observability hooks**
  - Logging (join, answer, broadcast).
  - Simple metrics (counts, latencies) for future integration.

**Internal Data Structures (for prototype)**

- `Map<quizId, QuizSession>`
- `QuizSession` holds:
  - `participants: Map<userId, Participant>`
  - `subscribers: Set<SseClient>` (each is a response object or wrapper)
  - configuration (e.g. max participants, started/ended flags).
- `Participant`:
  - `userId: string`
  - `name: string`
  - `score: number`
  - `attempts: number`
  - `joinedAt`, `updatedAt`: timestamps.

Production-ready design can move this to **Redis** or similar, but in-memory is sufficient for the coding challenge.

---

### 3.3 Data Store(s)

#### 3.3.1 Primary Data Store (Future / Extended)

For the full product:

- **Relational DB** (e.g. PostgreSQL):
  - `quizzes` (id, name, language level, owner, createdAt, status).
  - `questions` (id, quizId, prompt, correctAnswer, difficulty, etc.).
  - `quiz_sessions` (id, quizId, startTime, endTime, etc.).
  - `submissions` (id, sessionId, userId, questionId, isCorrect, submittedAt).
  - `scores` (sessionId, userId, score, attempts).

For the challenge implementation, I will **mock** this part and keep data in memory.

#### 3.3.2 Cache / Real-Time Store

For a scalable solution:

- Use **Redis** (or similar):
  - Store per-quiz leaderboard as a **sorted set** (`ZSET`) keyed by `quizId`.
  - Use **Pub/Sub**:
    - When one node updates the leaderboard, it publishes an event.
    - Other nodes subscribe and push updates to their connected clients.
- For now, the prototype uses **in-memory structures only**.

---

### 3.4 Quiz Management Service (Out of Scope for Implementation)

**Responsibilities**

- CRUD for quizzes and questions.
- Manage quiz scheduling (start/end).
- Validate answers (lookup correct answer from DB, apply scoring rules).

In this challenge, answer correctness can be **passed in the request** (`correct: true/false`) to isolate the real-time part.

---

### 3.5 Observability Stack (Conceptual)

- **Logging**
  - Structured logs for joins, answers, broadcasts, errors.
- **Metrics**
  - # of active SSE connections.
  - # of participants per quiz.
  - Answer throughput (submissions/sec).
  - Leaderboard update latency.
- **Tracing (future)**
  - Trace flow from HTTP request to DB/cache and SSE broadcast.

For the prototype, I will use simple console logging and structure it in a way that can be easily replaced with a real logging library.

---

## 4. Data Flow

### 4.1 User Joins a Quiz

1. User enters `quizId` and `name` on the client.
2. Client sends:

   `POST /join`
   ```json
   {
     "quizId": "demo",
     "userId": "u1",
     "name": "Ana"
   }
   ```

3. Real-Time API:
   - Validates payload.
   - Creates quiz session in memory if not exists.
   - Adds participant (or updates name if already joined).
   - Returns a success response with current leaderboard snapshot.
4. If the client has already opened `GET /events?quizId=demo`, it will start receiving leaderboard updates as soon as they exist.

### 4.2 Establish Real-Time Connection (SSE)

1. Client calls:

   `GET /events?quizId=demo`
2. Server:
   - Validates quizId.
   - Sets headers for SSE.
   - Stores the connection in `quizSession.subscribers`.
   - Optionally:
     - Sends an **initial event** with current leaderboard.
3. When the client disconnects (network / tab closed), server removes the subscriber.

### 4.3 Submit Answer

1. User submits answer (client knows whether it’s correct for this challenge):

   `POST /answer`
   ```json
   {
     "quizId": "demo",
     "userId": "u1",
     "correct": true
   }
   ```

2. Server:
   - Validates quizId and userId (must have joined).
   - Updates:
     - `attempts++`
     - If `correct` → `score += 1` (or other scoring rule).
   - Rebuilds leaderboard for that quiz:
     - Sort participants by `score DESC`, then maybe `updatedAt ASC` to break ties deterministically.
3. Broadcast:
   - Serialize leaderboard as JSON:
     ```json
     {
       "quizId": "demo",
       "updatedAt": "2025-11-28T00:00:00.000Z",
       "entries": [
         { "userId": "u1", "name": "Ana", "score": 5, "attempts": 6 },
         { "userId": "u2", "name": "Ben", "score": 3, "attempts": 5 }
       ]
     }
     ```
   - For each SSE subscriber in `quizSession.subscribers`, send event:
     ```text
     event: leaderboard
     data: {...json...}

     ```
4. All connected clients update their UI immediately.

### 4.4 Leaderboard Snapshot

1. Client calls:

   `GET /leaderboard?quizId=demo`
2. Server:
   - Reads participants, sorts them, returns leaderboard JSON.
3. This is useful:
   - For late joiners.
   - As a fallback if SSE fails.

---

## 5. Technologies & Tools

### 5.1 Runtime & Language

- **Node.js 18+**
  - Modern JS runtime, easy to run locally.
- **JavaScript (or TypeScript)**
  - For the challenge implementation I will likely use standard JS with JSDoc comments, but design is TypeScript-friendly.

### 5.2 Frameworks / Libraries

- **HTTP Framework**: Node’s built-in `http` module or a minimal framework (e.g. Express).
  - For this challenge, a small footprint is enough; I will likely use **plain Node HTTP** to avoid dependencies.
- **Real-time Communication**:
  - **Server-Sent Events (SSE)**:
    - Simple uni-directional stream from server to client.
    - Works over standard HTTP, easy to test with `curl`.
    - Perfect for pushing leaderboard updates.
  - Alternative for future scaling: WebSockets if we need bi-directional real-time messaging (e.g. sending questions, chat, etc.).

### 5.3 Storage

- **Prototype**
  - In-memory structures (`Map`, etc.) inside Node process.
- **Future / Scalable**
  - **Redis** for:
    - Fast leaderboard operations.
    - Cross-node pub/sub for broadcasts.
  - **PostgreSQL** (or other RDBMS) for:
    - Durable storage of quizzes, questions, and historical results.

### 5.4 Observability & Tooling (Future)

- Logging library (e.g. pino, Winston).
- Metrics (Prometheus).
- Centralized log collection (ELK / Loki).

---

## 6. Non-Functional Considerations

### 6.1 Scalability

- **Horizontal scaling**
  - Multiple Node.js instances behind a **load balancer**.
  - SSE requires **sticky sessions** or a shared event bus (Redis Pub/Sub) so that:
    - Any instance processing an answer can publish a “leaderboard updated” event.
    - Instances that own SSE connections for that quiz receive the event and broadcast updates.
- **Sharding by quizId**
  - For very large scale, quizzes can be partitioned across instances by hash of `quizId`.

### 6.2 Performance

- Keep scoreboard in memory (or Redis) to avoid heavy DB reads on every update.
- Use O(log N) leaderboard operations (sorted structures).
- Keep payloads small (only necessary fields per participant).
- Stream responses incrementally (SSE) instead of frequent polling.

### 6.3 Reliability & Fault Tolerance

- **Failure of a single Node instance**
  - SSE connections from that instance drop; client reconnect logic can reopen connection via load balancer.
  - Leaderboard data should be in a shared cache (e.g. Redis) so state is not lost when a node restarts.
- **Network issues**
  - Client auto-reconnect with exponential backoff.
  - Server should support idempotent operations where possible.

### 6.4 Security

- For the challenge:
  - Keep endpoints open and simple.
- For production:
  - Authenticate users (JWT, session cookies).
  - Authorize which users can join which quizzes.
  - Rate-limit sensitive endpoints (e.g. answer submissions).
  - Input validation and sanitization to avoid injection or malformed payload issues.
  - Use HTTPS between client and server.

### 6.5 Maintainability

- Clear separation of concerns:
  - Routing layer.
  - Quiz/session domain logic.
  - SSE connection management.
  - Storage abstraction (in-memory vs Redis/DB).
- Type-friendly (TypeScript-ready) models for entities.
- Unit tests for scoring logic and leaderboard ordering.

---

## 7. AI Collaboration in Design (Required)

As required by the challenge, I used **Generative AI** as a design partner.

### 7.1 AI Tools Used

- **ChatGPT (OpenAI)**

### 7.2 How AI Helped in the Design Phase

- **Clarifying requirements**
  - Discussed the acceptance criteria (join by quizId, real-time scores, real-time leaderboard) and how they map to concrete endpoints and data flows.
- **Brainstorming architecture options**
  - Explored different real-time transport mechanisms:
    - Long polling
    - Server-Sent Events (SSE)
    - WebSockets
  - Selected **SSE** for this implementation because:
    - It’s simple to implement over HTTP.
    - Works well with curl for demonstration.
    - Fits the “server pushes leaderboard updates” pattern.
- **Refining component boundaries**
  - Iterated on how to separate:
    - Real-Time Quiz API
    - Data store (in-memory vs Redis vs DB)
    - Future Quiz Management Service
  - Ensured the design scales from a single-node prototype to a distributed deployment.
- **Non-functional aspects**
  - Used AI to brainstorm:
    - How to handle scalability with Redis Pub/Sub and sticky sessions.
    - Ideas for observability: metrics, structured logging, and basic health checks.
    - Potential failure scenarios and reconnection strategies for SSE.

### 7.3 My Verification and Critical Thinking

To avoid blindly trusting AI suggestions, I:

- **Cross-checked complexity and feasibility**
  - Ensured that the chosen architecture (Node.js + SSE + in-memory store) is **implementable under the time constraints** of the challenge.
  - Simplified areas (e.g. mocking correctness of answers) while keeping the design extensible.
- **Validated real-time options**
  - Considered WebSockets and long polling; decided SSE is enough for one-way leaderboard updates.
  - Noted that if future requirements need bi-directional communication (e.g. sending questions to clients), the design can be extended to WebSockets without major restructuring.
- **Stress-tested the design logically**
  - Thought through typical and edge scenarios:
    - Multiple users joining the same quiz at once.
    - Many answer submissions in a short burst.
    - Client reconnection when network is flaky.
  - Ensured there is a clear place in the architecture to handle each case.
- **Kept ownership**
  - Treated AI as a brainstorming partner, not an authority:
    - I chose the final architecture.
    - I prioritized which parts to implement now vs. mark as future work.
    - I ensured alignment with the challenge scope and evaluation criteria.
