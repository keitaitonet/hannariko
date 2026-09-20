import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RequestContext } from "@mastra/core/request-context";
import { Mastra } from "@mastra/core";
import { Agent } from "@mastra/core/agent";
import { createClient } from "@libsql/client";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import { ContextRecordStore, recordMarkdown } from "../src/mastra/records/store.ts";
import { captureContextRecord, snapshotJSON } from "../src/mastra/records/capture.ts";
import { createContextRecordTool } from "../src/mastra/records/tool.ts";
import { ContextDiscordAdapter } from "../src/mastra/discord/context.ts";
import { contextRecordRoutes } from "../src/mastra/records/routes.ts";

const wireMessage = (id, content) => ({
  id, channel_id: "200", content, author: { id: "400", username: "sender" },
  timestamp: "2026-09-20T10:00:00Z", mentions: [], mention_roles: [], mention_everyone: false, attachments: [],
});
const incoming = () => ({
  id: "300", threadId: "discord:100:200", text: "話題が混ざっているので記録して。\nこの機能もほしい", formatted: { type: "root", children: [] },
  raw: { ...wireMessage("300", "話題が混ざっているので記録して。\nこの機能もほしい"), message_reference: { message_id: "150", channel_id: "200" } },
  author: { userId: "400", userName: "sender", isBot: false }, metadata: { dateSent: new Date("2026-09-20T10:00:00Z"), edited: false }, attachments: [],
});
const makeRecord = (id = "discord-300") => ({
  version: 1, id, startedAt: "2026-09-20T10:00:00Z", completedAt: "2026-09-20T10:00:01Z", note: "原文\n```\n!記録", source: { platform: "discord", channelId: "200", messageId: id.slice(8), url: "https://discord.com/channels/100/200/300" },
  sections: { trigger: { capturedAt: "2026-09-20T10:00:00Z", status: "available", data: { text: "original" } } }, limits: {},
});
async function temporaryStore(t) {
  const directory = await mkdtemp(join(tmpdir(), "hannariko-records-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const client = createClient({ url: `file:${join(directory, "records.db")}` });
  t.after(() => client.close());
  return new ContextRecordStore(client);
}
function fixture() {
  const calls = [];
  const adapter = new ContextDiscordAdapter({ botToken: "test", applicationId: "999", publicKey: "0".repeat(64) });
  adapter.readIncomingMessage = async (threadId, messageId) => { calls.push({ fetchedThread: threadId, fetchedMessage: messageId }); return incoming(); };
  adapter.readChannel = async id => ({ id, type: 0, name: "test" });
  adapter.readMessage = async (_, id) => wireMessage(id, "older target");
  adapter.readMessages = async (channelId, before, limit) => { calls.push({ channelId, before, limit }); return [wireMessage("299", "recent")]; };
  adapter.readMessagesAround = async (channelId, around) => { calls.push({ channelId, around }); return [wireMessage("301", "future"), wireMessage("151", "after target"), wireMessage("150", "older target"), wireMessage("149", "before target")]; };
  const thread = { id: "memory-thread", resourceId: "first-sender", metadata: { channel_platform: "discord", channel_ownerId: "discord-agent", channel_externalThreadId: "discord:100:200" } };
  const messages = [
    { id: "m3", role: "assistant", createdAt: new Date("2026-09-20T10:00:03Z"), content: { parts: [{ type: "text", text: "response" }], metadata: { traceId: "newest" } } },
    { id: "m2", role: "assistant", createdAt: new Date("2026-09-20T10:00:02Z"), content: { parts: [], metadata: { traceId: "missing" } } },
    { id: "m1", role: "assistant", createdAt: new Date("2026-09-20T10:00:01Z"), content: { parts: [], metadata: { traceId: "older" } } },
  ];
  const stores = {
    memory: {
      getThreadById: async () => thread,
      listThreads: async options => { calls.push(options); return { threads: [thread] }; },
      listMessages: async options => { calls.push(options); return { messages, hasMore: true }; },
      getObservationalMemory: async () => ({ activeObservations: "Original memory", bufferedObservations: "Pending memory" }),
    },
    threadState: { getState: async () => ({ tasks: [{ content: "do something", status: "in_progress" }] }) },
    observability: {
      listTracesLight: async () => ({ spans: [] }),
      getTrace: async ({ traceId }) => { calls.push({ traceId }); return traceId === "missing" ? null : { traceId, spans: [{ input: [{ role: "system", content: "actual input" }], output: "answer" }] }; },
    },
  };
  const agent = {
    id: "discord-agent", name: "bot",
    listActiveThreadRuns: () => [{ runId: "live", threadId: "memory-thread" }, { runId: "other", threadId: "different" }],
    getModel: async () => ({ provider: "openai", modelId: "model", apiKey: "never copy this" }),
    listTools: async () => ({ search: { description: "search", requireApproval: false } }),
    getInstructions: async () => "original instructions",
    getMemory: async () => ({ getMergedThreadConfig: () => ({ lastMessages: 20, observationalMemory: { model: "observer" } }) }),
    listSuspendedRuns: async options => { calls.push(options); return { runs: [] }; },
  };
  const context = {
    agent: { threadId: "memory-thread", resourceId: "first-sender" },
    requestContext: new RequestContext(), signalMetadata: {},
    mastra: { getAgentById: () => agent, getStorage: () => ({ getStore: async name => stores[name] }), getLogger: () => ({ error() {} }) },
  };
  return { adapter, calls, stores, agent, context };
}

test("record survives reopening and the first concurrent capture wins across connections", async t => {
  const directory = await mkdtemp(join(tmpdir(), "hannariko-reopen-"));
  const url = `file:${join(directory, "records.db")}`;
  const first = createClient({ url });
  const second = createClient({ url });
  t.after(async () => { first.close(); second.close(); await rm(directory, { recursive: true, force: true }); });
  const store = new ContextRecordStore(first);
  const other = new ContextRecordStore(second);
  await Promise.all([store.list(), other.list()]);
  const original = makeRecord();
  const results = await Promise.all([store.save(original), other.save({ ...original, note: "competing capture" })]);
  assert.deepEqual(results[0], results[1]);
  first.close(); second.close();
  const reopened = createClient({ url });
  try {
    const restored = new ContextRecordStore(reopened);
    assert.deepEqual(await restored.get(original.id), results[0]);
    assert.deepEqual(await restored.save({ ...original, note: "changed" }), results[0]);
    assert.equal(await restored.get("discord-999"), null);
    await assert.rejects(restored.get("../../.env"), /Invalid/);
  } finally { reopened.close(); }
});

test("pagination orders snowflakes without integer precision loss or duplicates", async t => {
  const store = await temporaryStore(t);
  for (const id of ["9", "10", "11", "99999999999999999999", "99999999999999999998"]) await store.save(makeRecord(`discord-${id}`));
  const largest = await store.list(2);
  assert.deepEqual(largest.records.map(r => r.id), ["discord-99999999999999999999", "discord-99999999999999999998"]);
  const first = await store.list(2, largest.nextCursor);
  assert.deepEqual(first.records.map(r => r.id), ["discord-11", "discord-10"]);
  assert.equal(first.nextCursor, "discord-10");
  assert.deepEqual((await store.list(2, first.nextCursor)).records.map(r => r.id), ["discord-9"]);
  await assert.rejects(store.list(101));
  await assert.rejects(store.list(1, "bad"));
});

test("capture freezes bounded channel-local state and preserves partial trace failures", async () => {
  const f = fixture();
  const record = await captureContextRecord({ ...f, message: incoming(), note: "raw note", resolveContext: async () => ({ channelId: "200", unavailable: [] }) });
  assert.equal(record.sections.trigger.data.content, incoming().raw.content);
  assert.equal(record.sections.memoryMessages.data.messages[0].id, "m1");
  assert.equal(record.sections.memoryMessages.data.hasMore, true);
  assert.equal(record.sections.observationalMemory.data.activeObservations, "Original memory");
  assert.deepEqual(record.sections.activeRuns.data, [{ runId: "live", threadId: "memory-thread" }]);
  assert.equal(record.sections["trace:missing"].status, "unavailable");
  assert.equal(record.sections["trace:newest"].data.spans[0].input[0].content, "actual input");
  assert.deepEqual(f.calls.filter(c => c.traceId), [{ traceId: "newest" }, { traceId: "missing" }]);
  assert.deepEqual(record.sections.referencedConversation.data.messages.map(m => m.id), ["149", "150", "151"]);
  assert.equal(f.calls.find(c => c.filter?.metadata)?.filter.metadata.channel_externalThreadId, "discord:100:200");
  assert.equal(f.calls.find(c => c.orderBy)?.perPage, 100);
  assert.equal(JSON.stringify(record).includes("never copy this"), false);
  f.stores.memory.listMessages = async () => ({ messages: [] });
  assert.equal(record.sections.memoryMessages.data.messages.length, 3);
});

test("missing storage/permissions still yields original note, trigger and explicit gaps", async () => {
  const f = fixture();
  f.context.mastra.getStorage = () => undefined;
  f.adapter.readMessages = async () => { throw new Error("403 Secret should not leak"); };
  const record = await captureContextRecord({ ...f, message: incoming(), note: "機能がほしい", resolveContext: async () => { throw new Error("metadata missing"); } });
  assert.equal(record.note, "機能がほしい");
  assert.equal(record.sections.trigger.status, "available");
  assert.equal(record.sections.thread.status, "unavailable");
  assert.equal(record.sections.activeRuns.status, "unavailable");
  assert.equal(record.sections.discordMessages.status, "unavailable");
  assert.equal(JSON.stringify(record).includes("Secret"), false);
});

test("active trace is prioritized and foreign-thread trace-list results are excluded", async () => {
  const f = fixture();
  f.stores.observability.listTracesLight = async options => {
    assert.equal(options.pagination.perPage, 5);
    assert.equal(options.filters.metadata.threadId, "memory-thread");
    return { spans: [
      { traceId: "foreign", metadata: { threadId: "other", runId: "other" } },
      { traceId: "active", metadata: { threadId: "memory-thread", runId: "live" } },
    ] };
  };
  const record = await captureContextRecord({ ...f, message: incoming(), note: "x", resolveContext: async () => ({ unavailable: [] }) });
  assert.deepEqual(record.sections.traceSelection.data.included, ["active", "newest"]);
  assert.deepEqual(record.sections.recentTraces.data.spans.map(s => s.traceId), ["active"]);
  assert.equal(JSON.stringify(record).includes("foreign"), false);
});

test("oversized state is explicitly omitted without losing the trigger", async () => {
  const f = fixture();
  f.stores.memory.getObservationalMemory = async () => ({ activeObservations: "x".repeat(2 * 1024 * 1024) });
  const record = await captureContextRecord({ ...f, message: incoming(), note: "x", resolveContext: async () => ({ unavailable: [] }) });
  assert.equal(record.sections.observationalMemory.status, "unavailable");
  assert.match(record.sections.observationalMemory.reason, /exceeded/);
  assert.equal(record.sections.trigger.status, "available");
});

test("real Mastra tool loop saves a record using its execution thread and LibSQL state", async t => {
  const directory = await mkdtemp(join(tmpdir(), "hannariko-capture-db-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const storage = new LibSQLStore({ id: "test-store", url: `file:${join(directory, "test.db")}` });
  const f = fixture();
  const recordClient = createClient({ url: `file:${join(directory, "test.db")}` });
  t.after(() => recordClient.close());
  const records = new ContextRecordStore(recordClient);
  const saveContextRecord = createContextRecordTool(f.adapter, records);
  let modelSteps = 0;
  const agent = new Agent({
    id: "discord-agent", name: "test", instructions: "test instructions",
    tools: { saveContextRecord },
    model: {
      specificationVersion: "v2", provider: "offline", modelId: "offline", supportedUrls: {},
      doGenerate: async options => {
        assert.ok(options.tools.some(tool => tool.name === "saveContextRecord"));
        const call = modelSteps++ === 0;
        return {
          content: call ? [{ type: "tool-call", toolCallId: "save-one", toolName: "saveContextRecord", input: JSON.stringify({ messageId: "300", note: "自然文からの記録メモ" }) }] : [{ type: "text", text: "記録しました" }],
          finishReason: call ? "tool-calls" : "stop", usage: { inputTokens: 1, outputTokens: 1 }, warnings: [],
        };
      },
      doStream: async () => assert.fail("model streaming"),
    },
    memory: new Memory({ options: { lastMessages: 20 } }),
  });
  const mastra = new Mastra({ agents: { discordAgent: agent }, storage, logger: false });
  t.after(() => mastra.shutdown());
  await storage.init();
  const memory = await storage.getStore("memory");
  await memory.saveThread({ thread: { id: "real-thread", resourceId: "owner", title: "test", createdAt: new Date(), updatedAt: new Date(), metadata: { channel_platform: "discord", channel_externalThreadId: "discord:100:200", channel_ownerId: "discord-agent" } } });
  await memory.saveMessages({ messages: [{ id: "real-message", threadId: "real-thread", resourceId: "owner", role: "assistant", createdAt: new Date(), content: { format: 2, parts: [{ type: "text", text: "saved answer" }] } }] });
  const state = await storage.getStore("threadState");
  await state.setState({ threadId: "real-thread", type: "task", value: [{ id: "one", content: "pending task" }] });
  const record = await captureContextRecord({ adapter: f.adapter, message: incoming(), note: "check state", context: { mastra, requestContext: new RequestContext(), signalMetadata: {} }, resolveContext: async () => ({ channelId: "200", unavailable: [] }) });
  assert.equal(record.sections.thread.data.id, "real-thread");
  assert.equal(record.sections.memoryMessages.data.messages[0].content.parts[0].text, "saved answer");
  assert.equal(record.sections.tasks.data[0].content, "pending task");
  assert.equal(record.sections.configuration.data.instructions, "test instructions");
  assert.equal(record.sections.configuration.data.model.modelId, "offline");
  assert.equal(record.sections.suspendedRuns.status, "available");
  assert.equal(modelSteps, 0);
  const result = await agent.generate("この挙動を記録して", { memory: { thread: "real-thread", resource: "owner" } });
  assert.equal(result.text, "記録しました");
  assert.equal((await records.get("discord-300")).note, "自然文からの記録メモ");
  assert.equal((await recordClient.execute("SELECT count(*) AS count FROM hannariko_context_records")).rows[0].count, 1);
  assert.ok(await memory.getThreadById({ threadId: "real-thread" }));
});

test("standard tool saves free-form notes and original messages, and deduplicates calls", async t => {
  const f = fixture(); const store = await temporaryStore(t);
  const tool = createContextRecordTool(f.adapter, store);
  f.context.requestContext.set("channel", { messageId: "outdated", threadId: "discord:100:other" });
  const args = { messageId: "300", note: "自由なメモ。種別は指定しない" };
  const results = await Promise.all([tool.execute(args, f.context), tool.execute(args, f.context)]);
  assert.ok(results.every(result => result.id === "discord-300" && result.partial));
  assert.equal(f.calls.filter(c => c.before).length, 1);
  assert.deepEqual(f.calls.find(c => c.fetchedMessage), { fetchedThread: "discord:100:200", fetchedMessage: "300" });
  const record = await store.get("discord-300");
  assert.equal(record.note, args.note);
  assert.equal(record.sections.trigger.data.content, incoming().raw.content);
  await tool.execute({ ...args, note: "changed" }, f.context);
  assert.equal((await store.get("discord-300")).note, args.note);
  assert.equal(f.calls.filter(c => c.before).length, 1);
});

test("tool rejects non-Discord scope and does not read an arbitrary channel", async t => {
  const f = fixture(); const store = await temporaryStore(t);
  const tool = createContextRecordTool(f.adapter, store);
  f.stores.memory.getThreadById = async () => ({ metadata: { channel_platform: "web" } });
  await assert.rejects(tool.execute({ messageId: "300", note: "x" }, f.context));
  assert.equal(f.calls.filter(c => c.fetchedMessage).length, 0);
});

test("tool does not return a record from a different conversation", async t => {
  const f = fixture(); const store = await temporaryStore(t);
  await store.save({ ...makeRecord(), source: { ...makeRecord().source, channelId: "other" } });
  await assert.rejects(createContextRecordTool(f.adapter, store).execute({ messageId: "300", note: "x" }, f.context));
});

test("write failure is a tool error and never returns a successful record ID", async () => {
  const f = fixture();
  const tool = createContextRecordTool(f.adapter, { get: async () => null, save: async () => { throw new Error("disk full"); } });
  await assert.rejects(tool.execute({ messageId: "300", note: "x" }, f.context), /disk full/);
});

test("JSON omits credentials and binary payloads while leaving message prose untouched", () => {
  assert.deepEqual(snapshotJSON({ authorization: "secret", apiKey: "secret", content: "my note", data: "data:image/png;base64,AAAA", reasoningEncryptedContent: "encrypted", inputTokens: 32 }), {
    authorization: "[omitted]", apiKey: "[omitted]", content: "my note", data: "[binary data omitted: 26 characters]", reasoningEncryptedContent: "[omitted]", inputTokens: 32,
  });
});

test("read routes expose stored JSON/Markdown only and reject traversal", async t => {
  const store = await temporaryStore(t); await store.save(makeRecord());
  const routes = contextRecordRoutes(store);
  assert.ok(routes.every(r => r.method === "GET"));
  const c = (id, format) => ({ req: { param: () => id, query: key => key === "format" ? format : undefined }, header() {}, json: (body, status = 200) => ({ body, status }), text: body => ({ body, status: 200 }) });
  assert.equal((await routes[1].handler(c("../../.env"))).status, 400);
  assert.equal((await routes[1].handler(c("discord-999"))).status, 404);
  const json = await routes[1].handler(c("discord-300"));
  assert.equal(json.body.note, makeRecord().note);
  const markdown = await routes[1].handler(c("discord-300", "markdown"));
  assert.equal(markdown.body, recordMarkdown(makeRecord()));
  assert.match(markdown.body, /````\n原文/);
});
