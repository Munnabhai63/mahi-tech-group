module.exports = {
  apps: [
    {
      name: 'ovipay-api',
      cwd: '/var/www/ovipay',
      script: 'bin/api.js',
      env: {
        NODE_ENV: 'production'
      },
      restart_delay: 3000,
      max_restarts: 10
    },
    {
      name: 'ovipay-checkout',
      cwd: '/var/www/ovipay',
      script: 'bin/checkout.js',
      env: {
        NODE_ENV: 'production'
      },
      restart_delay: 3000,
      max_restarts: 10
    },
    {
      name: 'ovipay-admin',
      cwd: '/var/www/ovipay',
      script: 'bin/admin.js',
      env: {
        NODE_ENV: 'production'
      },
      restart_delay: 3000,
      max_restarts: 10
    }
  ]
};
