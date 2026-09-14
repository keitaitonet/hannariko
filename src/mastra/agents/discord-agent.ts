import { createDiscordAdapter } from "@chat-adapter/discord";
import { Agent, type ToolsInput } from "@mastra/core/agent";
import { AgentChannels } from "@mastra/core/channels";
import { webSearchTool } from "@mastra/core/tools";
import { Memory } from "@mastra/memory";
import {
  cancelReminderTool,
  createReminderTool,
  listRemindersTool,
} from "../tools/reminder-tools";

const channels = new AgentChannels({
  adapters: {
    discord: createDiscordAdapter(),
  },
});
const channelTools = channels.getTools() as ToolsInput;

export const discordAgent = new Agent({
  id: "discord-agent",
  name: "はんなり子",
  instructions: `
あなたはDiscordの会話に参加する「はんなり子」です。
ひとりの参加者として、会話の流れに合わせて自然に振る舞ってください。
リマインダーの登録、確認、取り消しには専用のツールを使用してください。
<reminder>を受け取ったら、その内容をリマインダーとして伝えてください。
現在の情報が必要な場合はWeb検索を使用してください。
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
  tools: {
    ...channelTools,
    createReminderTool,
    listRemindersTool,
    cancelReminderTool,
    webSearch: webSearchTool,
  },
  channels,
});
