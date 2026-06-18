module.exports = {
  apps: [
    {
      name: "cpfinder-security",
      script: "server.js",
      cwd: __dirname,
      node_args: "--max-old-space-size=400",
      env: {
        NODE_ENV: "production",
        PORT: "4173"
      },
      max_memory_restart: "700M",
      autorestart: true,
      merge_logs: true,
      time: true
    }
  ]
};
