import { describe, expect, it, vi } from 'vitest';
import { createPageNavigation, webUrl } from '../page-navigation.js';

function fakeChrome() {
  const listeners = new Set();
  const tabs = new Map();
  return {
    listeners,
    tabs: {
      create: vi.fn(async (options) => { tabs.set(9, { id: 9, url: options.url, title: 'Partite', status: 'loading' }); return { id: 9 }; }),
      get: vi.fn(async (id) => tabs.get(id)),
      remove: vi.fn(async () => {}),
      onUpdated: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) },
      finish(id) { tabs.get(id).status = 'complete'; for (const fn of listeners) fn(id, { status: 'complete' }); },
    },
    scripting: { executeScript: vi.fn(async () => [{ result: [{ text: 'Partite', href: 'https://www.hattrick.org/Matches' }] }]) },
  };
}

describe('page navigation', () => {
  it('accepts only http(s) addresses', () => {
    expect(webUrl('https://www.hattrick.org/x')).toBe('https://www.hattrick.org/x');
    for (const bad of ['javascript:alert(1)', 'file:///C:/x', 'chrome://settings', 'data:text/html,x', 'nope', 42]) {
      expect(() => webUrl(bad)).toThrow();
    }
  });

  it('opens a background tab next to the opener and waits for the load', async () => {
    const chrome = fakeChrome();
    const navigation = createPageNavigation(chrome);
    const pending = navigation.create({ url: 'https://www.hattrick.org/Matches', openerTabId: 3 });
    await vi.waitFor(() => expect(chrome.listeners.size).toBe(1));
    chrome.tabs.finish(9);
    await expect(pending).resolves.toEqual({ id: 9, url: 'https://www.hattrick.org/Matches', title: 'Partite', status: 'complete' });
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://www.hattrick.org/Matches', active: false, openerTabId: 3 });
  });

  it('refuses unsafe addresses without opening a tab', async () => {
    const chrome = fakeChrome();
    await expect(createPageNavigation(chrome).create({ url: 'javascript:alert(1)' })).rejects.toThrow('Only http(s)');
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  it('closes only tabs it opened', async () => {
    const chrome = fakeChrome();
    const navigation = createPageNavigation(chrome, { loadTimeoutMs: 1 });
    await expect(navigation.close({ tabId: 3 })).rejects.toThrow('Only tabs opened');
    await navigation.create({ url: 'https://example.com' });
    await expect(navigation.close({ tabId: 9 })).resolves.toEqual({ closed: true });
    expect(chrome.tabs.remove).toHaveBeenCalledWith(9);
    await expect(navigation.close({ tabId: 9 })).rejects.toThrow('Only tabs opened');
  });

  it('lists the links of a page', async () => {
    const chrome = fakeChrome();
    await expect(createPageNavigation(chrome).links(3)).resolves.toEqual({ links: [{ text: 'Partite', href: 'https://www.hattrick.org/Matches' }] });
    expect(chrome.scripting.executeScript.mock.calls[0][0].target).toEqual({ tabId: 3 });
  });
});
