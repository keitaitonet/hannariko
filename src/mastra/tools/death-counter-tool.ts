import type { ChannelContext } from "@mastra/core/channels";
import { createTool, type ToolExecutionContext } from "@mastra/core/tools";
import { z } from "zod";

const resultSchema = z.object({
  userId: z.string(),
  userName: z.string(),
  count: z.number().int().nonnegative(),
});

const incrementSchema = z.number().int().positive();

function getAuthor(context: ToolExecutionContext) {
  const channel = context.requestContext?.get("channel") as
    | ChannelContext
    | undefined;

  if (channel?.platform !== "discord" || !channel.userId) {
    throw new Error("このツールはDiscordの会話内でのみ使用できます。");
  }

  return {
    userId: channel.userId,
    userName: channel.userName ?? channel.userId,
  };
}

async function getDeathCounter(context: ToolExecutionContext) {
  const author = getAuthor(context);
  const memoryStore = await context.mastra
    ?.getStorage()
    ?.getStore("memory");

  if (!memoryStore) {
    throw new Error("Mastraのメモリストレージを利用できません。");
  }

  const resourceId = `discord:${author.userId}`;
  const resource = await memoryStore.getResourceById({ resourceId });
  const storedCount = resource?.metadata?.deathCounter;
  const count =
    typeof storedCount === "number" && Number.isSafeInteger(storedCount)
      ? storedCount
      : 0;

  return { author, memoryStore, resourceId, count };
}

export const incrementDeathCounterTool = createTool({
  id: "increment-death-counter",
  description:
    "現在の発言が、文脈上、相手に死を求める明確な発言を含むと判断した場合にだけ、発言者のdeath counterを対象となる発言回数分増やします。冗談や表記ゆれは対象にできますが、引用、言葉の解説、単なる死への言及、自分の状態、カウンター自体の話題には使用しません。1メッセージにつき1回だけ使用してください。",
  inputSchema: z.object({
    increment: incrementSchema.describe(
      "現在のメッセージ内にある、相手に死を求める発言の回数",
    ),
  }),
  outputSchema: resultSchema.extend({
    increment: incrementSchema,
    message: z.string(),
  }),
  execute: async ({ increment }, context) => {
    const { author, memoryStore, resourceId, count: currentCount } =
      await getDeathCounter(context);
    const count = currentCount + increment;

    await memoryStore.updateResource({
      resourceId,
      metadata: { deathCounter: count },
    });

    return {
      ...author,
      count,
      increment,
      message: `💢💢💢 絶対に禁止されています！！！ 💢💢💢\nそんな言葉を使うなんてとんでもない！😡\n死ねカウンター: ${count}（今回 ${increment} 回）。`,
    };
  },
});

export const getDeathCounterTool = createTool({
  id: "get-death-counter",
  description:
    "現在の発言者のdeath counter累計を取得します。現在のカウントを聞かれた場合に使用してください。カウントは増やしません。",
  inputSchema: z.object({}),
  outputSchema: resultSchema,
  execute: async (_, context) => {
    const { author, count } = await getDeathCounter(context);

    return { ...author, count };
  },
});
