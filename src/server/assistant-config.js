// Credentials are accepted only from the environment, never the application's JSON config.
function assistantConfig(config = {}, env = process.env) {
  const value = env.MINICPM_URL || config.url || 'http://127.0.0.1:9130';
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('MiniCPM URL must be an HTTP loopback origin without credentials.');
  }
  return { enabled: env.CALENDAR_ASSISTANT_ENABLED === undefined ? config.enabled === true : env.CALENDAR_ASSISTANT_ENABLED === '1', url: url.origin, token: env.MINICPM_TOKEN || '' };
}
module.exports = { assistantConfig };
