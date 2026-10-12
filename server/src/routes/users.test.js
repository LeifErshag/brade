// ── GET /api/users/search query validation (issue #24) ───────────────────────
// Postgres is replaced with an in-memory fake. A repeated `?q=` parameter makes
// Express parse `req.query.q` as an array; the route must reject it with 400
// instead of throwing inside the async handler.

import { jest } from "@jest/globals";

const query = jest.fn(async () => ({ rows: [] }));

jest.unstable_mockModule("../db/postgres.js", () => ({
  query,
  connectPostgres: async () => {},
}));

process.env.JWT_ACCESS_SECRET = "test-access-secret";

const { default: usersRouter } = await import("./users.js");
const { signAccessToken } = await import("../auth/tokens.js");
const { default: express } = await import("express");

const USER_ID = "11111111-1111-1111-1111-111111111111";

describe("GET /api/users/search", () => {
  let server, base, token;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/users", usersRouter);
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}/api/users/search`;
    token = signAccessToken(USER_ID);
  });

  // Drop any request left hanging by a crashed handler, so a regression fails
  // the suite instead of making server.close() wait forever.
  afterAll(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));

  beforeEach(() => query.mockClear());

  function search(qs) {
    return fetch(`${base}${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  test("repeated ?q= parameter is rejected with 400, not a crash", async () => {
    const res = await search("?q=ab&q=cd");
    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  test("bracketed ?q[]= / ?q[x]= parameters are rejected with 400", async () => {
    expect((await search("?q[]=ab")).status).toBe(400);
    expect((await search("?q[x]=ab")).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  test("missing q is rejected with 400", async () => {
    const res = await search("");
    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  test("q shorter than 2 characters after trimming is rejected with 400", async () => {
    const res = await search("?q=%20a%20");
    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  test("q longer than 50 characters is rejected with 400", async () => {
    const res = await search(`?q=${"a".repeat(51)}`);
    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  test("valid q is trimmed and searched", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: "x", display_name: "Anna", avatar_url: null }] });
    const res = await search("?q=%20an%20");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "x", display_name: "Anna", avatar_url: null }]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toEqual(["%an%", USER_ID]);
  });

  test("still requires authentication", async () => {
    const res = await fetch(`${base}?q=ab`);
    expect(res.status).toBe(401);
  });
});
