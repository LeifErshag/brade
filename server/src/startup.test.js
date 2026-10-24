import { jest } from "@jest/globals";
import { runStartup } from "./startup.js";

function setup() {
  const proc = { exit: jest.fn() };
  const logger = { error: jest.fn() };
  return { proc, logger };
}

describe("runStartup", () => {
  test("logs a rejected startup and exits with code 1", async () => {
    const { proc, logger } = setup();
    const err = new Error("postgres unreachable");
    await runStartup(async () => { throw err; }, proc, logger);
    expect(logger.error).toHaveBeenCalledWith("Server failed to start", { err });
    expect(proc.exit).toHaveBeenCalledWith(1);
  });

  test("a synchronous throw in start is handled the same way", async () => {
    const { proc, logger } = setup();
    const err = new Error("sync boom");
    await runStartup(() => { throw err; }, proc, logger);
    expect(logger.error).toHaveBeenCalledWith("Server failed to start", { err });
    expect(proc.exit).toHaveBeenCalledWith(1);
  });

  test("a successful startup does not exit", async () => {
    const { proc, logger } = setup();
    const start = jest.fn(async () => {});
    await runStartup(start, proc, logger);
    expect(start).toHaveBeenCalled();
    expect(proc.exit).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});
