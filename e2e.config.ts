import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile();
  } catch {
    // Ignore if already loaded or missing
  }
}

const apiKey = process.env.GEMINI_API_KEY || process.env.API_GEMINI_API_KEY;

const google = createGoogleGenerativeAI({
  apiKey,
});

export default {
  targets: [
    {
      name: 'web',
      engine: web({ browser: 'chromium' }),
      app: {
        url: 'http://localhost:3000',
        // यह कमांड e2e को खुद सर्वर चलाने का आदेश देती है:
        command: {
          executable: process.platform === 'win32' ? (process.env.COMSPEC || 'cmd.exe') : 'npm',
          args: process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run dev'] : ['run', 'dev'],
          log: '.e2e/logs/app.log',
        },
      },
    },
  ],
  agents: {
    default: {
      model: google('gemini-3.5-flash'),
      system: 'You are an expert QA and exploration agent. Test buttons, forms, navigation, links, and surface any broken flows, 404s, 500s, or UI errors.',
    },
  },
  credentials: {
    admin: {
      username: 'admin@mahitechgroup.com',
      password: 'AdminPassword@2026',
    },
    developer: {
      username: 'developer@oviaxe.com',
      password: 'Password@2026!',
    },
  },
} satisfies E2EConfig;
