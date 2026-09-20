import { registerApiRoute } from "@mastra/core/server";
import { ContextRecordStore, recordMarkdown, validRecordId } from "./store.ts";

export function contextRecordRoutes(store: ContextRecordStore) {
  return [
    registerApiRoute("/context-records", {
      method: "GET",
      handler: async c => {
        c.header("Cache-Control", "no-store");
        const limit = Number(c.req.query("limit") ?? 20);
        const before = c.req.query("before");
        if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (before && !validRecordId(before))) {
          return c.json({ error: "Invalid pagination" }, 400);
        }
        return c.json(await store.list(limit, before));
      },
    }),
    registerApiRoute("/context-records/:id", {
      method: "GET",
      handler: async c => {
        c.header("Cache-Control", "no-store");
        const id = c.req.param("id");
        if (!validRecordId(id)) return c.json({ error: "Invalid record ID" }, 400);
        const record = await store.get(id);
        if (!record) return c.json({ error: "Record not found" }, 404);
        return c.req.query("format") === "markdown" ? c.text(recordMarkdown(record)) : c.json(record);
      },
    }),
  ];
}
