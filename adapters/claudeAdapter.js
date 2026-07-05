(function() {
  class ClaudeAdapter extends self.BaseAdapter {
    constructor() {
      super('claude');
    }

    async isLoggedIn() {
      if (window.location.pathname.includes('/login')) {
        return false;
      }
      return !!this.getInput();
    }
  }

  const adapter = new ClaudeAdapter();
  
  const url = chrome.runtime.getURL('config/selectors.json');
  const selectorsPromise = fetch(url)
     .then(r => r.json())
     .then(selectors => {
       adapter.setSelectors(selectors.claude);
       return selectors;
     })
     .catch(err => {
       console.error("Error setting up Claude selectors:", err);
       throw err;
     });
   
   chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
     if (request.action === 'ping') {
       if (adapter.selectors) {
         sendResponse({ success: true, result: 'pong' });
       } else {
         sendResponse({ success: false, error: 'Selectors not loaded yet' });
       }
       return false;
     }

     (async () => {
       try {
         await selectorsPromise;
         if (request.action === 'isReady') {
           const ready = await adapter.isReady();
           sendResponse({ success: true, result: ready });
         } else if (request.action === 'isLoggedIn') {
           const loggedIn = await adapter.isLoggedIn();
           sendResponse({ success: true, result: loggedIn });
         } else if (request.action === 'injectAndSend') {
           await adapter.injectAndSend(request.text);
           sendResponse({ success: true });
         } else if (request.action === 'isGenerating') {
           const gen = await adapter.isGenerating();
           sendResponse({ success: true, result: gen });
         } else if (request.action === 'waitForCompletion') {
           const text = await adapter.waitForCompletion(request.timeoutMs);
           sendResponse({ success: true, result: text });
         } else if (request.action === 'extractLatestResponse') {
           const text = await adapter.extractLatestResponse();
           sendResponse({ success: true, result: text });
         } else if (request.action === 'cancel') {
           adapter.cancel();
           sendResponse({ success: true });
         } else {
           sendResponse({ success: false, error: 'Unknown action: ' + request.action });
         }
       } catch (err) {
         sendResponse({ success: false, error: err.message });
       }
     })();
     return true;
   });
})();
