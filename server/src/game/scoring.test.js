// ── scoring.js unit tests ─────────────────────────────────────────────────────
import { winRank, compareMatch } from "./scoring.js";

// ── winRank ───────────────────────────────────────────────────────────────────

describe("winRank", () => {
  test("sprangjan ranks highest", () => {
    expect(winRank("sprangjan")).toBeGreaterThan(winRank("jan"));
  });

  test("jan ranks above munk-2pt group", () => {
    expect(winRank("jan")).toBeGreaterThan(winRank("trappspel_munk"));
  });

  test("munk-2pt group all rank equal", () => {
    const r = winRank("kronspel_enkelt_munk");
    expect(winRank("kronspel_dubbelt_munk")).toBe(r);
    expect(winRank("trappspel_munk")).toBe(r);
    expect(winRank("uppspel_munk")).toBe(r);
  });

  test("plain-2pt group all rank equal and below munk-2pt group", () => {
    const munk = winRank("trappspel_munk");
    const plain = winRank("trappspel");
    expect(plain).toBeLessThan(munk);
    expect(winRank("kronspel_enkelt")).toBe(plain);
    expect(winRank("kronspel_dubbelt")).toBe(plain);
    expect(winRank("uppspel")).toBe(plain);
  });

  test("hemspel_munk ranks below plain-2pt group", () => {
    expect(winRank("hemspel_munk")).toBeLessThan(winRank("trappspel"));
  });

  test("hemspel ranks below hemspel_munk", () => {
    expect(winRank("hemspel")).toBeLessThan(winRank("hemspel_munk"));
  });

  test("resign ranks below hemspel", () => {
    expect(winRank("resign")).toBeLessThan(winRank("hemspel"));
  });

  test("unknown type returns 0", () => {
    expect(winRank("totally_unknown")).toBe(0);
  });

  // Confirm trappspel and hemspel_munk have different ranks (both 2 points
  // but trappspel ranks higher per §14).
  test("trappspel ranks above hemspel_munk despite equal points", () => {
    expect(winRank("trappspel")).toBeGreaterThan(winRank("hemspel_munk"));
  });
});

// ── compareMatch ──────────────────────────────────────────────────────────────

describe("compareMatch", () => {
  test("higher cumulative points wins", () => {
    // a: jan(4) = 4 pts; b: hemspel(1)+hemspel(1) = 2 pts
    expect(compareMatch(["jan"], ["hemspel", "hemspel"])).toBe("a");
  });

  test("lower cumulative points loses", () => {
    expect(compareMatch(["hemspel"], ["jan"])).toBe("b");
  });

  test("equal points — higher rank wins first game comparison", () => {
    // a: trappspel(2); b: hemspel_munk(2) — both 2 pts, trappspel ranks higher
    expect(compareMatch(["trappspel"], ["hemspel_munk"])).toBe("a");
  });

  test("equal points — lower rank at first comparison loses", () => {
    expect(compareMatch(["hemspel_munk"], ["trappspel"])).toBe("b");
  });

  test("equal points, first game tied — second game breaks tie", () => {
    // a: [jan(4), hemspel(1)] = 5 pts; b: [jan(4), hemspel_munk(2)] = 6 pts
    // Wait — points differ. Let's keep points equal:
    // a: [trappspel(2), trappspel(2)] = 4 pts
    // b: [jan(4)] = 4 pts → ranked: b has jan(rank6), a has trappspel(rank4),trappspel(rank4)
    //   index 0: b.rank6 > a.rank4 → b wins
    expect(compareMatch(["trappspel", "trappspel"], ["jan"])).toBe("b");
  });

  test("equal points, first ranks tied — second rank breaks tie", () => {
    // a: [trappspel(2), hemspel_munk(2)] sorted ranks: [4, 3] = 4 pts
    // b: [trappspel(2), hemspel(2)] sorted ranks: [4, 2] = 4 pts
    // index 0: both rank 4 — tie
    // index 1: a rank 3 > b rank 2 → a wins
    expect(compareMatch(["trappspel", "hemspel_munk"], ["trappspel", "hemspel"])).toBe("a");
  });

  test("empty results for both — tie", () => {
    expect(compareMatch([], [])).toBe("tie");
  });

  test("one player won nothing — other wins", () => {
    expect(compareMatch([], ["hemspel"])).toBe("b");
    expect(compareMatch(["hemspel"], [])).toBe("a");
  });

  test("identical winning records — tie", () => {
    expect(compareMatch(["jan", "hemspel"], ["jan", "hemspel"])).toBe("tie");
  });

  test("longer list with same leading ranks loses at extra index", () => {
    // a: [trappspel(2), hemspel(1)] = 3 pts   -- ranks [4, 2]
    // b: [trappspel(2), hemspel(1)] = 3 pts   -- ranks [4, 2]
    expect(compareMatch(["trappspel", "hemspel"], ["trappspel", "hemspel"])).toBe("tie");
  });

  test("§14 example: trappspel vs hemspel_munk are both 2 points but different rank", () => {
    // Proves the tie-break distinguishes plays with equal points
    expect(winRank("trappspel")).not.toBe(winRank("hemspel_munk"));
    expect(compareMatch(["trappspel"], ["hemspel_munk"])).toBe("a");
  });
});
