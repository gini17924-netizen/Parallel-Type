/**
 * phase 110: the team relay engine — two (or more) players share ONE word
 * list word-by-word: word i belongs to player (i % playerCount), a player
 * may ONLY type while the current word is theirs, and finishing a word
 * passes the turn. PURE: no stores, no wire — the lan-match layer wraps
 * this with the room plumbing later. the deterministic split makes every
 * player's share identical across machines (the seeded-race rule).
 */

export type RelayPlayer = {
  playerId: string;
  /** the words this player owns (their slice of the alternating split) */
  words: string[];
  /** how many of THEIR words are fully typed */
  done: number;
  /** chars typed into their CURRENT word */
  typed: number;
};

export type RelayState = {
  players: RelayPlayer[];
  /** the global word index the relay is waiting on */
  cursor: number;
  /** the player whose word is next */
  activePlayerId: string;
  phase: "ready" | "running" | "complete";
};

export function splitWords(
  words: string[],
  playerIds: string[],
): RelayPlayer[] {
  return playerIds.map((playerId, index) => ({
    playerId,
    words: words.filter(
      (_, wordIndex) => wordIndex % playerIds.length === index,
    ),
    done: 0,
    typed: 0,
  }));
}

/** creates the relay state for a shared word list and the seating order */
export function createRelay(words: string[], playerIds: string[]): RelayState {
  const players = splitWords(words, playerIds);
  const first = players[0];
  return {
    players,
    cursor: 0,
    activePlayerId: first?.playerId ?? "",
    phase: players.every((player) => player.words.length === 0)
      ? "complete"
      : "ready",
  };
}

function playerOf(
  state: RelayState,
  playerId: string,
): RelayPlayer | undefined {
  return state.players.find((player) => player.playerId === playerId);
}

/** the word the relay is waiting on, and whose it is */
export function currentWord(
  state: RelayState,
): { playerId: string; word: string } | undefined {
  if (state.phase !== "running" && state.phase !== "ready") return undefined;
  const player = playerOf(state, state.activePlayerId);
  const word = player?.words[player.done];
  if (player === undefined || word === undefined) return undefined;
  return { playerId: player.playerId, word };
}

/** feeds one key for ONE player — ignored unless the relay is waiting on
 * that player's current word; a completed word passes the turn. returns
 * the next state (immutable — the wire layer broadcasts it). */
export function feedKey(
  state: RelayState,
  playerId: string,
  key: string,
): RelayState {
  if (state.phase === "complete") return state;
  const current = currentWord(state);
  if (current === undefined || current.playerId !== playerId) return state;
  const word = current.word;
  const player = playerOf(state, playerId) as RelayPlayer;
  const expected = word[player.typed];
  if (expected === undefined || key !== expected) return state; //wrong key: ignored
  const typed = player.typed + 1;
  const players = state.players.map((p) =>
    p.playerId === playerId ? { ...p, typed } : p,
  );
  if (typed >= word.length) {
    //the word is complete: advance the cursor and pass the turn
    const donePlayers = players.map((p) =>
      p.playerId === playerId ? { ...p, typed: 0, done: p.done + 1 } : p,
    );
    const cursor = state.cursor + 1;
    const nextPlayer =
      donePlayers.find(
        (p) => p.playerId !== playerId && (p.words[p.done] ?? "") !== "",
      ) ?? donePlayers[0];
    const allDone = donePlayers.every((p) => p.done >= p.words.length);
    const nextActive = !allDone
      ? (donePlayers.find(
          (p) =>
            p.playerId !== playerId &&
            cursor >= 0 &&
            p.words.length - p.done > 0,
        )?.playerId ??
        nextPlayer?.playerId ??
        state.activePlayerId)
      : state.activePlayerId;
    return {
      players: donePlayers,
      cursor,
      activePlayerId: nextActive,
      phase: allDone ? "complete" : "running",
    };
  }
  return { ...state, players, phase: "running" };
}

/** the handoff rule as data: whose turn is it after the current word */
export function nextWordOwner(state: RelayState): string | undefined {
  const current = currentWord(state);
  if (current === undefined) return undefined;
  const order = state.players.map((player) => player.playerId);
  const index = order.indexOf(current.playerId);
  return order[(index + 1) % order.length];
}
