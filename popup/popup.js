// Elements
const setupView = document.getElementById('setup-view');
const runningView = document.getElementById('running-view');
const resultsView = document.getElementById('results-view');

const globalStatus = document.getElementById('global-status');
const questionInput = document.getElementById('question-input');

// Config checkboxes
const platformChatgpt = document.getElementById('platform-chatgpt');
const platformClaude = document.getElementById('platform-claude');
const platformGemini = document.getElementById('platform-gemini');
const similarityThreshold = document.getElementById('similarity-threshold');
const judgeSelect = document.getElementById('judge-select');

// Buttons
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const resetBtn = document.getElementById('reset-btn');
const clearLogsBtn = document.getElementById('clear-logs-btn');

// Timeline steps
const stepBroadcast = document.getElementById('step-broadcast');
const stepCritique = document.getElementById('step-critique');
const stepRound2 = document.getElementById('step-round2');
const stepJudge = document.getElementById('step-judge');

// Platform status badges
const badgeChatgpt = document.getElementById('badge-chatgpt');
const badgeClaude = document.getElementById('badge-claude');
const badgeGemini = document.getElementById('badge-gemini');

// Results elements
const synthesizedContent = document.getElementById('synthesized-content');
const synthesisJudgeName = document.getElementById('synthesis-judge-name');
const synthesisSimilarity = document.getElementById('synthesis-similarity');

// Accordion Tabs
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanes = document.querySelectorAll('.tab-pane');

// Logs
const logsList = document.getElementById('logs-list');
const clearCrashBtn = document.getElementById('clear-crash-btn');
const crashLogContent = document.getElementById('crash-log-content');

let pollingInterval = null;
let lastLogCount = 0;

// Init
document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  startPolling();
  
  startBtn.addEventListener('click', startDebate);
  stopBtn.addEventListener('click', stopDebate);
  resetBtn.addEventListener('click', resetDebate);
  clearLogsBtn.addEventListener('click', clearLogs);
  if (clearCrashBtn) {
    clearCrashBtn.addEventListener('click', clearCrashLogs);
  }

  // Restore saved question (Smart UI Improvement)
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['saved_question'], (data) => {
      if (data.saved_question && questionInput) {
        questionInput.value = data.saved_question;
      }
    });
  }

  // Save question automatically on typing (Smart UI Improvement)
  if (questionInput) {
    questionInput.addEventListener('input', () => {
      chrome.storage.local.set({ 'saved_question': questionInput.value });
    });
  }
});

// Tab Navigation
function setupTabs() {
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));
      
      btn.classList.add('active');
      const paneId = btn.getAttribute('data-tab');
      document.getElementById(paneId).classList.add('active');
    });
  });
}

// Start polling background state
function startPolling() {
  updatePopupState();
  if (pollingInterval) clearInterval(pollingInterval);
  pollingInterval = setInterval(updatePopupState, 1000);
}

// Fetch state and logs
async function updatePopupState() {
  chrome.runtime.sendMessage({ action: 'getDebateState' }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn('Error fetching debate state:', chrome.runtime.lastError.message);
      return;
    }
    if (response && response.success) {
      renderState(response.result);
    }
  });

  // Pull logs
  if (typeof DebateLogger !== 'undefined') {
    const logs = await DebateLogger.getLogs();
    if (logs.length !== lastLogCount) {
      renderLogs(logs);
      lastLogCount = logs.length;
    }
  }

  // Pull and render system crash logs (Observable Debugging)
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['lastCrashLog', 'contentCrashLogs'], (data) => {
      if (chrome.runtime.lastError) return;
      if (!crashLogContent) return;

      let html = '';
      if (data.lastCrashLog) {
        const log = data.lastCrashLog;
        const ts = log.timestamp ? log.timestamp.slice(11, 19) : '??:??:??';
        html += `<div style="margin-bottom: 6px; padding: 4px; border-left: 2px solid #ef4444; background: rgba(239, 68, 68, 0.05);">
          <strong style="color: #ef4444;">[SW CRASH - ${ts}]</strong> ${log.message}<br>
          <small style="color: #64748b;">${log.filename || 'unknown'}:${log.lineno || 0}</small>
          ${log.stack ? `<pre style="font-size: 8px; color: #f87171; margin-top: 4px; overflow-x: auto; white-space: pre-wrap;">${log.stack}</pre>` : ''}
        </div>`;
      }

      if (data.contentCrashLogs && data.contentCrashLogs.length > 0) {
        data.contentCrashLogs.forEach(log => {
          const ts = log.timestamp ? log.timestamp.slice(11, 19) : '??:??:??';
          html += `<div style="margin-bottom: 6px; padding: 4px; border-left: 2px solid #f59e0b; background: rgba(245, 158, 11, 0.05);">
            <strong style="color: #f59e0b;">[${log.platform.toUpperCase()} CRASH - ${ts}]</strong> ${log.message}<br>
            <small style="color: #64748b;">${log.filename || 'unknown'}:${log.lineno || 0}</small>
            ${log.stack ? `<pre style="font-size: 8px; color: #fbbf24; margin-top: 4px; overflow-x: auto; white-space: pre-wrap;">${log.stack}</pre>` : ''}
          </div>`;
        });
      }

      if (!html) {
        crashLogContent.innerHTML = '<span style="color: #64748b;">No recent system crashes.</span>';
      } else {
        crashLogContent.innerHTML = html;
      }
    });
  }
}

