export type SessionLifecycleSnapshot = {
  key?: string | null;
  sessionKey?: string | null;
  status?: string | null;
  endedAt?: number | null;
  abortedLastRun?: boolean | null;
};

type ParsedAgentSessionKey = {
  agentId: string;
  requestSessionKey: string;
};

function parseAgentSessionKey(sessionKey: string): ParsedAgentSessionKey | null {
  const match = /^agent:([^:]+):(.+)$/.exec(sessionKey);
  if (!match) {
    return null;
  }

  return {
    agentId: match[1],
    requestSessionKey: match[2],
  };
}

function matchesAgentScope(agentId: string | null | undefined, parsed: ParsedAgentSessionKey) {
  return !agentId || parsed.agentId === agentId;
}

function matchesRequestSessionKeyAlias(params: {
  bareSessionKey: string;
  parsed: ParsedAgentSessionKey;
  agentId?: string | null;
}) {
  if (params.parsed.requestSessionKey !== params.bareSessionKey) {
    return false;
  }

  // Only the main agent should treat a bare `main` alias as equivalent to a
  // canonical agent-scoped main session key. For sub-agents, `main` refers to
  // the global main-agent session, not `agent:<subagent>:main`.
  if (params.bareSessionKey === "main" && params.parsed.requestSessionKey === "main") {
    return params.parsed.agentId === "main" && matchesAgentScope(params.agentId, params.parsed);
  }

  return matchesAgentScope(params.agentId, params.parsed);
}

export function sessionKeysMatch(params: {
  left?: string | null;
  right?: string | null;
  agentId?: string | null;
}) {
  const left = params.left?.trim() || "";
  const right = params.right?.trim() || "";
  if (!left || !right) {
    return false;
  }
  if (left === right) {
    return true;
  }

  const leftParsed = parseAgentSessionKey(left);
  const rightParsed = parseAgentSessionKey(right);

  if (leftParsed && rightParsed) {
    return leftParsed.agentId === rightParsed.agentId && leftParsed.requestSessionKey === rightParsed.requestSessionKey;
  }

  if (leftParsed && matchesRequestSessionKeyAlias({
    bareSessionKey: right,
    parsed: leftParsed,
    agentId: params.agentId,
  })) {
    return true;
  }

  if (rightParsed && matchesRequestSessionKeyAlias({
    bareSessionKey: left,
    parsed: rightParsed,
    agentId: params.agentId,
  })) {
    return true;
  }

  return false;
}

export function preferCanonicalSessionKey(params: {
  sessionKey?: string | null;
  matchedSessionKey?: string | null;
}) {
  return params.matchedSessionKey?.trim() || params.sessionKey?.trim() || "";
}

export function isTerminalSessionSnapshot(snapshot?: SessionLifecycleSnapshot | null) {
  if (!snapshot) {
    return false;
  }

  if (snapshot.abortedLastRun) {
    return true;
  }

  if (typeof snapshot.endedAt === "number" && Number.isFinite(snapshot.endedAt)) {
    return true;
  }

  return snapshot.status === "done" || snapshot.status === "error" || snapshot.status === "aborted";
}
