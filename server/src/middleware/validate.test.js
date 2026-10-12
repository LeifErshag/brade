import { jest } from "@jest/globals";
import { z } from "zod";
import { validate } from "./validate.js";

function run(mw, req) {
  const res = {
    status: jest.fn(function () { return this; }),
    json:   jest.fn(function () { return this; }),
  };
  const next = jest.fn();
  mw(req, res, next);
  return { res, next };
}

describe("validate()", () => {
  const schema = z.object({ name: z.string().trim().min(1) });

  test("validates req.body by default and replaces it with parsed data", () => {
    const req = { body: { name: "  Anna  ", extra: 1 }, query: {} };
    const { next } = run(validate(schema), req);
    expect(next).toHaveBeenCalled();
    expect(req.body).toEqual({ name: "Anna" });
  });

  test("rejects an invalid body with 400", () => {
    const { res, next } = run(validate(schema), { body: { name: "" } });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("can validate req.query and replaces it with parsed data", () => {
    const req = { body: {}, query: { name: "  Bo " } };
    const { next } = run(validate(schema, "query"), req);
    expect(next).toHaveBeenCalled();
    expect(req.query).toEqual({ name: "Bo" });
    expect(req.body).toEqual({});
  });

  test("rejects an invalid query with 400", () => {
    const req = { body: { name: "ok" }, query: { name: ["a", "b"] } };
    const { res, next } = run(validate(schema, "query"), req);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].issues[0].path).toEqual(["name"]);
  });
});
