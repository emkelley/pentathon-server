import { defaultSettings } from "./types.js";

class TimerManager {
  constructor() {
    this.timerState = {
      timeRemaining: 3600 * 16, // Start with 16 hours
      isActive: false,
      settings: { ...defaultSettings },
    };
    this.timerInterval = null;
    this.broadcastCallback = null;
    this.saveStateCallback = null;
    this.errorCount = 0;
    this.maxErrors = 10;
    this.lastBroadcast = null;
    this.lastRecoveryAttempt = null;
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
        this.errorCount = 0;
      } catch (error) {
        this.errorCount++;
        this.log("error", `Broadcast failed (${this.errorCount}/${this.maxErrors})`, error.message);
        if (this.errorCount >= this.maxErrors) {
          this.log("error", "Max broadcast errors reached, continuing without broadcasts");
          this.broadcastCallback = null;
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
    return { ...this.timerState.settings };
  }

  updateSettings(settings) {
    try {
      this.log("info", "Updating settings", settings);

      // Handle existing settings
      if (
        typeof settings.regularSubTime === "number" &&
        Number.isFinite(settings.regularSubTime) &&
        settings.regularSubTime >= 0
      ) {
        this.log(
          "info",
          `Updating regularSubTime: ${this.timerState.settings.regularSubTime} -> ${settings.regularSubTime}`
        );
        this.timerState.settings.regularSubTime = settings.regularSubTime;
      }
      if (
        typeof settings.tier2SubTime === "number" &&
        Number.isFinite(settings.tier2SubTime) &&
        settings.tier2SubTime >= 0
      ) {
        this.log(
          "info",
          `Updating tier2SubTime: ${this.timerState.settings.tier2SubTime} -> ${settings.tier2SubTime}`
        );
        this.timerState.settings.tier2SubTime = settings.tier2SubTime;
      }
      if (
        typeof settings.tier3SubTime === "number" &&
        Number.isFinite(settings.tier3SubTime) &&
        settings.tier3SubTime >= 0
      ) {
        this.log(
          "info",
          `Updating tier3SubTime: ${this.timerState.settings.tier3SubTime} -> ${settings.tier3SubTime}`
        );
        this.timerState.settings.tier3SubTime = settings.tier3SubTime;
      }
      if (
        typeof settings.primeSubTime === "number" &&
        Number.isFinite(settings.primeSubTime) &&
        settings.primeSubTime >= 0
      ) {
        this.log(
          "info",
          `Updating primeSubTime: ${this.timerState.settings.primeSubTime} -> ${settings.primeSubTime}`
        );
        this.timerState.settings.primeSubTime = settings.primeSubTime;
      }
      if (
        typeof settings.giftSubTime === "number" &&
        Number.isFinite(settings.giftSubTime) &&
        settings.giftSubTime >= 0
      ) {
        this.log(
          "info",
          `Updating giftSubTime: ${this.timerState.settings.giftSubTime} -> ${settings.giftSubTime}`
        );
        this.timerState.settings.giftSubTime = settings.giftSubTime;
      }
      if (
        typeof settings.timerSize === "number" &&
        Number.isFinite(settings.timerSize) &&
        settings.timerSize >= 0
      ) {
        this.timerState.settings.timerSize = settings.timerSize;
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
      if (
        typeof settings.timerShadowBlur === "number" &&
        Number.isFinite(settings.timerShadowBlur) &&
        settings.timerShadowBlur >= 0
      ) {
        this.timerState.settings.timerShadowBlur = settings.timerShadowBlur;
        stylingUpdated = true;
      }
      if (
        typeof settings.timerShadowOpacity === "number" &&
        Number.isFinite(settings.timerShadowOpacity) &&
        settings.timerShadowOpacity >= 0 &&
        settings.timerShadowOpacity <= 1
      ) {
        this.timerState.settings.timerShadowOpacity = settings.timerShadowOpacity;
        stylingUpdated = true;
      }
      if (typeof settings.timerShadowX === "number" && Number.isFinite(settings.timerShadowX)) {
        this.timerState.settings.timerShadowX = settings.timerShadowX;
        stylingUpdated = true;
      }
      if (typeof settings.timerShadowY === "number" && Number.isFinite(settings.timerShadowY)) {
        this.timerState.settings.timerShadowY = settings.timerShadowY;
        stylingUpdated = true;
      }

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

      if (this.saveStateCallback) {
        try {
          this.log("info", "Settings updated - triggering state save");
          const result = this.saveStateCallback();
          if (result && typeof result.catch === "function") {
            result.catch((error) => {
              this.log("warn", "Failed to save state after settings update", error.message);
            });
          }
        } catch (error) {
          this.log("warn", "Failed to save state after settings update", error.message);
        }
      } else {
        this.log("warn", "No saveStateCallback set - settings won't be persisted");
      }

      this.log("info", "Final settings after update", this.timerState.settings);
      return { ...this.timerState.settings };
    } catch (error) {
      this.log("error", "Error updating settings", error.message);
      throw error;
    }
  }

  start() {
    try {
      this.stop(); // Always stop any existing timer first

      this.timerState.isActive = true;
      this.log("info", `Starting timer with ${this.timerState.timeRemaining} seconds remaining`);

      // Simple countdown - decrement every second
      this.timerInterval = setInterval(() => {
        if (!this.timerState.isActive) {
          this.stop();
          return;
        }

        if (this.timerState.timeRemaining > 0) {
          this.timerState.timeRemaining--;
          this.broadcast({
            type: "timer_update",
            timeRemaining: this.timerState.timeRemaining,
            isActive: this.timerState.isActive,
          });
        } else {
          this.log("info", "Timer reached zero, stopping");
          this.stop();
          this.broadcast({
            type: "timer_ended",
            timeRemaining: 0,
            isActive: false,
          });
        }
      }, 1000);

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
        clearInterval(this.timerInterval);
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
      if (this.timerInterval) {
        clearInterval(this.timerInterval);
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

      const broadcastData = {
        type: "time_added",
        timeRemaining: this.timerState.timeRemaining,
        isActive: this.timerState.isActive,
        addedTime: seconds,
        previousTime: previousTime,
      };

      // Include subscriber details if provided
      if (subscriberDetails) {
        broadcastData.subscriber = subscriberDetails;
      }

      this.broadcast(broadcastData);
    } catch (error) {
      this.log("error", "Error adding time to timer", error.message);
      throw error;
    }
  }

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

  recover() {
    const now = Date.now();
    if (this.lastRecoveryAttempt && now - this.lastRecoveryAttempt < 30000) {
      this.log("warn", `Recovery attempt ignored - cooldown active`);
      return false;
    }

    this.lastRecoveryAttempt = now;
    this.log("info", "Attempting timer recovery...");

    try {
      if (this.timerInterval) {
        clearInterval(this.timerInterval);
        this.timerInterval = null;
      }
      this.errorCount = 0;

      if (this.timerState.isActive && this.timerState.timeRemaining > 0) {
        this.timerState.isActive = false;
        this.start();
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

  cleanup() {
    this.log("info", "Cleaning up timer...");
    try {
      this.stop();
      this.broadcastCallback = null;
      this.errorCount = 0;
      this.lastBroadcast = null;
      this.lastRecoveryAttempt = null;
      this.log("info", "Timer cleanup completed");
    } catch (error) {
      this.log("error", "Error during timer cleanup", error.message);
    }
  }

  getStats() {
    return {
      ...this.getState(),
      hasInterval: !!this.timerInterval,
      errorCount: this.errorCount,
      lastBroadcast: this.lastBroadcast,
      health: this.isHealthy(),
    };
  }
}

export const timerManager = new TimerManager();
