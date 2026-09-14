import { createTool, type ToolExecutionContext } from "@mastra/core/tools";
import { z } from "zod";
import {
  reminderInputSchema,
  reminderWorkflow,
} from "../workflows/reminder-workflow";

const reminderSchema = reminderInputSchema.pick({
  scheduledAt: true,
  message: true,
});

const reminderSummarySchema = z.object({
  id: z.string(),
  scheduledAt: z.string(),
  message: z.string(),
});

function getConversation(context: ToolExecutionContext) {
  const threadId = context.agent?.threadId;
  const resourceId = context.agent?.resourceId;

  if (!threadId || !resourceId) {
    throw new Error("このツールは会話スレッド内でのみ使用できます。");
  }

  return { threadId, resourceId };
}

async function getReminders(context: ToolExecutionContext) {
  const { threadId, resourceId } = getConversation(context);
  const { runs } = await reminderWorkflow.listWorkflowRuns({ resourceId });
  const reminders = runs.map(({ runId, snapshot }) => {
    const state = (
      typeof snapshot === "string" ? JSON.parse(snapshot) : snapshot
    ) as {
      status?: string;
      context?: { input?: Record<string, unknown> };
    };
    const input = state.context?.input;

    if (
      !state.status ||
      !["pending", "running", "waiting"].includes(state.status) ||
      input?.threadId !== threadId ||
      typeof input.scheduledAt !== "string" ||
      typeof input.message !== "string"
    ) {
      return null;
    }

    return {
      id: runId,
      scheduledAt: input.scheduledAt,
      message: input.message,
    };
  });

  return reminders
    .filter((reminder): reminder is z.infer<typeof reminderSummarySchema> =>
      Boolean(reminder),
    )
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
}

export const createReminderTool = createTool({
  id: "create-reminder",
  description:
    "このDiscord会話へ指定日時に一度だけ通知するリマインダーを登録します。日時はタイムゾーンを含むISO 8601形式で、ユーザーがタイムゾーンを指定しない場合はAsia/Tokyoとして指定してください。",
  inputSchema: reminderSchema,
  outputSchema: reminderSummarySchema,
  requireApproval: true,
  execute: async ({ scheduledAt, message }, context) => {
    const scheduledDate = new Date(scheduledAt);

    if (Number.isNaN(scheduledDate.getTime())) {
      throw new Error("scheduledAtには有効なISO 8601日時を指定してください。");
    }
    if (scheduledDate.getTime() <= Date.now()) {
      throw new Error("scheduledAtには未来の日時を指定してください。");
    }

    const { threadId, resourceId } = getConversation(context);
    const run = await reminderWorkflow.createRun({ resourceId });
    const { runId } = await run.startAsync({
      inputData: {
        scheduledAt: scheduledDate.toISOString(),
        message,
        threadId,
        resourceId,
      },
    });

    return {
      id: runId,
      scheduledAt: scheduledDate.toISOString(),
      message,
    };
  },
});

export const listRemindersTool = createTool({
  id: "list-reminders",
  description: "このDiscord会話に登録されている単発リマインダーを一覧表示します。",
  inputSchema: z.object({}),
  outputSchema: z.object({ reminders: z.array(reminderSummarySchema) }),
  execute: async (_, context) => ({ reminders: await getReminders(context) }),
});

export const cancelReminderTool = createTool({
  id: "cancel-reminder",
  description: "このDiscord会話に登録されている単発リマインダーを取り消します。",
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ canceled: z.boolean() }),
  requireApproval: true,
  execute: async ({ id }, context) => {
    const { resourceId } = getConversation(context);
    const reminders = await getReminders(context);

    if (!reminders.some((reminder) => reminder.id === id)) {
      throw new Error("この会話に該当するリマインダーはありません。");
    }

    const run = await reminderWorkflow.createRun({ runId: id, resourceId });
    await run.cancel();

    return { canceled: true };
  },
});
