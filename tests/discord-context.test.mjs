import assert from "node:assert/strict";
import test from "node:test";
import { ContextDiscordAdapter, attachContext, createContextResolver, createDiscordHandler, originalMessage } from "../src/mastra/discord/context.ts";

const adapter = () => new ContextDiscordAdapter({ botToken: "test", applicationId: "999", publicKey: "0".repeat(64) });
const incoming = (overrides = {}) => ({
  id: "300", threadId: "discord:100:200:201", text: "どこ？", formatted: { type: "root", children: [] },
  raw: { id: "300", channel_id: "201", content: "どこ？", author: { id: "400" }, timestamp: "2026-09-20T10:00:00Z", message_reference: { message_id: "299", channel_id: "201", guild_id: "100" }, mentions: [{ id: "401" }] },
  author: { userId: "400", userName: "sender", isBot: false },
  metadata: { dateSent: new Date("2026-09-20T10:00:00Z"), edited: false }, attachments: [],
  ...overrides,
});

test("Gateway normalization retains reply and real mentions, independent of routing isMention", async () => {
  const a = adapter(); let received;
  a.chat = { handleIncomingMessage: async (_a, _t, m) => { received = m; } };
  await a.handleGatewayMessage({
    id: "300", guildId: "100", channelId: "201", channel: { isThread: () => true, parentId: "200" },
    content: "どこ？", attachments: new Map(), author: { id: "400", username: "sender", bot: false },
    createdAt: new Date("2026-09-20T10:00:00Z"), editedAt: null,
    reference: { messageId: "299", channelId: "201", guildId: "100", type: 0 },
    mentions: { users: { map: fn => [{ id: "401" }].map(fn) }, roles: new Map(), everyone: false },
  }, true);
  assert.equal(received.isMention, true);
  assert.equal(received.raw.message_reference.message_id, "299");
  assert.deepEqual(received.raw.mentions, [{ id: "401" }]);
});

test("thread, parent topic, category and reply author/text reach every delivered message", async () => {
  const a = adapter(); const reads = [];
  a.readChannel = async id => {
    reads.push(id);
    return { "201": { id, type: 11, name: "集合場所", parent_id: "200" }, "200": { id, type: 0, name: "旅行", topic: "旅程相談", parent_id: "202" }, "202": { id, type: 4, name: "遊び" } }[id];
  };
  a.readMessage = async (channel, id) => ({ id, channel_id: channel, content: "町田のクレープ", author: { id: "401" }, timestamp: "2026-09-20T09:59:00Z", mentions: [], mention_roles: [], mention_everyone: false, attachments: [] });
  const handler = createDiscordHandler(a);
  for (let n = 0; n < 2; n++) {
    const message = incoming(); const ctx = { signalMetadata: {} };
    await handler({}, message, async (_, enriched) => {
      assert.match(enriched.text, /町田のクレープ/);
      assert.match(enriched.text, /旅程相談/);
      assert.match(enriched.text, /遊び/);
      assert.match(enriched.text, /"id":"401"/);
      assert.ok(enriched.text.endsWith("どこ？"));
      assert.equal(ctx.signalMetadata.discordContext.mentions.bot, false);
      assert.equal(ctx.signalMetadata.discordContext.channelId, "201");
      assert.equal(enriched.formatted.type, "root");
    }, ctx);
  }
  assert.deepEqual(reads, ["201", "200", "202"]);
});

test("missing/deleted replies retain IDs and never prevent delivery; cross-channel refs are not fetched", async () => {
  const a = adapter(); let reads = 0;
  a.readChannel = async () => { throw new Error("403"); };
  a.readMessage = async () => { reads++; throw new Error("404"); };
  const resolve = createContextResolver(a);
  const first = await resolve(incoming());
  assert.equal(first.reply.status, "unavailable");
  assert.equal(first.reply.reference.message_id, "299");
  assert.equal(first.unavailable.length, 2);
  const second = incoming(); second.raw.message_reference.channel_id = "999";
  assert.equal((await resolve(second)).reply.status, "outside-channel");
  assert.equal(reads, 1);
});

test("DMs, messages without replies, attachments and JSON escaping preserve original content", async () => {
  const a = adapter(); a.readChannel = async id => ({ id, type: 1 });
  const m = incoming({ threadId: "discord:@me:201", attachments: [{ name: "sample.png", mimeType: "image/png", url: "https://cdn.discordapp.com/sample.png" }] });
  delete m.raw.message_reference; m.raw.content = 'line\n"quoted" <@401>';
  assert.equal(originalMessage(m).attachments[0].filename, "sample.png");
  const context = await createContextResolver(a)(m);
  assert.equal(context.guildId, null); assert.equal(context.reply, undefined);
  assert.equal(context.messageUrl, "https://discord.com/channels/@me/201/300");
});

test("context enrichment preserves flattened forwards instead of replacing them with raw content", () => {
  const m = incoming({ text: "Forwarded message:\n元の本文\n添付の説明" });
  m.raw.content = "";
  attachContext(m, { channelId: "201", unavailable: [] });
  assert.ok(m.text.endsWith("Forwarded message:\n元の本文\n添付の説明"));
});
