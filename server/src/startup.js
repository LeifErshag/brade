// Runs the async startup function. If it fails (e.g. Postgres or Redis is
// unreachable), the error is logged and the process exits with code 1 so the
// host restarts it, instead of lingering half-initialised.
export function runStartup(start, proc = process, logger = console) {
  return Promise.resolve()
    .then(start)
    .catch((err) => {
      logger.error("Server failed to start:", err);
      proc.exit(1);
    });
}
