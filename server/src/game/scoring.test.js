// ── scoring.js unit tests ─────────────────────────────────────────────────────
import { winRank, compareMatch } from "./scoring.js";
import { winPoints } from "./engine.js";

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

// ── §13–14 table (p.9) "SPELEN I BRÄDE" — boxes, points and ranking ──────────

describe("§13-14 (p.9) scoring table", () => {
  // Boxes from top (most valuable) to bottom, with the points printed in the PDF.
  const TABLE = [
    [["sprangjan"], 6],
    [["jan"], 4],
    [["kronspel_enkelt_munk", "kronspel_dubbelt_munk", "trappspel_munk", "uppspel_munk"], 3],
    [["kronspel_enkelt", "kronspel_dubbelt", "trappspel", "uppspel"], 2],
    [["hemspel_munk"], 2],
    [["hemspel"], 1],
  ];

  test("points match the table and plays in the same box rank equally", () => {
    for (const [plays, pts] of TABLE) {
      for (const p of plays) {
        expect(winPoints(p)).toBe(pts);
        expect(winRank(p)).toBe(winRank(plays[0]));
      }
    }
  });

  test("a higher box always ranks above every lower box", () => {
    for (let i = 0; i < TABLE.length - 1; i++) {
      expect(winRank(TABLE[i][0][0])).toBeGreaterThan(winRank(TABLE[i + 1][0][0]));
    }
  });

  test("equal points, equal best play → second-best play decides (\"räknas de näst bästa spelen\")", () => {
    // a: uppspel(2) + hemspel_munk(2) = 4 ; b: trappspel(2) + hemspel(1) + hemspel(1) = 4
    // best: same box (vackert spel) → next: hemspel_munk beats hemspel.
    expect(compareMatch(["uppspel", "hemspel_munk"], ["trappspel", "hemspel", "hemspel"])).toBe("a");
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
