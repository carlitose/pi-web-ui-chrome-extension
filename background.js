import { createToolExecutor } from './tool-executor.js';
import { createToolBridge } from './tool-bridge.js';

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ tabId: tab.id });
});

// Browser tools stay available while the side panel is closed. No automatic debugger attach:
// tools that need it attach on demand, exactly as in the panel.
const toolExecutor = createToolExecutor(chrome, { autoAttach: false });
const toolBridge = createToolBridge({ executeTool: (tool, params) => toolExecutor.execute(tool, params) });
toolBridge.connect();

// A suspended service worker loses its socket: the alarm wakes it and reconnects.
const RECONNECT_ALARM = 'pi-bridge-reconnect';
chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM) toolBridge.connect();
});
chrome.runtime.onStartup.addListener(() => toolBridge.connect());
