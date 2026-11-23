import { copySelection } from "./selectionClipboard.js";
import { bindMouseSelection } from "./terminalMouseSelection.js";
import { byId } from "./dom.js";
import { loadToken } from "./api.js";
import { bindTerminalFiles } from "./terminalFiles.js";
import { TerminalChrome } from "./terminalChrome.js";
import { TerminalControl } from "./terminalControl.js";
import { TerminalInputBinding } from "./terminalInputBinding.js";
import { reconnectDelay } from "./terminalReconnect.js";
import { TERMINAL_OPTIONS } from "./terminalTheme.js";
import { TerminalSockets, type TerminalTarget } from "./terminalSocket.js";
import type { TerminalOutputFrame } from "../shared/protocol.js";
import { FitCtor, TerminalCtor, observeTerminalSize, type Xterm } from "./terminalXterm.js";
import {
  begin,
  initial,
  isSeeding,
  seed,
  settleLive,
} from "./terminalStreamState.js";

export class TerminalView {
  private readonly host = byId("terminal-host");
  private readonly chrome = new TerminalChrome();
  private readonly control: TerminalControl;
  private readonly input: TerminalInputBinding;
  private readonly files = new AbortController();
  private term: Xterm | null = null;
  private fit: { fit(): void } | null = null;
  private sockets: TerminalSockets | null = null;
  private observer: { disconnect(): void } | null = null;
  private mouseSelection: { dispose(): void } | null = null;
  private disposed = false;
  private stream = initial();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly target: TerminalTarget,
    autoTake: boolean,
    private readonly stopped: (exited: boolean, message: string) => void,
    private readonly selectionPolicy: "modifier" | "agent" = "modifier",
  ) {
    this.control = new TerminalControl(
      {
        sendTake: () => this.sockets?.take(),
        sendRelease: () => this.sockets?.release(),
        sendInput: (data) => this.sockets?.input(data),
        setInputNotice: (text) => this.chrome.setInputNotice(text),
        setStdin: (enabled) => { if (this.term) this.term.options.disableStdin = !enabled; },
        setStatus: (text, active) => this.chrome.setStatus(text, active),
        showTake: (visible) => this.chrome.showTake(visible),
        showError: (message) => this.chrome.showError(message),
        clearError: () => this.chrome.clearError(),
        focus: () => this.term?.focus(),
        fit: () => this.fitNow(),
      },
      autoTake,
    );
    this.input = new TerminalInputBinding(this.control);
  }

  open(): void {
    if (!this.host || !TerminalCtor || !FitCtor) {
      this.stopped(false, "Terminal emulator is unavailable");
      return;
    }
    const term = new TerminalCtor({ ...TERMINAL_OPTIONS, cols: 80, rows: 24 }) as Xterm;
    const fit = new FitCtor();
    term.loadAddon(fit);
    term.open(this.host);
    this.term = term;
    this.fit = fit;
    this.input.attach(term);
    bindTerminalFiles(this.host, term, this.target, (source) => this.input.paste(term, source), this.files.signal);
    copySelection(term, () => this.chrome.showError("Use your browser’s Copy command for this selection."));
    this.mouseSelection = bindMouseSelection(term, this.selectionPolicy);
    term.onResize(({ cols, rows }) => {
      if (!this.control.controlled || isSeeding(this.stream)) return;
      this.chrome.setSize(`${cols}×${rows}`);
      this.sockets?.resize(cols, rows);
    });
    this.host.onclick = () => {
      if (term.getSelection()) return;
      term.focus();
      this.control.requestControl();
    };
    this.chrome.onTake(() => this.control.requestControl());
    this.observer = observeTerminalSize(this.host, () => {
      if (this.control.controlled && !isSeeding(this.stream)) this.fitNow();
    });
    this.openSockets();
  }

  takeControl(): void { this.term?.focus(); this.control.requestControl(); }

  /** Follow the owner's PTY size while this view is read-only. */
  reconcileSize(cols?: number, rows?: number): void {
    const term = this.term;
    if (this.disposed || isSeeding(this.stream) || this.control.controlled || !term) return;
    if (!cols || !rows || (term.cols === cols && term.rows === rows)) return;
    term.resize(cols, rows);
    this.chrome.setSize(`${cols}×${rows}`);
  }

  dispose(): void {
    this.disposed = true;
    this.files.abort();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.observer?.disconnect();
    this.observer = null;
    this.mouseSelection?.dispose();
    this.mouseSelection = null;
    this.sockets?.close();
    this.sockets = null;
    this.control.dispose();
    this.chrome.onTake(() => undefined);
    this.term?.dispose();
    this.term = null;
    if (this.host) this.host.onclick = null;
    this.host?.replaceChildren();
  }

  private openSockets(): void {
    const token = loadToken();
    if (!token) {
      this.stopped(false, "Terminal access token is unavailable");
      return;
    }
    this.stream = begin(this.stream);
    this.input.reset();
    this.control.resetConnection();
    this.sockets = new TerminalSockets(this.target, token, {
      outputText: (message) => this.onOutput(message),
      outputBytes: (data) => this.term?.write(data),
      controlText: (message) => this.control.control(message),
      closed: () => this.onClosed(),
    });
  }

  private onOutput(message: TerminalOutputFrame): void {
    if (message?.type === "ready" || message?.type === "reset") {
      this.stream = seed(this.stream);
      this.control.setStream(false, true);
      this.input.reset();
      this.term?.reset();
      if (message.type === "ready" && typeof message.cols === "number" && typeof message.rows === "number") {
        this.term?.resize(message.cols, message.rows);
        this.chrome.setSize(`${message.cols}×${message.rows}`);
      }
    } else if (message?.type === "live") {
      const generation = this.stream.generation;
      this.term?.write("", () => this.live(generation));

    } else if (message?.type === "exit") {
      this.stopped(true, "");
    } else if (message?.type === "unreachable") {
      this.stopped(false, "The machine is unreachable.");
    } else if (message?.type === "error") {
      this.stopped(false, message.message || "Terminal stream failed");
    }
  }

  private live(generation: number): void {
    if (this.disposed) return;
    const result = settleLive(this.stream, generation);
    if (!result.applied) return;
    this.stream = result.state;
    this.control.setStream(true, false);
    this.chrome.clearError();
    this.reconnectAttempts = 0;
  }

  private onClosed(): void {
    if (this.disposed) return;
    this.stream = begin(this.stream);
    this.control.resetConnection();
    this.chrome.setStatus("Reconnecting…");
    this.sockets?.close();
    if (this.reconnectTimer) return;
    const delay = reconnectDelay(this.reconnectAttempts++);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.disposed) return;
      this.openSockets();
    }, delay);
  }

  private fitNow(): void {
    if (this.disposed || !this.fit) return;
    try {
      this.fit.fit();
    } catch {
      // The pane may be hidden while the view is being disposed.
    }
  }
}
