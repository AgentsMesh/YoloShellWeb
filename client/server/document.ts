export const brand = `<div class="brand"><span class="brand-mark" aria-hidden="true">Y</span><strong>Yolo <span>web</span></strong></div>`;

export function documentPage(title: string, module: "main" | "settings", content: string): string {
  const terminal = module === "main";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0d0b09">
<title>${title}</title>
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="stylesheet" href="/app.css">
${terminal ? '<link rel="stylesheet" href="/vendor/xterm.css">' : ""}
</head>
<body>
<div id="gate" class="gate">
<form id="gate-form" class="gate-card">
<div class="gate-mark" aria-hidden="true">Y</div>
<p class="eyebrow">Trusted plugin · local Hub</p>
<h1>Yolo <span>web</span></h1>
<p class="gate-copy">Interactive terminals and agent conversations.</p>
<label for="token">Access token</label>
<input id="token" type="password" autocomplete="off" spellcheck="false" placeholder="Paste the plugin token">
<button id="gate-submit" type="submit" disabled>Connect</button>
<p id="gate-message" class="note" role="status" aria-live="polite">Read the token from the plugin data directory.</p>
</form>
</div>
${content}
<noscript>Yolo Web needs JavaScript.</noscript>
${terminal ? '<script src="/vendor/xterm.js"></script><script src="/vendor/addon-fit.js"></script>' : ""}
<script type="module" src="/app/${module}.js"></script>
</body>
</html>`;
}
