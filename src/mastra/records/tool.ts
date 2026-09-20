import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { ContextDiscordAdapter, createContextResolver } from "../discord/context.ts";
import { captureContextRecord } from "./capture.ts";
import { ContextRecordStore, type ContextRecord } from "./store.ts";

export function createContextRecordTool(adapter: ContextDiscordAdapter, store: ContextRecordStore) {
  const resolveContext = createContextResolver(adapter, 0);
  const pending = new Map<string, Promise<ContextRecord>>();
  return createTool({
    id: "save-context-record",
    description: "Discord の会話から、bot の振る舞いへの指摘、改善案、機能の要望など、今後の調査や開発のために残したいことを記録します。自然言語の依頼や会話の意図に応じて使ってください。分類は不要です。指定発言の原文・返信先・周辺会話と、その時点の bot の記憶・実行状態を自動取得して保存します。保存結果の ID をユーザーに伝えてください。",
    inputSchema: z.object({
      messageId: z.string().regex(/^\d{1,20}$/).describe("記録の起点となる、この会話の Discord 発言 ID。user signal の messageId または Discord context の messageId を使う。通常は指摘や要望を述べたユーザーの発言。"),
      note: z.string().max(8000).describe("何を残したいかを自由な自然言語で書く。固定の分類や評価は不要。元の発言は別途そのまま保存される。"),
    }),
    outputSchema: z.object({ id: z.string(), sourceUrl: z.string(), partial: z.boolean() }),
    execute: async ({ messageId, note }, context) => {
      const threadId = context.agent?.threadId;
      const memory = await context.mastra?.getStorage()?.getStore("memory");
      if (!threadId || !memory) throw new Error("このツールは Discord の会話内で使用してください。");
      const thread = await memory.getThreadById({ threadId, resourceId: context.agent?.resourceId });
      const externalThreadId = thread?.metadata?.channel_externalThreadId;
      if (thread?.metadata?.channel_platform !== "discord" || thread.metadata.channel_ownerId !== "discord-agent" || typeof externalThreadId !== "string") {
        throw new Error("この会話の Discord チャンネルを特定できませんでした。");
      }
      const channel = adapter.decodeThreadId(externalThreadId);
      const channelId = channel.threadId ?? channel.channelId;
      const id = `discord-${messageId}`;
      let record = await store.get(id);
      if (record && record.source.channelId !== channelId) throw new Error("別の会話の記録にはアクセスできません。");
      if (!record) {
        let work = pending.get(id);
        if (!work) {
          if (pending.size >= 2) throw new Error("記録処理が混み合っています。少し待ってから再試行してください。");
          work = (async () => {
            const message = await adapter.readIncomingMessage(externalThreadId, messageId);
            const captured = await captureContextRecord({
              adapter, message, note, resolveContext,
              context: { mastra: context.mastra, requestContext: context.requestContext },
            });
            return store.save(captured);
          })();
          pending.set(id, work);
        }
        try { record = await work; } finally { pending.delete(id); }
      }
      if (record.source.channelId !== channelId) throw new Error("別の会話の記録にはアクセスできません。");
      const discordContext = record.sections.discordContext?.data as { unavailable?: string[] } | undefined;
      return {
        id: record.id, sourceUrl: record.source.url,
        partial: Object.values(record.sections).some(section => section.status === "unavailable") || !!discordContext?.unavailable?.length,
      };
    },
  });
}
