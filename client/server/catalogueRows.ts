function id(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function terminalKey(value: unknown): string | null {
  return id((value as { address?: { terminal_id?: unknown } } | null)?.address?.terminal_id);
}

export function agentKey(value: unknown): string | null {
  return id(
    (value as { cursor?: { target?: { address?: { agent_id?: unknown } } } } | null)?.cursor
      ?.target?.address?.agent_id,
  );
}

/** Every agent observation identifies its execution and terminal runtime. */
export function hasAgentBinding(value: unknown): boolean {
  const row = value as { cursor?: { target?: { execution_id?: string } }; terminal?: { runtime_epoch?: string } } | null;
  return Boolean(agentKey(row) && id(row?.cursor?.target?.execution_id) &&
    terminalKey(row?.terminal) && id(row?.terminal?.runtime_epoch));
}

/** Previous rows outside the pages the observer could read. */
export function unobserved(previous: unknown[], rows: unknown[], keyOf: (row: unknown) => string | null): unknown[] {
  if (!previous.length) return [];
  const seen = new Set(rows.map(keyOf));
  return previous.filter((row) => {
    const key = keyOf(row);
    return key !== null && !seen.has(key);
  });
}
