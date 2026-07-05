(function() {
  // Capture content script runtime errors
  window.addEventListener('error', (event) => {
    try {
      const msg = event.message || '';
      
      // Filter out standard, harmless layout and cross-origin script warnings from the host webpage
      if (msg.includes('ResizeObserver') || msg === 'Script error.') {
        return; 
      }

      const logEntry = {
        platform: (window.location.hostname.includes('chatgpt') ? 'chatgpt' : 
                   window.location.hostname.includes('claude') ? 'claude' : 
                   window.location.hostname.includes('gemini') ? 'gemini' : 'unknown'),
        timestamp: new Date().toISOString(),
        message: msg || 'Unknown content script error',
        filename: event.filename || '',
        lineno: event.lineno || 0,
        stack: event.error ? event.error.stack : ''
      };
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['contentCrashLogs'], (data) => {
          const logs = data.contentCrashLogs || [];
          logs.push(logEntry);
          chrome.storage.local.set({ 'contentCrashLogs': logs.slice(-20) });
        });
      }
    } catch (e) {
      console.error('Failed to log content script error:', e);
    }
  });

  class BaseAdapter {
    constructor(platformName) {
      this.platformName = platformName;
      this.selectors = null;
      this.isCancelled = false;
    }

    setSelectors(selectors) {
      this.selectors = selectors;
    }

    getInput() {
      if (!this.selectors) return null;
      return self.SelectorResolver.resolveInput(this.selectors.input);
    }

    getSendButton() {
      if (!this.selectors) return null;
      return self.SelectorResolver.resolveSendButton(this.selectors.sendButton);
    }

    getResponseContainers() {
      if (!this.selectors) return [];
      return self.SelectorResolver.resolveResponseContainers(this.selectors.responseContainer);
    }

    getStopButton() {
      if (!this.selectors) return null;
      return self.SelectorResolver.resolveStopButton(this.selectors.stopButton);
    }

    async isReady() {
      const input = this.getInput();
      const sendBtn = this.getSendButton();
      return !!(input && sendBtn);
    }

    async isLoggedIn() {
      // Default heuristic: if we can find the input or we are not on a login path
      const path = window.location.pathname;
      if (path.includes('/login') || path.includes('/auth') || path.includes('/signin')) {
        return false;
      }
      // Check if we can find the input. If not, wait a bit. If still not, check for login buttons.
      const input = this.getInput();
      if (input) return true;

      const hasLoginText = document.body.innerText.includes('Sign in') || 
                           document.body.innerText.includes('Log in') || 
                           document.body.innerText.includes('Welcome back');
      return !hasLoginText;
    }

    async injectAndSend(text) {
      this.isCancelled = false;
      const input = this.getInput();
      if (!input) {
        throw new Error(`[${this.platformName}] Input element not found`);
      }

      // Focus and clear input
      input.focus();
      if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (input.getAttribute('contenteditable') === 'true') {
        try {
          input.focus();
          document.execCommand('selectAll', false, null);
          document.execCommand('delete', false, null);
        } catch (e) {
          input.innerHTML = '';
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }

      await new Promise(r => setTimeout(r, 100));

      // Inject text
      if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
        input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (input.getAttribute('contenteditable') === 'true') {
        try {
          // Standard contenteditable typing simulation via execCommand
          input.focus();
          document.execCommand('selectAll', false, null);
          document.execCommand('delete', false, null);
          
          const lines = text.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (i > 0) {
              document.execCommand('insertLineBreak', false);
            }
            if (lines[i]) {
              document.execCommand('insertText', false, lines[i]);
            }
          }
        } catch (execErr) {
          console.warn(`[${this.platformName}] execCommand failed, falling back to manual DOM append:`, execErr.message);
          // Fallback manual DOM assignment
          input.innerHTML = '';
          const lines = text.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (i > 0) {
              const br = document.createElement('br');
              input.appendChild(br);
            }
            const textNode = document.createTextNode(lines[i]);
            input.appendChild(textNode);
          }
        }
        
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }

      // Delay to let UI frameworks (ProseMirror, React) process input and enable send button
      await new Promise(r => setTimeout(r, 600));

      // Find the send button (with retry)
      let sendBtn = this.getSendButton();
      if (!sendBtn) {
        await new Promise(r => setTimeout(r, 500));
        sendBtn = this.getSendButton();
      }

      // Verify it's actually a send button before clicking
      let submitted = false;
      if (sendBtn) {
        const label = (sendBtn.getAttribute('aria-label') || '').toLowerCase();
        const testId = (sendBtn.getAttribute('data-testid') || '').toLowerCase();
        const isTrusted = label.includes('send') || label.includes('submit') || label.includes('prompt') || testId.includes('send');
        
        if (isTrusted) {
          sendBtn.focus();
          sendBtn.click();
          submitted = true;
          console.log(`[${this.platformName}] Send button clicked (verified via aria-label).`);
        } else {
          console.warn(`[${this.platformName}] Found button but aria-label "${label}" is not trusted. Using Enter key fallback.`);
        }
      }

      // Fallback: Submit via Enter keypress (works on Claude, ChatGPT, Gemini)
      if (!submitted) {
        console.log(`[${this.platformName}] Submitting via Enter key.`);
        input.focus();
        const eventInit = {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
          bubbles: true, cancelable: true, composed: true
        };
        input.dispatchEvent(new KeyboardEvent('keydown', eventInit));
        input.dispatchEvent(new KeyboardEvent('keypress', eventInit));
        input.dispatchEvent(new KeyboardEvent('keyup', eventInit));
      }
    }

    async isGenerating() {
      const stopBtn = this.getStopButton();
      return !!stopBtn;
    }

    async extractLatestResponse() {
      const containers = this.getResponseContainers();
      if (containers.length === 0) return '';
      const lastContainer = containers[containers.length - 1];
      return lastContainer.innerText || lastContainer.textContent || '';
    }

    async waitForCompletion(timeoutMs = 120000) {
      this.isCancelled = false;
      
      // Save baseline states to prevent early completion matching on old text
      const initialContainers = this.getResponseContainers();
      const initialCount = initialContainers.length;
      let initialText = '';
      if (initialCount > 0) {
        initialText = (initialContainers[initialCount - 1].innerText || '').trim();
      }

      return new Promise((resolve, reject) => {
        let mutationTimer = null;
        let stabilityTimer = null;
        let checkInterval = null;
        let observer = null;
        let cancelCheckInterval = null;

        // Visual visibility check helper to handle hidden elements in the DOM
        const isElementVisible = (el) => {
          if (!el) return false;
          return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        };

        const timeoutTimer = setTimeout(() => {
          cleanup();
          reject(new Error(`[${this.platformName}] Timeout waiting for response completion after ${timeoutMs}ms`));
        }, timeoutMs);

        const cleanup = () => {
          clearTimeout(timeoutTimer);
          if (mutationTimer) clearTimeout(mutationTimer);
          if (stabilityTimer) clearTimeout(stabilityTimer);
          if (checkInterval) clearInterval(checkInterval);
          if (cancelCheckInterval) clearInterval(cancelCheckInterval);
          if (observer) observer.disconnect();
        };

        // Listen for cancel signal
        cancelCheckInterval = setInterval(() => {
          if (this.isCancelled) {
            cleanup();
            reject(new Error(`[${this.platformName}] Generation cancelled`));
          }
        }, 100);

        let lastLength = 0;
        let lengthStableCount = 0;
        let lastMutationTime = Date.now();
        let generationStarted = false;
        const startDetectTime = Date.now();

        const checkAllSignals = async () => {
          const currentContainers = this.getResponseContainers();
          const currentCount = currentContainers.length;
          let currentText = '';
          if (currentCount > 0) {
            currentText = (currentContainers[currentCount - 1].innerText || '').trim();
          }

          const stopBtn = this.getStopButton();
          const stopBtnVisible = !!(stopBtn && isElementVisible(stopBtn));

          // Wait for generation to start
          if (!generationStarted) {
            const newContainerAdded = currentCount > initialCount;
            const contentChanged = currentCount === initialCount && currentText !== initialText && currentText.length > 0;

            if (newContainerAdded || contentChanged || stopBtnVisible) {
              generationStarted = true;
              lastMutationTime = Date.now();
              lengthStableCount = 0;
              lastLength = currentText.length;
              console.log(`[${this.platformName}] New generation has started.`);
            } else {
              // Startup check threshold: fallback if no start is detected within 8 seconds
              if (Date.now() - startDetectTime > 8000) {
                generationStarted = true;
                lastMutationTime = Date.now();
                console.log(`[${this.platformName}] Startup detection window expired. Processing completion signals.`);
              } else {
                return; // Keep waiting
              }
            }
          }

          // Evaluate completion signals
          const stopAbsent = !stopBtnVisible;
          const timeSinceLastMutation = Date.now() - lastMutationTime;
          const mutationIdle = timeSinceLastMutation >= 2000;
          const lengthStable = lengthStableCount >= 2;
          const hasNewContent = currentText.length > 0 && currentText !== initialText;

          // Primary completion: response text found, stop gone, mutations idle, length stable
          if (hasNewContent && stopAbsent && mutationIdle && lengthStable) {
            cleanup();
            resolve(currentText);
            return;
          }

          // Fallback completion: response containers not found (selectors mismatch),
          // but generation clearly finished (stop button gone, DOM quiet for 4+ seconds)
          const timeSinceStart = Date.now() - startDetectTime;
          if (!hasNewContent && stopAbsent && timeSinceLastMutation >= 4000 && timeSinceStart > 10000) {
            console.log(`[${this.platformName}] Fallback completion: containers not matched but generation appears done.`);
            cleanup();
            // Try to extract text from the page body as last resort
            const fallbackText = await this.extractLatestResponse();
            resolve(fallbackText || '[Response detected but could not extract text]');
            return;
          }
        };

        // Start observing DOM changes in the body
        observer = new MutationObserver(() => {
          lastMutationTime = Date.now();
          if (mutationTimer) clearTimeout(mutationTimer);
          mutationTimer = setTimeout(checkAllSignals, 1500);
        });

        observer.observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true
        });

        // Stability tick check
        checkInterval = setInterval(async () => {
          const currentContainers = this.getResponseContainers();
          const currentCount = currentContainers.length;
          let currentLength = 0;
          if (currentCount > 0) {
            currentLength = (currentContainers[currentCount - 1].innerText || '').trim().length;
          }
          
          if (currentLength > 0 && currentLength === lastLength) {
            lengthStableCount++;
          } else {
            lengthStableCount = 0;
          }
          lastLength = currentLength;

          checkAllSignals();
        }, 1000);

        // Initial check trigger
        mutationTimer = setTimeout(checkAllSignals, 1500);
      });
    }

    cancel() {
      this.isCancelled = true;
    }
  }

  if (typeof self !== 'undefined') {
    self.BaseAdapter = BaseAdapter;
  }
})();
