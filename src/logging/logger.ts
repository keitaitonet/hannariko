type LogEvent = {
  type: string;
  [key: string]: unknown;
};

export const logger = {
  log(event: LogEvent): void {
    console.dir(event, { depth: null });
  },
};
