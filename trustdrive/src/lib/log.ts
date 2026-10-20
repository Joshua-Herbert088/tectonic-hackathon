import { config } from "./config";

/**
 * Logging. In production one JSON object per line with a `severity`, which log collectors parse into
 * structured entries; in development a readable line.
 */
type Level = "DEBUG" | "INFO" | "WARNING" | "ERROR";

function write(severity: Level, message: string, fields: Record<string, unknown> = {}) {
  if (config.production) {
    const line = JSON.stringify({ severity, message, ...fields });
    if (severity === "ERROR") console.error(line);
    else console.log(line);
    return;
  }
  const extra = Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : "";
  (severity === "ERROR" ? console.error : severity === "WARNING" ? console.warn : console.log)(`[${severity.toLowerCase()}] ${message}${extra}`);
}

export const log = {
  debug: (message: string, fields?: Record<string, unknown>) => write("DEBUG", message, fields),
  info: (message: string, fields?: Record<string, unknown>) => write("INFO", message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => write("WARNING", message, fields),
  error: (message: string, fields?: Record<string, unknown>) => write("ERROR", message, fields),
};
