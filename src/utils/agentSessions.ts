export interface SessionInitAgent {
  id: string;
}

export function getAgentSessionInitIds(
  agents: SessionInitAgent[] | null | undefined,
): string[] {
  if (!agents || agents.length === 0) {
    return [];
  }

  return agents
    .map((agent) => agent.id)
    .filter((id) => id && id !== "main");
}
