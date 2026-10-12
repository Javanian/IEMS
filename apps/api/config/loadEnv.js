const path = require('path');
const dotenv = require('dotenv');

const envPath = path.resolve(__dirname, '..', '..', '..', '.env');
const result = dotenv.config({ path: envPath });

if (result.error) {
  console.warn(`No .env file found at ${envPath}, using environment variables`);
}

module.exports = {
  envPath,
  loaded: !result.error,
};
