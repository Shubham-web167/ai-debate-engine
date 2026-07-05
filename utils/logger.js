(function() {
  const LOG_KEY = 'debate_logs';
  const MAX_LOGS = 500;

  // Promise chain to serialize storage writes and prevent race conditions
  let writeQueue = Promise.resolve();

  async function appendToStorage(logEntry) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      writeQueue = writeQueue.then(async () => {
        try {
          const data = await new Promise((resolve) => {
            chrome.storage.local.get([LOG_KEY], (res) => resolve(res));
          });
          const logs = data[LOG_KEY] || [];
          logs.push(logEntry);
          if (logs.length > MAX_LOGS) {
            logs.shift(); // remove oldest
          }
          await new Promise((resolve) => {
            chrome.storage.local.set({ [LOG_KEY]: logs }, () => resolve());
          });
        } catch (err) {
          console.error('Failed to save log to storage:', err);
        }
      });
      return writeQueue;
    }
  }

  const DebateLogger = {
    log: async function(level, platform, event, detail = '') {
      const timestamp = new Date().toISOString();
      const logEntry = { timestamp, level, platform, event, detail: typeof detail === 'object' ? JSON.stringify(detail) : String(detail) };
      
      const formattedMsg = `[${timestamp}] [${level.toUpperCase()}] [${platform.toUpperCase()}] ${event} ${detail ? '- ' + (typeof detail === 'object' ? JSON.stringify(detail) : detail) : ''}`;
      if (level === 'error') {
        console.error(formattedMsg);
      } else if (level === 'warn') {
        console.warn(formattedMsg);
      } else if (level === 'debug') {
        console.debug(formattedMsg);
      } else {
        console.log(formattedMsg);
      }

      await appendToStorage(logEntry);
    },
    info: function(platform, event, detail) {
      return this.log('info', platform, event, detail);
    },
    warn: function(platform, event, detail) {
      return this.log('warn', platform, event, detail);
    },
    error: function(platform, event, detail) {
      return this.log('error', platform, event, detail);
    },
    debug: function(platform, event, detail) {
      return this.log('debug', platform, event, detail);
    },
    clear: async function() {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        writeQueue = writeQueue.then(async () => {
          try {
            await new Promise((resolve) => {
              chrome.storage.local.set({ [LOG_KEY]: [] }, () => resolve());
            });
          } catch (err) {
            console.error('Failed to clear storage:', err);
          }
        });
        return writeQueue;
      }
    },
    getLogs: async function() {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const data = await new Promise((resolve) => {
          chrome.storage.local.get([LOG_KEY], (res) => resolve(res));
        });
        return data[LOG_KEY] || [];
      }
      return [];
    }
  };

  if (typeof self !== 'undefined') {
    self.DebateLogger = DebateLogger;
  }
})();
