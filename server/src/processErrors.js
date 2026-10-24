// Process-level safety net for errors that escape every other handler.
//
// An unhandled rejection is logged and the process keeps running: on Node 15+
// it would otherwise kill the server and drop every live game.
//
// An uncaught exception leaves the process in an unknown state, so it is
// logged and the process exits with a failure code; the host restarts it.
import { log } from "./log.js";

export function installProcessErrorHandlers(proc = process, logger = log) {
  proc.on("unhandledRejection", (reason) => {
    // { err }: the reason may be any value, or undefined.
    logger.error("Unhandled promise rejection", { err: reason });
  });
  proc.on("uncaughtException", (err, origin) => {
    logger.error("Uncaught exception", { origin, err });
    proc.exit(1);
  });
}
