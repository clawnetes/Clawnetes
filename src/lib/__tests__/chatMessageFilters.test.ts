import { describe, it, expect } from "vitest";
import {
  clipLabel,
  deriveThreadTitle,
  deriveThreadPreview,
  extractLastFinalBlock,
  sanitizeAssistantTranscriptText,
  sanitizeTranscriptText,
  toChatMessages,
  toStoredMessages,
  type ChatMessage,
} from "../chatMessageFilters";

describe("clipLabel", () => {
  it("returns short strings unchanged", () => {
    expect(clipLabel("Hello")).toBe("Hello");
  });

  it("clips long strings with ellipsis", () => {
    const long = "A".repeat(50);
    const result = clipLabel(long, 42);
    expect(result.length).toBe(42);
    expect(result.endsWith("\u2026")).toBe(true);
  });

  it("returns empty string for empty input", () => {
    expect(clipLabel("")).toBe("");
    expect(clipLabel("   ")).toBe("");
  });

  it("trims whitespace", () => {
    expect(clipLabel("  hello  ")).toBe("hello");
  });
});

describe("deriveThreadTitle", () => {
  it("uses first user message as title", () => {
    const messages = [
      { id: "1", role: "user" as const, text: "Build a release checklist" },
      { id: "2", role: "assistant" as const, text: "Sure thing" },
    ];
    expect(deriveThreadTitle({ messages })).toBe("Build a release checklist");
  });

  it("falls back to session title", () => {
    const session = { key: "main", displayName: "My Session" } as any;
    expect(deriveThreadTitle({ session })).toBe("My Session");
  });

  it("falls back to default", () => {
    expect(deriveThreadTitle({})).toBe("New chat");
  });

  it("clips long titles", () => {
    const messages = [{ id: "1", role: "user" as const, text: "A".repeat(100) }];
    const title = deriveThreadTitle({ messages });
    expect(title.length).toBeLessThanOrEqual(42);
  });
});

describe("deriveThreadPreview", () => {
  it("uses last message as preview", () => {
    const messages = [
      { id: "1", role: "user" as const, text: "Hello" },
      { id: "2", role: "assistant" as const, text: "Hi, how can I help?" },
    ];
    expect(deriveThreadPreview({ messages })).toBe("Hi, how can I help?");
  });

  it("falls back when no messages", () => {
    expect(deriveThreadPreview({})).toBe("Fresh conversation");
  });
});

