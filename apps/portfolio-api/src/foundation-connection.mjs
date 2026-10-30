import { MongoClient } from 'mongodb';

export async function connectFoundationOwned(env = process.env) {
  const uri = env.PORTFOLIO_MONGO_URI, database = env.PORTFOLIO_DB;
  if (!uri || !/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri) || !/^portfolio_owned_[a-zA-Z0-9_]{1,60}$/.test(database || '')) throw new Error('Owned loopback Mongo URI and portfolio_owned_ database required');
  const client = await new MongoClient(uri, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000, socketTimeoutMS: 10000, maxPoolSize: 10, waitQueueTimeoutMS: 5000 }).connect();
  try {
    const hello = await client.db('admin').command({ hello: 1 });
    if (!hello.setName || !hello.isWritablePrimary) throw new Error('Writable replica set required');
    return { client, db: client.db(database) };
  } catch (error) { await client.close(); throw error; }
}
