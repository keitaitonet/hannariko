// Run inside the offline CI container, after its health endpoint is ready.
import assert from "node:assert/strict";
import { createClient } from "@libsql/client";
const client = createClient({ url: process.env.DATABASE_URL });
const base = "http://127.0.0.1:4111/context-records";
const agent = await fetch("http://127.0.0.1:4111/api/agents/discord-agent").then(r => r.json());
assert.equal(agent.tools.saveContextRecord.id, "save-context-record");
assert.match(agent.tools.saveContextRecord.inputSchema, /note/);
const record = {
  version: 1, id: "discord-123456789", startedAt: "2026-09-20T10:00:00Z", completedAt: "2026-09-20T10:00:01Z",
  note: "offline record fixture", source: { platform: "discord", channelId: "200", messageId: "123456789", url: "https://discord.com/channels/100/200/123456789" },
  sections: { trigger: { capturedAt: "2026-09-20T10:00:00Z", status: "available", data: { content: "original message" } } }, limits: {},
};
assert.equal((await fetch(base)).status, 200);
const original = JSON.stringify(record);
await client.execute({ sql: "INSERT INTO hannariko_context_records (id, sort_key, payload) VALUES (?, ?, ?)", args: [record.id, record.id.slice(8).padStart(20, "0"), original] });
try {
  const list = await fetch(base);
  assert.equal(list.status, 200);
  assert.ok((await list.json()).records.some(r => r.id === record.id));
  const json = await fetch(`${base}/${record.id}`);
  assert.equal(json.status, 200);
  assert.equal(json.headers.get("cache-control"), "no-store");
  assert.deepEqual(await json.json(), record);
  const markdown = await fetch(`${base}/${record.id}?format=markdown`);
  assert.equal(markdown.status, 200);
  assert.match(await markdown.text(), /offline record fixture/);
  assert.equal((await fetch(`${base}/invalid`)).status, 400);
  assert.equal((await fetch(`${base}/discord-999`)).status, 404);
  assert.equal((await client.execute({ sql: "SELECT payload FROM hannariko_context_records WHERE id = ?", args: [record.id] })).rows[0].payload, original);
  console.log("Context record runtime checks passed");
} finally {
  await client.execute({ sql: "DELETE FROM hannariko_context_records WHERE id = ?", args: [record.id] });
  client.close();
}
