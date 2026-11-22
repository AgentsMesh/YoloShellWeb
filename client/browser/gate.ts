import { saveToken } from "./api.js";
import { byId } from "./dom.js";

export function showGate(message = "", kind = ""): void {
  byId("app").hidden = true;
  byId("gate").hidden = false;
  const note = byId("gate-message");
  note.textContent = message || "Read the token from the plugin data directory.";
  note.className = `note ${kind}`;
  byId<HTMLInputElement>("token").focus();
}

export function showApp(): void {
  byId("gate").hidden = true;
  byId("app").hidden = false;
}

export function bindGate(start: () => void): void {
  byId<HTMLFormElement>("gate-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const value = saveToken(byId<HTMLInputElement>("token").value);
    if (!value) {
      showGate("Enter the token from the plugin data directory.", "bad");
      return;
    }
    start();
  });
  // The gate markup paints before this module runs. Keep Connect disabled until
  // the submit handler exists so an early click cannot fall through to a native
  // form navigation and silently drop the token.
  byId<HTMLButtonElement>("gate-submit").disabled = false;
}
