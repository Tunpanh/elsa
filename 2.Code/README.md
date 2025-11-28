# Real-Time Vocabulary Quiz – Coding Challenge Submission

## Overview

This repository contains my submission for the **Real-Time Vocabulary Quiz** coding challenge.

The goal of the component I implemented is to let learners:

- Join a quiz session using a **quiz ID**.
- Submit answers in real time.
- See a **live leaderboard** that updates as everyone answers.

I focused on the **Real-Time Quiz API server** (backend-only, Node.js + Server-Sent Events) as my chosen component.

---

## Submission Contents

### 1. System Design Documents

- **`SYSTEM_DESIGN.md`**

This document covers:

- Overall architecture of the Real-Time Vocabulary Quiz system.
- Key components and their responsibilities:
  - Web / mobile client
  - Real-Time Quiz API (Node.js + SSE)
  - Future data store(s) and cache
  - Quiz management service
- Data flow for:
  - Joining a quiz
  - Opening an SSE stream
  - Submitting answers
  - Receiving leaderboard updates
- Non-functional considerations:
  - Scalability
  - Performance
  - Reliability and fault tolerance
  - Security
  - Maintainability
- **AI Collaboration in Design (required)**:
  - How I used ChatGPT to explore SSE vs WebSockets vs polling.
  - How it helped refine component boundaries and non-functional trade-offs.
  - How I verified the design and kept ownership of decisions.

You can open this file directly for the full Part 1 System Design.

---

### 2. Working Code

- **`server.js`**

This file contains the full implementation of the **Real-Time Quiz API server**.

#### 2.1 Responsibilities

The server implements:

- `POST /join`  
  Users join a quiz session by `quizId`, `userId`, and `name`.  
  The server:
  - Creates a quiz session in memory if it does not exist.
  - Registers or updates the participant.
  - Returns the current leaderboard snapshot.

- `POST /answer`  
  Users submit answers with `quizId`, `userId`, and `correct` (boolean).  
  The server:
  - Validates that the quiz and participant exist.
  - Increments `attempts` and, if `correct === true`, increments `score`.
  - Recomputes the leaderboard.
  - Broadcasts the updated leaderboard via SSE.
  - Returns the updated user and leaderboard.

- `GET /leaderboard?quizId=...`  
  Returns a snapshot of the current leaderboard for the given quiz.

- `GET /events?quizId=...`  
  Opens a **Server-Sent Events (SSE)** stream.  
  The server:
  - Registers the client as a subscriber for that quiz.
  - Immediately sends the current leaderboard.
  - Sends a new `leaderboard` event whenever scores change.
  - Sends heartbeat comments to keep the connection alive.
  - Cleans up when the connection closes.

- `GET /health` (optional)  
  Simple health endpoint returning `{ status: "ok" }`.

#### 2.2 Data Model (In-Memory)

Inside `server.js`:

- `quizzes: Map<string, QuizSession>`
- `QuizSession`:
  - `quizId: string`
  - `participants: Map<string, Participant>`
  - `subscribers: Set<SseClient>`
  - `createdAt`, `updatedAt`
- `Participant`:
  - `userId`, `name`
  - `score`, `attempts`
  - `joinedAt`, `updatedAt`
- `SseClient`:
  - `id`
  - `res` (Node.js `ServerResponse`)
  - `heartbeatTimer`

Leaderboards are computed using:

- Primary sort: **score** (descending)
- Secondary sort: **updatedAt** (ascending; earlier achievers first)
- Tertiary sort: **userId** (ascending, for deterministic ordering)

#### 2.3 AI Collaboration in Implementation (Required)

As required by the challenge, I explicitly used Generative AI as an implementation assistant and documented this in the code.

In `server.js`:

- Sections influenced by AI are marked with `// [AI-ASSISTED]` comments.
- Examples:
  - JSON body parsing helper:
    - Initial pattern came from AI; I added a size limit and error handling for robustness.
  - Sorting comparator for the leaderboard:
    - Drafted with AI; I validated it using manual scenarios and test-like checks.
  - Async handler pattern in `http.createServer`:
    - General style suggested by AI; I customized error handling and logging.

For each AI-assisted section, I:

- **Reviewed the code manually**:
  - Ensured no unnecessary complexity or unsafe logic.
  - Adjusted names, structure, and comments for clarity.
- **Validated through testing**:
  - Used curl-based manual tests to verify behavior for:
    - Join, answer, leaderboard snapshot.
    - SSE stream updates when scores change.
    - Error paths like invalid JSON, missing fields, unknown quiz/user.