// Render logs to terminal
function renderLogs(logs) {
  try {
    logsList.innerHTML = '';
    logs.forEach(log => {
      if (!log) return;
      const item = document.createElement('div');
      item.className = 'log-item';
      
      const time = document.createElement('span');
      time.className = 'log-time';
      const timestampStr = log.timestamp ? String(log.timestamp) : '';
      time.innerText = timestampStr ? `[${timestampStr.slice(11, 19)}] ` : '[??:??:??] ';
      
      const level = document.createElement('span');
      const levelStr = log.level ? String(log.level) : 'info';
      level.className = `log-level ${levelStr}`;
      level.innerText = `[${levelStr.toUpperCase()}] `;
      
      const platform = document.createElement('span');
      const platformStr = log.platform ? String(log.platform) : 'orchestrator';
      platform.className = 'log-platform';
      platform.innerText = `[${platformStr.toUpperCase()}] `;
      
      const msg = document.createElement('span');
      msg.className = 'log-msg';
      const eventStr = log.event ? String(log.event) : '';
      const detailStr = log.detail ? `: ${String(log.detail)}` : '';
      msg.innerText = eventStr + detailStr;
      
      item.appendChild(time);
      item.appendChild(level);
      item.appendChild(platform);
      item.appendChild(msg);
      
      logsList.appendChild(item);
    });
    
    // Auto scroll logs
    logsList.scrollTop = logsList.scrollHeight;
  } catch (err) {
    console.error('Error rendering logs:', err);
  }
}

// Render UI based on orchestrator state
function renderState(state) {
  if (!state || state.status === 'IDLE') {
    globalStatus.innerText = 'IDLE';
    globalStatus.className = 'status-badge';
    
    setupView.classList.remove('hidden');
    runningView.classList.add('hidden');
    resultsView.classList.add('hidden');
    return;
  }

  // Update Status Badge
  globalStatus.innerText = state.status;
  if (['DONE'].includes(state.status)) {
    globalStatus.className = 'status-badge done';
  } else if (['CANCELLED', 'FAILED'].includes(state.status)) {
    globalStatus.className = 'status-badge failed';
  } else {
    globalStatus.className = 'status-badge active';
  }

  const isRunning = ![ 'DONE', 'CANCELLED', 'FAILED' ].includes(state.status);

  if (isRunning) {
    setupView.classList.add('hidden');
    runningView.classList.remove('hidden');
    resultsView.classList.add('hidden');
    
    updateTimeline(state.status);
    updatePlatformBadges(state.platformStatus);
  } else {
    setupView.classList.add('hidden');
    runningView.classList.add('hidden');
    resultsView.classList.remove('hidden');
    
    // Render Results
    if (state.status === 'DONE') {
      synthesizedContent.innerHTML = parseMarkdown(state.synthesis || 'Synthesis empty');
      synthesisJudgeName.innerText = (state.synthesisPlatform || 'N/A').toUpperCase();
      synthesisSimilarity.innerText = state.similarity !== null ? state.similarity.toFixed(3) : 'N/A';
    } else if (state.status === 'CANCELLED') {
      synthesizedContent.innerText = 'Debate was cancelled by the user.';
      synthesisJudgeName.innerText = 'N/A';
      synthesisSimilarity.innerText = 'N/A';
    } else if (state.status === 'FAILED') {
      synthesizedContent.innerText = `Debate failed: ${state.error || 'Unknown error'}`;
      synthesisJudgeName.innerText = 'N/A';
      synthesisSimilarity.innerText = 'N/A';
    }

    // Populate Intermediate Responses
    populateIntermediateText('initial', state.answers.initial);
    populateIntermediateText('critique1', state.answers.critique1);
    populateIntermediateText('critique2', state.answers.critique2);
  }
}

