module.exports = {
  apps: [
    {
      name: 'mahi-tech-group',
      script: 'src/server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development',
        PORT: 4000
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 4000
      }
    }
  ]
};