- **Kept ownership of the final result**:
  - Treated AI as a helper, not a code generator to copy blindly.
  - Simplified or rewrote suggested snippets where they didn’t fit.

This matches the requirement that **AI usage is documented and verified**, not blindly trusted.

---

## How to Run the Server

### Prerequisites

- **Node.js 18+** installed.

### Steps

From the repository root (where `server.js` lives):

```bash
node server.js
```

By default, the server listens on:

- `http://localhost:3000`

You can change the port using the `PORT` environment variable:

```bash
PORT=4000 node server.js
```

---

## API Reference (Quick)

### `POST /join`

Join a quiz session.

**Request**

```json
{
  "quizId": "demo",
  "userId": "u1",
  "name": "Ana"
}
```

**Response (200)**

```json
{
  "quizId": "demo",
  "user": {
    "userId": "u1",
    "name": "Ana",
    "score": 0,
    "attempts": 0
  },
  "leaderboard": [
    {
      "userId": "u1",
      "name": "Ana",
      "score": 0,
      "attempts": 0
    }
  ]
}
```

---

### `POST /answer`

Submit an answer.

**Request**

```json
{
  "quizId": "demo",
  "userId": "u1",
  "correct": true
}
```

**Response (200)**

```json
{
  "quizId": "demo",
  "user": {
    "userId": "u1",
    "name": "Ana",
    "score": 1,
    "attempts": 1
  },
  "leaderboard": [
    {
      "userId": "u1",
      "name": "Ana",
      "score": 1,
      "attempts": 1
    }
  ]
}
```

---

### `GET /leaderboard?quizId=demo`

Get current leaderboard snapshot.

**Response (200)**

```json
{
  "quizId": "demo",
  "entries": [
    {
      "userId": "u1",
      "name": "Ana",
      "score": 1,
      "attempts": 1
    }
  ]
}
```

---

### `GET /events?quizId=demo`

Open an SSE stream for real-time leaderboard updates.

Example using `curl`:

```bash
curl -N "http://localhost:3000/events?quizId=demo"
```

You will see events like:

```text
event: leaderboard
data: {"quizId":"demo","updatedAt":"2025-11-28T00:00:00.000Z","entries":[...]}
```

---

## Manual Test / Demo Flow (CLI)

The following steps are tailored for **Windows PowerShell**.

1. **Start the server**

   ```powershell
   node .\server.js
   ```

2. **Open SSE stream (another terminal)**

   Use `curl.exe` (the real curl binary, not the PowerShell alias):

   ```powershell
   curl.exe -N "http://localhost:3000/events?quizId=demo"
   ```

   Alternatively, you can open this URL in a browser:
   `http://localhost:3000/events?quizId=demo`

3. **Join as Ana**

   ```powershell
   Invoke-RestMethod -Uri "http://localhost:3000/join" `
     -Method POST `
     -ContentType "application/json" `
     -Body '{"quizId":"demo","userId":"u1","name":"Ana"}'
   ```

4. **Join as Ben**

   ```powershell
   Invoke-RestMethod -Uri "http://localhost:3000/join" `
     -Method POST `
     -ContentType "application/json" `
     -Body '{"quizId":"demo","userId":"u2","name":"Ben"}'
   ```

5. **Submit answers**

   Ana correct:

   ```powershell
   Invoke-RestMethod -Uri "http://localhost:3000/answer" `
     -Method POST `
     -ContentType "application/json" `
     -Body '{"quizId":"demo","userId":"u1","correct":true}'
   ```

   Ben incorrect:

   ```powershell
   Invoke-RestMethod -Uri "http://localhost:3000/answer" `
     -Method POST `
     -ContentType "application/json" `
     -Body '{"quizId":"demo","userId":"u2","correct":false}'
   ```

   Ana correct again:

   ```powershell
   Invoke-RestMethod -Uri "http://localhost:3000/answer" `
     -Method POST `
     -ContentType "application/json" `
     -Body '{"quizId":"demo","userId":"u1","correct":true}'
   ```

6. **Check snapshot**

   ```powershell
   Invoke-RestMethod -Uri "http://localhost:3000/leaderboard?quizId=demo" `
     -Method GET
   ```

Throughout this sequence, the SSE terminal (or browser tab) will display `leaderboard` events whenever scores change, providing a clear live demo for the video submission.

---

## Future Enhancements (Not Implemented but Considered)

- Replace in-memory state with:
  - **Redis** for cross-instance leaderboard and pub/sub.
  - **PostgreSQL** for durable quiz, question, and submission storage.
- Add **authentication and authorization**.
- Implement a full client UI for learners and teachers.
- Add **metrics** (Prometheus) and structured logging for production observability.
