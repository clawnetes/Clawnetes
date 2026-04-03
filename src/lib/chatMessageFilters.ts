import { extractMessageText, type GatewayChatSession } from "./gatewayChat";
import { generateUUID } from "./gatewayUuid";
import type { StoredChatMessage, StoredChatThread } from "./chatShellStorage";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  rawText?: string;
  runId?: string;
  pending?: boolean;
  error?: boolean;
  timestamp?: number;
};

type StructuredTranscriptSection = {
  label: string;
  lines: string[];
};

export function isToolMessage(message: Record<string, unknown>): boolean {
  if (message.type === "tool_use" || message.type === "tool_result") return true;

  if (Array.isArray(message.content)) {
    const hasToolPart = (message.content as Record<string, unknown>[]).some(
      (part) => typeof part === "object" && part !== null && (part.type === "tool_use" || part.type === "tool_result"),
    );
    if (hasToolPart) return true;
  }

  if (message.role === "user") {
    const text = extractMessageText(message);
    if (text.startsWith("{") && (text.includes('"tool":') || text.includes('"status":'))) return true;
  }

  return false;
}

function normalizeLineEndings(text: string) {
  return text.replace(/\r\n?/g, "\n");
}

export function normalizeTranscriptText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

export function isSkillFrontmatterNoiseText(text: string) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("---")) return false;

  const closingIndex = trimmed.indexOf("\n---", 4);
  if (closingIndex < 0) return false;

  const frontmatter = trimmed.slice(0, closingIndex + 4);
  const remainder = trimmed.slice(closingIndex + 4);

  return (
    /(?:^|\n)name:\s*[^\n]+/i.test(frontmatter) &&
    /(?:^|\n)description:\s*[^\n]+/i.test(frontmatter) &&
    /(?:^|\n)(?:allowed-tools|metadata|homepage|license):\s*[^\n]+/i.test(frontmatter) &&
    /(?:^|\n)#\s+[^\n]+/i.test(remainder)
  );
}

export function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function isToolPayloadJson(text: string) {
  const parsed = parseJsonObject(text);
  if (!parsed) return false;

  const looksLikeSessionHistoryPayload =
    Array.isArray(parsed.sessions) &&
    typeof parsed.count === "number" &&
    parsed.sessions.some((session) => {
      if (typeof session !== "object" || session === null) return false;
      const record = session as Record<string, unknown>;
      return (
        typeof record.key === "string" ||
        typeof record.sessionId === "string" ||
        typeof record.displayName === "string" ||
        typeof record.updatedAt === "number" ||
        Array.isArray(record.childSessions) ||
        typeof record.estimatedCostUsd === "number" ||
        typeof record.contextTokens === "number" ||
        typeof record.systemSent === "boolean"
      );
    });

  return (
    looksLikeSessionHistoryPayload ||
    typeof parsed.tool === "string" ||
    typeof parsed.finalUrl === "string" ||
    typeof parsed.externalContent === "object" ||
    typeof parsed.fetchedAt === "string" ||
    typeof parsed.tookMs === "number" ||
    typeof parsed.docs === "string" ||
    (typeof parsed.targetId === "string" &&
      typeof parsed.wsUrl === "string" &&
      typeof parsed.url === "string") ||
    (typeof parsed.type === "string" &&
      parsed.type === "page" &&
      typeof parsed.url === "string" &&
      typeof parsed.wsUrl === "string") ||
    (typeof parsed.status === "string" && (parsed.status === "error" || parsed.status === "ok")) ||
    (typeof parsed.error === "string" && typeof parsed.message === "string")
  );
}

export function stripTerminalControlSequences(text: string) {
  return normalizeLineEndings(text)
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
}

