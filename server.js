import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
import { timerManager } from "./src/timer.js";
import { webSocketManager } from "./src/websocket.js";
import { twitchManager } from "./src/twitch.js";
import routes from "./src/routes.js";

// Load environment variables
dotenv.config();

// Enhanced logging function
const log = (level, module, message, data = null) => {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level.toUpperCase()}] [${module}] ${message}`;
  console.log(logMessage);
  if (data) {
    console.log(JSON.stringify(data, null, 2));
  }

  // TODO: In production, write to log files for debugging
  // You could uncomment this for file logging:
  // fs.appendFile('app.log', logMessage + '\n').catch(() => {});
};

// State persistence for timer recovery
const STATE_FILE = path.join(process.cwd(), "timer-state.json");

const saveTimerState = async () => {
  try {
    const state = timerManager.getState();
    log("debug", "Persistence", "Saving timer state", {
      timeRemaining: state.timeRemaining,
      settings: state.settings,
    });
    await fs.writeFile(
      STATE_FILE,
      JSON.stringify({
        ...state,
        lastSaved: Date.now(),
      })
    );
    log("debug", "Persistence", "Timer state saved successfully");
  } catch (error) {
    log("error", "Persistence", "Failed to save timer state", error.message);
  }
};

const loadTimerState = async () => {
  try {
    log("debug", "Persistence", "Loading timer state from file");
    const data = await fs.readFile(STATE_FILE, "utf8");
    const state = JSON.parse(data);
    const timeSinceLastSave = Date.now() - state.lastSaved;

    log("debug", "Persistence", "Loaded state from file", {
      timeRemaining: state.timeRemaining,
      settings: state.settings,
      timeSinceLastSave,
    });

    // If timer was active and less than 5 minutes have passed, restore it
    if (state.isActive && timeSinceLastSave < 5 * 60 * 1000) {
      const secondsElapsed = Math.floor(timeSinceLastSave / 1000);
      const adjustedTime = Math.max(0, state.timeRemaining - secondsElapsed);

      timerManager.timerState.timeRemaining = adjustedTime;
      timerManager.timerState.settings = state.settings;

      if (adjustedTime > 0) {
        timerManager.start();
        log("info", "Recovery", `Timer state restored: ${adjustedTime}s remaining`);
      }
    } else {
      // Just restore the time and settings, don't auto-start
      timerManager.timerState.timeRemaining = state.timeRemaining;
      timerManager.timerState.settings = state.settings;
      log("info", "Recovery", `Timer state restored: ${state.timeRemaining}s remaining (inactive)`);
    }

    log("debug", "Persistence", "Timer state loaded successfully");
  } catch (error) {
    log("warn", "Recovery", "Could not restore timer state, starting fresh");
  }
};

// Graceful error handling - DO NOT EXIT PROCESS
const handleError = (error, context) => {
  log("error", "System", `Error in ${context}`, {
    message: error.message,
    stack: error.stack,
    context,
  });

  // Try to recover based on error type
  if (context.includes("Twitch")) {
    log("info", "Recovery", "Attempting to reconnect Twitch...");
    setTimeout(() => {
      twitchManager.connect().catch((err) => {
        log("error", "Recovery", "Twitch reconnection failed", err.message);
      });
    }, 5000);
  }
};

// Replace fatal error handlers with recovery mechanisms
process.on("uncaughtException", (error) => {
  handleError(error, "UncaughtException");
  // DO NOT EXIT - let the app continue running
});

process.on("unhandledRejection", (reason, promise) => {
  handleError(reason instanceof Error ? reason : new Error(String(reason)), "UnhandledRejection");
  // DO NOT EXIT - let the app continue running
});

const app = express();
const PORT = process.env.PORT || 3000;

// CORS configuration
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    // Check if origin is localhost (any port)
    if (origin.match(/^https?:\/\/localhost(:\d+)?$/)) {
      return callback(null, true);
    }

    // Check if origin is 127.0.0.1 (any port)
    if (origin.match(/^https?:\/\/127\.0\.0\.1(:\d+)?$/)) {
      return callback(null, true);
    }

    // Check if origin is IPv6 localhost (any port)
    if (origin.match(/^https?:\/\/\[::1\](:\d+)?$/)) {
      return callback(null, true);
    }
    if (origin === "https://pentathon.emk.dev" || origin === "http://api.pentathon.emk.dev") {
      return callback(null, true);
    }
    // Check if origin is *.emk.dev
    if (origin.match(/^https?:\/\/.*\.emk\.dev$/)) {
      return callback(null, true);
    }

    // Allow emk.dev itself
    if (origin === "https://emk.dev" || origin === "http://emk.dev") {
      return callback(null, true);
    }

    // Reject other origins
    callback(new Error("Not allowed by CORS"));
  },
  credentials: true, // Allow cookies and credentials
  optionsSuccessStatus: 200, // For legacy browser support
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.static("public"));

// Use routes
app.use(routes);

// Health check endpoint
app.get("/health", (req, res) => {
  try {
    const timerHealth = timerManager.isHealthy();
    const twitchStats = twitchManager.getStats();
    const wsStats = webSocketManager.getStats();

    const health = {
      status: timerHealth.healthy && twitchStats.isConnected ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timer: {
        ...timerManager.getStats(),
        health: timerHealth,
      },
      websocket: wsStats,
      twitch: twitchStats,
      alerts: [],
    };

    // Add alerts for issues
    if (!timerHealth.healthy) {
      health.alerts.push({
        severity: "warning",
        component: "timer",
        message: "Timer health issues detected",
        issues: timerHealth.issues,
      });
    }

    if (!twitchStats.isConnected) {
      health.alerts.push({
        severity: "warning",
        component: "twitch",
        message: "Twitch not connected",
        attempts: twitchStats.reconnectAttempts,
      });
    }

    if (wsStats.totalClients === 0) {
      health.alerts.push({
        severity: "info",
        component: "websocket",
        message: "No WebSocket clients connected",
      });
    }

    res.json(health);
  } catch (error) {
    log("error", "Health check failed", error.message);
    res.status(500).json({
      status: "error",
      timestamp: new Date().toISOString(),
      error: error.message,
    });
  }
});

// Recovery endpoint for manual recovery
app.post("/recover", (req, res) => {
  try {
    log("info", "Manual recovery triggered");
    const results = {
      timer: timerManager.recover(),
      timestamp: new Date().toISOString(),
    };

    // Attempt Twitch reconnection if not connected
    if (!twitchManager.isConnected()) {
      connectTwitchWithRetry(0);
      results.twitch = "reconnection_initiated";
    } else {
      results.twitch = "already_connected";
    }

    res.json({
      success: true,
      message: "Recovery procedures initiated",
      results,
    });
  } catch (error) {
    log("error", "Recovery failed", error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Start server
const server = app.listen(PORT, async () => {
  log("info", "Server", `Listening on port ${PORT}`);
  log("info", "Server", `Public timer available at http://localhost:${PORT}/`);
  log("info", "Server", `Admin panel available at http://localhost:${PORT}/admin`);
  log("info", "Server", `Health check available at http://localhost:${PORT}/health`);

  // Load persisted timer state
  await loadTimerState();
});

