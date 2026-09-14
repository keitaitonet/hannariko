import { Mastra } from "@mastra/core";
import { MastraCompositeStore } from "@mastra/core/storage";
import { DuckDBStore } from "@mastra/duckdb";
import { LibSQLStore } from "@mastra/libsql";
import {
  MastraStorageExporter,
  Observability,
  SensitiveDataFilter,
} from "@mastra/observability";
import { discordAgent } from "./agents/discord-agent";
import { reminderWorkflow } from "./workflows/reminder-workflow";

export const mastra = new Mastra({
  bundler: {
    externals: ["@duckdb/node-bindings"],
  },
  agents: { discordAgent },
  workflows: { reminderWorkflow },
  storage: new MastraCompositeStore({
    id: "composite-storage",
    default: new LibSQLStore({
      id: "mastra-storage",
      url: "file:./mastra.db",
    }),
    domains: {
      observability: new DuckDBStore().observability,
    },
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: "hannariko",
        exporters: [new MastraStorageExporter()],
        spanOutputProcessors: [new SensitiveDataFilter()],
      },
    },
  }),
});
