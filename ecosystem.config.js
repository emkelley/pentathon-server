module.exports = {
  apps: [
    {
      name: "subathon-timer",
      script: "server.js",

      // Basic PM2 configuration
      instances: 1, // Single instance since we have state management
      exec_mode: "fork", // Use fork mode for single instance

      // Environment variables
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },

      // Restart policy - very aggressive for 7-day reliability
      watch: false, // Don't watch files in production to avoid accidental restarts
      ignore_watch: ["node_modules", "logs", "*.log", "timer-state.json"],

      // Auto-restart settings
      restart_delay: 5000, // Wait 5 seconds before restart
      max_restarts: 50, // Allow up to 50 restarts per day
      min_uptime: "30s", // App must run for 30s to be considered stable

      // Memory management
      max_memory_restart: "1G", // Restart if memory usage exceeds 1GB

      // Process monitoring
      autorestart: true, // Auto restart on crash
      kill_timeout: 30000, // 30 seconds to gracefully shutdown

      // Logging configuration
      log_file: "./logs/subathon-timer.log",
      out_file: "./logs/subathon-timer-out.log",
      error_file: "./logs/subathon-timer-error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,

      // Advanced restart conditions
      cron_restart: "0 4 * * *", // Restart daily at 4 AM as maintenance (optional)

      // Health monitoring
      health_check_grace_period: 30000, // 30 seconds grace period for health checks

      // Additional PM2 features
      vizion: false, // Disable git integration for performance
      post_update: ["pnpm install"], // Run after code updates

      // Node.js specific options
      node_args: [
        "--max-old-space-size=2048", // Limit Node.js memory to 2GB
        "--trace-warnings", // Show warning stack traces
      ],

      // Process title for easier identification
      name: "subathon-timer",

      // Metadata
      metadata: {
        description: "Penta Subathon Timer - 7-day reliable streaming timer",
        version: "1.0.0",
        author: "Subathon Team",
      },
    },
  ],
};
