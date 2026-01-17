/**
 * Environment Variable Validation
 * Checks required environment variables at startup and provides helpful error messages
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file only in local development (not on Render)
// On Render, environment variables are provided directly by the platform
if (process.env.NODE_ENV !== 'production' || !process.env.RENDER) {
  // Try to load .env from server root (for local development)
  const envPath = path.resolve(__dirname, '../../.env');
  dotenv.config({ path: envPath });
}

/**
 * Required environment variables
 * These must be set for the application to function
 */
const REQUIRED_ENV_VARS = [
  'TELEGRAM_BOT_TOKEN',
  'GOOGLE_SPREADSHEET_ID',
];

/**
 * Conditional required variables
 * At least one of these must be set
 */
const CONDITIONAL_ENV_VARS = {
  googleAuth: ['GOOGLE_SERVICE_ACCOUNT_KEY', 'GOOGLE_SERVICE_ACCOUNT_KEY_FILE'],
};

/**
 * Validate environment variables
 * @throws {Error} If required variables are missing
 */
export function validateEnv() {
  const missing = [];
  const errors = [];

  // Check required variables
  for (const varName of REQUIRED_ENV_VARS) {
    if (!process.env[varName] || process.env[varName].trim() === '' || process.env[varName] === '__FILL_ME__') {
      missing.push(varName);
    }
  }

  // Check conditional variables (at least one must be set)
  for (const [groupName, varNames] of Object.entries(CONDITIONAL_ENV_VARS)) {
    const hasAny = varNames.some(varName => {
      const value = process.env[varName];
      return value && value.trim() !== '' && value !== '__FILL_ME__';
    });

    if (!hasAny) {
      errors.push(
        `Missing ${groupName} configuration. Set at least one of: ${varNames.join(', ')}`
      );
    }
  }

  // Build error message
  if (missing.length > 0 || errors.length > 0) {
    let errorMessage = '❌ Missing required environment variables:\n\n';

    if (missing.length > 0) {
      errorMessage += 'Required variables:\n';
      missing.forEach(varName => {
        errorMessage += `  - ${varName}\n`;
      });
      errorMessage += '\n';
    }

    if (errors.length > 0) {
      errorMessage += 'Configuration errors:\n';
      errors.forEach(error => {
        errorMessage += `  - ${error}\n`;
      });
      errorMessage += '\n';
    }

    errorMessage += 'Please set these variables in your .env file.\n';
    errorMessage += 'See .env.example for a template.';

    throw new Error(errorMessage);
  }
}

/**
 * Get environment variable with validation
 * @param {string} varName - Environment variable name
 * @param {string} defaultValue - Default value if not set
 * @returns {string} Environment variable value
 */
export function getEnv(varName, defaultValue = undefined) {
  const value = process.env[varName];
  if (value && value !== '__FILL_ME__') {
    return value;
  }
  if (defaultValue !== undefined) {
    return defaultValue;
  }
  return undefined;
}
