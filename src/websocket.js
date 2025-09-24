import { WebSocketServer } from "ws";

class WebSocketManager {
  constructor() {
    this.wss = null;
    this.clients = new Set();
    this.heartbeatInterval = null;
    this.heartbeatIntervalMs = 30000; // 30 seconds
    this.onClientConnected = null;
  }

  log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level.toUpperCase()}] [WebSocket] ${message}`);
    if (data) {
      console.log(JSON.stringify(data, null, 2));
    }
  }

  init(server) {
    try {
      this.wss = new WebSocketServer({
        server,
        perMessageDeflate: false, // Disable compression to reduce memory usage
        maxPayload: 1024 * 16, // 16KB max message size
      });

      this.wss.on("connection", (ws, request) => {
        this.log(
          "info",
          `New client connected from ${request.socket.remoteAddress}. Total clients: ${
            this.clients.size + 1
          }`
        );

        // Add client to our set
        this.clients.add(ws);

        // Mark client as alive
        ws.isAlive = true;
        ws.connectionTime = Date.now();
        ws.lastActivity = Date.now();

        // Set up client event handlers
        this.setupClientHandlers(ws);

        // Send initial connection confirmation
        this.sendToClient(ws, {
          type: "connection_established",
          timestamp: Date.now(),
        });

        // Allow server to send an immediate snapshot (e.g., current timer state)
        if (typeof this.onClientConnected === "function") {
          try {
            this.onClientConnected(ws);
          } catch (error) {
            this.log("warn", "onClientConnected handler error", error.message);
          }
        }
      });

      this.wss.on("error", (error) => {
        this.log("error", "WebSocket server error", {
          message: error.message,
          code: error.code,
        });
      });

      // Start heartbeat mechanism
      this.startHeartbeat();

      this.log("info", "WebSocket server initialized successfully");
    } catch (error) {
      this.log("error", "Failed to initialize WebSocket server", error.message);
      throw error;
    }
  }

  setupClientHandlers(ws) {
    // Handle client messages (ping/pong for heartbeat)
    ws.on("message", (message) => {
      try {
        ws.lastActivity = Date.now();
        const data = JSON.parse(message.toString());

        if (data.type === "ping") {
          this.sendToClient(ws, { type: "pong", timestamp: Date.now() });
        }
      } catch (error) {
        this.log("warn", "Invalid message received from client", error.message);
      }
    });

    // Handle client disconnection
    ws.on("close", (code, reason) => {
      this.removeClient(ws);
      this.log(
        "info",
        `Client disconnected (code: ${code}, reason: ${reason.toString()}). Remaining clients: ${
          this.clients.size
        }`
      );
    });

    // Handle client errors
    ws.on("error", (error) => {
      this.log("warn", "Client connection error", {
        message: error.message,
        code: error.code,
      });
      this.removeClient(ws);
    });

    // Handle pong responses for heartbeat
    ws.on("pong", () => {
      ws.isAlive = true;
      ws.lastActivity = Date.now();
    });
  }

  removeClient(ws) {
    if (this.clients.has(ws)) {
      this.clients.delete(ws);
      try {
        if (ws.readyState === ws.OPEN) {
          ws.terminate();
        }
      } catch (error) {
        this.log("warn", "Error terminating client connection", error.message);
      }
    }
  }

  sendToClient(ws, data) {
    try {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(data));
        return true;
      }
    } catch (error) {
      this.log("warn", "Failed to send message to client", error.message);
      this.removeClient(ws);
    }
    return false;
  }

  startHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(() => {
      this.performHeartbeat();
    }, this.heartbeatIntervalMs);
  }

  performHeartbeat() {
    const now = Date.now();
    let deadClients = 0;
    let activeClients = 0;

    // Check each client
    for (const ws of this.clients) {
      const timeSinceLastActivity = now - (ws.lastActivity || ws.connectionTime);

      // If client hasn't responded to ping or been active for too long, remove it
      if (ws.isAlive === false || timeSinceLastActivity > 60000) {
        // 60 seconds timeout
        this.log(
          "warn",
          `Removing dead client (inactive for ${Math.floor(timeSinceLastActivity / 1000)}s)`
        );
        this.removeClient(ws);
        deadClients++;
        continue;
      }

      // Send ping to check if client is still alive
      if (ws.readyState === ws.OPEN) {
        try {
          ws.isAlive = false; // Will be set to true when pong is received
          ws.ping();
          activeClients++;
        } catch (error) {
          this.log("warn", "Failed to ping client", error.message);
          this.removeClient(ws);
          deadClients++;
        }
      } else {
        this.removeClient(ws);
        deadClients++;
      }
    }

    if (deadClients > 0 || activeClients > 0) {
      this.log(
        "debug",
        `Heartbeat: ${activeClients} active clients, ${deadClients} dead clients removed`
      );
    }
  }

  setOnClientConnected(callback) {
    this.onClientConnected = callback;
  }

  broadcast(data) {
    if (!data) {
      this.log("warn", "Attempted to broadcast null/undefined data");
      return;
    }

    let msg;
    try {
      msg = JSON.stringify(data);
    } catch (error) {
      this.log("error", "Failed to serialize broadcast data", {
        error: error.message,
        data: data,
      });
      return;
    }

    let sentCount = 0;
    let failedCount = 0;
    const deadClients = [];

    for (const client of this.clients) {
      try {
        if (client.readyState === client.OPEN) {
          client.send(msg);
          client.lastActivity = Date.now();
          sentCount++;
        } else {
          deadClients.push(client);
        }
      } catch (error) {
        this.log("warn", "Failed to send broadcast to client", error.message);
        deadClients.push(client);
        failedCount++;
      }
    }

    // Clean up dead clients
    for (const deadClient of deadClients) {
      this.removeClient(deadClient);
    }

    if (sentCount > 0 || failedCount > 0) {
      this.log(
        "debug",
        `Broadcast sent to ${sentCount} clients, ${failedCount} failed, ${deadClients.length} dead clients removed`
      );
    }

    return { sent: sentCount, failed: failedCount, removed: deadClients.length };
  }

  getClientCount() {
    return this.clients.size;
  }

  getStats() {
    const now = Date.now();
    const clientStats = [];

    for (const client of this.clients) {
      clientStats.push({
        readyState: client.readyState,
        isAlive: client.isAlive,
        connectionTime: client.connectionTime,
        lastActivity: client.lastActivity,
        connectionAge: now - (client.connectionTime || now),
        timeSinceLastActivity: now - (client.lastActivity || client.connectionTime || now),
      });
    }

    return {
      totalClients: this.clients.size,
      heartbeatInterval: this.heartbeatIntervalMs,
      clients: clientStats,
    };
  }

  shutdown() {
    this.log("info", "Shutting down WebSocket server...");

    // Stop heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Close all client connections
    for (const client of this.clients) {
      try {
        if (client.readyState === client.OPEN) {
          client.close(1001, "Server shutting down");
        }
      } catch (error) {
        this.log("warn", "Error closing client during shutdown", error.message);
      }
    }
    this.clients.clear();

    // Close WebSocket server
    if (this.wss) {
      try {
        this.wss.close(() => {
          this.log("info", "WebSocket server closed successfully");
        });
      } catch (error) {
        this.log("error", "Error closing WebSocket server", error.message);
      }
    }
  }
}

export const webSocketManager = new WebSocketManager();
