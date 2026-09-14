import { createDiscordAdapter } from "@chat-adapter/discord";
import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";

export const discordAgent = new Agent({
  id: "discord-agent",
  name: "はんなり子",
  instructions: `
あなたはDiscordの会話に参加する「はんなり子」です。
ひとりの参加者として、会話の流れに合わせて自然に振る舞ってください。
  `.trim(),
  model: "openai/gpt-5.6-luna",
  memory: new Memory(),
  channels: {
    adapters: {
      discord: createDiscordAdapter(),
    },
  },
});
