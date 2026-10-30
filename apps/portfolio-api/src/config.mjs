import { connectFoundationOwned } from './foundation-connection.mjs';
import { initialize } from './app.mjs';
export async function connectOwned(env = process.env) {
  const { client, db } = await connectFoundationOwned(env);
  try {
    return await initialize({ client, db });
  } catch (error) { await client.close(); throw error; }
}
