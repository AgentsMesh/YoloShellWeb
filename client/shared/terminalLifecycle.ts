export type TerminalPhase = { archived?: boolean; runtime?: { status?: string } | null };

export function finishedTerminal(terminal: TerminalPhase): boolean {
  const status = terminal.runtime?.status;
  return status === "exited" || status === "lost";
}

export function liveTerminal(terminal: TerminalPhase): boolean {
  if (terminal.archived) return false;
  const status = terminal.runtime?.status;
  return status === "starting" || status === "running" ||
    status === "output_blocked" || status === "finalizing";
}
