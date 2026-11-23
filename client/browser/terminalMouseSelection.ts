import type { Xterm } from "./terminalXterm.js";

type Cell = { column: number; row: number };
type SelectionPolicy = "modifier" | "agent";

/** Keep selection available when an interactive program has enabled mouse reporting. */
export function bindMouseSelection(term: Xterm, policy: SelectionPolicy = "modifier"): { dispose(): void } {
  const host = term.element;
  if (!host) return { dispose() {} };
  let start: Cell | null = null;
  let dragging = false;
  let deferredDown: MouseEvent | null = null;
  let replaying = false;

  const cell = (event: MouseEvent): Cell | null => {
    const rect = host.getBoundingClientRect();
    const columns = term.cols;
    const rows = term.rows;
    if (!columns || !rows || rect.width <= 0 || rect.height <= 0) return null;
    const column = Math.max(0, Math.min(columns - 1, Math.floor(((event.clientX - rect.left) / rect.width) * columns)));
    const row = Math.max(0, Math.min(rows - 1, Math.floor(((event.clientY - rect.top) / rect.height) * rows)));
    const viewportY = term.buffer?.active?.viewportY ?? 0;
    return { column, row: row + viewportY };
  };

  const force = (event: MouseEvent): boolean => {
    if (term.modes?.mouseTrackingMode === "none") return false;
    return policy === "agent" || event.shiftKey || event.altKey;
  };
  const replay = (event: MouseEvent, type: "mousedown" | "mouseup") => {
    const cloned = new MouseEvent(type, event);
    replaying = true;
    try { host.dispatchEvent(cloned); } finally { replaying = false; }
  };
  const down = (event: MouseEvent) => {
    if (replaying) return;
    if (event.button !== 0 || !force(event)) return;
    const point = cell(event);
    if (!point) return;
    if (policy === "agent") {
      event.preventDefault();
      event.stopImmediatePropagation();
      deferredDown = event;
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    start = point;
    dragging = true;
    host.setPointerCapture?.(event.pointerId);
  };
  const move = (event: MouseEvent) => {
    if (policy === "agent" && !dragging && deferredDown) {
      const dx = event.clientX - deferredDown.clientX;
      const dy = event.clientY - deferredDown.clientY;
      if (Math.hypot(dx, dy) < 3) return;
      const point = cell(deferredDown);
      if (!point) return;
      dragging = true;
      start = point;
      event.preventDefault();
      event.stopImmediatePropagation();
      host.setPointerCapture?.(deferredDown.pointerId);
      term.select(point.column, point.row, 1);
    }
    if (!dragging || !start) return;
    const point = cell(event);
    if (!point) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const width = term.cols;
    const begin = start.row * width + start.column;
    const end = point.row * width + point.column;
    term.select(Math.min(begin, end) % width, Math.floor(Math.min(begin, end) / width), Math.abs(end - begin) + 1);
  };
  const up = (event: MouseEvent) => {
    if (policy === "agent" && !dragging && deferredDown) {
      const downEvent = deferredDown;
      deferredDown = null;
      replay(downEvent, "mousedown");
      replay(event, "mouseup");
      return;
    }
    if (!dragging) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    dragging = false;
    start = null;
    deferredDown = null;
    try { host.releasePointerCapture?.(event.pointerId); } catch {}
  };
  host.addEventListener("mousedown", down, true);
  host.addEventListener("mousemove", move, true);
  host.addEventListener("mouseup", up, true);
  document.addEventListener("mousemove", move, true);
  document.addEventListener("mouseup", up, true);
  return { dispose() {
    host.removeEventListener("mousedown", down, true);
    host.removeEventListener("mousemove", move, true);
    host.removeEventListener("mouseup", up, true);
    document.removeEventListener("mousemove", move, true);
    document.removeEventListener("mouseup", up, true);
  } };
}
