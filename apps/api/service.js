const Service = require('node-windows').Service;
const EventLogger = require('node-windows').EventLogger;
const path = require('path');

const log = new EventLogger('Timesheet API Service');
const serverScript = path.join(__dirname, 'server.js');

const svc = new Service({
  name: 'Timesheet API',
  description: 'Node.js Timesheet API Service',
  script: serverScript,

  startType: 'automatic',
  delayedStart: false,
  wait: 2,
  grow: 0.25,
  maxRestarts: 5,

  cwd: __dirname,

  env: [
    {
      name: 'NODE_ENV',
      value: 'production',
    },
  ],
});

svc.on('install', () => {
  log.info('Service installed successfully');
  console.log('Service installed successfully');
  svc.start();
});

svc.on('alreadyinstalled', () => {
  log.warn('Service is already installed');
  console.log('Service is already installed');
});

svc.on('start', () => {
  log.info('Service started');
  console.log('Service started');
});

svc.on('stop', () => {
  log.info('Service stopped');
  console.log('Service stopped');
});

svc.on('error', (err) => {
  log.error(`Service error: ${err.message}`);
  console.error('Service error:', err);
});

svc.on('invalidinstallation', () => {
  log.error('Invalid installation');
  console.error('Invalid installation');
});

try {
  svc.install();
} catch (error) {
  log.error(`Installation failed: ${error.message}`);
  console.error('Installation failed:', error);
}
