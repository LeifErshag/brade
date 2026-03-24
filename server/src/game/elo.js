const K = 32;

// result: 1 = white wins, 0 = black wins
export function computeElo(whiteElo, blackElo, result) {
  const expected = 1 / (1 + Math.pow(10, (blackElo - whiteElo) / 400));
  const delta = Math.round(K * (result - expected));
  return {
    whiteAfter: whiteElo + delta,
    blackAfter: blackElo - delta,
  };
}
