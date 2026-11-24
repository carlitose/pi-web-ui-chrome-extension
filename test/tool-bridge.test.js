import { describe, expect, it, vi } from 'vitest';
import { createToolBridge, KEEPALIVE_MS } from '../tool-bridge.js';
import { createToolExecutor } from '../tool-executor.js';

function harness(executeTool = async () => ({ ok: true })) {
  const sockets = [];
  class FakeWebSocket {
    constructor(url) { this.url = url; this.readyState = 0; this.listeners = {}; this.sent = []; sockets.push(this); }
    addEventListener(name, handler) { this.listeners[name] = handler; }
    send(message) { this.sent.push(JSON.parse(message)); }
    open() { this.readyState = 1; this.listeners.open?.(); }
    drop() { this.readyState = 3; this.listeners.close?.({}); }
  }
  const timers = [];
  const repeats = [];
  const bridge = createToolBridge({
    WebSocketCtor: FakeWebSocket, executeTool,
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {},
    setRepeat: (fn, ms) => { repeats.push({ fn, ms }); return repeats.length; }, clearRepeat: () => {},
  });
  return { bridge, sockets, timers, repeats };
}

describe('createToolBridge', () => {
  it('connects to the loopback bridge and does not start a session', () => {
    const { bridge, sockets } = harness();
    bridge.connect();
    sockets[0].open();
    expect(sockets[0].url).toBe('ws://127.0.0.1:43117');
    expect(sockets[0].sent).toEqual([]);
    expect(bridge.connected()).toBe(true);
  });

  it('answers browser tool requests with the executor result or error', async () => {
    const executeTool = vi.fn(async (tool) => { if (tool === 'bad') throw new Error('nope'); return { tabs: [] }; });
    const { bridge, sockets } = harness(executeTool);
    bridge.connect();
    sockets[0].open();
    await sockets[0].listeners.message({ data: JSON.stringify({ id: 'a', type: 'browser_tool_request', tool: 'tabs.list', params: {} }) });
    await sockets[0].listeners.message({ data: JSON.stringify({ id: 'b', type: 'browser_tool_request', tool: 'bad', params: {} }) });
    await sockets[0].listeners.message({ data: JSON.stringify({ type: 'session_state' }) });
    expect(executeTool).toHaveBeenCalledWith('tabs.list', {});
    expect(sockets[0].sent).toEqual([
      { id: 'a', type: 'browser_tool_response', success: true, data: { tabs: [] } },
      { id: 'b', type: 'browser_tool_response', success: false, error: 'nope' },
    ]);
  });

  it('keeps retrying forever with a capped backoff and resets it after connecting', () => {
    const { bridge, sockets, timers } = harness();
    bridge.connect();
    for (let i = 0; i < 10; i++) { sockets.at(-1).drop(); timers.at(-1).fn(); }
    expect(sockets).toHaveLength(11);
    expect(timers.map((t) => t.ms)).toEqual([1000, 2000, 4000, 8000, 15000, 15000, 15000, 15000, 15000, 15000]);
    sockets.at(-1).open();
    sockets.at(-1).drop();
    expect(timers.at(-1).ms).toBe(1000);
  });

  it('does not open a second socket while one is connecting or open', () => {
    const { bridge, sockets } = harness();
    bridge.connect();
    bridge.connect();
    sockets[0].open();
    bridge.connect();
    expect(sockets).toHaveLength(1);
  });

  it('sends a keepalive below the service worker idle limit', () => {
    const { bridge, sockets, repeats } = harness();
    bridge.connect();
    sockets[0].open();
    expect(repeats[0].ms).toBe(KEEPALIVE_MS);
    expect(KEEPALIVE_MS).toBeLessThan(30_000);
    repeats[0].fn();
    expect(sockets[0].sent).toEqual([{ type: 'keepalive' }]);
  });
});

describe('createToolExecutor autoAttach: false', () => {
  it('registers no tab-activation auto-attach and does not attach on startup', async () => {
    const onActivated = vi.fn();
    const attach = vi.fn(async () => {});
    const chrome = {
      tabs: { query: vi.fn(async () => [{ id: 7 }]), get: vi.fn(async () => ({ id: 7, title: 't' })), onActivated: { addListener: onActivated } },
      debugger: { attach, detach: vi.fn(), sendCommand: vi.fn(), getTargets: vi.fn(async () => []), onDetach: { addListener: vi.fn() } },
    };
    createToolExecutor(chrome, { autoAttach: false, skipAttachEvents: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onActivated).not.toHaveBeenCalled();
    expect(attach).not.toHaveBeenCalled();
  });
});
