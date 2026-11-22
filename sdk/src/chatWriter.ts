import type { AttachmentTarget } from "./terminalAttachment";

export type ChatWriterOps = {
  observeLease(target: unknown, destination: string): Promise<unknown>;
  lease(request: unknown, destination: string): Promise<unknown>;
  release(grant: unknown, destination: string): Promise<unknown>;
};

/** Hold the origin writer for one fenced action. An uncertain action is never replayed here. */
export async function withChatWriter<T>(
  hub: ChatWriterOps, runtime: AttachmentTarget, act: (grant: unknown) => Promise<T>,
): Promise<T> {
  const destination = runtime.address.hub_id;
  const observed = await hub.observeLease(runtime, destination) as { lease?: { generation?: number } | null };
  const generation = observed.lease?.generation;
  const request = {
    request_id: crypto.randomUUID(), target: runtime,
    principal: { client_id: crypto.randomUUID(), controller_instance_id: crypto.randomUUID() },
    mode: typeof generation === "number" ? { mode: "take_control", observed_generation: generation } : { mode: "acquire" },
  };
  const { grant } = await hub.lease(request, destination) as { grant?: unknown };
  if (!grant) throw new Error("Writer lease is unavailable");
  try {
    return await act(grant);
  } finally {
    await hub.release(grant, destination).catch(() => undefined);
  }
}
