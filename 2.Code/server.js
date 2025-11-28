/**
 * Real-Time Vocabulary Quiz – API Server
 *
 * Component: Real-Time Quiz API (Node.js + SSE)
 *
 * Responsibilities:
 * - Allow users to join a quiz session by quizId.
 * - Accept answer submissions and update scores/attempts.
 * - Maintain an in-memory leaderboard per quiz.
 * - Stream real-time leaderboard updates via Server-Sent Events (SSE).
 *
 * NOTE: This file is intentionally dependency-free (only built-in Node modules).
 * It is designed for clarity in a coding challenge setting, not as a full
 * production service.
 */

const http = require("http");
const url = require("url");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const HEARTBEAT_INTERVAL_MS = 25_000; // keep SSE connections warm

/**
 * In-memory data model
 */

/**
 * @typedef {Object} Participant
 * @property {string} userId
 * @property {string} name
 * @property {number} score
 * @property {number} attempts
 * @property {number} joinedAt
 * @property {number} updatedAt
 */

/**
 * @typedef {Object} SseClient
 * @property {string} id
 * @property {http.ServerResponse} res
 * @property {NodeJS.Timeout | null} heartbeatTimer
 */

/**
 * @typedef {Object} QuizSession
 * @property {string} quizId
 * @property {Map<string, Participant>} participants
 * @property {Set<SseClient>} subscribers
 * @property {number} createdAt
 * @property {number} updatedAt
 */

/** @type {Map<string, QuizSession>} */
const quizzes = new Map();

/**
 * Utility helpers
 */

// [AI-ASSISTED] Basic JSON response helper inspired by common Node patterns.
// Verified and adapted for this specific routing logic.
function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
}

function setCommonHeaders(res) {
  // CORS for local dev / demo
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

/**
 * Parse JSON body from an incoming request.
 * Returns a Promise that resolves to an object or rejects on error.
 */
// [AI-ASSISTED] General structure of this body parser came from AI,
// but it was simplified and had a manual size limit added.
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    const MAX_SIZE = 1 * 1024 * 1024; // 1 MB

    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > MAX_SIZE) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!raw) {
        return resolve({});
      }
      try {
        const obj = JSON.parse(raw);
        resolve(obj);
      } catch (err) {
        reject(new Error("Invalid JSON"));
      }
    });

    req.on("error", (err) => {
      reject(err);
    });
  });
}

function createQuizSession(quizId) {
  const now = Date.now();
  /** @type {QuizSession} */
  const session = {
    quizId,
    participants: new Map(),
    subscribers: new Set(),
    createdAt: now,
    updatedAt: now,
  };
  quizzes.set(quizId, session);
  return session;
}

function getOrCreateQuizSession(quizId) {
  let session = quizzes.get(quizId);
  if (!session) {
    session = createQuizSession(quizId);
  }
  return session;
}

/**
 * Build a leaderboard array from a QuizSession.
 *
 * Ordering:
 *  - score DESC
 *  - updatedAt ASC (earlier achievers first)
 *  - userId ASC (deterministic)
 */
function buildLeaderboard(session) {
  // [AI-ASSISTED] Initial version of this sort comparator came from AI.
  // It was then validated with manual scenarios and unit-test-style checks.
  return Array.from(session.participants.values())
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.updatedAt !== b.updatedAt) return a.updatedAt - b.updatedAt;
      return a.userId.localeCompare(b.userId);
    })
    .map((p) => ({
      userId: p.userId,
      name: p.name,
      score: p.score,
      attempts: p.attempts,
    }));
}

/**
 * SSE helpers
 */

function makeClientId() {
  return crypto.randomBytes(8).toString("hex");
}

function setupSseHeaders(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*", // simple CORS for demo
  });
}

