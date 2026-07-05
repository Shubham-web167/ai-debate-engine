// Global error handlers for observable debugging
self.addEventListener('error', (event) => {
  try {
    const logEntry = {
      timestamp: new Date().toISOString(),
      message: event.message || 'Unknown background error',
      filename: event.filename || '',
      lineno: event.lineno || 0,
      colno: event.colno || 0,
      stack: event.error ? event.error.stack : ''
    };
    chrome.storage.local.set({ 'lastCrashLog': logEntry });
  } catch (e) {
    console.error('Failed to write error crash log to storage:', e);
  }
});

self.addEventListener('unhandledrejection', (event) => {
  try {
    const logEntry = {
      timestamp: new Date().toISOString(),
      message: event.reason ? (event.reason.message || String(event.reason)) : 'Unhandled promise rejection',
      stack: event.reason && event.reason.stack ? event.reason.stack : ''
    };
    chrome.storage.local.set({ 'lastCrashLog': logEntry });
  } catch (e) {
    console.error('Failed to write rejection crash log to storage:', e);
  }
});

// Import helper scripts
importScripts(
  'utils/logger.js',
  'utils/similarity.js',
  'prompts/templates.js',
  'stateMachine.js'
);

let currentState = null;
let isOrchestratorRunning = false;

const URLS = {
  chatgpt: 'https://chatgpt.com',
  claude: 'https://claude.ai',
  gemini: 'https://gemini.google.com'
};

let tabSwitchInterval = null;

// Activate a specific tab within Chrome (fail-safe)
function activateTab(platform) {
  try {
    if (!currentState || !currentState.tabs || !currentState.tabs[platform]) return;
    const tabId = currentState.tabs[platform];
    if (!tabId) return;
    
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.update) {
      chrome.tabs.update(tabId, { active: true }, (tab) => {
        if (chrome.runtime.lastError) {
          console.warn(`[activateTab] Failed to activate tab for ${platform}:`, chrome.runtime.lastError.message);
        }
      });
    }
  } catch (err) {
    console.warn(`[activateTab] Synchronous error for ${platform}:`, err.message);
  }
}

// Start round-robin tab switching at an 8-second interval (fail-safe)
function startRoundRobinTabSwitching(platformsToSwitch) {
  try {
    stopRoundRobinTabSwitching();
    if (!platformsToSwitch || platformsToSwitch.length === 0) return;
    
    if (platformsToSwitch.length === 1) {
      activateTab(platformsToSwitch[0]);
      return;
    }

    let index = 0;
    activateTab(platformsToSwitch[index]);

    tabSwitchInterval = setInterval(() => {
      try {
        if (!currentState) {
          stopRoundRobinTabSwitching();
          return;
        }

        const stillWaiting = platformsToSwitch.filter(p => 
          currentState.platformStatus &&
          (currentState.platformStatus[p] === 'WAITING' || currentState.platformStatus[p] === 'RUNNING')
        );

        if (stillWaiting.length === 0) {
          stopRoundRobinTabSwitching();
          return;
        }

        if (stillWaiting.length === 1) {
          activateTab(stillWaiting[0]);
          stopRoundRobinTabSwitching();
          return;
        }

        index = (index + 1) % platformsToSwitch.length;
        let checked = 0;
        while (!stillWaiting.includes(platformsToSwitch[index]) && checked < platformsToSwitch.length) {
          index = (index + 1) % platformsToSwitch.length;
          checked++;
        }

        if (stillWaiting.includes(platformsToSwitch[index])) {
          activateTab(platformsToSwitch[index]);
        }
      } catch (intervalErr) {
        console.warn('[startRoundRobinTabSwitching] Error inside interval loop:', intervalErr.message);
      }
    }, 8000);
  } catch (err) {
    console.warn('[startRoundRobinTabSwitching] Failed to start:', err.message);
  }
}

// Stop active round-robin timer (fail-safe)
function stopRoundRobinTabSwitching() {
  try {
    if (tabSwitchInterval) {
      clearInterval(tabSwitchInterval);
      tabSwitchInterval = null;
    }
  } catch (err) {
    console.warn('[stopRoundRobinTabSwitching] Failed to stop:', err.message);
  }
}

