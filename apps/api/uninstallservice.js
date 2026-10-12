const Service = require('node-windows').Service;
const path = require('path');

const svc = new Service({
  name: 'Timesheet API',
  script: path.join(__dirname, 'server.js'),
});

svc.on('uninstall', () => {
  console.log('Service uninstalled successfully');
});

svc.on('alreadyuninstalled', () => {
  console.log('Service is already uninstalled');
});

svc.on('error', (err) => {
  console.error('Error:', err);
});

svc.uninstall();
