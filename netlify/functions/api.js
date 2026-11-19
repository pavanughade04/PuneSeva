
const path = require('path');
const serverless = require('serverless-http');

const envPath = path.resolve(process.cwd(), 'backend', '.env');

require('dotenv').config({
  path: envPath,
  override: true
});

const appPromise = (async () => {
  const { createApp } = require('../../backend/serverless-app');
  return await createApp();
})();

exports.handler = async (event, context) => {
  const app = await appPromise;

  const handler = serverless(app, {
    basePath: '/.netlify/functions/api'
  });

  return handler(event, context);
};