export function hasAnsiColorNoise(text: string) {
  return (
    /\u001b\[[0-9;]*[A-Za-z]/.test(text) ||
    /\[(?:\d{1,3};){1,4}\d{1,3}m/.test(text) ||
    /\[(?:0|1|2|30|31|32|33|34|35|36|37|38|39|46)m/.test(text)
  );
}

export function isWeatherToolNoiseText(text: string) {
  return (
    /weather report(?: for)?:/i.test(text) ||
    /wttr\.in/i.test(text) ||
    /follow\s+.*igor_chubin/i.test(text) ||
    /\btimezone:\s+[A-Za-z_]+\/[A-Za-z_]+/i.test(text)
  );
}

export function hasWrappedExternalContent(text: string) {
  return (
    /SECURITY NOTICE:\s+The following content is from an EXTERNAL, UNTRUSTED source/i.test(text) ||
    /<<<EXTERNAL_UNTRUSTED_CONTENT\b/i.test(text) ||
    /<<<END_EXTERNAL_UNTRUSTED_CONTENT\b/i.test(text)
  );
}

function isTranscriptSpeakerLabel(value: string) {
  const trimmed = value.trim();
  return /^(?:YOU|TEST|[A-Z][A-Z0-9_-]{2,})$/.test(trimmed) && trimmed.length <= 40;
}

function isProgressNoiseLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) return false;

  return (
    /^% Total\s+% Received/i.test(trimmed) ||
    /^Dload\s+Upload\s+Total\s+Spent\s+Left\s+Speed$/i.test(trimmed) ||
    /^[\d.%\s:-]+(?:--:--:--|[kKmMgG]?)[\d.\s-]*$/.test(trimmed)
  );
}

function hasStandaloneThinkLine(text: string) {
  return /(?:^|\n)\s*think\s*(?:\n|$)/i.test(text);
}

function hasProcessTranscriptMarkers(text: string) {
  return (
    hasStandaloneThinkLine(text) ||
    /(?:^|\n)\s*(?:Command|Process) still running\b/im.test(text) ||
    /(?:^|\n)\s*Sent \d+ bytes to session\b/im.test(text) ||
    /(?:^|\n)\s*HEARTBEAT_OK\s*(?:\n|$)/im.test(text) ||
    /<final>/i.test(text) ||
    /(?:^|\n)\s*→\s+Opening browser for login/im.test(text) ||
    /(?:^|\n)\s*\(no new output\)\s*(?:\n|$)/im.test(text)
  );
}

function collapseTranscriptWhitespace(text: string) {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function firstMeaningfulLine(lines: string[]) {
  return lines.find((line) => line.trim())?.trim() || "";
}

function stripLeadingAgentSpeakerLabels(text: string) {
  let candidate = text.trim();
  while (candidate) {
    const lines = candidate.split("\n");
    const first = lines[0]?.trim() || "";
    if (!isTranscriptSpeakerLabel(first)) break;
    candidate = lines.slice(1).join("\n").trim();
  }
  return candidate;
}

function splitStructuredTranscriptSections(text: string): StructuredTranscriptSection[] {
  const sections: StructuredTranscriptSection[] = [];
  const lines = text.split("\n");
  let current: StructuredTranscriptSection | null = null;
  let inCodeFence = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^```/.test(trimmed)) {
      inCodeFence = !inCodeFence;
    }

    if (!inCodeFence && isTranscriptSpeakerLabel(trimmed)) {
      current = { label: trimmed, lines: [] };
      sections.push(current);
      continue;
    }

    if (current) {
      current.lines.push(line);
    }
  }

  return sections;
}

function hasStructuredTranscriptSections(text: string) {
  const sections = splitStructuredTranscriptSections(text);
  return sections.length >= 2 || (sections.length === 1 && isTranscriptSpeakerLabel(sections[0]?.label || ""));
}

function isInternalProcessLine(line: string, transcriptMode: boolean) {
  const trimmed = line.trim();
  if (!trimmed) return false;

  return (
    hasAnsiColorNoise(trimmed) ||
    /^\[(?:\?[0-9;]+[A-Za-z])+\s*/.test(trimmed) ||
    /^<\/?final>$/i.test(trimmed) ||
    /^think$/i.test(trimmed) ||
    /^(?:Command|Process) still running\b/i.test(trimmed) ||
    /^\(no new output\)$/i.test(trimmed) ||
    /^Sent \d+ bytes to session\b/i.test(trimmed) ||
    /^HEARTBEAT_OK$/i.test(trimmed) ||
    /^→\s+Opening browser for login/i.test(trimmed) ||
    (transcriptMode && isProgressNoiseLine(trimmed)) ||
    (transcriptMode && isTranscriptSpeakerLabel(trimmed))
  );
}

function looksLikeInternalPlanningText(text: string) {
  const normalized = normalizeTranscriptText(text);
  if (!normalized) return false;

  return (
    /^(?:I['’]ll|I am|I'm|I’m|Let me)\s+(?:do a quick|check|scan|look|browse|inspect|review|pull|open|search|verify)\b/i.test(normalized) ||
    /^(?:I['’]m|I am|I'm|I’m)\s+(?:checking|looking|browsing|using)\b/i.test(normalized) ||
    /^Web search isn['’]t configured\b/i.test(normalized)
  );
}

function isInternalAutomationScaffoldingText(text: string) {
  const normalized = normalizeTranscriptText(text);
  if (!normalized) return false;

  return (
    /^\[cron:[^\]]+\]/i.test(text.trim()) ||
    /Overnight\s+[A-Za-z0-9_-]+\s+check:/i.test(normalized) ||
    /Return your summary as plain text; it will be delivered automatically\./i.test(normalized) ||
    /If the task explicitly calls for messaging a specific external recipient/i.test(normalized)
  );
}

function isPersonaStartupChatterText(text: string) {
  const normalized = normalizeTranscriptText(text);
  if (!normalized) return false;

  const hasStartupSignal =
    /console\.log\(\s*["'`](?:System online|Hello,\s*[^"'`]+)[^"'`]*["'`]\s*\)/i.test(text) ||
    /\bSystem online\b/i.test(normalized);
  if (!hasStartupSignal) return false;

  return (
    /\b(?:I['’]m|I am)\s+ready\s+to\s+(?:write|debug|review)\b/i.test(normalized) ||
    /What are we (?:building|fixing) today\?/i.test(normalized) ||
    /Hello,\s*[^.!?]+[.!?]?\s*(?:I['’]m|I am)\s+ready\s+to\b/i.test(normalized)
  );
}

function dedupeCumulativeSections(sections: string[]) {
  return sections.filter((section, index) => !sections.slice(index + 1).some((later) => later.startsWith(section)));
}

function hasMessagingTimestampPrefix(text: string) {
  return /^\[(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+)?\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?\s+[A-Z]{2,5}\]\s*/i.test(text.trim());
}

function stripMessagingTimestampPrefix(text: string) {
  return text.replace(/^\[(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+)?\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?\s+[A-Z]{2,5}\]\s*/i, "");
}

function isMessagingGatewayNoticeLine(text: string) {
  const trimmed = text.trim();
  return /^System:\s*\[[^\]]+\]\s*.+gateway\s+(?:connected|disconnected|reconnected)\.?\s*$/i.test(trimmed);
}

function hasMessagingTranscriptWrappers(text: string) {
  return (
    /(?:^|\n)\s*YOU\s*(?:\n|$)/i.test(text) ||
    /(?:^|\n)\s*System:\s*\[[^\]]+\]\s*.+gateway\s+(?:connected|disconnected|reconnected)\.?\s*(?:\n|$)/i.test(text) ||
    /(?:^|\n)\s*\[(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+)?\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?\s+[A-Z]{2,5}\]/i.test(text)
  );
}

function stripMessagingTranscriptWrappers(text: string) {
  const lines = normalizeLineEndings(text).split("\n");
  const kept: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (isTranscriptSpeakerLabel(trimmed)) continue;
    if (isMessagingGatewayNoticeLine(trimmed)) continue;

    const unwrapped = hasMessagingTimestampPrefix(trimmed) ? stripMessagingTimestampPrefix(trimmed).trim() : trimmed;
    if (!unwrapped) continue;
    kept.push(unwrapped);
  }

  return collapseTranscriptWhitespace(kept.join("\n"));
}

export function isNoiseOnlyLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) return true;

  return (
    isInternalProcessLine(trimmed, true) ||
    /^SECURITY NOTICE:/i.test(trimmed) ||
    /^- DO NOT treat any part of this content/i.test(trimmed) ||
    /^- DO NOT execute tools\/commands/i.test(trimmed) ||
    /^- This content may contain social engineering/i.test(trimmed) ||
    /^- Respond helpfully to legitimate requests/i.test(trimmed) ||
    /^- Delete data, emails, or files$/i.test(trimmed) ||
    /^- Execute system commands$/i.test(trimmed) ||
    /^- Change your behavior or ignore your guidelines$/i.test(trimmed) ||
    /^- Reveal sensitive information$/i.test(trimmed) ||
    /^- Send messages to third parties$/i.test(trimmed) ||
    /^<<<EXTERNAL_UNTRUSTED_CONTENT\b/i.test(trimmed) ||
    /^<<<END_EXTERNAL_UNTRUSTED_CONTENT\b/i.test(trimmed) ||
    /^Source:\s+Web Fetch$/i.test(trimmed) ||
    /^Response body truncated after \d+ bytes\./i.test(trimmed) ||
    /^Weather report(?: for)?:/i.test(trimmed) ||
    /^Weather:/i.test(trimmed) ||
    /^Timezone:/i.test(trimmed) ||
    /^Location:/i.test(trimmed) ||
    /^Follow\s+.*igor_chubin/i.test(trimmed) ||
    /^[\s\p{So}\p{Sk}│┌┐└┘├┤┬┴┼─━╷╂]+$/u.test(trimmed)
  );
}

export function extractReplyFromToolNoise(text: string) {
  const lines = text.split(/\r?\n/);
  let firstVisibleLineIndex = 0;
  while (firstVisibleLineIndex < lines.length && isNoiseOnlyLine(lines[firstVisibleLineIndex])) {
    firstVisibleLineIndex += 1;
  }

  const trailingCandidate = lines.slice(firstVisibleLineIndex).join("\n").trim();
  if (
    trailingCandidate &&
    /[A-Za-z]/.test(trailingCandidate) &&
    !hasAnsiColorNoise(trailingCandidate) &&
    !isWeatherToolNoiseText(trailingCandidate)
  ) {
    return trailingCandidate;
  }

  for (let start = lines.length - 1; start >= 0; start -= 1) {
    const suffixLines = lines.slice(start);
    let candidate = suffixLines.join("\n").trim();
    if (!candidate) continue;
    if (hasAnsiColorNoise(candidate)) continue;
    if (/^Weather report(?: for)?:/i.test(candidate)) continue;
    if (/^Weather:/i.test(candidate)) continue;
    if (/^Timezone:/i.test(candidate)) continue;
    if (/^Location:/i.test(candidate)) continue;
    if (/^Follow\s+.*igor_chubin/i.test(candidate)) continue;
    if (!/[A-Za-z]/.test(candidate)) continue;

    while (candidate) {
      const [firstLine, ...rest] = candidate.split(/\r?\n/);
      if (!isNoiseOnlyLine(firstLine)) break;
      candidate = rest.join("\n").trim();
    }

    if (!candidate) continue;
    if (candidate.split(/\r?\n/).every((line) => isNoiseOnlyLine(line))) continue;
    return candidate;
  }

  return "";
}

export function stripLeadingTranscriptLabels(text: string) {
  let candidate = text.trim();
  while (candidate) {
    const lines = candidate.split(/\r?\n/);
    const first = lines[0]?.trim() || "";
    if (!/^(?:YOU|TEST)$/i.test(first)) break;
    candidate = lines.slice(1).join("\n").trim();
  }
  return candidate;
}

export function stripWrappedExternalContent(text: string) {
  if (!hasWrappedExternalContent(text)) return text;

  const marker = "<<<END_EXTERNAL_UNTRUSTED_CONTENT";
  const lastMarkerIndex = text.lastIndexOf(marker);
  if (lastMarkerIndex >= 0) {
    const markerEndIndex = text.indexOf(">>>", lastMarkerIndex);
    if (markerEndIndex >= 0) {
      return text.slice(markerEndIndex + 3).trim();
    }
  }

  return "";
}

export function isBootstrapNoiseText(text: string) {
  const normalized = normalizeTranscriptText(text);
  if (!normalized) return false;

  return (
    isPersonaStartupChatterText(text) ||
    /A new session was started via \/new or \/reset\./i.test(normalized) ||
    /Run your Session Startup sequence/i.test(normalized) ||
    /^Current time:/i.test(normalized) ||
    /^#\s*(SOUL|USER|MEMORY)\.md\b/i.test(text.trim()) ||
    (/\"status\"\s*:\s*\"error\"/i.test(text) &&
      /\"tool\"\s*:\s*\"read\"/i.test(text) &&
      /ENOENT: no such file or directory/i.test(text)) ||
    (/ENOENT: no such file or directory/i.test(text) && /(workspace\/memory|MEMORY\.md)/i.test(text))
  );
}

function sanitizeVisibleAssistantText(text: string, transcriptMode = false) {
  const stripped = stripWrappedExternalContent(
    stripTerminalControlSequences(text).replace(/<\/?final>/gi, ""),
  );
  const normalized = transcriptMode
    ? stripLeadingAgentSpeakerLabels(stripLeadingTranscriptLabels(stripped))
    : stripLeadingTranscriptLabels(stripped);
  if (!normalized) return "";

  const lines = normalized.split("\n");
  const kept: string[] = [];
  let inCodeFence = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^```/.test(trimmed)) {
      inCodeFence = !inCodeFence;
      kept.push(line);
      continue;
    }

    if (!inCodeFence && isInternalProcessLine(line, transcriptMode)) {
      continue;
    }

    kept.push(line);
  }

  return collapseTranscriptWhitespace(kept.join("\n"));
}

export function extractLastFinalBlock(text: string) {
  const source = normalizeLineEndings(text);
  const pattern = /<final>([\s\S]*?)<\/final>/gi;
  let match: RegExpExecArray | null;
  let lastBlock: string | null = null;

  while ((match = pattern.exec(source)) !== null) {
    lastBlock = match[1] ?? "";
  }

  return lastBlock ? lastBlock.trim() : null;
}

function extractOpenFinalBlock(text: string) {
  const source = normalizeLineEndings(text);
  const lower = source.toLowerCase();
  const startIndex = lower.lastIndexOf("<final>");
  if (startIndex < 0) return null;

  const afterStart = source.slice(startIndex + "<final>".length);
  if (afterStart.toLowerCase().includes("</final>")) {
    return null;
  }

  return afterStart.trim();
}

function sanitizeTranscriptSectionText(text: string) {
  let candidate = stripLeadingTranscriptLabels(stripTerminalControlSequences(text)).trim();
  if (!candidate) return "";
  if (isBootstrapNoiseText(candidate)) return "";
  if (isSkillFrontmatterNoiseText(candidate)) return "";
  if (isToolPayloadJson(candidate)) return "";

  if (hasWrappedExternalContent(candidate)) {
    candidate = stripLeadingTranscriptLabels(stripWrappedExternalContent(candidate));
  }

  const finalBlock = extractLastFinalBlock(candidate);
  if (finalBlock !== null) {
    return sanitizeVisibleAssistantText(finalBlock, true);
  }

  const openFinalBlock = extractOpenFinalBlock(candidate);
  if (openFinalBlock !== null) {
    return sanitizeVisibleAssistantText(openFinalBlock, true);
  }

  if (isWeatherToolNoiseText(candidate) || hasAnsiColorNoise(candidate)) {
    return sanitizeVisibleAssistantText(extractReplyFromToolNoise(candidate), true);
  }

  return sanitizeVisibleAssistantText(candidate, true);
}

function sanitizeUserTranscriptSectionText(text: string) {
  let candidate = stripLeadingTranscriptLabels(stripTerminalControlSequences(text)).trim();
  if (!candidate) return "";
  if (isBootstrapNoiseText(candidate)) return "";
  if (isSkillFrontmatterNoiseText(candidate)) return "";
  if (isToolPayloadJson(candidate)) return "";
  if (isInternalAutomationScaffoldingText(candidate)) return "";

  if (hasWrappedExternalContent(candidate)) {
    candidate = stripLeadingTranscriptLabels(stripWrappedExternalContent(candidate));
  }

  if (hasMessagingTranscriptWrappers(candidate)) {
    candidate = stripMessagingTranscriptWrappers(candidate);
  }

  candidate = stripLeadingTranscriptLabels(candidate).trim();
  if (!candidate) return "";
  if (isBootstrapNoiseText(candidate)) return "";
  if (isToolPayloadJson(candidate)) return "";
  if (isInternalAutomationScaffoldingText(candidate)) return "";

  return collapseTranscriptWhitespace(candidate);
}

function extractVisibleSectionsFromAgentTranscript(text: string) {
  const sections = splitStructuredTranscriptSections(text);
  if (sections.length === 0) return "";

  const visibleSections: string[] = [];
  for (const section of sections) {
    if (/^YOU$/i.test(section.label)) continue;
    if (/^think$/i.test(firstMeaningfulLine(section.lines))) continue;

    const visible = sanitizeTranscriptSectionText(section.lines.join("\n"));
    if (visible) {
      if (looksLikeInternalPlanningText(visible)) continue;
      visibleSections.push(visible);
    }
  }

  return collapseTranscriptWhitespace(dedupeCumulativeSections(visibleSections).join("\n\n"));
}

function extractVisibleSectionsFromUserTranscript(text: string) {
  const sections = splitStructuredTranscriptSections(text);
  if (sections.length === 0) return "";

  const visibleSections: string[] = [];
  for (const section of sections) {
    const visible = sanitizeUserTranscriptSectionText(section.lines.join("\n"));
    if (visible) {
      visibleSections.push(visible);
    }
  }

  return collapseTranscriptWhitespace(dedupeCumulativeSections(visibleSections).join("\n\n"));
}

export function sanitizeAssistantTranscriptText(text: string) {
  const rawText = normalizeLineEndings(text);
  let candidate = stripLeadingTranscriptLabels(stripTerminalControlSequences(text)).trim();
  if (!candidate) return "";
  if (isBootstrapNoiseText(candidate)) return "";
  if (isSkillFrontmatterNoiseText(candidate)) return "";
  if (isToolPayloadJson(candidate)) return "";

  if (hasWrappedExternalContent(candidate)) {
    candidate = stripLeadingTranscriptLabels(stripWrappedExternalContent(candidate));
  }

  const finalBlock = extractLastFinalBlock(candidate);
  if (finalBlock !== null) {
    return sanitizeVisibleAssistantText(finalBlock);
  }

  const openFinalBlock = extractOpenFinalBlock(candidate);
  if (openFinalBlock !== null) {
    return sanitizeVisibleAssistantText(openFinalBlock);
  }

  const transcriptMode = hasProcessTranscriptMarkers(candidate) || hasStructuredTranscriptSections(candidate);
  if (transcriptMode) {
    const visibleSections = extractVisibleSectionsFromAgentTranscript(candidate);
    if (visibleSections) {
      return visibleSections;
    }
    if (hasStandaloneThinkLine(candidate)) {
      return "";
    }
  }

  if (isWeatherToolNoiseText(rawText) || hasAnsiColorNoise(rawText)) {
    return sanitizeVisibleAssistantText(extractReplyFromToolNoise(rawText), true);
  }

  return sanitizeVisibleAssistantText(candidate, transcriptMode);
}

export function sanitizeTranscriptText(text: string) {
  const rawText = normalizeLineEndings(text);
  const trimmed = stripLeadingTranscriptLabels(stripTerminalControlSequences(text));
  if (!trimmed) return "";
  if (isBootstrapNoiseText(trimmed)) return "";
  if (isSkillFrontmatterNoiseText(trimmed)) return "";
  if (isToolPayloadJson(trimmed)) return "";

  if (hasWrappedExternalContent(trimmed)) {
    return stripLeadingTranscriptLabels(stripWrappedExternalContent(trimmed));
  }

  if (hasStructuredTranscriptSections(trimmed)) {
    return extractVisibleSectionsFromUserTranscript(trimmed);
  }

  if (isInternalAutomationScaffoldingText(trimmed)) return "";

  if (isWeatherToolNoiseText(rawText) || hasAnsiColorNoise(rawText)) {
    return stripLeadingTranscriptLabels(stripTerminalControlSequences(extractReplyFromToolNoise(rawText)));
  }

  if (hasMessagingTranscriptWrappers(trimmed)) {
    return stripMessagingTranscriptWrappers(trimmed);
  }

  return trimmed;
}

export function toChatMessages(rawMessages: unknown[] | undefined): ChatMessage[] {
  if (!Array.isArray(rawMessages)) return [];
  const messages: ChatMessage[] = [];
  rawMessages.forEach((item, index) => {
    if (typeof item !== "object" || item === null) return;
    const message = item as Record<string, unknown>;

    const role = message.role === "assistant" || message.role === "system" ? message.role : "user";
    if (isToolMessage(message)) return;
    if (role === "system") return;

    const rawText = extractMessageText(message);
    const text = role === "assistant"
      ? sanitizeAssistantTranscriptText(rawText)
      : sanitizeTranscriptText(rawText);
    if (!text) return;

    messages.push({
      id: `${String(message.timestamp || index)}-${role}`,
      role,
      text,
      rawText: role === "assistant" ? rawText : undefined,
      timestamp: typeof message.timestamp === "number" ? message.timestamp : undefined,
    });
  });
  return messages;
}

export function toStoredMessages(messages: ChatMessage[]): StoredChatMessage[] {
  return messages
    .filter((message) => !message.pending)
    .map((message) => ({
      id: message.id,
      role: message.role,
      text: message.text,
      timestamp: message.timestamp,
      error: message.error,
    }));
}

export function clipLabel(value: string, max = 42) {
  const normalized = value.trim();
  if (!normalized) return "";
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

export function formatSessionTitle(session: GatewayChatSession) {
  return session.displayName || session.derivedTitle || session.lastMessagePreview || session.key;
}

export function deriveThreadTitle(params: {
  session?: GatewayChatSession;
  messages?: StoredChatMessage[];
  fallback?: string;
}) {
  const userPrompt = params.messages?.find((message) => message.role === "user" && message.text.trim());
  if (userPrompt) {
    return clipLabel(userPrompt.text.replace(/\s+/g, " "));
  }
  if (params.session) {
    return clipLabel(formatSessionTitle(params.session));
  }
  return clipLabel(params.fallback || "New chat") || "New chat";
}

export function deriveThreadPreview(params: {
  session?: GatewayChatSession;
  messages?: StoredChatMessage[];
  fallback?: string;
}) {
  const lastMessage = [...(params.messages || [])].reverse().find((message) => message.text.trim());
  if (lastMessage) {
    return clipLabel(lastMessage.text.replace(/\s+/g, " "), 80);
  }
  if (params.session?.lastMessagePreview) {
    return clipLabel(params.session.lastMessagePreview.replace(/\s+/g, " "), 80);
  }
  return clipLabel(params.fallback || "Fresh conversation", 80) || "Fresh conversation";
}

export function createThread(params: {
  agentId: string;
  sessionKey: string;
  sessionId?: string;
  status: StoredChatThread["status"];
  session?: GatewayChatSession;
  title?: string;
  preview?: string;
  messages?: StoredChatMessage[];
}) {
  const messages = params.messages || [];
  return {
    id: generateUUID(),
    agentId: params.agentId,
    sessionKey: params.sessionKey,
    sessionId: params.sessionId,
    title: deriveThreadTitle({ session: params.session, messages, fallback: params.title }),
    preview: deriveThreadPreview({ session: params.session, messages, fallback: params.preview }),
    updatedAt: Date.now(),
    status: params.status,
    messages,
  } satisfies StoredChatThread;
}

export function defaultSessionKeyForAgent(agentId: string) {
  return `agent:${agentId}:main`;
}

export function resolveSessionKeyForAgent(params: {
  agentId: string;
  liveSessions: GatewayChatSession[];
  preferredSessionKey?: string;
}) {
  if (params.preferredSessionKey && params.liveSessions.some((session) => session.key === params.preferredSessionKey)) {
    return params.preferredSessionKey;
  }

  if (params.agentId === "main") {
    return (
      params.liveSessions.find((session) => session.key === "agent:main:main")?.key ||
      params.liveSessions.find((session) => session.key === "main")?.key ||
      params.liveSessions[0]?.key ||
      defaultSessionKeyForAgent(params.agentId)
    );
  }

  return (
    params.liveSessions.find((session) => session.key === `agent:${params.agentId}:main`)?.key ||
    params.liveSessions.find((session) => session.key !== "main")?.key ||
    defaultSessionKeyForAgent(params.agentId)
  );
}
