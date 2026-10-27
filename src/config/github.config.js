import fs from 'node:fs';
import path from 'node:path';

/**
 * Validates GitHub App environment variables and reads the private key.
 * Throws descriptive Error if any validation fails.
 * NEVER exposes privateKey or webhookSecret in error messages.
 */
export function validateAndLoadGithubConfig(env = process.env) {
  const appId = env.GITHUB_APP_ID;
  if (!appId || !/^\d+$/.test(String(appId).trim())) {
    throw new Error('Invalid or missing GITHUB_APP_ID: must be set and numeric');
  }

  const keyPath = env.GITHUB_APP_PRIVATE_KEY_PATH;
  if (!keyPath || typeof keyPath !== 'string' || !keyPath.trim()) {
    throw new Error('Invalid or missing GITHUB_APP_PRIVATE_KEY_PATH: must specify path to private key file');
  }

  let privateKey;
  try {
    const resolvedPath = path.isAbsolute(keyPath) ? keyPath : path.resolve(process.cwd(), keyPath);
    privateKey = fs.readFileSync(resolvedPath, 'utf8');
  } catch (err) {
    throw new Error(`Private key file not found or unreadable at GITHUB_APP_PRIVATE_KEY_PATH: ${keyPath}`);
  }

  if (!privateKey || !privateKey.trim()) {
    throw new Error('Private key file is empty');
  }

  const webhookSecret = env.GITHUB_WEBHOOK_SECRET;
  if (!webhookSecret || typeof webhookSecret !== 'string' || webhookSecret.length < 32) {
    throw new Error('Invalid or missing GITHUB_WEBHOOK_SECRET: must be at least 32 characters');
  }

  const orgName = env.GITHUB_ORG_NAME;
  if (!orgName || typeof orgName !== 'string' || !orgName.trim()) {
    throw new Error('Invalid or missing GITHUB_ORG_NAME: organization name must be set');
  }

  const installationId = env.GITHUB_APP_INSTALLATION_ID ? String(env.GITHUB_APP_INSTALLATION_ID).trim() : null;

  return Object.freeze({
    appId: String(appId).trim(),
    privateKey,
    webhookSecret,
    orgName: String(orgName).trim(),
    installationId,
  });
}

// Validate on load as required by PRD 17 specification
const githubConfig = validateAndLoadGithubConfig(process.env);

export default githubConfig;
export { githubConfig };
