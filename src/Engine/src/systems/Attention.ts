/**
 * The place keeping a record of you.
 *
 * ## Why this exists
 *
 * Everything the engine had for a player was a collectible. Look at the treeline for
 * thirty seconds, or be on the desktop at 03:33 three nights running, and the reward is
 * that another line appears in a journal. Nothing about the *place* changes, so there is
 * no reason to go back, no reason to look harder, and no reason to care what happens
 * tomorrow. That is what "a wallpaper that moves" means from the inside.
 *
 * The missing piece is not another collectible. It is **consequence**: the world should
 * end up different because of what you did with it, and it should survive a restart.
 *
 * ## The loop
 *
 * Looking at something raises **attention** on that place. Attention decays over days,
 * because a thing you looked at three weeks ago should not still be holding your
 * attention. Escalation is what attention buys: past each threshold the place becomes
 * stranger, and it stays that way.
 *
 * The half that makes it a place rather than a slot machine is **neglect**. A world
 * nobody has looked at creeps upward on its own. Ignoring a place makes it louder. That
 * inverts the usual wallpaper bargain, where looking away means nothing happens.
 *
 * All of it is pure arithmetic over a plain object. No DOM, no canvas, no engine: the
 * rules are the interesting part and they have to be checkable without a browser.
 */

/** What one place knows about how it has been treated. */
export interface WorldAttention {
  /**
   * How much attention the place is currently holding, 0..ATTENTION_CEILING.
   *
   * Not "attention ever paid". A number that only ever goes up is a score, and a score
   * that cannot be spent is a number nobody reads.
   */
  attention: number;
  /** 0..MAX_ESCALATION. What attention has bought, and the only part that is permanent. */
  escalation: number;
  /** Observation ids, oldest first, capped at MAX_OBSERVATIONS. */
  observations: string[];
  /** Epoch ms of the last time attention was paid to this place. Drives neglect. */
  lastAttended: number;
}

export interface AttentionState {
  /** Keyed by world id. A world absent from here has simply never been attended. */
  worlds: Record<string, WorldAttention>;
  /**
   * Conclusions the player has drawn by linking two observations.
   *
   * Stored as ids rather than objects because the text belongs to the terminal and the
   * terminal owns presentation; what is durable is that a link was made and what it
   * linked.
   */
  conclusions: string[];
}

/** Ceiling on a place's attention. Above this, more looking changes nothing. */
export const ATTENTION_CEILING = 3;

/** Attention one observation is worth. */
export const ATTENTION_PER_OBSERVATION = 1;

/**
 * Days after which attention has halved.
 *
 * Three days is tuned against the week a desktop is actually left running: long enough
 * that a place you use daily stays yours, short enough that a fortnight away genuinely
 * is somewhere new again.
 */
export const ATTENTION_HALF_LIFE_DAYS = 3;

/** Days of neglect before a place starts escalating on its own. */
export const NEGLECT_DAYS = 2;

/** How much escalation a full day past the neglect threshold buys. */
export const NEGLECT_PRESSURE_PER_DAY = 0.5;

/** Highest escalation a place can reach. */
export const MAX_ESCALATION = 5;

/** Escalation cost in attention, per level. */
export const ATTENTION_PER_ESCALATION = 1;

/** Ceiling on stored observations, so a state file cannot grow without limit. */
export const MAX_OBSERVATIONS = 60;

/** Ceiling on stored conclusions. */
export const MAX_CONCLUSIONS = 24;

const DAY_MS = 86_400_000;

export function emptyAttention(): AttentionState {
  return { worlds: {}, conclusions: [] };
}

function blankWorld(): WorldAttention {
  return { attention: 0, escalation: 0, observations: [], lastAttended: 0 };
}

/**
 * The observation id for one look at one place on one day.
 *
 * Date-keyed so that looking at the same treeline for a minute does not mint a hundred
 * observations, and so that the journal reads as "you looked at this again the next
 * evening" rather than as a click-count. It is also what makes neglect recoverable: a
 * day is enough to come back, and the place does not hold the specific moment against
 * you.
 */
export function observationId(worldId: string, zoneId: string, dayKey: string): string {
  return `${worldId}/${zoneId}/${dayKey}`;
}

/**
 * Pays attention to a place for one observation.
 *
 * Idempotent within a day for the same zone: the same id appearing twice does not pay
 * twice, so holding the cursor still over the observatory cannot farm escalation. It does
 * update `lastAttended` either way, because *being here* is attendance even when the
 * specific look was a repeat.
 */
export function observe(
  state: AttentionState,
  worldId: string,
  zoneId: string,
  dayKey: string,
  now: number
): { state: AttentionState; paid: boolean } {
  const current = state.worlds[worldId] ?? blankWorld();
  const id = observationId(worldId, zoneId, dayKey);

  if (current.observations.includes(id)) {
    return {
      state: {
        ...state,
        worlds: { ...state.worlds, [worldId]: { ...current, lastAttended: now } },
      },
      paid: false,
    };
  }

  const observations = [...current.observations, id].slice(-MAX_OBSERVATIONS);
  const next: WorldAttention = {
    attention: Math.min(ATTENTION_CEILING, current.attention + ATTENTION_PER_OBSERVATION),
    // Escalation is recomputed from attention in `settle`, never incremented here, so
    // it can never drift out of step with the attention it is supposed to be a
    // threshold reading of.
    escalation: current.escalation,
    observations,
    lastAttended: now,
  };

  return {
    state: { ...state, worlds: { ...state.worlds, [worldId]: next } },
    paid: true,
  };
}

