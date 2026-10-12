// Process-level safety net for errors that escape every other handler.
//
// An unhandled rejection is logged and the process keeps running: on Node 15+
// it would otherwise kill the server and drop every live game.
//
// An uncaught exception leaves the process in an unknown state, so it is
// logged and the process exits with a failure code; the host restarts it.
export function installProcessErrorHandlers(proc = process, logger = console) {
  proc.on("unhandledRejection", (reason) => {
    logger.error("Unhandled promise rejection:", reason);
  });
  proc.on("uncaughtException", (err, origin) => {
    logger.error(`Uncaught exception (${origin}):`, err);
    proc.exit(1);
  });
}
