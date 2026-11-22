import {
  leaseKnown,
  wants,
  type Effect,
  type Machine,
} from "./terminalControlState.js";

function takeIfReady(machine: Machine): { machine: Machine; effects: Effect[] } {
  if (
    !wants(machine) ||
    machine.takeSent ||
    machine.lease === "controlled" ||
    !machine.ready ||
    !leaseKnown(machine) ||
    machine.lease === "acquiring"
  ) {
    return { machine, effects: [] };
  }
  return {
    machine: { ...machine, takeSent: true },
    effects: [{ kind: "take" }],
  };
}

function request(machine: Machine): { machine: Machine; effects: Effect[] } {
  if (machine.disposed || machine.lease === "controlled") {
    return { machine, effects: [] };
  }
  const next = { ...machine, autoTake: false, intent: "take" as const, takeSent: false };
  const taken = takeIfReady(next);
  return {
    machine: taken.machine,
    effects: [{ kind: "clearError" }, ...taken.effects, { kind: "render" }],
  };
}

function maybeAutoTake(machine: Machine): { machine: Machine; effects: Effect[] } {
  if (!machine.autoTake || !machine.ready || !leaseKnown(machine)) {
    return { machine, effects: [] };
  }
  if (machine.lease === "controlled") {
    return { machine: { ...machine, autoTake: false }, effects: [] };
  }
  if (machine.otherController) {
    return { machine: { ...machine, autoTake: false }, effects: [{ kind: "render" }] };
  }
  if (machine.lease === "acquiring") return { machine, effects: [] };
  return request({ ...machine, autoTake: false });
}

export function ready(machine: Machine): { machine: Machine; effects: Effect[] } {
  let next = { ...machine, ready: true };
  const effects: Effect[] = [];
  const auto = maybeAutoTake(next);
  next = auto.machine;
  effects.push(...auto.effects);
  const taken = takeIfReady(next);
  next = taken.machine;
  effects.push(...taken.effects, { kind: "render" });
  return { machine: next, effects };
}

function invalidatesInput(before: Machine, after: Machine): boolean {
  if (after.otherController && !before.otherController) return true;
  if (before.lease === after.lease || before.lease === "unknown") return false;
  if (before.lease === "controlled" || after.lease === "lost" || after.lease === "released") return true;
  return before.lease === "acquiring" && after.lease === "observing";
}

export function lease(
  machine: Machine,
  message: { state?: unknown; controlled?: unknown; controller?: unknown; viewers?: unknown },
): { machine: Machine; effects: Effect[] } {
  const previous = machine.lease;
  const state = typeof message.state === "string" ? (message.state as Machine["lease"]) : previous;
  let next = {
    ...machine,
    lease: state,
    otherController: message.controlled === true && message.controller !== true,
    viewers: typeof message.viewers === "number" ? message.viewers : machine.viewers,
  };
  const effects: Effect[] = [];
  if (invalidatesInput(machine, next)) {
    next = { ...next, intent: "none", takeSent: false, autoTake: false };
    effects.push({ kind: "discardInput", reason: "terminal control changed" });
  }
  if (state === "controlled") {
    const hadIntent = wants(next) || next.autoTake;
    next = { ...next, autoTake: false, intent: "none", takeSent: false };
    effects.push({ kind: "clearError" }, { kind: "flushInput" });
    if (next.stream === "live") effects.push({ kind: "fit" });
    if (hadIntent) effects.push({ kind: "focus" });
  } else if (state === "observing" || state === "lost" || (state === "released" && wants(next))) {
    if (wants(next) && !next.takeSent) {
      const taken = takeIfReady(next);
      next = taken.machine;
      effects.push(...taken.effects);
    } else if (next.autoTake) {
      const auto = maybeAutoTake(next);
      next = auto.machine;
      effects.push(...auto.effects);
    }
  }
  effects.push({ kind: "stdin", enabled: !next.disposed }, { kind: "render" });
  return { machine: next, effects };
}

export function controlError(machine: Machine, message: string): { machine: Machine; effects: Effect[] } {
  return {
    machine: { ...machine, autoTake: false, intent: "none", takeSent: false },
    effects: [{ kind: "discardInput", reason: message }, { kind: "showError", message }, { kind: "render" }],
  };
}

export function requestControl(machine: Machine): { machine: Machine; effects: Effect[] } {
  if (machine.disposed || machine.lease === "controlled") return { machine, effects: [] };
  if (machine.takeSent) return { machine: { ...machine, intent: "take" }, effects: [] };
  return request(machine);
}

export function release(machine: Machine): { machine: Machine; effects: Effect[] } {
  if (machine.disposed) return { machine, effects: [] };
  return {
    machine: {
      ...machine,
      autoTake: false,
      intent: "none",
      takeSent: false,
      lease: "released",
    },
    effects: [{ kind: "discardInput", reason: "terminal control was released" }, { kind: "release" }, { kind: "render" }],
  };
}