describe("sanitizeTranscriptText", () => {
  it("returns normal text unchanged", () => {
    expect(sanitizeTranscriptText("Hello world")).toBe("Hello world");
  });

  it("strips leading transcript labels", () => {
    expect(sanitizeTranscriptText("YOU\nHello")).toBe("Hello");
  });

  it("returns empty for bootstrap noise", () => {
    expect(sanitizeTranscriptText("A new session was started via /new or /reset.")).toBe("");
  });

  it("returns empty for skill frontmatter", () => {
    const frontmatter = `---
name: test
description: test skill
allowed-tools: Bash(test:*)
---

# Test Skill`;
    expect(sanitizeTranscriptText(frontmatter)).toBe("");
  });

  it("returns empty for tool payload JSON", () => {
    expect(sanitizeTranscriptText('{"tool":"read","status":"ok"}')).toBe("");
  });

  it("returns empty for browser page payload JSON", () => {
    expect(
      sanitizeTranscriptText(`{
  "targetId": "072C57376416171C7B4C9E96F42628EF",
  "title": "",
  "url": "https://news.google.com/search?q=AI&hl=en-GB&gl=GB&ceid=GB%3Aen",
  "wsUrl": "ws://127.0.0.1:18800/devtools/page/072C57376416171C7B4C9E96F42628EF",
  "type": "page"
}`),
    ).toBe("");
  });

  it("strips ANSI color codes and extracts reply", () => {
    const text = "\u001b[32mcolored\u001b[0m\nActual reply here";
    const result = sanitizeTranscriptText(text);
    expect(result).toBe("Actual reply here");
  });

  it("strips messaging gateway notices and timestamp wrappers from user transcript text", () => {
    const text = `YOU
System: [2026-03-25 08:30:28 GMT] WhatsApp gateway connected.

[Wed 2026-03-25 09:33 GMT] hey what’s going on today regarding world peace`;

    expect(sanitizeTranscriptText(text)).toBe("hey what’s going on today regarding world peace");
  });

  it("returns empty for transcript-wrapped session history payloads", () => {
    const text = `YOU
{
  "count": 11,
  "sessions": [
    {
      "key": "agent:main:main",
      "displayName": "Mulugeta Tamiru id:5162540072",
      "updatedAt": 1774955300182,
      "sessionId": "866d4920-e511-4db8-87d2-fd7f7c16b6c2",
      "contextTokens": 272000,
      "estimatedCostUsd": 2.5778185000000002,
      "childSessions": ["agent:codex:acp:da28e748-899d-40f1-90dd-e6af3f7c29a5"],
      "systemSent": true
    }
  ]
}`;

    expect(sanitizeTranscriptText(text)).toBe("");
  });

  it("returns empty for transcript-wrapped cron automation scaffolding", () => {
    const text = `YOU
[cron:16be9dc1-918b-42c7-a092-586524937423 burnscope-overnight-check] Overnight burnscope check: inspect the current state of the burnscope project and any active ACP Codex run.
Current time: Tuesday, March 31st, 2026 — 12:08 PM (Europe/London) / 2026-03-31 11:08 UTC

Return your summary as plain text; it will be delivered automatically. If the task explicitly calls for messaging a specific external recipient, note who/where it should go instead of sending it yourself.`;

    expect(sanitizeTranscriptText(text)).toBe("");
  });

  it("keeps real user text while dropping transcript-wrapped scaffolding and payload sections", () => {
    const text = `YOU
[cron:16be9dc1-918b-42c7-a092-586524937423 burnscope-overnight-check] Overnight burnscope check: inspect the current state of the burnscope project.
Current time: Tuesday, March 31st, 2026 — 12:08 PM (Europe/London) / 2026-03-31 11:08 UTC

Return your summary as plain text; it will be delivered automatically.
YOU
{
  "count": 1,
  "sessions": [
    {
      "key": "agent:main:main",
      "sessionId": "866d4920-e511-4db8-87d2-fd7f7c16b6c2",
      "updatedAt": 1774955300182,
      "childSessions": ["agent:codex:acp:da28e748-899d-40f1-90dd-e6af3f7c29a5"]
    }
  ]
}
YOU
what changed in burnscope today?`;

    expect(sanitizeTranscriptText(text)).toBe("what changed in burnscope today?");
  });
});

describe("sanitizeAssistantTranscriptText", () => {
  it("extracts the last final block from transcript-style output", () => {
    const transcript = `ACHENEF
think
The user asked me to install gcloud and run gws auth setup.
YOU
Command still running (session gentle-coral, pid 177047). Use process for follow-up.
ACHENEF
<final>The Google Cloud CLI has been installed.
Open this link:
https://accounts.google.com/example
Paste the verification code back here.</final>
HEARTBEAT_OK`;

    expect(extractLastFinalBlock(transcript)).toBe(`The Google Cloud CLI has been installed.
Open this link:
https://accounts.google.com/example
Paste the verification code back here.`);
    expect(sanitizeAssistantTranscriptText(transcript)).toBe(`The Google Cloud CLI has been installed.
Open this link:
https://accounts.google.com/example
Paste the verification code back here.`);
  });

  it("shows the visible portion of an open final block while streaming", () => {
    const transcript = `ACHENEF
think
The user asked me to install gcloud.
ACHENEF
<final>Use this link:
https://accounts.google.com/example`;

    expect(sanitizeAssistantTranscriptText(transcript)).toBe(`Use this link:
https://accounts.google.com/example`);
  });

  it("returns empty when the content is only reasoning and process noise", () => {
    const transcript = `ACHENEF
think
The user wants status information.
YOU
Process still running.
Sent 1 bytes to session gentle-coral.
HEARTBEAT_OK`;

    expect(sanitizeAssistantTranscriptText(transcript)).toBe("");
  });

  it("preserves normal assistant prose and markdown", () => {
    const message = "Here is the result: **done**\nhttps://openclaw.ai/docs";
    expect(sanitizeAssistantTranscriptText(message)).toBe(message);
  });

  it("drops transcript planning and tool sections while preserving the final assistant answer", () => {
    const transcript = `TEST
I’ll do a quick scan for today’s notable AI developments and then give you the short version.
YOU
---
name: agent-browser
description: Browser automation CLI for AI agents.
allowed-tools: Bash(agent-browser:*)
---

# Browser Automation with agent-browser
TEST
Web search isn’t configured here, so I’m checking live headlines through the browser instead.
YOU
{
  "targetId": "072C57376416171C7B4C9E96F42628EF",
  "title": "",
  "url": "https://news.google.com/search?q=AI&hl=en-GB&gl=GB&ceid=GB%3Aen",
  "wsUrl": "ws://127.0.0.1:18800/devtools/page/072C57376416171C7B4C9E96F42628EF",
  "type": "page"
}
TEST
Here’s the quick AI-news snapshot for today:
OpenAI / Sora: the biggest headline looks like turbulence around Sora.
Google Research: Google published TurboQuant.`;

    expect(sanitizeAssistantTranscriptText(transcript)).toBe(`Here’s the quick AI-news snapshot for today:
OpenAI / Sora: the biggest headline looks like turbulence around Sora.
Google Research: Google published TurboQuant.`);
  });

  it("drops startup persona chatter that leaked into the assistant transcript", () => {
    const transcript = `SUPERMAN
console.log("System online. Hello, Mulugeta.");
👨‍💻 I'm ready to write, debug, or review some code. What are we building or fixing today?`;

    expect(sanitizeAssistantTranscriptText(transcript)).toBe("");
  });
});

