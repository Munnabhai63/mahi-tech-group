module.exports = {
  apps: [
    {
      name: 'mahi-tech-group',
      script: 'src/server.js',
      cwd: '/var/www/oviaxe.com',
      node_args: '--env-file=.env',
      env: {
        NODE_ENV: 'production'
      },
      max_memory_restart: '300M',
      restart_delay: 3000
    }
  ]
};
