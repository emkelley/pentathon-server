import express from "express";
import path from "path";
import { timerManager } from "./timer.js";

const router = express.Router();

// API Routes
router.get("/api/timer", (req, res) => {
  res.json(timerManager.getState());
});

router.post("/api/timer/start", (req, res) => {
  timerManager.start();
  res.json({ success: true, message: "Timer started" });
});

router.post("/api/timer/stop", (req, res) => {
  timerManager.stop();
  res.json({ success: true, message: "Timer stopped" });
});

router.post("/api/timer/reset", (req, res) => {
  const raw = req.body.time;
  const time = typeof raw === "string" ? Number(raw) : raw;
  const safeTime = Number.isFinite(time) && time >= 0 ? time : 3600;
  timerManager.reset(safeTime);
  res.json({ success: true, message: "Timer reset" });
});

router.post("/api/timer/add", (req, res) => {
  const raw = req.body.seconds;
  const seconds = typeof raw === "string" ? Number(raw) : raw;
  if (Number.isFinite(seconds) && seconds > 0) {
    timerManager.addTime(Number(seconds));
    res.json({ success: true, message: `Added ${seconds} seconds` });
  } else {
    res.status(400).json({ success: false, message: "Invalid seconds value" });
  }
});

router.get("/api/settings", (req, res) => {
  res.json(timerManager.getSettings());
});

router.get("/api/settings/sub-times", (req, res) => {
  const settings = timerManager.getSettings();
  res.json({
    regularSubTime: settings.regularSubTime,
    tier2SubTime: settings.tier2SubTime,
    tier3SubTime: settings.tier3SubTime,
    primeSubTime: settings.primeSubTime,
    giftSubTime: settings.giftSubTime,
  });
});

router.post("/api/settings", (req, res) => {
  console.log("[API] Received settings update request:", req.body);

  // Helper to coerce potentially string inputs to numbers safely
  const toNumber = (val) => {
    if (val === undefined || val === null || val === "") return undefined;
    const n = typeof val === "string" ? Number(val) : val;
    return Number.isFinite(n) ? n : undefined;
  };

  // Build payload including only defined/valid properties
  const payload = {
    // Times
    regularSubTime: toNumber(req.body.regularSubTime),
    tier2SubTime: toNumber(req.body.tier2SubTime),
    tier3SubTime: toNumber(req.body.tier3SubTime),
    primeSubTime: toNumber(req.body.primeSubTime),
    giftSubTime: toNumber(req.body.giftSubTime),
    timerSize: toNumber(req.body.timerSize),
    // Styling
    timerColor: req.body.timerColor,
    timerFont: req.body.timerFont,
    timerShadowColor: req.body.timerShadowColor,
    timerShadowBlur: toNumber(req.body.timerShadowBlur),
    timerShadowOpacity: toNumber(req.body.timerShadowOpacity),
    timerShadowX: toNumber(req.body.timerShadowX),
    timerShadowY: toNumber(req.body.timerShadowY),
  };

  // Remove undefined keys so updateSettings won't even see them
  Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

  console.log("[API] Coerced settings payload:", payload);

  const updatedSettings = timerManager.updateSettings(payload);

  console.log("[API] Settings updated successfully:", updatedSettings);

  res.json({
    success: true,
    message: "Settings updated",
    settings: updatedSettings,
  });
});

// Development endpoints for testing subscription events
// Only enable these in development/testing
router.post("/api/dev/simulate-sub", (req, res) => {
  const {
    username = "TestUser",
    tier = "1",
    type = "sub",
    count = 1,
    recipient = null,
    months = null,
  } = req.body;

  try {
    const result = simulateSubscription(username, tier, type, count, recipient, months);
    res.json(result);
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// Helper function to simulate subscription logic
const simulateSubscription = (username, tier, type, count, recipient, months) => {
  const settings = timerManager.getSettings();
  let timeToAdd, tierName, subPlan;

  // Determine time and tier info
  switch (tier) {
    case "1":
      timeToAdd = settings.regularSubTime;
      tierName = "Tier 1";
      subPlan = "1000";
      break;
    case "2":
      timeToAdd = settings.tier2SubTime;
      tierName = "Tier 2";
      subPlan = "2000";
      break;
    case "3":
      timeToAdd = settings.tier3SubTime;
      tierName = "Tier 3";
      subPlan = "3000";
      break;
    case "prime":
      timeToAdd = settings.primeSubTime;
      tierName = "Prime";
      subPlan = "Prime";
      break;
    default:
      throw new Error("Invalid tier");
  }

  let msgId, subType;
  let totalTime = timeToAdd;

  // Handle different subscription types
  switch (type) {
    case "sub":
      msgId = "sub";
      subType = "subscription";
      break;
    case "resub":
      msgId = "resub";
      subType = "resub";
      break;
    case "gift":
      msgId = "subgift";
      subType = "gift";
      totalTime = timeToAdd * count;
      break;
    default:
      throw new Error("Invalid type");
  }

  // Create subscriber details including all the subscription information
  const subscriberDetails = {
    username,
    subCount: count,
    subType,
    tierName,
    msgId,
    subPlan,
    timeAdded: totalTime,
  };

  // Add optional fields
  if (recipient && type === "gift") {
    subscriberDetails.recipient = recipient;
  }
  if (months && type === "resub") {
    subscriberDetails.months = months;
  }

  // Add time to timer with complete subscriber details
  timerManager.addTime(totalTime, subscriberDetails);

  // Create and broadcast the subscription event for the frontend
  const subscriptionData = {
    type: "subscription",
    username,
    msgId,
    subPlan,
    tierName,
    timeAdded: totalTime,
    subCount: count,
    subType,
  };

  // Add optional fields to subscription data
  if (recipient && type === "gift") {
    subscriptionData.recipient = recipient;
  }
  if (months && type === "resub") {
    subscriptionData.months = months;
  }

  // Broadcast the subscription event for frontend to handle
  timerManager.broadcast(subscriptionData);

  return {
    success: true,
    message: `Simulated ${type} for ${username} (${tierName}${
      count > 1 ? ` x${count}` : ""
    }) - Added ${totalTime}s`,
    data: subscriptionData,
  };
};

// Convenience endpoints for common scenarios
router.post("/api/dev/simulate-gift-bomb", (req, res) => {
  const { username = "GiftBomber", tier = "1", count = 10 } = req.body;

  try {
    const result = simulateSubscription(username, tier, "gift", count, null, null);
    res.json(result);
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post("/api/dev/simulate-random-sub", (req, res) => {
  const usernames = [
    "TestUser1",
    "SubLover",
    "GamerGal",
    "StreamFan",
    "TwitchViewer",
    "CoolUsername",
  ];
  const tiers = ["1", "2", "3", "prime"];
  const types = ["sub", "resub", "gift"];

  const username = usernames[Math.floor(Math.random() * usernames.length)];
  const tier = tiers[Math.floor(Math.random() * tiers.length)];
  const type = types[Math.floor(Math.random() * types.length)];
  const count = type === "gift" ? Math.floor(Math.random() * 5) + 1 : 1;
  const months = type === "resub" ? Math.floor(Math.random() * 24) + 1 : null;

  try {
    const result = simulateSubscription(username, tier, type, count, null, months);
    res.json(result);
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.get("/", (req, res) => {
  res.send({
    status: "ok",
    service: "pentathon-timer",
    uptime: process.uptime(),
  });
});

export default router;
