// Background tool bridge: keeps the extension reachable by the local Pi bridge without the side
// panel. It only answers browser_tool_request messages; it never starts sessions or sends prompts,
// so the panel's chat session is untouched. Reconnects forever with a capped backoff.
export const KEEPALIVE_MS = 20_000; // below the 30 s idle limit of MV3 service workers

export function createToolBridge({
  WebSocketCtor = WebSocket,
  port = 43117,
  executeTool,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  setRepeat = setInterval,
  clearRepeat = clearInterval,
  minDelayMs = 1_000,
  maxDelayMs = 15_000,
} = {}) {
  let socket = null;
  let retryTimer = null;
  let keepalive = null;
  let delay = minDelayMs;

  function connected() {
    return socket !== null && socket.readyState === 1;
  }

  function scheduleRetry() {
    if (retryTimer !== null) return;
    retryTimer = setTimer(() => { retryTimer = null; connect(); }, delay);
    delay = Math.min(delay * 2, maxDelayMs);
  }

  function connect() {
    if (socket !== null && (socket.readyState === 0 || socket.readyState === 1)) return;
    if (retryTimer !== null) { clearTimer(retryTimer); retryTimer = null; }
    let current;
    try {
      current = new WebSocketCtor(`ws://127.0.0.1:${port}`);
    } catch {
      socket = null;
      scheduleRetry();
      return;
    }
    socket = current;
    current.addEventListener('open', () => {
      delay = minDelayMs;
      if (keepalive !== null) clearRepeat(keepalive);
      // Socket traffic keeps the service worker alive; the bridge answers unknown types with an error.
      keepalive = setRepeat(() => { if (socket === current && current.readyState === 1) current.send(JSON.stringify({ type: 'keepalive' })); }, KEEPALIVE_MS);
    });
    current.addEventListener('close', () => {
      if (socket !== current) return;
      socket = null;
      if (keepalive !== null) { clearRepeat(keepalive); keepalive = null; }
      scheduleRetry();
    });
    current.addEventListener('error', () => { /* close follows and schedules the retry */ });
    current.addEventListener('message', async (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (!message || message.type !== 'browser_tool_request' || typeof message.id !== 'string') return;
      let reply;
      try {
        reply = { id: message.id, type: 'browser_tool_response', success: true, data: await executeTool(message.tool, message.params ?? {}) };
      } catch (error) {
        reply = { id: message.id, type: 'browser_tool_response', success: false, error: error instanceof Error ? error.message : String(error) };
      }
      if (current.readyState === 1) current.send(JSON.stringify(reply));
    });
  }

  return { connect, connected };
}