/**
 * Brings one place up to date with the clock.
 *
 * Three things happen and the order matters. Attention decays by half over its half
 * life. Neglect pressure is added if the place has been left long enough, and it is
 * added *after* the decay so a place nobody has visited for a month does not decay its
 * way back to nothing before it gets louder. Escalation is then recomputed, and
 * `max`ed against the stored value so escalation never falls.
 *
 * Escalation not falling is deliberate and is the one asymmetry in this file. A place
 * that has escalated stays escalated: what you did to it is part of it now. Everything
 * else about a place decays, which is what makes coming back worthwhile.
 */
export function settle(state: AttentionState, worldId: string, now: number): AttentionState {
  const current = state.worlds[worldId];
  if (!current) return state;

  const days = Math.max(0, (now - current.lastAttended) / DAY_MS);
  const decayed = current.attention * Math.pow(0.5, days / ATTENTION_HALF_LIFE_DAYS);

  const neglected = Math.max(0, days - NEGLECT_DAYS);
  const pressured = decayed + neglected * NEGLECT_PRESSURE_PER_DAY;

  const attention = Math.min(ATTENTION_CEILING, pressured);
  const fromAttention = Math.floor(attention / ATTENTION_PER_ESCALATION);

  const escalation = Math.max(current.escalation, fromAttention);
  if (escalation === current.escalation && Math.abs(attention - current.attention) < 1e-9) {
    return state;
  }

  return {
    ...state,
    worlds: { ...state.worlds, [worldId]: { ...current, attention, escalation } },
  };
}

/** Settles every known place. Cheap enough to call on a world change. */
export function settleAll(state: AttentionState, now: number): AttentionState {
  let out = state;
  for (const worldId of Object.keys(state.worlds)) out = settle(out, worldId, now);
  return out;
}

/** The escalation of a place that has never been attended. */
export function escalationOf(state: AttentionState, worldId: string): number {
  return state.worlds[worldId]?.escalation ?? 0;
}

/**
 * How often the scheduler may fire an anomaly here, as a multiplier.
 *
 * 1 at escalation 0, falling to about a fifth at the top. This is the whole mechanical
 * consequence of escalation and the reason it is worth anything: a place you attend
 * fires more often, and a place you have let go quiet for a week goes almost still.
 */
export function anomalyRateMultiplier(escalation: number): number {
  const level = Math.max(0, Math.min(MAX_ESCALATION, escalation));
  return Math.max(0.2, 1 - level * 0.16);
}

/**
 * Records a conclusion drawn by linking two observations.
 *
 * Returns the state unchanged if the conclusion is already recorded, so a player cannot
 * farm escalation by re-linking the same pair.
 */
export function conclude(state: AttentionState, conclusionId: string): AttentionState {
  if (state.conclusions.includes(conclusionId)) return state;
  return {
    ...state,
    conclusions: [...state.conclusions, conclusionId].slice(-MAX_CONCLUSIONS),
  };
}

/** How many observations a place has, for the terminal's readout. */
export function observationCount(state: AttentionState, worldId: string): number {
  return state.worlds[worldId]?.observations.length ?? 0;
}

/**
 * Rebuilds attention from untrusted input.
 *
 * The state file sits in %APPDATA% and is editable by hand, exactly like an imported
 * world or a configured feed, so every field is checked rather than coerced. A hostile
 * or merely broken file produces a playable place rather than a crash, and escalation
 * is clamped because an unclamped one would let a hand-edited state file fire every
 * anomaly at once.
 */
export function reconcileAttention(raw: unknown): AttentionState {
  if (!raw || typeof raw !== 'object') return emptyAttention();
  const source = raw as Partial<AttentionState>;
  const out = emptyAttention();

  if (source.worlds && typeof source.worlds === 'object' && !Array.isArray(source.worlds)) {
    for (const [worldId, value] of Object.entries(source.worlds)) {
      if (!value || typeof value !== 'object') continue;
      const w = value as Partial<WorldAttention>;
      const attention =
        typeof w.attention === 'number' && Number.isFinite(w.attention)
          ? Math.max(0, Math.min(ATTENTION_CEILING, w.attention))
          : 0;
      const escalation =
        typeof w.escalation === 'number' && Number.isFinite(w.escalation)
          ? Math.max(0, Math.min(MAX_ESCALATION, Math.floor(w.escalation)))
          : 0;
      const observations = Array.isArray(w.observations)
        ? w.observations.filter((o): o is string => typeof o === 'string').slice(-MAX_OBSERVATIONS)
        : [];
      const lastAttended =
        typeof w.lastAttended === 'number' && Number.isFinite(w.lastAttended)
          ? Math.max(0, w.lastAttended)
          : 0;
      out.worlds[worldId] = { attention, escalation, observations, lastAttended };
    }
  }

  if (Array.isArray(source.conclusions)) {
    out.conclusions = source.conclusions
      .filter((c): c is string => typeof c === 'string')
      .slice(-MAX_CONCLUSIONS);
  }

  return out;
}
