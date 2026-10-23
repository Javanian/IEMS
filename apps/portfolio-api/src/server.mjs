import { createApp } from './app.mjs';
import { connectOwned } from './config.mjs';
const port = Number(process.env.PORTFOLIO_PORT || 4313);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port');
const origins = (process.env.PORTFOLIO_ORIGINS || 'http://localhost:4173').split(',');
const runtime = await connectOwned();
const app = createApp(runtime, { origins, secureCookie: process.env.PORTFOLIO_SECURE_COOKIE === 'true' });
const server = app.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ service: 'portfolio-api', address: '127.0.0.1', port })));
async function close() { server.close(async () => { await runtime.client.close(); process.exitCode = 0; }); }
process.once('SIGINT', close); process.once('SIGTERM', close);
