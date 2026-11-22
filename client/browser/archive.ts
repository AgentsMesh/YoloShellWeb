import { api } from "./api.js";
import {
  archiveHistoryNote,
  disposeArchiveTerminal,
  showArchiveStream,
  showArchiveTerminal,
} from "./archiveHistory.js";
import {
  archivePending,
  clearFinished,
  showFinished,
} from "./archiveFinished.js";
import { byId } from "./dom.js";
import { terminalContext, terminalTitle } from "./model.js";
import { row } from "./rows.js";
import { scope } from "./appSelectors.js";
import { getState } from "./store.js";
import type { Terminal } from "./types.js";

type Archived = Terminal & { finished?: boolean };
type Machine = { machine?: string; label?: string };
type Reply = {
  machines?: Machine[];
  terminals?: Archived[];
  unsupported?: { label?: string }[];
  truncated?: boolean;
  archived?: number;
  finished?: number;
};

let rows: Archived[] = [];
let revision = 0;
const labels = new Map<string, string>();

function note(text: string, kind = ""): void {
  const element = byId("archive-note");
  element.textContent = text;
  element.className = `note ${kind}`;
}

function label(machine?: string): string {
  return (machine ? labels.get(machine) : undefined) ?? "Machine";
}

function title(item: Archived): string {
  return terminalTitle(item);
}

function showList(): void {
  revision++;
  disposeArchiveTerminal();
  clearFinished();
  showArchiveTerminal(true);
  byId("archive-list").hidden = false;
  byId("archive-history").hidden = true;
  byId<HTMLButtonElement>("archive-back").hidden = true;
  archiveHistoryNote("");
}

function renderRows(): void {
  const list = byId("archive-list");
  list.replaceChildren();
  rows.forEach((item, index) => {
    list.append(
      row(
        "archive",
        String(index),
        item.address?.machine ?? "",
        title(item),
        `${label(item.address?.machine)} · ${terminalContext(item)}`,
        item.finished ? "F" : "A",
        item.finished
          ? { key: "exited", label: "ended" }
          : { key: "archived", label: "archived" },
        false,
      ),
    );
  });
}

async function openHistory(item: Archived): Promise<void> {
  const machine = item.address?.machine;
  const terminalId = item.address?.terminal_id;
  const runtimeEpoch = item.runtime?.target?.runtime_epoch;
  if (!machine || !terminalId || !runtimeEpoch) {
    note("This archived row has no retained runtime", "bad");
    return;
  }
  const request = ++revision;
  archiveHistoryNote("Loading history…");
  const query = new URLSearchParams({
    machine,
    terminal_id: terminalId,
    runtime_epoch: runtimeEpoch,
  });
  try {
    const history = await api.archiveHistory(query);
    if (request !== revision || !byId<HTMLDialogElement>("archive").open) return;
    byId("archive-list").hidden = true;
    byId("archive-history").hidden = false;
    byId<HTMLButtonElement>("archive-back").hidden = false;
    if (!showArchiveStream(history.data)) {
      note("Terminal emulator is unavailable", "bad");
      return;
    }
    const size =
      history.data.byteLength < 1024
        ? `${history.data.byteLength} B`
        : `${Math.round(history.data.byteLength / 1024)} KB`;
    archiveHistoryNote(
      `${title(item)} · ${label(machine)} · ${size}${
        history.truncated ? " · earlier output omitted" : ""
      }`,
    );
  } catch (error) {
    if (request !== revision) return;
    archiveHistoryNote("");
    note(error instanceof Error ? error.message : "Could not read the archive", "bad");
  }
}

async function openArchive(): Promise<void> {
  const dialog = byId<HTMLDialogElement>("archive");
  if (!dialog.open) dialog.showModal();
  rows = [];
  labels.clear();
  showList();
  renderRows();
  const request = revision;
  note("Loading session history…");
  try {
    const reply = (await api.archive(scope(getState()) ?? undefined)) as Reply;
    if (request !== revision || !dialog.open) return;
    rows = Array.isArray(reply.terminals) ? reply.terminals : [];
    for (const item of reply.machines ?? []) {
      if (item.machine) labels.set(item.machine, item.label ?? "Machine");
    }
    const unavailable = (reply.unsupported ?? [])
      .map((item) => item.label)
      .filter((value): value is string => Boolean(value));
    if (rows.length === 0 && unavailable.length) {
      note(`Archived history is unavailable on ${unavailable.join(", ")}`);
    } else {
      const parts = [
        reply.archived ? `${reply.archived} archived` : "",
        reply.finished ? `${reply.finished} finished` : "",
        reply.truncated ? "older rows omitted" : "",
        unavailable.length ? `history unavailable on ${unavailable.join(", ")}` : "",
      ].filter(Boolean);
      note(parts.length ? parts.join(" · ") : "No ended or archived sessions");
    }
  } catch (error) {
    if (request !== revision) return;
    note(error instanceof Error ? error.message : "Could not load the session history", "bad");
  }
  renderRows();
}

function closeArchive(): void {
  byId<HTMLDialogElement>("archive").close();
}

export function bindArchive(): void {
  byId("archive-open").addEventListener("click", () => void openArchive());
  byId("archive-close").addEventListener("click", closeArchive);
  byId("archive-back").addEventListener("click", showList);
  byId("archive-finish").addEventListener("click", () => void archivePending(async () => {
    if (byId<HTMLDialogElement>("archive").open) await openArchive();
  }));
  byId("archive-list").addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "button[data-kind=archive]",
    );
    if (!button) return;
    const item = rows[Number(button.dataset.id)];
    if (!item) return;
    revision++;
    if (item.finished) showFinished(item);
    else void openHistory(item);
  });
  byId<HTMLDialogElement>("archive").addEventListener("close", () => {
    if (byId<HTMLDialogElement>("archive").open) return;
    revision++;
    rows = [];
    labels.clear();
    byId("archive-list").replaceChildren();
    disposeArchiveTerminal();
    clearFinished();
  });
}
