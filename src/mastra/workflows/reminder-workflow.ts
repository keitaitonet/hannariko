import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";

export const reminderInputSchema = z.object({
  scheduledAt: z.string(),
  message: z.string(),
  threadId: z.string(),
  resourceId: z.string(),
});

const reminderOutputSchema = z.object({
  deliveredAt: z.string(),
});

const deliverReminder = createStep({
  id: "deliver-reminder",
  inputSchema: reminderInputSchema,
  outputSchema: reminderOutputSchema,
  execute: async ({ inputData, mastra }) => {
    const agent = mastra.getAgent("discordAgent");
    const result = agent.sendSignal(
      {
        type: "notification",
        tagName: "reminder",
        contents: inputData.message,
      },
      {
        threadId: inputData.threadId,
        resourceId: inputData.resourceId,
      },
    );
    const accepted = await result.accepted;

    if (accepted.action === "wake") {
      await accepted.output.consumeStream();
    }

    return { deliveredAt: new Date().toISOString() };
  },
});

export const reminderWorkflow = createWorkflow({
  id: "reminder-workflow",
  inputSchema: reminderInputSchema,
  outputSchema: reminderOutputSchema,
})
  .sleepUntil(async ({ inputData }) => new Date(inputData.scheduledAt), {
    id: "wait-for-reminder",
  })
  .then(deliverReminder)
  .commit();
