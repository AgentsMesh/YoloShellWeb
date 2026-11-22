import { hasToken, loadToken } from "./api.js";
import { bind } from "./events.js";
import { bindGate, showApp, showGate } from "./gate.js";
import { refresh, startSession } from "./sessionController.js";

function boot(): void {
  showApp();
  startSession();
}

bind({ refresh });
bindGate(boot);
loadToken();
if (hasToken()) boot();
else showGate();
