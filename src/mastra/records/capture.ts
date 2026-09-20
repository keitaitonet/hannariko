import type { ToolExecutionContext } from "@mastra/core/tools";
import type { MastraDBMessage, StorageThreadType } from "@mastra/core/memory";
import type { ContextDiscordAdapter, DiscordContext, IncomingMessage } from "../discord/context.ts";
import { originalMessage } from "../discord/context.ts";
import type { CaptureSection, ContextRecord } from "./store.ts";

const SECTION_BYTE_LIMIT = 2 * 1024 * 1024;

// Never serialize clients, environment variables or credential-bearing headers.
// Conversation text remains verbatim; binary file contents and opaque reasoning
// ciphertext are not useful to an investigator and can be very large.
export function snapshotJSON(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (key, item) => {
    if (/^(authorization|cookie|set-cookie|apiKey|api_key|botToken|accessToken|refreshToken|password|secret|reasoningEncryptedContent)$/i.test(key)) return "[omitted]";
    if (typeof item === "string" && item.startsWith("data:") && item.includes(";base64,")) return `[binary data omitted: ${item.length} characters]`;
    return item;
  }) ?? "null");
}

async function section(read: () => unknown | Promise<unknown>): Promise<CaptureSection> {
  const capturedAt = new Date().toISOString();
  try {
    const data = snapshotJSON(await read());
    if (Buffer.byteLength(JSON.stringify(data)) > SECTION_BYTE_LIMIT) {
      return { capturedAt, status: "unavailable", reason: `Section exceeded ${SECTION_BYTE_LIMIT} bytes` };
    }
    return { capturedAt, status: "available", data };
  } catch {
    // Error objects from providers can contain URLs/tokens; don't persist those.
    return { capturedAt, status: "unavailable", reason: "Read failed or source unavailable" };
  }
}

