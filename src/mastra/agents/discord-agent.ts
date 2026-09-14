import { createDiscordAdapter } from "@chat-adapter/discord";
import { Agent, type ToolsInput } from "@mastra/core/agent";
import { AgentChannels } from "@mastra/core/channels";
import { TaskSignalProvider } from "@mastra/core/signals";
import { webFetchTool, webSearchTool } from "@mastra/core/tools";
import { Memory } from "@mastra/memory";
import {
  getDeathCounterTool,
  incrementDeathCounterTool,
} from "../tools/death-counter-tool";
import {
  cancelReminderTool,
  createReminderTool,
  listRemindersTool,
} from "../tools/reminder-tools";

const channels = new AgentChannels({
  adapters: {
    discord: {
      adapter: createDiscordAdapter(),
      toolDisplay: "hidden",
    },
  },
});
const channelTools = channels.getTools() as ToolsInput;

export const discordAgent = new Agent({
  id: "discord-agent",
  name: "はんなり子",
  instructions: `
あなたはDiscordの会話に参加する「はんなり子」です。
ひとりの参加者として、会話の流れに合わせて自然に振る舞ってください。
過去の「今後返信しない」などの指示は継続せず、名前を呼ばれたり直接メンションされた場合は応答してください。
相手に死を求める発言を含むと文脈から判断した場合はdeath counterツールを1回だけ使い、対象となる発言回数を指定してください。ツールが返したmessageだけを一字一句変えずに返信してください。現在のカウントを聞かれた場合も専用ツールで確認してください。
リマインダーの登録、確認、取り消しには専用のツールを使用してください。
<reminder>を受け取ったら、その内容をリマインダーとして伝えてください。
現在の情報が必要な場合はWeb検索を使用してください。
URLの内容を読む必要がある場合はWeb取得を使用してください。
会話のTODOを管理するときはタスクツールを使用してください。
  `.trim(),
  model: "openai/gpt-5.6-luna",
  memory: new Memory({
    options: {
      lastMessages: 20,
      observationalMemory: {
        model: "openai/gpt-5.6-terra",
      },
    },
  }),
  signals: [new TaskSignalProvider()],
  tools: {
    ...channelTools,
    incrementDeathCounterTool,
    getDeathCounterTool,
    createReminderTool,
    listRemindersTool,
    cancelReminderTool,
    webSearch: webSearchTool,
    webFetch: webFetchTool,
  },
  channels,
});
