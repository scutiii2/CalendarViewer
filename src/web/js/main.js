// Last page script: every file above has loaded, so the calendar can render and the saved state can load.
calendar.render();
placeSyncStrip();
initResponsiveUI();
restoreLocalSources();
restoreFeedCache();
renderSources();
calendar.refetchEvents();
// Learn whether the server shows Windows toasts before the first check, so no alert is announced twice.
refreshServerStatus().then(() => { runAlertCheck(false); scheduleAlertSync(); });
setInterval(refreshServerStatus, 30000);
loadFeeds();
