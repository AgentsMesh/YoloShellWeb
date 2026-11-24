type Kind = "shell" | "agent";
type Probe = (destination: string) => Promise<{ lifecycle: boolean; agent_start: boolean } | null>;

export async function routeReady(kind: Kind, destination: string, probe?: Probe): Promise<boolean> {
  if (!probe) return true;
  const capabilities = await probe(destination);
  return !capabilities || (kind === "shell" ? capabilities.lifecycle : capabilities.agent_start);
}
