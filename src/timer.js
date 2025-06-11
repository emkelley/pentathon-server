import { defaultSettings } from "./types.js";

class TimerManager {
  constructor() {
    this.timerState = {
      timeRemaining: 3600 * 16, // Start with 16 hours
      isActive: false,
      settings: { ...defaultSettings },
    };
    this.timerInterval = null;
    this.startTime = null; // When the timer was started
    this.baseTimeRemaining = null; // Time remaining when timer was started
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

  // Calculate current time remaining based on elapsed time
  getCurrentTimeRemaining() {
    if (!this.timerState.isActive || !this.startTime || !this.baseTimeRemaining) {
      return this.timerState.timeRemaining;
    }

    const elapsedSeconds = Math.floor((Date.now() - this.startTime) / 1000);
    const currentTimeRemaining = Math.max(0, this.baseTimeRemaining - elapsedSeconds);

    return currentTimeRemaining;
  }

  // Update the stored time remaining based on actual elapsed time
  updateTimeRemaining() {
    if (this.timerState.isActive) {
      this.timerState.timeRemaining = this.getCurrentTimeRemaining();
    }
  }

  getState() {
    this.updateTimeRemaining();
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
      // Always stop any existing timer first
      this.stop();

      this.timerState.isActive = true;
      this.startTime = Date.now();
      this.baseTimeRemaining = this.timerState.timeRemaining;

      this.log("info", `Starting timer with ${this.timerState.timeRemaining} seconds remaining`);

      // Simple interval that just broadcasts current state
      this.timerInterval = setInterval(() => {
        try {
          if (!this.timerState.isActive) {
            this.stop();
            return;
          }

          // Update time remaining based on actual elapsed time
          const currentTime = this.getCurrentTimeRemaining();
          this.timerState.timeRemaining = currentTime;

          if (currentTime > 0) {
            this.broadcast({
              type: "timer_update",
              timeRemaining: currentTime,
              isActive: this.timerState.isActive,
            });
          } else {
            // Timer finished
            this.timerState.timeRemaining = 0;
            this.log("info", "Timer reached zero, stopping");
            this.stop();
            this.broadcast({
              type: "timer_ended",
              timeRemaining: 0,
              isActive: false,
            });
          }
        } catch (error) {
          this.log("error", "Error in timer update", error.message);
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

      // Update time remaining before stopping
      this.updateTimeRemaining();
      this.timerState.isActive = false;
      this.startTime = null;
      this.baseTimeRemaining = null;

      this.log("info", `Timer stopped with ${this.timerState.timeRemaining} seconds remaining`);

      this.broadcast({
        type: "timer_stopped",
        timeRemaining: this.timerState.timeRemaining,
        isActive: this.timerState.isActive,
      });
    } catch (error) {
      this.log("error", "Error stopping timer", error.message);
      // Force cleanup
      if (this.timerInterval) {
        clearInterval(this.timerInterval);
        this.timerInterval = null;
      }
      this.timerState.isActive = false;
      this.startTime = null;
      this.baseTimeRemaining = null;
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

      // If timer is active, update current time first, then add
      if (this.timerState.isActive) {
        this.updateTimeRemaining();
        // Update the base time so the added time is preserved
        this.baseTimeRemaining = this.timerState.timeRemaining + Math.floor(seconds);
      }

      this.timerState.timeRemaining += Math.floor(seconds);

      this.log(
        "info",
        `Added ${seconds} seconds to timer (${previousTime} -> ${this.timerState.timeRemaining})`
      );

      this.broadcast({
        type: "time_added",
        timeRemaining: this.timerState.timeRemaining,
        isActive: this.timerState.isActive,
        addedTime: seconds,
        previousTime: previousTime,
      });
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
        timeRemaining: this.getCurrentTimeRemaining(),
        errorCount: this.errorCount,
        lastBroadcast: this.lastBroadcast,
      },
    };
  }

  recover() {
    const now = Date.now();
    if (this.lastRecoveryAttempt && now - this.lastRecoveryAttempt < 30000) {
      this.log(
        "warn",
        `Recovery attempt ignored - cooldown active (${Math.round(
          (30000 - (now - this.lastRecoveryAttempt)) / 1000
        )}s remaining)`
      );
      return false;
    }

    this.lastRecoveryAttempt = now;
    this.log("info", "Attempting timer recovery...");

    try {
      // Clean up any existing interval
      if (this.timerInterval) {
        clearInterval(this.timerInterval);
        this.timerInterval = null;
      }

      this.errorCount = 0;

      // If timer was supposed to be active, restart it
      if (this.timerState.isActive && this.timerState.timeRemaining > 0) {
        const wasActive = this.timerState.isActive;
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
    this.updateTimeRemaining();
    return {
      ...this.getState(),
      hasInterval: !!this.timerInterval,
      startTime: this.startTime,
      baseTimeRemaining: this.baseTimeRemaining,
      errorCount: this.errorCount,
      lastBroadcast: this.lastBroadcast,
      health: this.isHealthy(),
    };
  }
}

export const timerManager = new TimerManager();
