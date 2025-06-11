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
  timerManager.reset(req.body.time || 3600);
  res.json({ success: true, message: "Timer reset" });
});

router.post("/api/timer/add", (req, res) => {
  const { seconds } = req.body;
  if (typeof seconds === "number" && seconds > 0) {
    timerManager.addTime(seconds);
    res.json({ success: true, message: `Added ${seconds} seconds` });
  } else {
    res.status(400).json({ success: false, message: "Invalid seconds value" });
  }
});

router.get("/api/settings", (req, res) => {
  res.json(timerManager.getSettings());
});

router.post("/api/settings", (req, res) => {
  const {
    regularSubTime,
    tier2SubTime,
    tier3SubTime,
    primeSubTime,
    giftSubTime,
    timerSize,
    // Timer styling properties
    timerColor,
    timerFont,
    timerShadowColor,
    timerShadowBlur,
    timerShadowOpacity,
    timerShadowX,
    timerShadowY,
  } = req.body;

  const updatedSettings = timerManager.updateSettings({
    regularSubTime,
    tier2SubTime,
    tier3SubTime,
    primeSubTime,
    giftSubTime,
    timerSize,
    // Timer styling properties
    timerColor,
    timerFont,
    timerShadowColor,
    timerShadowBlur,
    timerShadowOpacity,
    timerShadowX,
    timerShadowY,
  });

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

  // Add time to timer with subscriber details
  const subscriberDetails = {
    username,
    subCount: count,
    subType,
    tierName,
    msgId,
  };

  timerManager.addTime(totalTime, subscriberDetails);

  // Simulate the subscription broadcast that would come from Twitch
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

  // Add optional fields
  if (recipient && type === "gift") {
    subscriptionData.recipient = recipient;
  }
  if (months && type === "resub") {
    subscriptionData.months = months;
  }

  // Broadcast the subscription event
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

// Serve public timer page
router.get("/", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "index.html"));
});

// Serve admin page
router.get("/admin", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "admin.html"));
});

export default router;