// Populate intermediate results fields
function populateIntermediateText(roundName, answersMap) {
  const platforms = ['chatgpt', 'claude', 'gemini'];
  platforms.forEach(p => {
    const el = document.getElementById(`res-${roundName}-${p}`);
    if (el) {
      el.innerText = answersMap[p] || 'No response or skipped';
    }
  });
}

// Update Timeline step states
function updateTimeline(status) {
  const steps = [
    { el: stepBroadcast, active: ['BROADCASTING', 'WAITING', 'COLLECTING'], done: ['CRITIQUE', 'WAITING_CRITIQUE', 'COLLECTING_CRITIQUE', 'ROUND2', 'WAITING_ROUND2', 'COLLECTING_ROUND2', 'JUDGE_ANALYSIS', 'WAITING_JUDGE_ANALYSIS', 'COLLECTING_JUDGE_ANALYSIS', 'JUDGE_SYNTHESIS', 'WAITING_JUDGE_SYNTHESIS', 'COLLECTING_JUDGE_SYNTHESIS'] },
    { el: stepCritique, active: ['CRITIQUE', 'WAITING_CRITIQUE', 'COLLECTING_CRITIQUE'], done: ['ROUND2', 'WAITING_ROUND2', 'COLLECTING_ROUND2', 'JUDGE_ANALYSIS', 'WAITING_JUDGE_ANALYSIS', 'COLLECTING_JUDGE_ANALYSIS', 'JUDGE_SYNTHESIS', 'WAITING_JUDGE_SYNTHESIS', 'COLLECTING_JUDGE_SYNTHESIS'] },
    { el: stepRound2, active: ['ROUND2', 'WAITING_ROUND2', 'COLLECTING_ROUND2'], done: ['JUDGE_ANALYSIS', 'WAITING_JUDGE_ANALYSIS', 'COLLECTING_JUDGE_ANALYSIS', 'JUDGE_SYNTHESIS', 'WAITING_JUDGE_SYNTHESIS', 'COLLECTING_JUDGE_SYNTHESIS'] },
    { el: stepJudge, active: ['JUDGE_ANALYSIS', 'WAITING_JUDGE_ANALYSIS', 'COLLECTING_JUDGE_ANALYSIS', 'JUDGE_SYNTHESIS', 'WAITING_JUDGE_SYNTHESIS', 'COLLECTING_JUDGE_SYNTHESIS'], done: [] }
  ];

  steps.forEach(step => {
    step.el.classList.remove('active', 'completed');
    if (step.done.includes(status)) {
      step.el.classList.add('completed');
    } else if (step.active.includes(status)) {
      step.el.classList.add('active');
    }
  });
}

// Update running platforms indicators
function updatePlatformBadges(platformStatus) {
  const badges = {
    chatgpt: badgeChatgpt,
    claude: badgeClaude,
    gemini: badgeGemini
  };

  for (const [platform, badge] of Object.entries(badges)) {
    const statusText = badge.querySelector('.p-status');
    const dot = badge.querySelector('.p-dot');
    const status = platformStatus[platform] || 'PENDING';
    
    statusText.innerText = status;
    badge.className = `platform-badge ${status.toLowerCase()}`; // reset
    
    // Color dot and badge border by status
    if (status === 'RUNNING') {
      dot.style.backgroundColor = '#3b82f6';
      statusText.style.color = '#3b82f6';
    } else if (status === 'WAITING') {
      dot.style.backgroundColor = '#f59e0b';
      statusText.style.color = '#f59e0b';
    } else if (status === 'SUCCESS') {
      dot.style.backgroundColor = '#10b981';
      statusText.style.color = '#10b981';
    } else if (['FAILED', 'TIMEOUT'].includes(status)) {
      dot.style.backgroundColor = '#ef4444';
      statusText.style.color = '#ef4444';
    } else if (status === 'SKIPPED') {
      dot.style.backgroundColor = '#6b7280';
      statusText.style.color = '#6b7280';
    } else {
      dot.style.backgroundColor = '#64748b';
      statusText.style.color = '#64748b';
    }
  }
}

