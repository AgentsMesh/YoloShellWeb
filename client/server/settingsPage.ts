import { brand, documentPage } from "./document";

export const settingsPage = documentPage("Settings · Yolo Web", "settings", `
<main id="app" class="settings" hidden>
<header class="settings-header">${brand}<a href="/" class="icon">Back to workspace</a></header>
<div class="settings-body">
<h1>Settings</h1>
<section aria-labelledby="attention-heading">
<h2 id="attention-heading">Notifications</h2>
<label class="setting-row"><span><strong>Agent alerts</strong><small>Show an alert when an agent needs your input.</small></span><input id="notify" type="checkbox"></label>
<label class="setting-row"><span><strong>Quiet mode</strong><small>Pause alerts and the tab badge. Requests still appear in Needs you.</small></span><input id="quiet" type="checkbox"></label>
<p id="notify-status" class="note" role="status"></p>
</section>
<section aria-labelledby="hub-heading">
<h2 id="hub-heading">Hub and machines</h2>
<label class="setting-row"><span><strong>Default machine</strong><small>Used for new shells and agents when viewing all machines.</small></span><select id="default-machine" disabled><option>Entry machine</option></select></label>
<ul id="settings-machines"></ul><p id="machines-status" class="note" role="status">Connecting…</p>
</section>
<section aria-labelledby="access-heading">
<h2 id="access-heading">Access</h2>
<div class="setting-row"><span><strong>Lock this tab</strong><small>Require the access token to reconnect.</small></span><button id="lock" type="button" class="icon">Lock</button></div>
</section>
</div></main>`);
