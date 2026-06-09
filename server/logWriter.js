const fs = require("fs");
const path = require("path");

class LogWriter {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.streams = new Map();
    this._ensureBaseDir();
  }

  _ensureBaseDir() {
    const today = new Date().toISOString().split("T")[0];
    const dateDir = path.join(this.baseDir, today);
    if (!fs.existsSync(dateDir)) {
      fs.mkdirSync(dateDir, { recursive: true });
    }
  }

  _getLogFile(sessionId) {
    const today = new Date().toISOString().split("T")[0];
    const dateDir = path.join(this.baseDir, today);
    if (!fs.existsSync(dateDir)) {
      fs.mkdirSync(dateDir, { recursive: true });
    }
    return path.join(dateDir, `${sessionId}.log`);
  }

  _getStream(sessionId) {
    if (this.streams.has(sessionId)) {
      return this.streams.get(sessionId);
    }
    const logFile = this._getLogFile(sessionId);
    const stream = fs.createWriteStream(logFile, { flags: "a" });
    this.streams.set(sessionId, stream);
    return stream;
  }

  write(sessionId, event) {
    const stream = this._getStream(sessionId);
    const line = JSON.stringify({
      sessionId,
      timestamp: new Date().toISOString(),
      ...event,
    });
    stream.write(line + "\n");
  }

  close(sessionId) {
    const stream = this.streams.get(sessionId);
    if (stream) {
      stream.end();
      this.streams.delete(sessionId);
    }
  }

  closeAll() {
    for (const [sessionId, stream] of this.streams) {
      stream.end();
    }
    this.streams.clear();
  }
}

module.exports = LogWriter;
