(function() {
  function isElementVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      (rect.width > 0 || rect.height > 0 || el.getClientRects().length > 0)
    );
  }

  const SelectorResolver = {
    resolve: function(candidates, context = document) {
      if (!candidates || !Array.isArray(candidates)) return null;
      for (const selector of candidates) {
        try {
          const el = context.querySelector(selector);
          if (el && isElementVisible(el)) {
            return el;
          }
        } catch (e) {
          // Ignore invalid selector syntax errors
        }
      }
      return null;
    },

    resolveAll: function(candidates, context = document) {
      if (!candidates || !Array.isArray(candidates)) return [];
      for (const selector of candidates) {
        try {
          const elements = Array.from(context.querySelectorAll(selector)).filter(isElementVisible);
          if (elements.length > 0) {
            return elements;
          }
        } catch (e) {
          // Ignore
        }
      }
      return [];
    },

    // Semantic fallbacks for input
    resolveInput: function(candidates, context = document) {
      const el = this.resolve(candidates, context);
      if (el) return el;

      // Heuristic 1: Any contenteditable element
      const contentEditable = context.querySelector('[contenteditable="true"]');
      if (contentEditable && isElementVisible(contentEditable)) return contentEditable;

      // Heuristic 2: ProseMirror editor (commonly used by Claude / editors)
      const pm = context.querySelector('.ProseMirror');
      if (pm && isElementVisible(pm)) return pm;

      // Heuristic 3: Textareas with descriptive placeholders
      const textareas = context.querySelectorAll('textarea');
      for (const ta of textareas) {
        const placeholder = (ta.getAttribute('placeholder') || '').toLowerCase();
        if (
          isElementVisible(ta) &&
          (placeholder.includes('message') ||
           placeholder.includes('ask') ||
           placeholder.includes('chat') ||
           placeholder.includes('write') ||
           placeholder.includes('prompt'))
        ) {
          return ta;
        }
      }

      // Heuristic 4: First visible textarea or input type text
      const firstTa = context.querySelector('textarea');
      if (firstTa && isElementVisible(firstTa)) return firstTa;

      const firstInput = context.querySelector('input[type="text"]');
      if (firstInput && isElementVisible(firstInput)) return firstInput;

      return null;
    },

    // Semantic fallbacks for send button
    resolveSendButton: function(candidates, context = document) {
      const el = this.resolve(candidates, context);
      if (el) return el;

      // Negative labels — buttons with these words are NEVER a send button
      const NEGATIVE_LABELS = ['add', 'attach', 'file', 'upload', 'screenshot', 'plugin', 'search', 'connector', 'menu', 'setting', 'photo', 'image', 'project', 'skill', 'model'];
      
      function isSendCandidate(btn) {
        if (!isElementVisible(btn)) return false;
        const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
        const title = (btn.getAttribute('title') || '').toLowerCase();
        const textContent = (btn.textContent || '').trim().toLowerCase();
        const allText = ariaLabel + ' ' + title + ' ' + textContent;
        // Reject if any negative label matches
        for (const neg of NEGATIVE_LABELS) {
          if (allText.includes(neg)) return false;
        }
        return true;
      }

      // Heuristic 1: Button with send-like aria-label or title
      const buttons = context.querySelectorAll('button');
      for (const btn of buttons) {
        if (!isSendCandidate(btn)) continue;
        const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
        const title = (btn.getAttribute('title') || '').toLowerCase();
        if (
          ariaLabel.includes('send') ||
          ariaLabel.includes('submit') ||
          title.includes('send') ||
          title.includes('submit')
        ) {
          return btn;
        }
      }

      // Heuristic 2: LAST visible non-negative button inside form or fieldset
      const form = context.querySelector('form') || context.querySelector('fieldset');
      if (form) {
        const formButtons = Array.from(form.querySelectorAll('button')).filter(isSendCandidate);
        if (formButtons.length > 0) {
          return formButtons[formButtons.length - 1];
        }
      }

      return null;
    },

    // Semantic fallbacks for responses (usually containers)
    resolveResponseContainers: function(candidates, context = document) {
      const elements = this.resolveAll(candidates, context);
      if (elements.length > 0) return elements;

      // Heuristic 1: Elements with assistant role data attributes
      const assistantEl = context.querySelectorAll('[data-message-author-role="assistant"]');
      if (assistantEl.length > 0) return Array.from(assistantEl).filter(isElementVisible);

      // Heuristic 2: Streaming indicators (Claude uses data-is-streaming)
      const streamingEl = context.querySelectorAll('[data-is-streaming]');
      if (streamingEl.length > 0) return Array.from(streamingEl).filter(isElementVisible);

      // Heuristic 3: Common markdown/prose containers
      const markdownEl = context.querySelectorAll('.markdown, .prose, [class*="markdown"], [class*="prose"]');
      if (markdownEl.length > 0) return Array.from(markdownEl).filter(isElementVisible);

      // Heuristic 4: Elements with aria-label indicating AI response
      const ariaEls = context.querySelectorAll('[aria-label*="assistant" i], [aria-label*="claude" i], [aria-label*="response" i]');
      if (ariaEls.length > 0) return Array.from(ariaEls).filter(isElementVisible);

      // Heuristic 5: Any div containing substantial text that is NOT the input area
      // (last resort for platforms with unknown class names)
      const allDivs = context.querySelectorAll('div[class]');
      const candidates2 = [];
      for (const div of allDivs) {
        if (!isElementVisible(div)) continue;
        if (div.getAttribute('contenteditable')) continue;
        if (div.closest('[contenteditable]')) continue;
        const text = (div.innerText || '').trim();
        if (text.length > 50 && !div.querySelector('[contenteditable]')) {
          candidates2.push(div);
        }
      }
      // Filter to only include leaf-level text containers (no nested candidates)
      const leafContainers = candidates2.filter(div => {
        return !candidates2.some(other => other !== div && div.contains(other));
      });
      if (leafContainers.length > 0) return leafContainers;

      return [];
    },

    // Semantic fallbacks for stop button
    resolveStopButton: function(candidates, context = document) {
      const el = this.resolve(candidates, context);
      if (el) return el;

      const buttons = context.querySelectorAll('button');
      for (const btn of buttons) {
        if (!isElementVisible(btn)) continue;
        const label = (btn.getAttribute('aria-label') || '').toLowerCase();
        if (label.includes('stop') || label.includes('cancel') || label.includes('pause')) {
          return btn;
        }
      }
      return null;
    }
  };

  if (typeof self !== 'undefined') {
    self.SelectorResolver = SelectorResolver;
  }
})();
