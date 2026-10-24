import { log } from "../log.js";

// Final Express error middleware.
//
// Client errors that carry a 4xx `status` (e.g. body-parser's 400 for
// malformed JSON or 413 for a body over the size limit) are passed through
// with that status. Everything else becomes a generic 500. Stack traces and
// internal messages are never sent to the client.
export function errorHandler(logger = log) {
  return (err, req, res, next) => {
    const status = err?.status ?? err?.statusCode;
    const isClientError = Number.isInteger(status) && status >= 400 && status < 500;

    if (isClientError) {
      // Not err.message: for malformed JSON it quotes part of the client's
      // body. Log only the status and the http-errors `type`, if any.
      logger.warn(`Client error ${status}${typeof err.type === "string" ? ` (${err.type})` : ""}`);
    } else {
      // A fixed message, so one search finds every 500; the error goes in err.
      // req.path, not req.url: the query string may carry a token.
      logger.error("Request failed", { method: req?.method, path: req?.path, userId: req?.userId, err });
    }

    // Response already started: let Express abort the connection.
    if (res.headersSent) return next(err);

    if (isClientError) {
      // http-errors marks messages that are safe to show with `expose`.
      const message = err.expose && err.message ? err.message : "Bad request";
      return res.status(status).json({ error: message });
    }
    res.status(500).json({ error: "Internal server error" });
  };
}
