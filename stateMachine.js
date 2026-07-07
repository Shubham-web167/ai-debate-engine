(function() {
  const STATES = {
    IDLE: 'IDLE',
    BROADCASTING: 'BROADCASTING',
    WAITING: 'WAITING',
    COLLECTING: 'COLLECTING',
    CRITIQUE: 'CRITIQUE',
    WAITING_CRITIQUE: 'WAITING_CRITIQUE',
    COLLECTING_CRITIQUE: 'COLLECTING_CRITIQUE',
    ROUND2: 'ROUND2',
    WAITING_ROUND2: 'WAITING_ROUND2',
    COLLECTING_ROUND2: 'COLLECTING_ROUND2',
    JUDGE_ANALYSIS: 'JUDGE_ANALYSIS',
    WAITING_JUDGE_ANALYSIS: 'WAITING_JUDGE_ANALYSIS',
    COLLECTING_JUDGE_ANALYSIS: 'COLLECTING_JUDGE_ANALYSIS',
    JUDGE_SYNTHESIS: 'JUDGE_SYNTHESIS',
    WAITING_JUDGE_SYNTHESIS: 'WAITING_JUDGE_SYNTHESIS',
    COLLECTING_JUDGE_SYNTHESIS: 'COLLECTING_JUDGE_SYNTHESIS',
    DONE: 'DONE',
    CANCELLED: 'CANCELLED',
    FAILED: 'FAILED'
  };

  const StateMachine = {
    STATES: STATES,

    createInitialState: function(question, config) {
      const selectedPlatforms = (config && config.platforms && config.platforms.length > 0) 
        ? config.platforms 
        : ['chatgpt', 'claude', 'gemini'];
      
      const platformStatus = {};
      selectedPlatforms.forEach(p => {
        platformStatus[p] = 'PENDING';
      });

      return {
        status: STATES.IDLE,
        question: question || '',
        config: {
          platforms: selectedPlatforms,
          round2SimilarityThreshold: (config && config.round2SimilarityThreshold !== undefined) 
            ? parseFloat(config.round2SimilarityThreshold) 
            : 0.4,
          judgePlatform: (config && config.judgePlatform) ? config.judgePlatform : 'longest'
        },
        tabs: {}, // platform -> tabId
        platformStatus: platformStatus, // platform -> 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'SKIPPED'
        answers: {
          initial: {},   // platform -> text
          critique1: {}, // platform -> text
          critique2: {}  // platform -> text
        },
        similarity: null,
        analysis: '',
        synthesis: '',
        synthesisPlatform: '',
        error: null,
        updatedAt: new Date().toISOString()
      };
    },

    transition: function(state, nextStatus, updates = {}) {
      if (!STATES[nextStatus]) {
        throw new Error(`Invalid target state: ${nextStatus}`);
      }

      // Perform clean copy of nested objects to prevent mutation side-effects
      const newState = JSON.parse(JSON.stringify(state));
      newState.status = nextStatus;
      newState.updatedAt = new Date().toISOString();

      // Apply updates
      for (const [key, value] of Object.entries(updates)) {
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          newState[key] = { ...newState[key], ...value };
        } else {
          newState[key] = value;
        }
      }

      return newState;
    }
  };

  if (typeof self !== 'undefined') {
    self.StateMachine = StateMachine;
  }
})();
