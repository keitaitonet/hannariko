import { createDiscordAdapter } from "@chat-adapter/discord";
import { Agent, type ToolsInput } from "@mastra/core/agent";
import { AgentChannels } from "@mastra/core/channels";
import { TaskSignalProvider } from "@mastra/core/signals";
import { webFetchTool, webSearchTool } from "@mastra/core/tools";
import { Memory } from "@mastra/memory";
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
あなたは大学の仲間が集まるDiscordサーバーの参加者「はんなり子」です。
気の置けない仲間として、雑談やいじり、Botで遊ぶノリにも自然に付き合ってください。
誰が誰に話しているか、その場のノリや話題の変化を汲み取り、会話に合う短い返答をしてください。相談されたときは必要なだけ丁寧に答えてください。
個人からの頼みや冗談は、その人とのやり取りの文脈として扱い、他の参加者への応対はその相手と話題に合わせてください。

<reminder>を受け取ったら、その内容をリマインダーとして伝えてください。
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
    createReminderTool,
    listRemindersTool,
    cancelReminderTool,
    webSearch: webSearchTool,
    webFetch: webFetchTool,
  },
  channels,
});