describe("toChatMessages", () => {
  it("returns empty array for non-array input", () => {
    expect(toChatMessages(undefined)).toEqual([]);
    expect(toChatMessages(null as any)).toEqual([]);
  });

  it("converts raw messages to ChatMessage array", () => {
    const raw = [
      { role: "user", content: [{ type: "text", text: "Hello" }] },
      { role: "assistant", content: [{ type: "text", text: "Hi" }] },
    ];
    const result = toChatMessages(raw);
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe("user");
    expect(result[0].text).toBe("Hello");
    expect(result[1].role).toBe("assistant");
  });

  it("filters out tool messages", () => {
    const raw = [
      { role: "user", content: [{ type: "text", text: "Hello" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "1", name: "read", input: {} }] },
      { role: "assistant", content: [{ type: "text", text: "Done" }] },
    ];
    const result = toChatMessages(raw);
    expect(result).toHaveLength(2);
  });

  it("filters out system messages", () => {
    const raw = [
      { role: "system", content: [{ type: "text", text: "System prompt" }] },
      { role: "user", content: [{ type: "text", text: "Hello" }] },
    ];
    const result = toChatMessages(raw);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
  });

  it("sanitizes transcript-style assistant history entries", () => {
    const raw = [
      {
        role: "assistant",
        content: [{
          type: "text",
          text: `ACHENEF
think
The user asked me to install gcloud.
ACHENEF
<final>The Google Cloud CLI has been installed.
Use this link:
https://accounts.google.com/example</final>`,
        }],
      },
    ];

    const result = toChatMessages(raw);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe(`The Google Cloud CLI has been installed.
Use this link:
https://accounts.google.com/example`);
  });

  it("drops transcript-wrapped internal user scaffolding while preserving real user text", () => {
    const raw = [
      {
        role: "user",
        content: [{
          type: "text",
          text: `YOU
[cron:16be9dc1-918b-42c7-a092-586524937423 burnscope-overnight-check] Overnight burnscope check: inspect the current state of the burnscope project.
Current time: Tuesday, March 31st, 2026 — 12:08 PM (Europe/London) / 2026-03-31 11:08 UTC
Return your summary as plain text; it will be delivered automatically.
YOU
{
  "count": 1,
  "sessions": [
    {
      "key": "agent:main:main",
      "sessionId": "866d4920-e511-4db8-87d2-fd7f7c16b6c2",
      "updatedAt": 1774955300182,
      "childSessions": ["agent:codex:acp:da28e748-899d-40f1-90dd-e6af3f7c29a5"]
    }
  ]
}
YOU
what changed in burnscope today?`,
        }],
      },
    ];

    const result = toChatMessages(raw);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    expect(result[0].text).toBe("what changed in burnscope today?");
  });
});

describe("toStoredMessages", () => {
  it("filters out pending messages", () => {
    const messages: ChatMessage[] = [
      { id: "1", role: "user", text: "Hello" },
      { id: "2", role: "assistant", text: "...", pending: true },
    ];
    const result = toStoredMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("1");
  });

  it("preserves error flag", () => {
    const messages: ChatMessage[] = [
      { id: "1", role: "system", text: "Error occurred", error: true },
    ];
    const result = toStoredMessages(messages);
    expect(result[0].error).toBe(true);
  });
});