export async function captureContextRecord(input: {
  adapter: ContextDiscordAdapter;
  message: IncomingMessage;
  note: string;
  context: Pick<ToolExecutionContext, "mastra" | "requestContext">;
  resolveContext: (message: IncomingMessage) => Promise<DiscordContext>;
}): Promise<ContextRecord> {
  const { adapter, message, note, context: ctx, resolveContext } = input;
  const startedAt = new Date().toISOString();
  const raw = originalMessage(message);
  const coordinates = adapter.decodeThreadId(message.threadId);
  const channelId = coordinates.threadId ?? coordinates.channelId;
  const source = {
    platform: "discord" as const, channelId, messageId: message.id,
    url: `https://discord.com/channels/${coordinates.guildId}/${channelId}/${message.id}`,
  };
  const sections: Record<string, CaptureSection> = {};
  sections.trigger = await section(() => ({ ...raw, normalizedText: message.text }));
  const mastra = ctx.mastra;
  const agent = mastra?.getAgentById("discord-agent");
  const storage = mastra?.getStorage();
  let thread: StorageThreadType | undefined;
  sections.thread = await section(async () => {
    const memory = await storage?.getStore("memory");
    if (!memory) throw new Error("No memory store");
    const { threads } = await memory.listThreads({
      page: 0, perPage: 2,
      filter: { metadata: { channel_platform: "discord", channel_externalThreadId: message.threadId, channel_ownerId: "discord-agent" } },
    });
    if (threads.length > 1) throw new Error("Ambiguous thread");
    thread = threads[0];
    return thread ?? null;
  });
  // Capture active state before slow Discord/trace reads. No agent generation or
  // subscription changes are performed by this capture.
  sections.activeRuns = await section(() => {
    if (!agent) throw new Error("No agent");
    if (sections.thread.status === "unavailable") throw new Error("Thread lookup failed");
    return thread ? agent.listActiveThreadRuns().filter(run => run.threadId === thread!.id) : [];
  });
  sections.runtime = await section(() => ({
    node: process.version, uptimeSeconds: process.uptime(),
    image: process.env.BOT_IMAGE ?? null, revision: process.env.APP_REVISION ?? null,
  }));
  sections.configuration = await section(async () => {
    if (!agent) throw new Error("No agent");
    const model = await agent.getModel({ requestContext: ctx.requestContext });
    const tools = await agent.listTools({ requestContext: ctx.requestContext });
    const memory = await agent.getMemory({ requestContext: ctx.requestContext });
    const options = memory?.getMergedThreadConfig();
    return {
      agentId: agent.id, name: agent.name,
      model: { provider: model.provider, modelId: model.modelId },
      instructions: await agent.getInstructions({ requestContext: ctx.requestContext }),
      tools: Object.entries(tools).map(([name, tool]) => ({
        name,
        description: "description" in tool ? tool.description : undefined,
        requireApproval: "requireApproval" in tool ? tool.requireApproval : undefined,
      })),
      memory: { lastMessages: options?.lastMessages, observationalMemory: options?.observationalMemory },
    };
  });

  let messages: MastraDBMessage[] = [];
  sections.memoryMessages = await section(async () => {
    const memory = await storage?.getStore("memory");
    if (!memory) throw new Error("No memory store");
    if (sections.thread.status === "unavailable") throw new Error("Thread lookup failed");
    if (!thread) return { messages: [], hasMore: false };
    const result = await memory.listMessages({
      threadId: thread.id, page: 0, perPage: 100, includeTotal: false,
      orderBy: { field: "createdAt", direction: "DESC" },
      filter: { dateRange: { end: new Date(startedAt) } },
    });
    messages = result.messages;
    return { messages: [...messages].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt)), hasMore: result.hasMore };
  });
  sections.observationalMemory = await section(async () => {
    const memory = await storage?.getStore("memory");
    if (!memory) throw new Error("No memory store");
    if (sections.thread.status === "unavailable") throw new Error("Thread lookup failed");
    return thread ? memory.getObservationalMemory(thread.id, thread.resourceId) : null;
  });
  sections.tasks = await section(async () => {
    const state = await storage?.getStore("threadState");
    if (!state) throw new Error("No thread state store");
    if (sections.thread.status === "unavailable") throw new Error("Thread lookup failed");
    return thread ? await state.getState({ threadId: thread.id, type: "task" }) ?? null : null;
  });
  sections.suspendedRuns = await section(async () => {
    if (!agent) throw new Error("No agent");
    if (sections.thread.status === "unavailable") throw new Error("Thread lookup failed");
    return thread ? agent.listSuspendedRuns({ threadId: thread.id, resourceId: thread.resourceId, page: 0, perPage: 10 }) : null;
  });

  const activeTraceIds: string[] = [];
  const recentTraceIds: string[] = [];
  sections.recentTraces = await section(async () => {
    const observability = await storage?.getStore("observability");
    if (!observability || sections.thread.status === "unavailable") throw new Error("Trace store/thread unavailable");
    if (!thread) return { spans: [] };
    const result = await observability.listTracesLight({
      filters: { metadata: { threadId: thread.id } },
      pagination: { page: 0, perPage: 5 },
      orderBy: { field: "startedAt", direction: "DESC" },
    });
    // Some storage versions have inconsistent trace-list pagination. Verify the
    // scope before saving anything, and never treat its total as authoritative.
    const spans = result.spans.filter(span => span.metadata?.threadId === thread!.id);
    const active = sections.activeRuns.data as { runId: string }[] | undefined;
    for (const span of spans) {
      recentTraceIds.push(span.traceId);
      if (active?.some(run => run.runId === span.metadata?.runId)) activeTraceIds.push(span.traceId);
    }
    return { spans, limitReached: result.spans.length === 5 };
  });

  sections.discordContext = await section(() => resolveContext(message));
  sections.discordMessages = await section(async () => {
    const messages = await adapter.readMessages(channelId, message.id, 50);
    return { messages: messages.sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1), limitReached: messages.length === 50 };
  });
  if (raw.message_reference?.message_id) {
    sections.referencedConversation = await section(async () => {
      const reference = raw.message_reference!;
      if ((reference.channel_id && reference.channel_id !== channelId) ||
          (reference.guild_id && reference.guild_id !== coordinates.guildId)) {
        throw new Error("Reference outside current channel");
      }
      const messages = await adapter.readMessagesAround(channelId, reference.message_id!);
      return {
        messages: messages.filter(m => BigInt(m.id) <= BigInt(message.id))
          .sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1),
        limitReached: messages.length === 25,
      };
    });
  }
  const messageTraceIds = messages.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    .map(m => typeof m.content === "object" ? m.content.metadata?.traceId : undefined)
    .filter((id): id is string => typeof id === "string");
  const traceIds = [...new Set([...activeTraceIds, ...messageTraceIds, ...recentTraceIds])];
  sections.traceSelection = await section(() => ({ included: traceIds.slice(0, 2), omitted: traceIds.slice(2) }));
  // Read details sequentially; production DuckDB has a 256 MB memory limit.
  for (const traceId of traceIds.slice(0, 2)) {
    sections[`trace:${traceId}`] = await section(async () => {
      const observability = await storage?.getStore("observability");
      const trace = await observability?.getTrace({ traceId });
      if (!trace) throw new Error("Trace missing");
      return trace;
    });
  }
  return {
    version: 1, id: `discord-${message.id}`, startedAt, completedAt: new Date().toISOString(),
    note, source, sections,
    limits: {
      discordMessagesBeforeTrigger: 50, discordMessagesAroundReference: 25, memoryMessages: 100, traces: 2, bytesPerSection: SECTION_BYTE_LIMIT,
      consistency: "Each section is read at its capturedAt time; not a transaction across Discord and storage. Active runs may continue during capture.",
      attachments: "Metadata and URLs only; file bytes are not copied and URLs may expire.",
      historicalState: "State is captured when the tool executes, not reconstructed at the time of the replied-to message.",
    },
  };
}