// Start keepalive alarm to keep service worker awake
function startKeepAliveAlarm() {
  chrome.alarms.create('debate_keepalive', { periodInMinutes: 0.5 });
}

function stopKeepAliveAlarm() {
  chrome.alarms.clear('debate_keepalive');
}

// Persist current state to storage
async function saveState() {
  if (currentState) {
    await new Promise((resolve) => {
      chrome.storage.local.set({ 'debate_state': currentState }, () => resolve());
    });
  }
}

// Helper to send message to tab with retry-with-backoff
async function sendTabMessageWithRetry(tabId, message, retries = [0, 2000, 5000]) {
  for (let i = 0; i < retries.length; i++) {
    const delay = retries[i];
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    // Abort if debate has been cancelled
    if (currentState && currentState.status === 'CANCELLED') {
      throw new Error("Action aborted: debate cancelled");
    }

    try {
      const response = await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, message, (res) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(res);
          }
        });
      });

      if (response && response.success) {
        return response.result;
      }
      throw new Error(response ? response.error : "Unknown error response from content script");
    } catch (err) {
      await self.DebateLogger.warn(
        message.platform || 'orchestrator', 
        `Action ${message.action} failed (attempt ${i + 1}/${retries.length}): ${err.message}`
      );
      if (i === retries.length - 1) {
        throw err;
      }
    }
  }
}

// Resolve platform tab (reuse or open new)
async function resolvePlatformTab(platform) {
  const urlPattern = URLS[platform];
  
  const tabs = await new Promise((resolve) => {
    chrome.tabs.query({}, (res) => resolve(res));
  });

  const matchingTab = tabs.find(t => t.url && t.url.includes(urlPattern.split('://')[1]));
  let tabId;
  if (matchingTab) {
    await self.DebateLogger.info(platform, 'Reusing existing tab', { tabId: matchingTab.id });
    tabId = matchingTab.id;
  } else {
    await self.DebateLogger.info(platform, 'Opening new tab', { url: urlPattern });
    const newTab = await new Promise((resolve) => {
      chrome.tabs.create({ url: urlPattern, active: false }, (t) => resolve(t));
    });
    await waitForTabComplete(newTab.id);
    tabId = newTab.id;
  }

  // Always perform handshake to ensure content script is ready before returning tabId
  await verifyTabReady(tabId, platform);
  
  return tabId;
}

// Perform a ping/pong handshake to ensure the content script is active and loaded
async function verifyTabReady(tabId, platform, timeoutMs = 20000) {
  await self.DebateLogger.info(platform, 'Starting connection handshake with content script...');
  const startTime = Date.now();
  let injectionAttempted = false;
  
  // Map platform to its content script files (must match manifest order)
  const CONTENT_SCRIPTS = {
    chatgpt: ['utils/logger.js', 'utils/selectorResolver.js', 'adapters/baseAdapter.js', 'adapters/chatgptAdapter.js'],
    claude:  ['utils/logger.js', 'utils/selectorResolver.js', 'adapters/baseAdapter.js', 'adapters/claudeAdapter.js'],
    gemini:  ['utils/logger.js', 'utils/selectorResolver.js', 'adapters/baseAdapter.js', 'adapters/geminiAdapter.js']
  };
  
  while (Date.now() - startTime < timeoutMs) {
    // Abort if debate has been cancelled
    if (currentState && currentState.status === 'CANCELLED') {
      throw new Error("Action aborted: debate cancelled");
    }

    try {
      const response = await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, { action: 'ping' }, (res) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(res);
          }
        });
      });

      if (response && response.success && response.result === 'pong') {
        await self.DebateLogger.info(platform, 'Handshake succeeded. Content script is active.');
        return;
      }
    } catch (err) {
      console.log(`[Handshake] Ping failed for ${platform}, retrying... ${err.message}`);
      
      // After 2 seconds of failed pings, attempt programmatic content script injection
      if (!injectionAttempted && Date.now() - startTime > 2000) {
        injectionAttempted = true;
        const scripts = CONTENT_SCRIPTS[platform];
        if (scripts) {
          await self.DebateLogger.info(platform, 'Pings failing - attempting programmatic content script injection...');
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tabId },
              files: scripts
            });
            await self.DebateLogger.info(platform, 'Content scripts injected programmatically. Waiting for initialization...');
            // Give injected scripts time to initialize and fetch selectors
            await new Promise(resolve => setTimeout(resolve, 1000));
          } catch (injectErr) {
            await self.DebateLogger.warn(platform, 'Programmatic injection failed', injectErr.message);
          }
        }
      }
    }
    
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  
  throw new Error("Content script handshake timeout. Target page did not respond to pings.");
}

