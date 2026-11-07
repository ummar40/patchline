import pino, { type DestinationStream, type Logger } from "pino";
import { redactText, redactValue } from "./redaction";

export type { Logger };

export function createLogger(options: {
  service: string;
  level: string;
  destination?: DestinationStream;
}): Logger {
  return pino(
    {
      level: options.level,
      base: { service: options.service },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label) => ({ level: label }),
        log: (fields) => redactValue(fields) as Record<string, unknown>,
      },
      hooks: {
        logMethod(args, method) {
          const scrubbed = args.map((arg) => (typeof arg === "string" ? redactText(arg) : arg));
          method.apply(this, scrubbed as Parameters<typeof method>);
        },
      },
    },
    options.destination,
  );
}
