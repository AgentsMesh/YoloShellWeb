import { bindComposerFiles } from "./composerDraft.js";
import { bindActions, closeDrawer } from "./actions.js";
import { bindArchive } from "./archive.js";
import {
  filterChanged,
  notePendingAgent,
  scopeChanged,
} from "./catalogueController.js";
import { bindCreate } from "./create.js";
import { byId } from "./dom.js";
import { bindLifecycle } from "./lifecycle.js";
import {
  choose,
  chooseCreated,
  expireCreated,
  setLens,
} from "./selectionController.js";
import { bindTerminalLog } from "./terminalLog.js";

export function bind(handlers: {
  refresh: () => Promise<void>;
}): void {
  bindActions();
  bindComposerFiles();
  bindArchive();
  bindLifecycle();
  bindTerminalLog();
  bindCreate({
    refresh: handlers.refresh,
    created: chooseCreated,
    expired: expireCreated,
    started: (machine, terminalId, provider, name, cwd) =>
      notePendingAgent(machine, terminalId, provider, name, cwd),
  });
  byId("alerts").addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-id]");
    if (!target) return;
    target.closest(".alert")?.remove();
    choose(
      target.dataset.kind ?? "",
      target.dataset.id ?? "",
      false,
      target.dataset.machine,
    );
  });
  for (const id of ["needs-list", "agent-list", "terminal-list"]) {
    byId(id).addEventListener("click", (event) => {
      const target = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-id]");
      if (!target) return;
      choose(
        target.dataset.kind ?? "",
        target.dataset.id ?? "",
        false,
        target.dataset.machine,
      );
      if (target.dataset.lens === "terminal") setLens("terminal");
    });
  }
  byId("machine-list").addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-scope]");
    if (!target) return;
    scopeChanged(target.dataset.scope || null);
  });
  byId("lens-chat").addEventListener("click", () => setLens("chat"));
  byId("lens-terminal").addEventListener("click", () => setLens("terminal"));
  byId<HTMLInputElement>("filter").addEventListener("input", (event) => {
    filterChanged((event.target as HTMLInputElement).value);
  });
  byId("menu").addEventListener("click", () => {
    const open = document.body.classList.toggle("sidebar-open");
    byId("menu").setAttribute("aria-expanded", String(open));
  });
  byId("app").addEventListener("click", (event) => {
    if (!document.body.classList.contains("sidebar-open")) return;
    if ((event.target as HTMLElement).closest("#sidebar, #menu")) return;
    closeDrawer();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDrawer();
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      byId<HTMLInputElement>("filter").focus();
    }
  });
}
