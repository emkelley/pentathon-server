let ws;
let timerData = { timeRemaining: 3600, isActive: false };

// Initialize WebSocket connection
function initWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${window.location.host}`);

  ws.onopen = () => {
    console.log("WebSocket connected");
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    handleWebSocketMessage(data);
  };

  ws.onclose = () => {
    console.log("WebSocket disconnected");
    setTimeout(initWebSocket, 3000); // Reconnect after 3 seconds
  };
}

// Handle WebSocket messages
function handleWebSocketMessage(data) {
  switch (data.type) {
    case "timer_update":
    case "timer_started":
    case "timer_stopped":
    case "timer_reset":
      timerData = { timeRemaining: data.timeRemaining, isActive: data.isActive };
      updateTimerDisplay();
      break;

    case "time_added":
      timerData = { timeRemaining: data.timeRemaining, isActive: data.isActive };
      updateTimerDisplay();
      flashTimer();
      break;

    case "subscription":
      timerData.timeRemaining = data.timeRemaining || timerData.timeRemaining;
      updateTimerDisplay();
      showRecentSub(data);
      flashTimer();
      break;

    case "timer_ended":
      timerData = { timeRemaining: 0, isActive: false };
      updateTimerDisplay();
      showTimerEnded();
      break;

    case "timer_size_update":
      updateTimerSize(data.size);
      break;

    case "timer_style_update":
      loadTimerStyle(data.style);
      break;
  }
}

// Format time display
function formatTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs
    .toString()
    .padStart(2, "0")}`;
}

// Update timer display
function updateTimerDisplay() {
  const timerEl = document.getElementById("timerDisplay");
  const statusEl = document.getElementById("timerStatus");

  timerEl.textContent = formatTime(timerData.timeRemaining);

  if (timerData.timeRemaining === 0) {
    statusEl.textContent = "🚨 STREAM ENDED! 🚨";
    statusEl.className = "status ended";
    timerEl.className = "timer-display ended";
  } else if (timerData.isActive) {
    statusEl.textContent = "🔴 LIVE - Timer Running";
    statusEl.className = "status pulse";
    timerEl.className = "timer-display";
  } else {
    statusEl.textContent = "⏸️ Timer Paused";
    statusEl.className = "status";
    timerEl.className = "timer-display";
  }

  // Apply current styling
  applyTimerStyle();
}

// Flash timer when time is added
function flashTimer() {
  const container = document.querySelector(".timer-container");
  container.classList.add("flash");
  setTimeout(() => {
    container.classList.remove("flash");
  }, 500);
}

// Show recent subscription
function showRecentSub(data) {
  const recentSubEl = document.getElementById("recentSub");

  let subType;
  if (data.subPlan === "Prime") {
    subType = "Prime Sub";
  } else if (data.msgId === "subgift") {
    subType = data.subCount > 1 ? `${data.subCount} Gift Subs` : "Gift Sub";
  } else if (data.msgId === "resub") {
    subType = data.months ? `Resub (${data.months} months)` : "Resub";
  } else {
    subType = "Sub";
  }

  recentSubEl.innerHTML = `
            🎉 ${data.username}<br>
            <small>${subType} (+${formatSeconds(data.timeAdded)})</small>
        `;

  recentSubEl.classList.add("show");

  setTimeout(() => {
    recentSubEl.classList.remove("show");
  }, 4000);
}

// Format seconds to readable time
function formatSeconds(seconds) {
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }
  return `${seconds}s`;
}

// Show timer ended animation
function showTimerEnded() {
  document.body.style.background = "linear-gradient(135deg, #ff6b6b 0%, #ee5a52 100%)";
}

// Timer styling variables
let currentTimerStyle = {
  color: "#60e9b9",
  fontFamily: "'Courier New', monospace",
  shadowColor: "#000000",
  shadowBlur: 4,
  shadowOpacity: 0.3,
  shadowX: 2,
  shadowY: 2,
};

// Update timer size
function updateTimerSize(size) {
  const timerEl = document.getElementById("timerDisplay");
  if (size === 0) {
    // Reset to responsive sizing
    timerEl.style.fontSize = "";
  } else {
    timerEl.style.fontSize = `${size}px`;
  }
}

// Apply timer styling using CSS custom properties
function applyTimerStyle(style = currentTimerStyle) {
  const timerDisplay = document.getElementById("timerDisplay");
  const shadowRgba = hexToRgba(style.shadowColor, style.shadowOpacity);
  const textShadow = `${style.shadowX}px ${style.shadowY}px ${style.shadowBlur}px ${shadowRgba}`;

  // Use CSS custom properties to override the CSS values
  timerDisplay.style.setProperty("--timer-color", style.color);
  timerDisplay.style.setProperty("--timer-font-family", style.fontFamily);
  timerDisplay.style.setProperty("--timer-shadow", textShadow);
}

// Convert hex color to rgba
function hexToRgba(hex, opacity) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

// Load timer style from settings
function loadTimerStyle(settings) {
  if (settings.timerColor) {
    currentTimerStyle.color = settings.timerColor;
  }
  if (settings.timerFont) {
    currentTimerStyle.fontFamily = settings.timerFont;
  }
  if (settings.timerShadowColor) {
    currentTimerStyle.shadowColor = settings.timerShadowColor;
  }
  if (settings.timerShadowBlur !== undefined) {
    currentTimerStyle.shadowBlur = settings.timerShadowBlur;
  }
  if (settings.timerShadowOpacity !== undefined) {
    currentTimerStyle.shadowOpacity = settings.timerShadowOpacity;
  }
  if (settings.timerShadowX !== undefined) {
    currentTimerStyle.shadowX = settings.timerShadowX;
  }
  if (settings.timerShadowY !== undefined) {
    currentTimerStyle.shadowY = settings.timerShadowY;
  }

  applyTimerStyle();
}

// Load initial data
async function loadInitialData() {
  try {
    const timerResponse = await fetch("/api/timer");
    timerData = await timerResponse.json();
    updateTimerDisplay();

    // Load settings including styling
    const settingsResponse = await fetch("/api/settings");
    const settings = await settingsResponse.json();

    // Load timer size setting
    if (settings.timerSize) {
      updateTimerSize(settings.timerSize);
    }

    // Load timer styling
    loadTimerStyle(settings);
  } catch (error) {
    console.error("Failed to load initial data:", error);
  }
}

// Initialize everything
window.addEventListener("load", () => {
  initWebSocket();
  loadInitialData();
});
