import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { api } from "../browser/api";
import { selected } from "../browser/appSelectors";
import { bindComposerFiles, clearSent, hasFiles, preparePrompt, syncComposer } from "../browser/composerDraft";
import { dispatch, getState, resetStore } from "../browser/store";
import type { Agent } from "../browser/types";

class Control extends EventTarget {
  value = "";
  style = {};
  childElementCount = 0;
  replaceChildren(...items: unknown[]) { this.childElementCount = items.length; }
  setAttribute() {}
  focus() {}
}

let prompt: Control;
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
beforeEach(() => {
  prompt = new Control();
  const controls = new Map([["prompt", prompt], ["chat-add-file", new Control()], ["chat-files", new Control()]]);
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    getElementById: (id: string) => controls.get(id), createElement: () => new Control(),
  } });
  resetStore();
  syncComposer(null, false);
  bindComposerFiles();
});
afterEach(() => {
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
  else Reflect.deleteProperty(globalThis, "document");
});

function machine(machine: string, revision: number, freshness = "live", reachable = true) {
  return { machine, revision, freshness, reachable };
}
function agent(machine: string, execution_id = "e", runtime_epoch = "r"): Agent {
  return {
    cursor: { target: { address: { machine, agent_id: "a" }, execution_id } },
    terminal: { address: { machine, terminal_id: "t" }, runtime_epoch },
    lifecycle: { state: "running" }, reachability: "reachable", freshness: "current",
  };
}
function inventory(hubs: ReturnType<typeof machine>[], agents: Agent[]) {
  dispatch({ type: "catalogue/replace", inventory: {
    hubs: { hubs }, agents: { agents }, terminals: { terminals: [] },
  }, snapshot: undefined, at: 1 });
  syncComposer(selected(getState()), true);
}
function choose(machine: string) {
  dispatch({ type: "selection/choose", intent: { kind: "agent", id: "a", machine } });
  syncComposer(selected(getState()), true);
}
function type(text: string) {
  prompt.value = text;
  prompt.dispatchEvent(new Event("input"));
}
function pasteFile() {
  const files = [new File(["bytes"], "proof.txt")];
  prompt.dispatchEvent(Object.assign(new Event("paste"), { clipboardData: { files } }));
}

test("reselecting the same execution after peer rediscovery restores text and sends the pasted bytes", async () => {
  const peer = agent("remote"), home = agent("home");
  const entry = machine("home", 1);
  inventory([entry, machine("remote", 5)], [peer, home]);
  choose("remote");
  type("unsent message");
  pasteFile();
  inventory([entry], [home]);
  expect(selected(getState())).toBeNull();
  choose("home");
  inventory([entry, machine("remote", 0)], [home]);
  inventory([entry, machine("remote", 1, "unreachable", false)], [home]);
  inventory([entry, machine("remote", 2, "stale")], [home]);
  inventory([entry, machine("remote", 3)], [peer, home]);
  choose("remote");
  expect(prompt.value).toBe("unsent message");
  expect(hasFiles()).toBe(true);
  using upload = spyOn(api, "stageAttachment").mockImplementation(async (chunk: any) => {
    expect(chunk).toMatchObject({ machine: "remote", terminal_id: "t", runtime_epoch: "r", data: btoa("bytes") });
    return { upload_id: chunk.upload_id, next_offset: 5, path: "/staged/proof.txt" };
  });
  expect(await preparePrompt(prompt.value, () => {})).toEqual({ content: [
    { type: "text", text: "unsent message" }, { type: "resource_link", name: "proof.txt", uri: "file:///staged/proof.txt" },
  ] });
  expect(upload).toHaveBeenCalledTimes(1);
  clearSent({ kind: "agent", agent: peer });
});

test("a complete absence retires a background draft while another machine stays selected", () => {
  const remote = machine("remote", 1), home = machine("home", 1);
  const peer = agent("remote"), local = agent("home");
  inventory([remote, home], [peer, local]);
  choose("remote");
  type("old");
  pasteFile();
  choose("home");
  type("keep local");
  inventory([home, machine("remote", 2)], [local]);
  inventory([home, machine("remote", 3)], [local, peer]);
  expect(prompt.value).toBe("keep local");
  choose("remote");
  expect(prompt.value).toBe("");
  expect(hasFiles()).toBe(false);
  clearSent({ kind: "agent", agent: local });
});

test("a replacement runtime and a late receipt keep separate drafts", () => {
  const old = agent("remote");
  inventory([machine("remote", 1)], [old]);
  choose("remote");
  type("old");
  pasteFile();
  const current = agent("remote", "e", "new-runtime");
  inventory([machine("remote", 2)], [current]);
  expect(prompt.value).toBe("");
  expect(hasFiles()).toBe(false);
  type("new draft");
  clearSent({ kind: "agent", agent: old });
  expect(prompt.value).toBe("new draft");
  clearSent({ kind: "agent", agent: current });
});