// Initialize WebSocket server
webSocketManager.init(server);

// Set up broadcast callbacks to connect all modules
const broadcast = (data) => {
  try {
    webSocketManager.broadcast(data);
  } catch (error) {
    log("error", "WebSocket", "Broadcast failed", error.message);
  }
};

timerManager.setBroadcastCallback(broadcast);
timerManager.setSaveStateCallback(saveTimerState);
twitchManager.setBroadcastCallback(broadcast);

// Auto-save timer state every 30 seconds
setInterval(saveTimerState, 30000);

// Connect to Twitch with enhanced error handling and retry logic
const connectTwitchWithRetry = async (retryCount = 0) => {
  const maxRetries = 10;
  const baseDelay = 5000; // 5 seconds

  try {
    log("info", "Twitch", `Connection attempt ${retryCount + 1}/${maxRetries}`);
    await twitchManager.connect();
    log("info", "Twitch", "Successfully connected");
  } catch (error) {
    log("error", "Twitch", `Connection attempt ${retryCount + 1} failed`, error.message);

    if (retryCount < maxRetries - 1) {
      const delay = baseDelay * Math.pow(2, retryCount); // Exponential backoff
      log("info", "Twitch", `Retrying in ${delay}ms...`);
      setTimeout(() => connectTwitchWithRetry(retryCount + 1), delay);
    } else {
      log(
        "error",
        "Twitch",
        "Max retry attempts reached. Server will continue without Twitch integration"
      );
    }
  }
};

