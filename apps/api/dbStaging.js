const { Pool } = require("pg");

const env = process.env;

function pick(...names) {
  for (const name of names) {
    if (env[name]) return env[name];
  }
  return null;
}

const isRemote = Boolean(pick("SAP_STAGING_DB_HOST", "AWS_PGhost"));

const config = {
  host: pick("SAP_STAGING_DB_HOST", "AWS_PGhost", "DB_HOST"),
  port: parseInt(pick("SAP_STAGING_DB_PORT", "AWS_PGport", "DB_PORT") || "5432", 10),
  database: pick("SAP_STAGING_DB_NAME", "AWS_PGDb", "DB_NAME"),
  user: pick("SAP_STAGING_DB_USER", "AWS_PGuser", "DB_USER"),
  password: pick("SAP_STAGING_DB_PASSWORD", "AWS_PGpass", "DB_PASSWORD"),
  max: parseInt(env.DB_POOL_MAX || "5", 10),
  ssl: isRemote ? { rejectUnauthorized: false } : undefined,
};

const sapPool = new Pool(config);

module.exports = sapPool;