// Start debate trigger
function startDebate() {
  const question = questionInput.value.trim();
  if (!question) {
    alert('Please enter a question first.');
    return;
  }

  const platforms = [];
  if (platformChatgpt.checked) platforms.push('chatgpt');
  if (platformClaude.checked) platforms.push('claude');
  if (platformGemini.checked) platforms.push('gemini');

  if (platforms.length === 0) {
    alert('Please select at least one target platform.');
    return;
  }

  const config = {
    platforms: platforms,
    round2SimilarityThreshold: parseFloat(similarityThreshold.value) || 0.4,
    judgePlatform: judgeSelect.value
  };

  chrome.runtime.sendMessage({
    action: 'startDebate',
    question: question,
    config: config
  }, (response) => {
    if (response && response.success) {
      console.log('Debate launched successfully.');
    } else {
      alert('Error launching debate: ' + (response ? response.error : 'Unknown error'));
    }
  });
}

// Stop debate trigger
function stopDebate() {
  chrome.runtime.sendMessage({ action: 'stopDebate' }, (response) => {
    if (response && response.success) {
      console.log('Stop request sent.');
    }
  });
}

// Reset debate to setup view (completely resets locks, variables, and state)
function resetDebate() {
  chrome.runtime.sendMessage({ action: 'resetDebate' }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn('Error resetting debate:', chrome.runtime.lastError.message);
    }
    lastLogCount = 0;
    updatePopupState();
  });
}

// Clear logs
function clearLogs() {
  if (typeof DebateLogger !== 'undefined') {
    DebateLogger.clear().then(() => {
      lastLogCount = 0;
      logsList.innerHTML = '';
    });
  }
}

// Clear crash logs from storage
function clearCrashLogs() {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.remove(['lastCrashLog', 'contentCrashLogs'], () => {
      if (crashLogContent) {
        crashLogContent.innerHTML = '<span style="color: #64748b;">No recent system crashes.</span>';
      }
    });
  }
}

// Basic markdown to HTML parser for premium rendered synthesis layout
function parseMarkdown(text) {
  if (!text) return '';
  
  // Escape standard HTML tags
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
    
  // Headers
  html = html.replace(/^### (.*?)$/gm, '<h3 style="font-size: 13px; font-weight: 700; margin: 8px 0 4px 0; color: #f1f5f9;">$1</h3>');
  html = html.replace(/^## (.*?)$/gm, '<h2 style="font-size: 15px; font-weight: 700; margin: 12px 0 6px 0; color: #f8fafc; border-bottom: 1px solid #334155; padding-bottom: 2px;">$1</h2>');
  html = html.replace(/^# (.*?)$/gm, '<h1 style="font-size: 17px; font-weight: 800; margin: 16px 0 8px 0; color: #ffffff;">$1</h1>');
  
  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong style="color: #f1f5f9; font-weight: 600;">$1</strong>');
  
  // Italics
  html = html.replace(/\*(.*?)\*/g, '<em style="color: #cbd5e1; font-style: italic;">$1</em>');
  
  // Fenced code blocks
  html = html.replace(/```([\s\S]*?)```/g, '<pre style="background-color: #020617; border: 1px solid #1e293b; border-radius: 6px; padding: 8px; font-family: monospace; font-size: 9px; overflow-x: auto; color: #a7f3d0; margin: 6px 0;"><code style="font-family: inherit;">$1</code></pre>');
  
  // Inline code snippets
  html = html.replace(/`(.*?)`/g, '<code style="background-color: #1e293b; border: 1px solid #334155; border-radius: 4px; padding: 2px 4px; font-family: monospace; font-size: 9px; color: #f472b6;">$1</code>');
  
  // Bullet items
  html = html.replace(/^\- (.*?)$/gm, '<li style="margin-left: 12px; margin-bottom: 4px; color: #cbd5e1; list-style-type: disc;">$1</li>');
  html = html.replace(/^\* (.*?)$/gm, '<li style="margin-left: 12px; margin-bottom: 4px; color: #cbd5e1; list-style-type: disc;">$1</li>');
  
  // Convert newlines to HTML breaks
  html = html.replace(/\n/g, '<br>');
  
  return html;
}