// Start initial connection
connectTwitchWithRetry();

// System health monitoring and automatic recovery
const performHealthCheck = () => {
  const memUsage = process.memoryUsage();
  const memUsageMB = Object.keys(memUsage).reduce((acc, key) => {
    acc[key] = Math.round(memUsage[key] / 1024 / 1024);
    return acc;
  }, {});

  log(
    "info",
    "Health",
    `Memory usage: ${JSON.stringify(memUsageMB)}MB, Uptime: ${Math.floor(process.uptime())}s`
  );

  // Check if memory usage is getting too high (>500MB)
  if (memUsage.heapUsed > 500 * 1024 * 1024) {
    log("warn", "Health", "High memory usage detected, consider restarting");
  }

  // Check timer health and attempt recovery if needed
  const timerHealth = timerManager.isHealthy();
  if (!timerHealth.healthy) {
    log("warn", "Health", "Timer health issues detected", timerHealth.issues);
    const recovered = timerManager.recover();
    if (recovered) {
      log("info", "Health", "Timer recovery successful");
    } else {
      log("error", "Health", "Timer recovery failed");
    }
  }

  // Check Twitch connection and attempt reconnection if needed
  if (!twitchManager.isConnected()) {
    const stats = twitchManager.getStats();
    if (stats.reconnectAttempts === 0) {
      log("info", "Health", "Twitch disconnected, initiating reconnection");
      connectTwitchWithRetry(0);
    }
  }

  // Log connection statistics
  const twitchStats = twitchManager.getStats();
  const wsStats = webSocketManager.getStats();
  log(
    "debug",
    "Health",
    `Twitch: ${twitchStats.isConnected ? "connected" : "disconnected"} (${
      twitchStats.eventCount
    } events), WebSocket: ${wsStats.totalClients} clients`
  );
};

// Health check every 2 minutes for more responsive monitoring
setInterval(performHealthCheck, 2 * 60 * 1000);

// Graceful shutdown handling
const gracefulShutdown = async (signal) => {
  log("info", "Shutdown", `Received ${signal}, starting graceful shutdown...`);

  try {
    // Save timer state before shutdown
    await saveTimerState();
    log("info", "Shutdown", "Timer state saved");

    // Clean up timer
    timerManager.cleanup();
    log("info", "Shutdown", "Timer cleaned up");

    // Close Twitch connection
    await twitchManager.disconnect();
    log("info", "Shutdown", "Twitch connection closed");

    // Shutdown WebSocket server
    webSocketManager.shutdown();
    log("info", "Shutdown", "WebSocket server closed");

    // Close server
    server.close(() => {
      log("info", "Shutdown", "Server closed gracefully");
      process.exit(0);
    });

    // Force exit after 30 seconds if graceful shutdown hangs
    setTimeout(() => {
      log("error", "Shutdown", "Graceful shutdown timeout, forcing exit");
      process.exit(1);
    }, 30000);
  } catch (error) {
    log("error", "Shutdown", "Error during graceful shutdown", error.message);
    process.exit(1);
  }
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
