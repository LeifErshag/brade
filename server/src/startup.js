// Runs the async startup function. If it fails (e.g. Postgres or Redis is
// unreachable), the error is logged and the process exits with code 1 so the
// host restarts it, instead of lingering half-initialised.
import { log } from "./log.js";

export function runStartup(start, proc = process, logger = log) {
  return Promise.resolve()
    .then(start)
    .catch((err) => {
      logger.error("Server failed to start", { err });
      proc.exit(1);
    });
}