// Poll tab state until 'complete'
async function waitForTabComplete(tabId) {
  for (let i = 0; i < 30; i++) {
    const tab = await new Promise((resolve) => {
      chrome.tabs.get(tabId, (t) => {
        if (chrome.runtime.lastError) {
          resolve(null);
        } else {
          resolve(t);
        }
      });
    });
    if (tab && tab.status === 'complete') {
      return;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error("Tab load timeout");
}

// Open tabs and verify login status
async function setupTabs() {
  const tabIds = {};
  for (const platform of currentState.config.platforms) {
    try {
      await self.DebateLogger.info(platform, 'Resolving tab connection');
      const tabId = await resolvePlatformTab(platform);
      tabIds[platform] = tabId;
      
      const loggedIn = await sendTabMessageWithRetry(tabId, { action: 'isLoggedIn' });
      if (!loggedIn) {
        await self.DebateLogger.warn(platform, 'User is not logged in. Skipping this platform.');
        currentState.platformStatus[platform] = 'SKIPPED';
        continue;
      }
      
      currentState.platformStatus[platform] = 'RUNNING';
    } catch (err) {
      await self.DebateLogger.error(platform, 'Failed to resolve tab or verify login', err.message);
      currentState.platformStatus[platform] = 'FAILED';
    }
  }

  currentState = self.StateMachine.transition(currentState, 'BROADCASTING', { tabs: tabIds });
  await saveState();
}

// Re-entrant runner for a specific round of messages
async function runRoundGeneric(stageName, answersKey, timeoutMs) {
  let waitState, collectState, nextState;
  if (stageName === 'initial') {
    waitState = 'WAITING';
    collectState = 'COLLECTING';
    nextState = 'CRITIQUE';
  } else if (stageName === 'critique1') {
    waitState = 'WAITING_CRITIQUE';
    collectState = 'COLLECTING_CRITIQUE';
    nextState = 'ROUND2';
  } else if (stageName === 'critique2') {
    waitState = 'WAITING_ROUND2';
    collectState = 'COLLECTING_ROUND2';
    nextState = 'JUDGE';
  }

  if (currentState.status !== waitState && currentState.status !== collectState) {
    currentState = self.StateMachine.transition(currentState, waitState);
    await saveState();
  }

  const activePlatforms = currentState.config.platforms.filter(p => 
    currentState.platformStatus[p] !== 'SKIPPED' && 
    currentState.platformStatus[p] !== 'FAILED'
  );

  if (activePlatforms.length === 0) {
    await self.DebateLogger.warn('orchestrator', `No active platforms available for stage: ${stageName}`);
    currentState = self.StateMachine.transition(currentState, nextState);
    await saveState();
    return;
  }

  const platformsToSwitch = activePlatforms.filter(p => !currentState.answers[stageName][p]);
  startRoundRobinTabSwitching(platformsToSwitch);

  let staggerIndex = 0;
  const promises = activePlatforms.map(async (platform) => {
    if (currentState.answers[stageName][platform]) {
      await self.DebateLogger.info(platform, `Already collected ${stageName} response. Skipping message send.`);
      return;
    }

    let tabId;
    try {
      // Self-healing tab resolution to verify active connection before prompt injection
      tabId = await resolvePlatformTab(platform);
      currentState.tabs[platform] = tabId;
      await saveState();
    } catch (tabErr) {
      currentState.platformStatus[platform] = 'FAILED';
      await saveState();
      await self.DebateLogger.error(platform, `Failed to verify content script connection for ${stageName}`, tabErr.message);
      return;
    }

    try {
      currentState.platformStatus[platform] = 'RUNNING';
      await saveState();

      let promptText = '';
      if (stageName === 'initial') {
        promptText = currentState.question;
      } else if (stageName === 'critique1') {
        const myInitial = currentState.answers.initial[platform];
        const otherAnswers = {};
        for (const p of activePlatforms) {
          if (p !== platform) otherAnswers[p] = currentState.answers.initial[p];
        }
        promptText = self.DebateTemplates.getCritiquePrompt(currentState.question, platform, myInitial, otherAnswers);
      } else if (stageName === 'critique2') {
        const myCritique1 = currentState.answers.critique1[platform];
        const otherAnswers = {};
        for (const p of activePlatforms) {
          if (p !== platform) otherAnswers[p] = currentState.answers.critique1[p];
        }
        promptText = self.DebateTemplates.getCritiquePrompt(currentState.question, platform, myCritique1, otherAnswers);
      }

      // Stagger prompts to prevent tab overload
      const delay = staggerIndex++ * 300;
      await new Promise(r => setTimeout(r, delay));
      
      await self.DebateLogger.info(platform, `Sending prompt for ${stageName}`);
      await sendTabMessageWithRetry(tabId, { action: 'injectAndSend', text: promptText });
      
      currentState.platformStatus[platform] = 'WAITING';
      await saveState();

      await self.DebateLogger.info(platform, `Waiting for response (${timeoutMs / 1000}s timeout)`);
      const text = await sendTabMessageWithRetry(tabId, { action: 'waitForCompletion', timeoutMs: timeoutMs }, [0, 2000, 5000]);
      
      currentState.answers[stageName][platform] = text;
      currentState.platformStatus[platform] = 'SUCCESS';
      await self.DebateLogger.info(platform, `Successfully collected response for ${stageName}`);
    } catch (err) {
      currentState.platformStatus[platform] = 'FAILED';
      await self.DebateLogger.error(platform, `Failed during ${stageName} round`, err.message);
    }
    await saveState();
  });

  try {
    await Promise.allSettled(promises);
  } finally {
    stopRoundRobinTabSwitching();
  }

  const successes = activePlatforms.filter(p => currentState.platformStatus[p] === 'SUCCESS');
  if (successes.length === 0) {
    throw new Error(`All platforms failed in ${stageName} round`);
  }

  currentState = self.StateMachine.transition(currentState, nextState);
  await saveState();
}

async function runInitialRound() {
  await runRoundGeneric('initial', 'initial', 120000);

  // Check if we can perform a critique
  const successes = currentState.config.platforms.filter(p => currentState.answers.initial[p]);
  if (successes.length < 2) {
    await self.DebateLogger.warn('orchestrator', 'Fewer than 2 successful initial answers. Skipping critiques.');
    currentState = self.StateMachine.transition(currentState, 'JUDGE');
    await saveState();
  }
}

async function runCritiqueRound1() {
  await runRoundGeneric('critique1', 'critique1', 120000);

  // Calculate similarity after Critique 1
  const answersMap = {};
  for (const p of currentState.config.platforms) {
    if (currentState.answers.critique1[p]) {
      answersMap[p] = currentState.answers.critique1[p];
    }
  }

  const avgSimilarity = self.Similarity.averagePairwiseSimilarity(answersMap);
  currentState.similarity = avgSimilarity;
  await saveState();

  if (avgSimilarity >= currentState.config.round2SimilarityThreshold) {
    await self.DebateLogger.info(
      'orchestrator', 
      `Critique 1 similarity (${avgSimilarity.toFixed(3)}) meets threshold (${currentState.config.round2SimilarityThreshold}). Skipping Critique Round 2.`
    );
    currentState = self.StateMachine.transition(currentState, 'JUDGE');
    await saveState();
  } else {
    await self.DebateLogger.info(
      'orchestrator', 
      `Critique 1 similarity (${avgSimilarity.toFixed(3)}) is below threshold (${currentState.config.round2SimilarityThreshold}). Triggering Critique Round 2.`
    );
  }
}

async function runCritiqueRound2() {
  await runRoundGeneric('critique2', 'critique2', 120000);
}

async function runJudgeRound() {
  if (currentState.status !== 'WAITING_JUDGE' && currentState.status !== 'COLLECTING_JUDGE') {
    currentState = self.StateMachine.transition(currentState, 'WAITING_JUDGE');
    await saveState();
  }

  let finalAnswersMap = {};
  if (Object.keys(currentState.answers.critique2).length > 0) {
    finalAnswersMap = currentState.answers.critique2;
  } else if (Object.keys(currentState.answers.critique1).length > 0) {
    finalAnswersMap = currentState.answers.critique1;
  } else {
    finalAnswersMap = currentState.answers.initial;
  }

  const successfulPlatforms = Object.keys(finalAnswersMap);
  if (successfulPlatforms.length === 0) {
    throw new Error("No successful responses available for synthesis");
  }

  let judge = currentState.config.judgePlatform;
  if (judge === 'longest') {
    let longestLength = -1;
    let selected = '';
    for (const p of successfulPlatforms) {
      const len = finalAnswersMap[p].length;
      if (len > longestLength) {
        longestLength = len;
        selected = p;
      }
    }
    judge = selected;
  } else if (!successfulPlatforms.includes(judge)) {
    judge = successfulPlatforms[0];
  }

  currentState.synthesisPlatform = judge;
  await self.DebateLogger.info('orchestrator', `Selected judge platform: ${judge.toUpperCase()}`);
  await saveState();

  const tabId = currentState.tabs[judge];
  if (!tabId) {
    throw new Error(`No tab connection for judge platform: ${judge}`);
  }

  // Focus the judge tab
  activateTab(judge);

  if (currentState.synthesis) {
    await self.DebateLogger.info('orchestrator', 'Synthesis already completed.');
    return;
  }

  const judgePrompt = self.DebateTemplates.getJudgePrompt(currentState.question, finalAnswersMap);
  
  currentState.platformStatus[judge] = 'RUNNING';
  await saveState();

  await self.DebateLogger.info(judge, 'Sending synthesis prompt to Judge');
  await sendTabMessageWithRetry(tabId, { action: 'injectAndSend', text: judgePrompt });

  currentState.platformStatus[judge] = 'WAITING';
  await saveState();

  await self.DebateLogger.info(judge, 'Waiting for judge synthesis (180s timeout)');
  const synthesizedText = await sendTabMessageWithRetry(tabId, { action: 'waitForCompletion', timeoutMs: 180000 }, [0, 2000, 5000]);

  currentState.synthesis = synthesizedText;
  currentState.platformStatus[judge] = 'SUCCESS';
  await self.DebateLogger.info(judge, 'Synthesis completed successfully!');
  await saveState();
}

// Master state loop
async function runDebateStateLoop() {
  if (isOrchestratorRunning) return;
  isOrchestratorRunning = true;

  try {
    startKeepAliveAlarm();

    if (currentState.status === 'IDLE') {
      await setupTabs();
    }
    
    if (currentState.status === 'BROADCASTING' || currentState.status === 'WAITING' || currentState.status === 'COLLECTING') {
      await runInitialRound();
    }

    if (currentState.status === 'CRITIQUE' || currentState.status === 'WAITING_CRITIQUE' || currentState.status === 'COLLECTING_CRITIQUE') {
      await runCritiqueRound1();
    }

    if (currentState.status === 'ROUND2' || currentState.status === 'WAITING_ROUND2' || currentState.status === 'COLLECTING_ROUND2') {
      await runCritiqueRound2();
    }

    if (currentState.status === 'JUDGE' || currentState.status === 'WAITING_JUDGE' || currentState.status === 'COLLECTING_JUDGE') {
      await runJudgeRound();
    }
    
    if (currentState && currentState.status !== 'CANCELLED' && currentState.status !== 'FAILED') {
      currentState = self.StateMachine.transition(currentState, 'DONE');
      await saveState();
      await self.DebateLogger.info('orchestrator', 'Debate successfully completed!');
    }
  } catch (err) {
    if (currentState && currentState.status !== 'CANCELLED') {
      currentState = self.StateMachine.transition(currentState, 'FAILED', { error: err.message });
      await saveState();
      await self.DebateLogger.error('orchestrator', 'Debate failed', err.message);
    }
  } finally {
    isOrchestratorRunning = false;
    stopKeepAliveAlarm();
  }
}

// Explicit cancellation cleanup
async function cancelDebate() {
  await self.DebateLogger.warn('orchestrator', 'Cancelling active debate...');
  stopKeepAliveAlarm();
  stopRoundRobinTabSwitching();
  isOrchestratorRunning = false; // Reset lock immediately on cancellation

  if (currentState) {
    currentState.status = 'CANCELLED';
    await saveState();
    
    for (const [platform, tabId] of Object.entries(currentState.tabs)) {
      try {
        chrome.tabs.sendMessage(tabId, { action: 'cancel' }, () => {
          const err = chrome.runtime.lastError;
        });
        currentState.platformStatus[platform] = 'CANCELLED';
      } catch (err) {
        // Tab might have been closed, ignore
      }
    }
    await saveState();
  }
  await self.DebateLogger.warn('orchestrator', 'Debate cancelled successfully.');
}

// Message listener (guarded against duplicate registration)
if (self.messageListenerRegistered) {
  console.warn('[WARNING] Duplicate message listener registration attempted!');
} else {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    (async () => {
      try {
        if (request.action === 'startDebate') {
          if (isOrchestratorRunning) {
            sendResponse({ success: false, error: 'Debate is already running' });
            return;
          }
          await self.DebateLogger.clear();
          await self.DebateLogger.info('orchestrator', 'Starting new debate', { question: request.question });
          
          currentState = self.StateMachine.createInitialState(request.question, request.config);
          await saveState();
          
          // Start async loop
          runDebateStateLoop();
          
          sendResponse({ success: true });
        } else if (request.action === 'stopDebate') {
          await cancelDebate();
          sendResponse({ success: true });
        } else if (request.action === 'resetDebate') {
          await cancelDebate();
          currentState = null;
          isOrchestratorRunning = false;
          await new Promise((resolve) => {
            chrome.storage.local.remove(['debate_state'], () => resolve());
          });
          sendResponse({ success: true });
        } else if (request.action === 'getDebateState') {
          sendResponse({ success: true, result: currentState });
        } else {
          sendResponse({ success: false, error: 'Unknown action' });
        }
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  });
  self.messageListenerRegistered = true;
}

// Restore state on worker startup for popup display only — do NOT auto-resume the debate loop.
// Auto-resuming causes the extension to re-open tabs and re-send questions whenever
// the user reloads the extension from chrome://extensions.
if (self.startupResumeExecuted) {
  console.warn('[WARNING] Duplicate startup resume execution attempted!');
} else {
  chrome.storage.local.get(['debate_state'], (data) => {
    if (data.debate_state) {
      currentState = data.debate_state;
      
      // Clear terminal states (FAILED, COMPLETED, CANCELLED) on startup
      // so stale state doesn't linger across reloads
      const terminalStates = ['FAILED', 'COMPLETED', 'CANCELLED'];
      if (terminalStates.includes(currentState.status)) {
        self.DebateLogger.info('orchestrator', `Clearing terminal state (${currentState.status}) on startup.`);
        currentState = null;
        chrome.storage.local.remove(['debate_state']);
      } else {
        // Non-terminal (in-progress) state found — restore for popup display
        // but do NOT auto-resume the orchestrator loop
        self.DebateLogger.info('orchestrator', `Restored state (${currentState.status}) for display. Use "New Debate" to start fresh.`);
      }
    }
  });
  self.startupResumeExecuted = true;
}

// Re-check loops on periodic alarms (guarded against duplicate listener registration)
if (self.alarmListenerRegistered) {
  console.warn('[WARNING] Duplicate alarm listener registration attempted!');
} else {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'debate_keepalive') {
      // Only resume if the orchestrator was genuinely active in THIS service worker session.
      // Do NOT read from cold storage — that causes phantom restarts after extension reloads.
      if (currentState && !isOrchestratorRunning) {
        const runningStates = [
          'BROADCASTING', 'WAITING', 'COLLECTING',
          'CRITIQUE', 'WAITING_CRITIQUE', 'COLLECTING_CRITIQUE',
          'ROUND2', 'WAITING_ROUND2', 'COLLECTING_ROUND2',
          'JUDGE', 'WAITING_JUDGE', 'COLLECTING_JUDGE'
        ];
        if (runningStates.includes(currentState.status)) {
          console.log('Keepalive triggered orchestrator restart');
          runDebateStateLoop();
        }
      }
    }
  });
  self.alarmListenerRegistered = true;
}