function sendSseEvent(res, eventName, data) {
  const payload =
    typeof data === "string" ? data : JSON.stringify(data);
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${payload}\n\n`);
}

function sendSseComment(res, comment) {
  res.write(`: ${comment}\n\n`);
}

/**
 * Broadcast the current leaderboard for a given session to all SSE subscribers.
 */
function broadcastLeaderboard(session) {
  const payload = {
    quizId: session.quizId,
    updatedAt: new Date(session.updatedAt).toISOString(),
    entries: buildLeaderboard(session),
  };

  for (const client of session.subscribers) {
    try {
      sendSseEvent(client.res, "leaderboard", payload);
    } catch (err) {
      // If a client errors, just log and continue. The 'close' handler
      // will clean up dangling connections.
      console.error(
        "[broadcast] error sending to client",
        client.id,
        err.message
      );
    }
  }
}

/**
 * HTTP route handlers
 */

async function handleJoin(req, res) {
  try {
    const body = await parseJsonBody(req);

    const quizId = String(body.quizId || "").trim();
    const userId = String(body.userId || "").trim();
    const name = String(body.name || "").trim();

    if (!quizId || !userId || !name) {
      return sendJson(res, 400, {
        error: "quizId, userId, and name are required",
      });
    }

    const session = getOrCreateQuizSession(quizId);
    const now = Date.now();

    let participant = session.participants.get(userId);
    if (!participant) {
      participant = {
        userId,
        name,
        score: 0,
        attempts: 0,
        joinedAt: now,
        updatedAt: now,
      };
    } else {
      // update name if changed
      participant = {
        ...participant,
        name,
        updatedAt: now,
      };
    }

    session.participants.set(userId, participant);
    session.updatedAt = now;

    const leaderboard = buildLeaderboard(session);

    sendJson(res, 200, {
      quizId,
      user: {
        userId: participant.userId,
        name: participant.name,
        score: participant.score,
        attempts: participant.attempts,
      },
      leaderboard,
    });
  } catch (err) {
    console.error("[/join] error:", err.message);
    sendJson(res, 400, { error: err.message || "Invalid request" });
  }
}

async function handleAnswer(req, res) {
  try {
    const body = await parseJsonBody(req);

    const quizId = String(body.quizId || "").trim();
    const userId = String(body.userId || "").trim();
    const correct = body.correct;

    if (!quizId || !userId || typeof correct !== "boolean") {
      return sendJson(res, 400, {
        error: "quizId, userId, and correct:boolean are required",
      });
    }

    const session = quizzes.get(quizId);
    if (!session) {
      return sendJson(res, 404, { error: "Quiz not found" });
    }

    let participant = session.participants.get(userId);
    if (!participant) {
      return sendJson(res, 404, { error: "Participant not found" });
    }

    const now = Date.now();
    participant = {
      ...participant,
      attempts: participant.attempts + 1,
      score: participant.score + (correct ? 1 : 0),
      updatedAt: now,
    };

    session.participants.set(userId, participant);
    session.updatedAt = now;

    const leaderboard = buildLeaderboard(session);

    // Broadcast to SSE subscribers
    broadcastLeaderboard(session);

    sendJson(res, 200, {
      quizId,
      user: {
        userId: participant.userId,
        name: participant.name,
        score: participant.score,
        attempts: participant.attempts,
      },
      leaderboard,
    });
  } catch (err) {
    console.error("[/answer] error:", err.message);
    sendJson(res, 400, { error: err.message || "Invalid request" });
  }
}

function handleLeaderboard(req, res, query) {
  const quizId = String(query.quizId || "").trim();
  if (!quizId) {
    return sendJson(res, 400, { error: "quizId is required" });
  }

  const session = quizzes.get(quizId);
  if (!session) {
    return sendJson(res, 404, { error: "Quiz not found" });
  }

  const leaderboard = buildLeaderboard(session);
  sendJson(res, 200, {
    quizId,
    entries: leaderboard,
  });
}

function handleEvents(req, res, query) {
  const quizId = String(query.quizId || "").trim();
  if (!quizId) {
    // For SSE, we still return a normal JSON error and close.
    return sendJson(res, 400, { error: "quizId is required" });
  }

  const session = getOrCreateQuizSession(quizId);

  setupSseHeaders(res);

  const clientId = makeClientId();
  /** @type {SseClient} */
  const client = {
    id: clientId,
    res,
    heartbeatTimer: null,
  };

  session.subscribers.add(client);
  console.log(
    `[SSE] client connected: ${clientId} for quiz ${quizId} (subscribers: ${session.subscribers.size})`
  );

  // Send initial leaderboard event
  const initialPayload = {
    quizId,
    updatedAt: new Date(session.updatedAt).toISOString(),
    entries: buildLeaderboard(session),
  };
  sendSseEvent(res, "leaderboard", initialPayload);

  // Heartbeats to keep connection alive
  client.heartbeatTimer = setInterval(() => {
    try {
      sendSseComment(res, "heartbeat");
    } catch (err) {
      console.error("[SSE] heartbeat error:", err.message);
    }
  }, HEARTBEAT_INTERVAL_MS);

  // Cleanup on close
  req.on("close", () => {
    if (client.heartbeatTimer) {
      clearInterval(client.heartbeatTimer);
    }
    session.subscribers.delete(client);
    console.log(
      `[SSE] client disconnected: ${clientId} for quiz ${quizId} (subscribers: ${session.subscribers.size})`
    );
  });
}

function handleHealth(req, res) {
  sendJson(res, 200, { status: "ok", uptime: process.uptime() });
}

/**
 * Main request router
 */

async function handleRequest(req, res) {
  setCommonHeaders(res);

  const parsedUrl = url.parse(req.url || "", true);
  const pathname = parsedUrl.pathname || "/";
  const method = req.method || "GET";

  // Simple preflight for CORS
  if (method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (method === "GET" && pathname === "/health") {
    return handleHealth(req, res);
  }

  if (method === "POST" && pathname === "/join") {
    return handleJoin(req, res);
  }

  if (method === "POST" && pathname === "/answer") {
    return handleAnswer(req, res);
  }

  if (method === "GET" && pathname === "/leaderboard") {
    return handleLeaderboard(req, res, parsedUrl.query || {});
  }

  if (method === "GET" && pathname === "/events") {
    return handleEvents(req, res, parsedUrl.query || {});
  }

  // Fallback: not found
  sendJson(res, 404, { error: "Not found" });
}

const server = http.createServer((req, res) => {
  // [AI-ASSISTED] Pattern of delegating to an async handler inside the
  // createServer callback came from AI; error handling was customized.
  handleRequest(req, res).catch((err) => {
    console.error("[server] unexpected error:", err);
    if (!res.headersSent) {
      sendJson(res, 500, { error: "Internal server error" });
    } else {
      res.end();
    }
  });
});

server.listen(PORT, () => {
  console.log(`Real-Time Quiz API server listening on http://localhost:${PORT}`);
});
