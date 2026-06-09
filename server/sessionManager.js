const { v4: uuidv4 } = require("uuid");

class SessionManager {
  constructor() {
    this.sessions = new Map();
  }

  createSession(tabId, url, sessionId) {
    const id = sessionId || `tab-${tabId}`;
    const session = {
      sessionId: id,
      tabId,
      url,
      startTime: new Date().toISOString(),
      eventCount: 0,
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  getSessionByTabId(tabId) {
    for (const session of this.sessions.values()) {
      if (session.tabId === tabId) {
        return session;
      }
    }
    return null;
  }

  incrementEventCount(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.eventCount++;
    }
  }

  removeSession(sessionId) {
    this.sessions.delete(sessionId);
  }

  getActiveSessions() {
    return Array.from(this.sessions.values());
  }
}

module.exports = SessionManager;
