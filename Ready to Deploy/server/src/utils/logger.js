/**
 * Simple logger utility for production-safe logging
 * Controlled by LOG_LEVEL environment variable
 */

const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
};

function getLogLevel() {
  const envLevel = process.env.LOG_LEVEL?.toUpperCase();
  if (envLevel && LOG_LEVELS[envLevel] !== undefined) {
    return LOG_LEVELS[envLevel];
  }
  
  // Default: production = ERROR, development = DEBUG
  if (process.env.NODE_ENV === 'production') {
    return LOG_LEVELS.ERROR;
  }
  return LOG_LEVELS.DEBUG;
}

const currentLogLevel = getLogLevel();

function safeStringify(obj, maxLength = 200) {
  if (typeof obj === 'string') {
    return obj.length > maxLength ? obj.substring(0, maxLength) + '...' : obj;
  }
  try {
    const str = JSON.stringify(obj);
    return str.length > maxLength ? str.substring(0, maxLength) + '...' : str;
  } catch (e) {
    return '[Object]';
  }
}

const logger = {
  error(...args) {
    // Always print errors
    const message = args.map(arg => 
      typeof arg === 'object' ? safeStringify(arg) : String(arg)
    ).join(' ');
    console.error(message);
  },
  
  warn(...args) {
    if (currentLogLevel >= LOG_LEVELS.WARN) {
      const message = args.map(arg => 
        typeof arg === 'object' ? safeStringify(arg) : String(arg)
      ).join(' ');
      console.warn(message);
    }
  },
  
  info(...args) {
    if (currentLogLevel >= LOG_LEVELS.INFO) {
      const message = args.map(arg => 
        typeof arg === 'object' ? safeStringify(arg) : String(arg)
      ).join(' ');
    }
  },
  
  debug(...args) {
    if (currentLogLevel >= LOG_LEVELS.DEBUG) {
      const message = args.map(arg => 
        typeof arg === 'object' ? safeStringify(arg) : String(arg)
      ).join(' ');
    }
  },
};

export default logger;
