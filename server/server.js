const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const crypto = require("crypto");
const path = require("path");
const SessionManager = require("./sessionManager");
const LogWriter = require("./logWriter");

const PORT = process.env.PORT || 3000;
const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, "logs");
const TOKEN = process.env.API_KEY || crypto.randomBytes(32).toString("hex");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

const sessionManager = new SessionManager();
const logWriter = new LogWriter(LOG_DIR);

app.use(express.json({ limit: "10mb" }));

// Only allow local origins
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const host = req.headers.host || "";
  const isLocal =
    host.startsWith("localhost") ||
    host.startsWith("127.0.0.1") ||
    host.startsWith("[::1]");
  const isExtension = origin && origin.startsWith("chrome-extension://");

  if (req.path === "/health") return next();

  if (origin && !isExtension && !isLocal) {
    return res.status(403).json({ error: "Forbidden origin" });
  }
  next();
});

function authenticate(req, res, next) {
  const key = req.headers["x-api-key"];
  if (key !== TOKEN) {
    return res.status(401).json({ error: "Invalid API key" });
  }
  next();
}

app.get("/health", (req, res) => {
  const count = sessionManager.getActiveSessions().length;
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
  console.log(`[Event] Written: ${sessionId}/${eventType}`);

  broadcast({ sessionId, eventType, payload });
  res.json({ ok: true });
});

// WebSocket upgrade with token validation
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get("token");
  const origin = req.headers.origin || "";

  if (token !== TOKEN) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    console.log("[WS] Rejected: invalid token");
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
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

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[Server] Running on http://localhost:${PORT}`);
  console.log(`[Server] WebSocket on ws://localhost:${PORT}`);
  console.log(`[Server] Logs: ${LOG_DIR}`);
  console.log(`[Server] Token: ${TOKEN}`);
  console.log("[Server] Bound to 127.0.0.1 — not accessible from network");
});

process.on("SIGINT", () => {
  console.log("\n[Server] Shutting down...");
  logWriter.closeAll();
  server.close();
  process.exit(0);
});
