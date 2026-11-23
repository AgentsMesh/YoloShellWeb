import { expect, test } from "bun:test";
import { bindMouseSelection } from "../browser/terminalMouseSelection";

test("interactive terminal drag selects cells only with the explicit modifier", () => {
  const host = new EventTarget() as HTMLElement;
  Object.assign(host, { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 20 }) });
  const selected: unknown[] = [];
  const term = { element: host, cols: 10, rows: 2, modes: { mouseTrackingMode: "any" }, select: (...args: unknown[]) => selected.push(args) } as any;
  const binding = bindMouseSelection(term);
  const event = (type: string, init: Record<string, unknown>) => {
    const value = new Event(type, { bubbles: true, cancelable: true }) as Event & Record<string, unknown>;
    Object.assign(value, init);
    return value;
  };
  host.dispatchEvent(event("mousedown", { button: 0, clientX: 10, clientY: 5 }));
  expect(selected).toHaveLength(0);
  host.dispatchEvent(event("mousedown", { button: 0, shiftKey: true, clientX: 10, clientY: 5 }));
  host.dispatchEvent(event("mousemove", { buttons: 1, clientX: 80, clientY: 5 }));
  host.dispatchEvent(event("mouseup", { button: 0, clientX: 80, clientY: 5 }));
  expect(selected.length).toBeGreaterThanOrEqual(1);
  selected.length = 0;
  const agentBinding = bindMouseSelection({ ...term, modes: { mouseTrackingMode: "any" } } as any, "agent");
  host.dispatchEvent(event("mousedown", { button: 0, clientX: 10, clientY: 5 }));
  host.dispatchEvent(event("mousemove", { buttons: 1, clientX: 80, clientY: 5 }));
  host.dispatchEvent(event("mouseup", { button: 0, clientX: 80, clientY: 5 }));
  expect(selected.length).toBeGreaterThanOrEqual(2);
  agentBinding.dispose();
  binding.dispose();
});
