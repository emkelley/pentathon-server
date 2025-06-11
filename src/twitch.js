import tmi from "tmi.js";
import axios from "axios";
import dotenv from "dotenv";
import { timerManager } from "./timer.js";

dotenv.config();

class TwitchManager {
  constructor() {
    this.client = null;
    this.broadcastCallback = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 20;
    this.reconnectDelay = 5000; // Start with 5 seconds
    this.maxReconnectDelay = 300000; // Max 5 minutes
    this.connectionHealthCheck = null;
    this.lastEventTime = Date.now();
    this.eventCount = 0;
  }

  setBroadcastCallback(callback) {
    this.broadcastCallback = callback;
  }

  broadcast(data) {
    if (this.broadcastCallback) {
      try {
        this.broadcastCallback(data);
      } catch (error) {
        console.error("[Twitch] Broadcast error:", error.message);
      }
    }
  }

  log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level.toUpperCase()}] [Twitch] ${message}`);
    if (data) {
      console.log(JSON.stringify(data, null, 2));
    }
  }

  isConnected() {
    return this.isConnected && this.client && this.client.readyState() === "OPEN";
  }

  async refreshToken() {
    this.log("info", "Attempting to refresh access token...");
    try {
      const response = await axios.post("https://id.twitch.tv/oauth2/token", null, {
        params: {
          grant_type: "refresh_token",
          refresh_token: process.env.TWITCH_REFRESH_TOK,
          client_id: process.env.TWITCH_CLIENT_ID,
        },
        timeout: 10000, // 10 second timeout
      });

      // Update environment variables with new tokens
      process.env.TWITCH_ACCESS_TOK = response.data.access_token;
      process.env.TWITCH_REFRESH_TOK = response.data.refresh_token;

      this.log("info", "Successfully refreshed access token");
      return response.data.access_token;
    } catch (error) {
      this.log("error", "Failed to refresh token", {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
      });
      throw error;
    }
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.log(
        "error",
        `Max reconnection attempts (${this.maxReconnectAttempts}) reached. Stopping reconnection attempts.`
      );
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.maxReconnectDelay
    );

    this.log(
      "info",
      `Scheduling reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`
    );

    setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        this.log("error", "Reconnection attempt failed", error.message);
        this.scheduleReconnect();
      }
    }, delay);
  }

  resetReconnectState() {
    this.reconnectAttempts = 0;
    this.reconnectDelay = 5000;
  }

  startConnectionHealthCheck() {
    // Clear existing health check
    if (this.connectionHealthCheck) {
      clearInterval(this.connectionHealthCheck);
    }

    // Check connection health every 60 seconds
    this.connectionHealthCheck = setInterval(() => {
      const timeSinceLastEvent = Date.now() - this.lastEventTime;
      const isStale = timeSinceLastEvent > 5 * 60 * 1000; // 5 minutes without events

      if (this.isConnected && this.client) {
        const readyState = this.client.readyState();

        // Only log health check if there's an issue
        if (readyState !== "OPEN") {
          this.log("warn", "Connection health check failed - not connected");
          this.handleConnectionLoss("Health check failed");
        }
        // Don't log successful health checks - too verbose
      } else {
        this.log("warn", "Connection health check failed - client not available");
        this.handleConnectionLoss("Client not available");
      }
    }, 60000);
  }

  handleConnectionLoss(reason) {
    this.log("warn", `Connection lost: ${reason}`);
    this.isConnected = false;

    if (this.client) {
      try {
        this.client.disconnect();
      } catch (error) {
        this.log("error", "Error during disconnect", error.message);
      }
    }

    this.scheduleReconnect();
  }

  setupEventHandlers() {
    if (!this.client) return;

    // Connection event handlers
    this.client.on("connected", (addr, port) => {
      this.log("info", `Connection successful to ${addr}:${port} - ready to receive events`);
      this.isConnected = true;
      this.resetReconnectState();
      this.lastEventTime = Date.now();
      this.startConnectionHealthCheck();
    });

    this.client.on("connecting", (addr, port) => {
      this.log("info", `Connecting to ${addr}:${port}...`);
    });

    this.client.on("reconnect", () => {
      this.log("info", "Reconnecting...");
    });

    this.client.on("join", (channel, username, self) => {
      this.lastEventTime = Date.now();
      if (self) {
        this.log("info", `Bot successfully joined channel: ${channel}`);
      }
      // Don't log other users joining - too verbose
    });

    this.client.on("part", (channel, username, self) => {
      this.lastEventTime = Date.now();
      if (self) {
        this.log("info", `Bot left channel: ${channel}`);
      }
      // Don't log other users leaving - too verbose
    });

    this.client.on("notice", (channel, msgid, message) => {
      this.lastEventTime = Date.now();

      // Only log important notices, not routine ones
      if (msgid.includes("login_authentication_failed") || msgid.includes("bad_auth")) {
        this.log("warn", `Authentication notice in ${channel}: ${msgid} - ${message}`);
        this.log("warn", "Authentication failed, attempting token refresh...");
        this.handleAuthenticationFailure();
      } else if (msgid.includes("error") || msgid.includes("ban") || msgid.includes("timeout")) {
        this.log("warn", `Important notice in ${channel}: ${msgid} - ${message}`);
      }
      // Don't log routine notices like slow mode, followers only, etc.
    });

    // Handle authentication errors and token refresh
    this.client.on("disconnected", async (reason) => {
      this.log("warn", `Disconnected from Twitch. Reason: ${reason}`);
      this.isConnected = false;

      if (reason && reason.includes("authentication failed")) {
        this.log("info", "Authentication failed, attempting token refresh...");
        await this.handleAuthenticationFailure();
      } else {
        // For other disconnection reasons, schedule a reconnect
        this.scheduleReconnect();
      }
    });

    // Chat message handler (currently disabled)
    this.client.on("message", (channel, userstate, message, self) => {
      if (self) return;
      this.lastEventTime = Date.now();
      // Chat messages are currently disabled but can be re-enabled here
    });

    // Debug: Log ALL events to see what we're receiving
    this.client.on("raw_message", (messageCloned, message) => {
      this.lastEventTime = Date.now();
      // Only log events that might be subscription related
      // if (message && (message.command === "USERNOTICE" || message.command === "PRIVMSG")) {
      //   this.log('debug', `RAW ${message.command}`, JSON.stringify(message.tags, null, 2));
      // }
    });

    // Subscription event handlers
    this.setupSubscriptionHandlers();
  }

  async handleAuthenticationFailure() {
    try {
      const newToken = await this.refreshToken();
      if (this.client) {
        this.client.opts.identity.password = `oauth:${newToken}`;
        this.log("info", "Reconnecting with new token...");
        await this.client.connect();
      }
    } catch (error) {
      this.log("error", "Failed to reconnect after token refresh", error.message);
      this.scheduleReconnect();
    }
  }

  setupSubscriptionHandlers() {
    if (!this.client) return;

    // Listen for usernotice events (subs, resubs, gifts, etc)
    this.client.on("usernotice", (channel, userstate, message) => {
      this.lastEventTime = Date.now();
      this.eventCount++;

      try {
        const msgId = userstate["msg-id"];
        const username = userstate["display-name"] || userstate.username;
        const subPlan = userstate["msg-param-sub-plan"];

        // Only log if it's a subscription-related event
        if (msgId === "sub" || msgId === "resub" || msgId === "subgift") {
          this.log("info", `Received ${msgId}: ${username} (plan: ${subPlan})`);
        }

        const timerSettings = timerManager.getSettings();

        if (msgId === "sub" || msgId === "resub") {
          // Regular subscription or resub - determine time based on tier
          let timeToAdd;
          let tierName;

          switch (subPlan) {
            case "1000":
              timeToAdd = timerSettings.regularSubTime;
              tierName = "Tier 1";
              break;
            case "2000":
              timeToAdd = timerSettings.tier2SubTime;
              tierName = "Tier 2";
              break;
            case "3000":
              timeToAdd = timerSettings.tier3SubTime;
              tierName = "Tier 3";
              break;
            case "Prime":
              timeToAdd = timerSettings.primeSubTime;
              tierName = "Prime";
              break;
            default:
              // Fallback for unknown plans
              timeToAdd = timerSettings.regularSubTime;
              tierName = "Unknown";
              this.log("warn", `Unknown sub plan: ${subPlan}, using regular sub time`);
          }

          const subscriberDetails = {
            username,
            subCount: 1,
            subType: msgId === "resub" ? "resub" : "subscription",
            tierName,
            msgId,
          };

          timerManager.addTime(timeToAdd, subscriberDetails);

          this.broadcast({
            type: "subscription",
            username,
            msgId,
            subPlan,
            tierName,
            timeAdded: timeToAdd,
            subCount: 1,
            subType: msgId === "resub" ? "resub" : "subscription",
          });
          this.log("info", `${username} ${msgId} (${tierName}) - Added ${timeToAdd} seconds`);
        } else if (msgId === "subgift") {
          // Gift subscription - determine time based on tier
          const giftCount = parseInt(userstate["msg-param-gift-months"] || "1");
          let baseTime;
          let tierName;

          switch (subPlan) {
            case "1000":
              baseTime = timerSettings.regularSubTime;
              tierName = "Tier 1";
              break;
            case "2000":
              baseTime = timerSettings.tier2SubTime;
              tierName = "Tier 2";
              break;
            case "3000":
              baseTime = timerSettings.tier3SubTime;
              tierName = "Tier 3";
              break;
            default:
              // Fallback for unknown plans or use giftSubTime if specifically configured
              baseTime = timerSettings.giftSubTime;
              tierName = "Gift";
              this.log("warn", `Unknown gift sub plan: ${subPlan}, using gift sub time`);
          }

          const timeToAdd = baseTime * giftCount;

          const subscriberDetails = {
            username,
            subCount: giftCount,
            subType: "gift",
            tierName,
            msgId,
          };

          timerManager.addTime(timeToAdd, subscriberDetails);

          const recipient =
            userstate["msg-param-recipient-display-name"] ||
            userstate["msg-param-recipient-user-name"];

          this.broadcast({
            type: "subscription",
            username,
            msgId,
            subPlan,
            tierName,
            timeAdded: timeToAdd,
            subCount: giftCount,
            subType: "gift",
            recipient: recipient,
          });
          this.log(
            "info",
            `${username} gifted ${giftCount} ${tierName} sub(s) - Added ${timeToAdd} seconds`
          );
        } else {
          this.log("info", `Unhandled usernotice type: ${msgId}`);
        }
      } catch (error) {
        this.log("error", "Error handling usernotice event", {
          message: error.message,
          stack: error.stack,
          userstate,
        });
      }
    });

    // Alternative event handlers as backup
    this.client.on("subscription", (channel, username, method, message, userstate) => {
      this.lastEventTime = Date.now();
      this.eventCount++;

      try {
        const subPlan = method.plan || userstate["msg-param-sub-plan"];
        const timerSettings = timerManager.getSettings();

        let timeToAdd;
        let tierName;

        switch (subPlan) {
          case "1000":
            timeToAdd = timerSettings.regularSubTime;
            tierName = "Tier 1";
            break;
          case "2000":
            timeToAdd = timerSettings.tier2SubTime;
            tierName = "Tier 2";
            break;
          case "3000":
            timeToAdd = timerSettings.tier3SubTime;
            tierName = "Tier 3";
            break;
          case "Prime":
            timeToAdd = timerSettings.primeSubTime;
            tierName = "Prime";
            break;
          default:
            timeToAdd = timerSettings.regularSubTime;
            tierName = "Unknown";
        }

        const subscriberDetails = {
          username,
          subCount: 1,
          subType: "subscription",
          tierName,
          msgId: "sub",
        };

        timerManager.addTime(timeToAdd, subscriberDetails);
        this.broadcast({
          type: "subscription",
          username,
          msgId: "sub",
          subPlan,
          tierName,
          timeAdded: timeToAdd,
          subCount: 1,
          subType: "subscription",
        });
        this.log(
          "info",
          `Subscription via subscription event: ${username} (${tierName}) - Added ${timeToAdd} seconds`
        );
      } catch (error) {
        this.log("error", "Error handling subscription event", error.message);
      }
    });

    this.client.on("resub", (channel, username, months, message, userstate, methods) => {
      this.lastEventTime = Date.now();
      this.eventCount++;

      try {
        this.log("info", `RESUB EVENT: ${username} resubscribed for ${months} months`);

        const subPlan = methods.plan || userstate["msg-param-sub-plan"];
        const timerSettings = timerManager.getSettings();

        let timeToAdd;
        let tierName;

        switch (subPlan) {
          case "1000":
            timeToAdd = timerSettings.regularSubTime;
            tierName = "Tier 1";
            break;
          case "2000":
            timeToAdd = timerSettings.tier2SubTime;
            tierName = "Tier 2";
            break;
          case "3000":
            timeToAdd = timerSettings.tier3SubTime;
            tierName = "Tier 3";
            break;
          case "Prime":
            timeToAdd = timerSettings.primeSubTime;
            tierName = "Prime";
            break;
          default:
            timeToAdd = timerSettings.regularSubTime;
            tierName = "Unknown";
        }

        const subscriberDetails = {
          username,
          subCount: 1,
          subType: "resub",
          tierName,
          msgId: "resub",
        };

        timerManager.addTime(timeToAdd, subscriberDetails);
        this.broadcast({
          type: "subscription",
          username,
          msgId: "resub",
          subPlan,
          tierName,
          timeAdded: timeToAdd,
          subCount: 1,
          subType: "resub",
          months: months,
        });
        this.log(
          "info",
          `Resub via resub event: ${username} (${tierName}) - Added ${timeToAdd} seconds`
        );
      } catch (error) {
        this.log("error", "Error handling resub event", error.message);
      }
    });

    this.client.on("subgift", (channel, username, streakMonths, recipient, methods, userstate) => {
      this.lastEventTime = Date.now();
      this.eventCount++;

      try {
        this.log("info", `SUBGIFT EVENT: ${username} gifted a sub to ${recipient}`);

        const timerSettings = timerManager.getSettings();
        let timeToAdd;
        let tierName;

        switch (methods.plan) {
          case "1000":
            timeToAdd = timerSettings.regularSubTime;
            tierName = "Tier 1";
            break;
          case "2000":
            timeToAdd = timerSettings.tier2SubTime;
            tierName = "Tier 2";
            break;
          case "3000":
            timeToAdd = timerSettings.tier3SubTime;
            tierName = "Tier 3";
            break;
          default:
            timeToAdd = timerSettings.giftSubTime;
            tierName = "Gift";
        }

        const subscriberDetails = {
          username,
          subCount: 1,
          subType: "gift",
          tierName,
          msgId: "subgift",
        };

        timerManager.addTime(timeToAdd, subscriberDetails);
        this.broadcast({
          type: "subscription",
          username,
          msgId: "subgift",
          subPlan: methods.plan,
          tierName,
          timeAdded: timeToAdd,
          subCount: 1,
          subType: "gift",
          recipient: recipient,
        });
        this.log(
          "info",
          `Subgift via subgift event: ${username} gifted a ${tierName} sub to ${recipient} - Added ${timeToAdd} seconds`
        );
      } catch (error) {
        this.log("error", "Error handling subgift event", error.message);
      }
    });
  }

  async connect() {
    try {
      // Disconnect existing client if any
      if (this.client) {
        try {
          await this.client.disconnect();
        } catch (error) {
          this.log("warn", "Error disconnecting existing client", error.message);
        }
      }

      // Validate required environment variables
      if (
        !process.env.TWITCH_BOT_USERNAME ||
        !process.env.TWITCH_ACCESS_TOK ||
        !process.env.TWITCH_CHANNEL
      ) {
        throw new Error("Missing required Twitch environment variables");
      }

      this.client = new tmi.Client({
        options: {
          debug: false,
          messagesLogLevel: "info", // Only log warnings and errors, not chat messages
        },
        connection: {
          secure: true,
          reconnect: false, // We handle reconnection ourselves
          timeout: 30000, // 30 second timeout
          reconnectDecay: 1.5,
          reconnectInterval: 5000,
          maxReconnectAttempts: 5,
        },
        identity: {
          username: process.env.TWITCH_BOT_USERNAME,
          password: `oauth:${process.env.TWITCH_ACCESS_TOK}`,
        },
        channels: [process.env.TWITCH_CHANNEL],
      });

      this.setupEventHandlers();

      await this.client.connect();
    } catch (error) {
      this.log("error", "Failed to connect", {
        message: error.message,
        code: error.code,
      });
      this.isConnected = false;
      throw error;
    }
  }

  async disconnect() {
    this.log("info", "Disconnecting from Twitch...");

    if (this.connectionHealthCheck) {
      clearInterval(this.connectionHealthCheck);
      this.connectionHealthCheck = null;
    }

    this.isConnected = false;

    if (this.client) {
      try {
        await this.client.disconnect();
        this.log("info", "Successfully disconnected from Twitch");
      } catch (error) {
        this.log("error", "Error during disconnect", error.message);
      }
      this.client = null;
    }
  }

  getStats() {
    return {
      isConnected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
      eventCount: this.eventCount,
      lastEventTime: this.lastEventTime,
      timeSinceLastEvent: Date.now() - this.lastEventTime,
      clientState: this.client ? this.client.readyState() : "NO_CLIENT",
    };
  }
}

export const twitchManager = new TwitchManager();
