// Opening pages for an agent without disturbing the user: new background tabs only, http(s) only,
// and the agent may close only the tabs it opened itself.
const LOAD_TIMEOUT_MS = 20_000;

export function webUrl(value) {
  if (typeof value !== 'string') throw new Error('url must be an http(s) address');
  let url;
  try { url = new URL(value); } catch { throw new Error('url must be an http(s) address'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http(s) pages can be opened');
  return url.href;
}

function waitForLoad(chromeApi, tabId, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chromeApi.tabs.onUpdated?.removeListener(listener);
      resolve();
    };
    const listener = (id, info) => { if (id === tabId && info.status === 'complete') finish(); };
    const timer = setTimeout(finish, timeoutMs);
    chromeApi.tabs.onUpdated?.addListener(listener);
    // The page may already be complete before the listener was registered.
    chromeApi.tabs.get(tabId).then((tab) => { if (tab?.status === 'complete') finish(); }).catch(finish);
  });
}

export function createPageNavigation(chromeApi, { loadTimeoutMs = LOAD_TIMEOUT_MS } = {}) {
  const opened = new Set();

  return {
    async create(params) {
      const url = webUrl(params.url);
      const options = { url, active: false };
      if (typeof params.openerTabId === 'number') options.openerTabId = params.openerTabId;
      const created = await chromeApi.tabs.create(options);
      opened.add(created.id);
      await waitForLoad(chromeApi, created.id, loadTimeoutMs);
      const tab = await chromeApi.tabs.get(created.id);
      return { id: tab.id, url: tab.url, title: tab.title, status: tab.status };
    },
    async close(params) {
      if (!opened.has(params.tabId)) throw new Error('Only tabs opened with tabs.create can be closed');
      await chromeApi.tabs.remove(params.tabId);
      opened.delete(params.tabId);
      return { closed: true };
    },
    async links(tabId) {
      const [result] = await chromeApi.scripting.executeScript({
        target: { tabId },
        func: () => [...document.querySelectorAll('a[href]')]
          .map((a) => ({ text: (a.innerText || a.getAttribute('aria-label') || a.title || '').trim().replace(/\s+/g, ' ').slice(0, 120), href: a.href }))
          .filter((link) => /^https?:/.test(link.href))
          .slice(0, 500),
      });
      return { links: result.result };
    },
  };
}
