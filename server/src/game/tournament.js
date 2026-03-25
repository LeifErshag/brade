/**
 * Tournament bracket generation and advancement logic.
 *
 * Pure bracket functions (no DB/Redis) are exported for use in routes.
 * advanceTournament is the DB-aware hook called after a match completes.
 */

import { v4 as uuid } from "uuid";
import { query } from "../db/postgres.js";
import { getRedis, keys, TTL } from "../db/redis.js";
import { initGame } from "./engine.js";

// ── Pure bracket generation ───────────────────────────────────────────────────

/**
 * Round-robin schedule via the circle method.
 * playerIds must be sorted by seed (best first).
 * Returns an array of rounds; each round is an array of [whiteId, blackId|null].
 * null means a bye (the non-null player advances automatically).
 */
export function generateRoundRobin(playerIds) {
  const players = [...playerIds];
  if (players.length % 2 === 1) players.push(null); // null = bye slot
  const n = players.length;
  const rounds = n - 1;
  const fixed    = players[0];
  const rotating = players.slice(1);
  const result   = [];

  for (let r = 0; r < rounds; r++) {
    const circle = [fixed, ...rotating];
    const round  = [];
    for (let i = 0; i < n / 2; i++) {
      const a = circle[i];
      const b = circle[n - 1 - i];
      // Alternate home/away each round to balance colours
      round.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    result.push(round);
    rotating.unshift(rotating.pop()); // rotate
  }
  return result;
}

/**
 * Single-elimination round-1 seeding.
 * playerIds sorted best-to-worst. Returns [whiteId, blackId|null] pairs.
 * null means a bye (top seed gets it).
 */
export function generateSingleEliminationRound1(playerIds) {
  const n    = playerIds.length;
  const size = Math.pow(2, Math.ceil(Math.log2(Math.max(n, 2))));
  const padded = [...playerIds, ...Array(size - n).fill(null)];
  const pairs  = [];
  for (let i = 0; i < size / 2; i++) {
    pairs.push([padded[i], padded[size - 1 - i]]);
  }
  return pairs;
}

/**
 * Swiss pairings for a round.
 * standings: [{ playerId, wins, losses }] sorted by wins desc.
 * previousMatches: Set of "idA:idB" strings already played (either direction).
 * Returns [whiteId, blackId|null] pairs (null = bye for last odd player).
 */
export function generateSwissPairings(standings, previousMatches) {
  const remaining = [...standings];
  const pairs     = [];

  while (remaining.length >= 2) {
    const p1 = remaining.shift();
    let matched = false;
    for (let i = 0; i < remaining.length; i++) {
      const p2  = remaining[i];
      const key = `${p1.playerId}:${p2.playerId}`;
      const rev = `${p2.playerId}:${p1.playerId}`;
      if (!previousMatches.has(key) && !previousMatches.has(rev)) {
        pairs.push([p1.playerId, p2.playerId]);
        remaining.splice(i, 1);
        matched = true;
        break;
      }
    }
    if (!matched && remaining.length > 0) {
      // Force pair even if rematch
      const p2 = remaining.shift();
      pairs.push([p1.playerId, p2.playerId]);
    }
  }

  // Odd player out gets a bye
  if (remaining.length === 1) {
    pairs.push([remaining[0].playerId, null]);
  }
  return pairs;
}

// ── Room creation helper ──────────────────────────────────────────────────────

/**
 * Create game rooms + DB records for a set of match pairs.
 * pairs: [[whiteId, blackId|null], ...]
 * Returns the inserted tournament_match rows.
 */
export async function createMatchRound(tournamentId, round, matchLength, pairs) {
  const redis    = getRedis();
  const inserted = [];

  for (const [whiteId, blackId] of pairs) {
    if (blackId === null || whiteId === null) {
      // Bye
      const winner = whiteId ?? blackId;
      const { rows: [tm] } = await query(
        `INSERT INTO tournament_matches
           (tournament_id, round, white_id, black_id, winner_id, status)
         VALUES ($1, $2, $3, $4, $5, 'bye')
         RETURNING *`,
        [tournamentId, round, whiteId, blackId, winner]
      );
      // Credit the bye as a win
      await query(
        `UPDATE tournament_players SET wins = wins + 1, byes = byes + 1
         WHERE  tournament_id = $1 AND player_id = $2`,
        [tournamentId, winner]
      );
      inserted.push(tm);
      continue;
    }

    // Fetch player info
    const { rows: pInfo } = await query(
      `SELECT id, display_name, avatar_url, elo FROM users WHERE id = ANY($1::uuid[])`,
      [[whiteId, blackId]]
    );
    const info = Object.fromEntries(pInfo.map(p => [p.id, p]));

    const roomId = uuid().slice(0, 8).toUpperCase();
    const gs     = initGame();
    gs.legalMoves = [];

    // Persist to games table
    await query(
      `INSERT INTO games (room_id, white_id, black_id, match_length, white_elo_before, black_elo_before)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [roomId, whiteId, blackId, matchLength,
       info[whiteId]?.elo ?? 1200, info[blackId]?.elo ?? 1200]
    );
    const { rows: [gameRow] } = await query(
      `SELECT id FROM games WHERE room_id = $1`, [roomId]
    );

    // Insert tournament match row
    const { rows: [tm] } = await query(
      `INSERT INTO tournament_matches
         (tournament_id, round, room_id, white_id, black_id, status)
       VALUES ($1, $2, $3, $4, $5, 'playing')
       RETURNING *`,
      [tournamentId, round, roomId, whiteId, blackId]
    );

    // Build and store room state in Redis — game starts immediately (no lobby)
    const roomState = {
      roomId,
      matchLength,
      createdBy:        whiteId,
      players:          { white: whiteId, black: blackId },
      playerInfo:       {
        white: { display_name: info[whiteId]?.display_name ?? "", avatar_url: info[whiteId]?.avatar_url ?? null },
        black: { display_name: info[blackId]?.display_name ?? "", avatar_url: info[blackId]?.avatar_url ?? null },
      },
      ready:            { white: true, black: true },
      status:           "playing",
      score:            { white: 0, black: 0 },
      gameNum:          1,
      gameState:        gs,
      gameDbId:         gameRow.id,
      createdAt:        Date.now(),
      tournamentId,
      tournamentMatchId: tm.id,
    };
    await redis.set(keys.room(roomId), JSON.stringify(roomState), "EX", TTL.room);
    inserted.push(tm);
  }

  return inserted;
}

// ── Tournament advancement ────────────────────────────────────────────────────

/**
 * Called when a tournament match completes.
 * Updates standings, checks if the round is done, and advances if so.
 */
export async function advanceTournament(tournamentId, matchId, winnerId, loserId) {
  // Update match record
  await query(
    `UPDATE tournament_matches
        SET status = 'completed', winner_id = $2, completed_at = now()
      WHERE id = $1`,
    [matchId, winnerId]
  );

  // Update player standings
  await query(
    `UPDATE tournament_players SET wins = wins + 1
     WHERE tournament_id = $1 AND player_id = $2`,
    [tournamentId, winnerId]
  );
  await query(
    `UPDATE tournament_players SET losses = losses + 1
     WHERE tournament_id = $1 AND player_id = $2`,
    [tournamentId, loserId]
  );

  // Fetch tournament state
  const { rows: [t] } = await query(
    `SELECT * FROM tournaments WHERE id = $1`, [tournamentId]
  );
  if (!t || t.status !== "active") return;

  // For single_elimination: eliminate the loser
  if (t.tournament_type === "single_elimination") {
    await query(
      `UPDATE tournament_players SET status = 'eliminated'
       WHERE  tournament_id = $1 AND player_id = $2`,
      [tournamentId, loserId]
    );
  }

  // Check if all matches in current round are done
  const { rows: pending } = await query(
    `SELECT id FROM tournament_matches
     WHERE  tournament_id = $1
       AND  round = $2
       AND  status NOT IN ('completed', 'bye')`,
    [tournamentId, t.current_round]
  );
  if (pending.length > 0) return; // Still matches to play this round

  // ── Round complete — advance ──────────────────────────────────────────────
  const nextRound = t.current_round + 1;

  if (t.tournament_type === "single_elimination") {
    const { rows: active } = await query(
      `SELECT player_id, seed_elo FROM tournament_players
       WHERE  tournament_id = $1 AND status = 'active'
       ORDER  BY seed_elo DESC`,
      [tournamentId]
    );
    if (active.length <= 1) {
      await finalizeTournament(t, active[0]?.player_id ?? winnerId);
      return;
    }
    // Pair survivors (seeded order: best vs 2nd, etc.)
    const playerIds = active.map(p => p.player_id);
    const pairs     = generateSingleEliminationRound1(playerIds); // reuse seeding logic
    await createMatchRound(tournamentId, nextRound, t.match_length, pairs);
    await query(
      `UPDATE tournaments SET current_round = $2 WHERE id = $1`,
      [tournamentId, nextRound]
    );

  } else if (t.tournament_type === "round_robin") {
    if (nextRound > t.total_rounds) {
      // Find winner by standings
      const { rows: [top] } = await query(
        `SELECT player_id FROM tournament_players
         WHERE  tournament_id = $1
         ORDER  BY wins DESC, losses ASC, seed_elo DESC
         LIMIT  1`,
        [tournamentId]
      );
      await finalizeTournament(t, top?.player_id ?? null);
      return;
    }
    // Re-generate the schedule and pick the next round's pairs
    const { rows: players } = await query(
      `SELECT player_id FROM tournament_players
       WHERE  tournament_id = $1
       ORDER  BY seed_elo DESC`,
      [tournamentId]
    );
    const allRounds = generateRoundRobin(players.map(p => p.player_id));
    const pairs     = allRounds[nextRound - 1];
    await createMatchRound(tournamentId, nextRound, t.match_length, pairs);
    await query(
      `UPDATE tournaments SET current_round = $2 WHERE id = $1`,
      [tournamentId, nextRound]
    );

  } else {
    // Swiss
    if (nextRound > t.total_rounds) {
      const { rows: [top] } = await query(
        `SELECT player_id FROM tournament_players
         WHERE  tournament_id = $1
         ORDER  BY wins DESC, losses ASC, seed_elo DESC
         LIMIT  1`,
        [tournamentId]
      );
      await finalizeTournament(t, top?.player_id ?? null);
      return;
    }
    const { rows: players } = await query(
      `SELECT player_id, wins, losses FROM tournament_players
       WHERE  tournament_id = $1
       ORDER  BY wins DESC, losses ASC, seed_elo DESC`,
      [tournamentId]
    );
    const { rows: prevMatches } = await query(
      `SELECT white_id, black_id FROM tournament_matches WHERE tournament_id = $1`,
      [tournamentId]
    );
    const previousSet = new Set(prevMatches.map(m => `${m.white_id}:${m.black_id}`));
    const standings   = players.map(p => ({ playerId: p.player_id, wins: p.wins, losses: p.losses }));
    const pairs       = generateSwissPairings(standings, previousSet);
    await createMatchRound(tournamentId, nextRound, t.match_length, pairs);
    await query(
      `UPDATE tournaments SET current_round = $2 WHERE id = $1`,
      [tournamentId, nextRound]
    );
  }
}

async function finalizeTournament(t, winnerId) {
  // Assign final ranks based on standings
  const { rows: players } = await query(
    `SELECT player_id FROM tournament_players
     WHERE  tournament_id = $1
     ORDER  BY wins DESC, losses ASC, seed_elo DESC`,
    [t.id]
  );
  for (let i = 0; i < players.length; i++) {
    await query(
      `UPDATE tournament_players SET final_rank = $3
       WHERE  tournament_id = $1 AND player_id = $2`,
      [t.id, players[i].player_id, i + 1]
    );
  }
  await query(
    `UPDATE tournaments
        SET status = 'finished', winner_id = $2, ended_at = now()
      WHERE id = $1`,
    [t.id, winnerId]
  );
}
