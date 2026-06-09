const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const cors = require("cors");
const path = require("path");
const SessionManager = require("./sessionManager");
const LogWriter = require("./logWriter");

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || "local-monitor-secret";
const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, "logs");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const sessionManager = new SessionManager();
const logWriter = new LogWriter(LOG_DIR);

app.use(cors());
app.use(express.json({ limit: "10mb" }));

function authenticate(req, res, next) {
  const key = req.headers["x-api-key"];
  console.log(`[HTTP] ${req.method} ${req.path} key=${key ? key.substring(0, 8) + "..." : "none"}`);
  if (key !== API_KEY) {
    return res.status(401).json({ error: "Invalid API key" });
  }
  next();
}

app.get("/health", (req, res) => {
  const count = sessionManager.getActiveSessions().length;
  console.log(`[HTTP] GET /health → ok, ${count} sessions`);
  res.json({ status: "ok", sessions: count });
});

app.get("/sessions", authenticate, (req, res) => {
  res.json({ sessions: sessionManager.getActiveSessions() });
});

app.post("/events", authenticate, (req, res) => {
  const { sessionId, eventType, payload } = req.body;
  console.log(`[HTTP] POST /events → session=${sessionId} type=${eventType}`);

  if (!sessionId || !eventType) {
    return res.status(400).json({ error: "Missing sessionId or eventType" });
  }

  let session = sessionManager.getSession(sessionId);
  if (!session) {
    session = sessionManager.createSession(0, payload?.url || "", sessionId);
  }

  sessionManager.incrementEventCount(sessionId);

  logWriter.write(sessionId, { eventType, payload });
  console.log(`[Event] Written: ${sessionId}/${eventType} (total: ${session.sessionEventCount || "?"})`);

  broadcast({ sessionId, eventType, payload });
  console.log(`[WS] Broadcast to ${wss.clients.size} client(s)`);

  res.json({ ok: true });
});

wss.on("connection", (ws) => {
  console.log("[WS] Client connected");

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data);
      console.log(`[WS] Received: type=${msg.type} session=${msg.sessionId} eventType=${msg.eventType}`);

      if (msg.type === "register") {
        const session = sessionManager.createSession(msg.tabId, msg.url);
        ws._sessionId = session.sessionId;
        ws._tabId = msg.tabId;
        console.log(`[WS] Registered session: ${session.sessionId}`);
        ws.send(JSON.stringify({ type: "registered", sessionId: session.sessionId }));
      }

      if (msg.sessionId && msg.eventType) {
        let session = sessionManager.getSession(msg.sessionId);
        if (!session) {
          session = sessionManager.createSession(msg.tabId || 0, msg.payload?.url || "", msg.sessionId);
          console.log(`[WS] Auto-created session: ${msg.sessionId}`);
        }
        sessionManager.incrementEventCount(msg.sessionId);
        logWriter.write(msg.sessionId, { eventType: msg.eventType, payload: msg.payload });
        console.log(`[WS] Written: ${msg.sessionId}/${msg.eventType}`);
      }
    } catch (e) {
      console.error("[WS] Parse error:", e.message, data.toString().substring(0, 200));
    }
  });

  ws.on("close", () => {
    console.log("[WS] Client disconnected");
  });
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(msg);
    }
  });
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[Server] Running on http://localhost:${PORT}`);
  console.log(`[Server] WebSocket on ws://localhost:${PORT}`);
  console.log(`[Server] Logs: ${LOG_DIR}`);
});

process.on("SIGINT", () => {
  console.log("\n[Server] Shutting down...");
  logWriter.closeAll();
  server.close();
  process.exit(0);
});
