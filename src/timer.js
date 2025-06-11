import { defaultSettings } from "./types.js";

class TimerManager {
  constructor() {
    this.timerState = {
      timeRemaining: 3600 * 16, // Start with 16 hours
      isActive: false,
      settings: { ...defaultSettings },
    };
    this.timerInterval = null;
    this.timerStartTime = null;
    this.expectedTicks = 0;
    this.broadcastCallback = null;
    this.saveStateCallback = null;
    this.errorCount = 0;
    this.maxErrors = 10;
    this.lastBroadcast = null;
  }

  log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level.toUpperCase()}] [Timer] ${message}`);
    if (data) {
      console.log(JSON.stringify(data, null, 2));
    }
  }

  setBroadcastCallback(callback) {
    this.broadcastCallback = callback;
  }

  setSaveStateCallback(callback) {
    this.saveStateCallback = callback;
  }

  broadcast(data) {
    if (this.broadcastCallback) {
      try {
        this.broadcastCallback(data);
        this.lastBroadcast = Date.now();
        this.errorCount = 0; // Reset error count on successful broadcast
      } catch (error) {
        this.errorCount++;
        this.log("error", `Broadcast failed (${this.errorCount}/${this.maxErrors})`, error.message);

        if (this.errorCount >= this.maxErrors) {
          this.log("error", "Max broadcast errors reached, continuing without broadcasts");
          this.broadcastCallback = null; // Disable broadcasting to prevent further errors
        }
      }
    }
  }

  getState() {
    return {
      ...this.timerState,
      lastUpdate: Date.now(),
      errorCount: this.errorCount,
    };
  }

  getSettings() {
    this.log("debug", "Getting settings", this.timerState.settings);
    return { ...this.timerState.settings };
  }

  updateSettings(settings) {
    try {
      this.log("debug", "Updating settings", settings);
      this.log("debug", "Current settings before update", this.timerState.settings);

      // Handle existing settings
      if (typeof settings.regularSubTime === "number" && settings.regularSubTime >= 0) {
        this.timerState.settings.regularSubTime = settings.regularSubTime;
      }
      if (typeof settings.tier2SubTime === "number" && settings.tier2SubTime >= 0) {
        this.timerState.settings.tier2SubTime = settings.tier2SubTime;
      }
      if (typeof settings.tier3SubTime === "number" && settings.tier3SubTime >= 0) {
        this.timerState.settings.tier3SubTime = settings.tier3SubTime;
      }
      if (typeof settings.primeSubTime === "number" && settings.primeSubTime >= 0) {
        this.timerState.settings.primeSubTime = settings.primeSubTime;
      }
      if (typeof settings.giftSubTime === "number" && settings.giftSubTime >= 0) {
        this.timerState.settings.giftSubTime = settings.giftSubTime;
      }
      if (typeof settings.timerSize === "number" && settings.timerSize >= 0) {
        this.timerState.settings.timerSize = settings.timerSize;
        // Broadcast timer size update separately for immediate UI update
        this.broadcast({
          type: "timer_size_update",
          size: settings.timerSize,
        });
      }

      // Handle timer styling settings
      let stylingUpdated = false;

      if (typeof settings.timerColor === "string") {
        this.timerState.settings.timerColor = settings.timerColor;
        stylingUpdated = true;
      }
      if (typeof settings.timerFont === "string") {
        this.timerState.settings.timerFont = settings.timerFont;
        stylingUpdated = true;
      }
      if (typeof settings.timerShadowColor === "string") {
        this.timerState.settings.timerShadowColor = settings.timerShadowColor;
        stylingUpdated = true;
      }
      if (typeof settings.timerShadowBlur === "number" && settings.timerShadowBlur >= 0) {
        this.timerState.settings.timerShadowBlur = settings.timerShadowBlur;
        stylingUpdated = true;
      }
      if (
        typeof settings.timerShadowOpacity === "number" &&
        settings.timerShadowOpacity >= 0 &&
        settings.timerShadowOpacity <= 1
      ) {
        this.timerState.settings.timerShadowOpacity = settings.timerShadowOpacity;
        stylingUpdated = true;
      }
      if (typeof settings.timerShadowX === "number") {
        this.timerState.settings.timerShadowX = settings.timerShadowX;
        stylingUpdated = true;
      }
      if (typeof settings.timerShadowY === "number") {
        this.timerState.settings.timerShadowY = settings.timerShadowY;
        stylingUpdated = true;
      }

      // Broadcast timer style update if styling was changed
      if (stylingUpdated) {
        this.broadcast({
          type: "timer_style_update",
          style: {
            timerColor: this.timerState.settings.timerColor,
            timerFont: this.timerState.settings.timerFont,
            timerShadowColor: this.timerState.settings.timerShadowColor,
            timerShadowBlur: this.timerState.settings.timerShadowBlur,
            timerShadowOpacity: this.timerState.settings.timerShadowOpacity,
            timerShadowX: this.timerState.settings.timerShadowX,
            timerShadowY: this.timerState.settings.timerShadowY,
          },
        });
      }

      this.broadcast({
        type: "settings_updated",
        settings: this.timerState.settings,
      });

      // Save state immediately after settings update
      if (this.saveStateCallback) {
        try {
          // Handle async save callback
          const result = this.saveStateCallback();
          if (result && typeof result.catch === "function") {
            result.catch((error) => {
              this.log("warn", "Failed to save state after settings update", error.message);
            });
          }
        } catch (error) {
          this.log("warn", "Failed to save state after settings update", error.message);
        }
      }

      this.log("info", "Settings updated successfully");
      this.log("debug", "Final settings after update", this.timerState.settings);
      return { ...this.timerState.settings };
    } catch (error) {
      this.log("error", "Error updating settings", error.message);
      throw error;
    }
  }

  start() {
    try {
      if (this.timerInterval) {
        this.log("warn", "Timer already running, stopping previous timer");
        this.stop();
      }

      this.timerState.isActive = true;
      this.timerStartTime = Date.now();
      this.expectedTicks = 0;

      this.log("info", `Starting timer with ${this.timerState.timeRemaining} seconds remaining`);

      // Use a drift-correcting timer instead of setInterval
      const tick = () => {
        try {
          if (!this.timerState.isActive) {
            this.log("debug", "Timer stopped, ending tick cycle");
            return;
          }

          this.expectedTicks++;
          const expectedTime = this.timerStartTime + this.expectedTicks * 1000;
          const actualTime = Date.now();
          const drift = actualTime - expectedTime;

          if (this.timerState.timeRemaining > 0) {
            this.timerState.timeRemaining--;

            // Only broadcast every second, not every tick (in case of catch-up)
            this.broadcast({
              type: "timer_update",
              timeRemaining: this.timerState.timeRemaining,
              isActive: this.timerState.isActive,
              drift: Math.round(drift),
            });

            // Adjust next timeout to compensate for drift
            const nextTimeout = Math.max(0, 1000 - drift);
            this.timerInterval = setTimeout(tick, nextTimeout);

            // Log significant drift
            if (Math.abs(drift) > 100) {
              this.log("warn", `Timer drift detected: ${Math.round(drift)}ms`);
            }
          } else {
            this.log("info", "Timer reached zero, stopping");
            this.stop();
            this.broadcast({
              type: "timer_ended",
              timeRemaining: 0,
              isActive: false,
            });
          }
        } catch (error) {
          this.log("error", "Error in timer tick", error.message);
          // Try to recover by scheduling next tick
          if (this.timerState.isActive && this.timerState.timeRemaining > 0) {
            this.timerInterval = setTimeout(tick, 1000);
          } else {
            this.stop();
          }
        }
      };

      // Start the first tick
      this.timerInterval = setTimeout(tick, 1000);

      this.broadcast({
        type: "timer_started",
        timeRemaining: this.timerState.timeRemaining,
        isActive: this.timerState.isActive,
      });
    } catch (error) {
      this.log("error", "Error starting timer", error.message);
      this.timerState.isActive = false;
      throw error;
    }
  }

  stop() {
    try {
      if (this.timerInterval) {
        clearTimeout(this.timerInterval);
        this.timerInterval = null;
      }
      this.timerState.isActive = false;

      this.log("info", `Timer stopped with ${this.timerState.timeRemaining} seconds remaining`);

      this.broadcast({
        type: "timer_stopped",
        timeRemaining: this.timerState.timeRemaining,
        isActive: this.timerState.isActive,
      });
    } catch (error) {
      this.log("error", "Error stopping timer", error.message);
      // Force stop even if broadcast fails
      if (this.timerInterval) {
        clearTimeout(this.timerInterval);
        this.timerInterval = null;
      }
      this.timerState.isActive = false;
    }
  }

  reset(time = 3600) {
    try {
      this.stop();
      this.timerState.timeRemaining = Math.max(0, Math.floor(time));

      this.log("info", `Timer reset to ${this.timerState.timeRemaining} seconds`);

      this.broadcast({
        type: "timer_reset",
        timeRemaining: this.timerState.timeRemaining,
        isActive: false,
      });
    } catch (error) {
      this.log("error", "Error resetting timer", error.message);
      throw error;
    }
  }

  addTime(seconds, subscriberDetails = null) {
    try {
      if (typeof seconds !== "number" || seconds <= 0) {
        this.log("warn", `Invalid time addition: ${seconds}`);
        return;
      }

      const previousTime = this.timerState.timeRemaining;
      this.timerState.timeRemaining += Math.floor(seconds);

      this.log(
        "info",
        `Added ${seconds} seconds to timer (${previousTime} -> ${this.timerState.timeRemaining})`
      );

      // Only include timer-related information in time_added broadcast
      const broadcastData = {
        type: "time_added",
        timeRemaining: this.timerState.timeRemaining,
        isActive: this.timerState.isActive,
        addedTime: seconds,
        previousTime: previousTime,
      };

      this.broadcast(broadcastData);
    } catch (error) {
      this.log("error", "Error adding time to timer", error.message);
      throw error;
    }
  }

  // Health check method
  isHealthy() {
    const now = Date.now();
    const issues = [];

    if (this.timerState.isActive && !this.timerInterval) {
      issues.push("Timer is marked active but no interval is running");
    }

    if (!this.timerState.isActive && this.timerInterval) {
      issues.push("Timer is marked inactive but interval is still running");
    }

    if (this.errorCount >= this.maxErrors) {
      issues.push("Max error count reached");
    }

    if (this.lastBroadcast && now - this.lastBroadcast > 60000) {
      issues.push("No successful broadcast in last 60 seconds");
    }

    return {
      healthy: issues.length === 0,
      issues,
      state: {
        isActive: this.timerState.isActive,
        hasInterval: !!this.timerInterval,
        timeRemaining: this.timerState.timeRemaining,
        errorCount: this.errorCount,
        lastBroadcast: this.lastBroadcast,
      },
    };
  }

  // Recovery method
  recover() {
    this.log("info", "Attempting timer recovery...");

    try {
      // Clean up any existing interval
      if (this.timerInterval) {
        clearTimeout(this.timerInterval);
        this.timerInterval = null;
      }

      // Reset error count
      this.errorCount = 0;

      // If timer was supposed to be active, restart it
      if (this.timerState.isActive && this.timerState.timeRemaining > 0) {
        this.timerState.isActive = false; // Reset flag
        this.start(); // Restart timer
        this.log("info", "Timer recovery successful - restarted active timer");
      } else {
        this.log("info", "Timer recovery successful - timer was inactive");
      }

      return true;
    } catch (error) {
      this.log("error", "Timer recovery failed", error.message);
      return false;
    }
  }

  // Cleanup method for proper shutdown
  cleanup() {
    this.log("info", "Cleaning up timer...");

    try {
      this.stop();
      this.broadcastCallback = null;
      this.errorCount = 0;
      this.lastBroadcast = null;
      this.log("info", "Timer cleanup completed");
    } catch (error) {
      this.log("error", "Error during timer cleanup", error.message);
    }
  }

  getStats() {
    return {
      ...this.getState(),
      hasInterval: !!this.timerInterval,
      startTime: this.timerStartTime,
      expectedTicks: this.expectedTicks,
      errorCount: this.errorCount,
      lastBroadcast: this.lastBroadcast,
      health: this.isHealthy(),
    };
  }
}

export const timerManager = new TimerManager();
