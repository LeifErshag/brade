import { jest } from "@jest/globals";
import { EventEmitter } from "events";
import { installProcessErrorHandlers } from "./processErrors.js";

function setup() {
  const proc = new EventEmitter();
  proc.exit = jest.fn();
  const logger = { error: jest.fn() };
  installProcessErrorHandlers(proc, logger);
  return { proc, logger };
}

describe("installProcessErrorHandlers", () => {
  test("logs an unhandled rejection and keeps the process running", () => {
    const { proc, logger } = setup();
    const reason = new Error("redis down");
    proc.emit("unhandledRejection", reason, Promise.resolve());
    expect(logger.error).toHaveBeenCalledWith("Unhandled promise rejection", { err: reason });
    expect(proc.exit).not.toHaveBeenCalled();
  });

  test("logs an uncaught exception and exits with code 1", () => {
    const { proc, logger } = setup();
    const err = new Error("boom");
    proc.emit("uncaughtException", err, "uncaughtException");
    expect(logger.error).toHaveBeenCalledWith("Uncaught exception", { origin: "uncaughtException", err });
    expect(proc.exit).toHaveBeenCalledWith(1);
  });
});
