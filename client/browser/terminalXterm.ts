export type XtermKey = { key: string; domEvent: KeyboardEvent };

export type Xterm = {
  cols: number;
  rows: number;
  open(host: HTMLElement): void;
  dispose(): void;
  focus(): void;
  getSelection(): string;
  onSelectionChange(callback: () => void): { dispose(): void };
  paste(data: string): void;
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void;
  reset(): void;
  resize(cols: number, rows: number): void;
  write(data: string | Uint8Array, callback?: () => void): void;
  loadAddon(addon: unknown): void;
  onKey(callback: (key: XtermKey) => void): void;
  onData(callback: (data: string) => void): void;
  onBinary(callback: (data: string) => void): void;
  onResize(callback: (size: { cols: number; rows: number }) => void): void;
  options: { disableStdin?: boolean };
};

export const TerminalCtor = (globalThis as any).Terminal;
export const FitCtor = (globalThis as any).FitAddon?.FitAddon;

/** Fit after layout settles; fitting inside ResizeObserver can resize the observed host again. */
export function observeTerminalSize(host: HTMLElement, fit: () => void): { disconnect(): void } {
  let frame = 0;
  const observer = new ResizeObserver(() => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      fit();
    });
  });
  observer.observe(host);
  return { disconnect() { observer.disconnect(); cancelAnimationFrame(frame); } };
}
