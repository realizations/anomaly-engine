/**
 * While you were away.
 *
 * The north star for this project, from the original brief: *the best moment
 * is when the user looks at their desktop and realizes that something changed
 * while they were away.*
 *
 * That moment only works under three conditions, all of which are easy to get
 * wrong:
 *
 *  1. It has to be earned. An absence summary shown on every launch is a
 *     notification. It is only interesting when the gap was long enough for
 *     something to have happened, so a short gap says nothing at all.
 *  2. It has to be deniable. The summary reports *the world's* change, not the
 *     player's. "The tide went out further than the chart allows" is unsettling.
 *     "An anomaly was triggered for you" is a coupon.
 *  3. It has to be brief. It is shown once, on the terminal, and it does not
 *     wait to be acknowledged. A thing that demands attention is not a
 *     discovery.
 *
 * Everything here is phrased as something the place did, in the same register
 * as the rest of the world, and every line carries an explanation.
 */

import { mulberry32 } from '../render/noise.js';
import type { WorldDefinition } from '../worlds/types.js';

/** Below this, there is nothing worth saying. */
const MIN_AWAY_MS = 45 * 60 * 1000;
/** Above this, the copy changes register: the place has been quiet a long
 *  time, and that is itself a thing to notice. */
const LONG_AWAY_MS = 8 * 60 * 60 * 1000;

/** One line of the return summary. */
export interface ReturnLine {
  text: string;
  /** A plausible explanation, so the player can dismiss it. */
  deniability: string;
}

export interface AwaySummary {
  /** How long the engine was not running, in ms. */
  awayMs: number;
  /** Human phrasing of the gap, e.g. "11 hours". */
  awayPhrase: string;
  /** One line per thing that happened while the engine was off. */
  lines: ReturnLine[];
  /** True when the gap was long enough to be worth saying anything. */
  worthShowing: boolean;
}

/** A line about the world having continued without being watched. */
interface DriftLine {
  text: string;
  deniability: string;
  /** Minimum gap before this line becomes available. */
  minAwayMs: number;
}

/**
 * Per-biome drift, so a return reads as a property of the place. A salt flat
 * and a fell do not go on doing the same thing while nobody is looking.
 */
const DRIFT: Record<string, DriftLine[]> = {
  'temperate-forest': [
    { text: 'The treeline moved in closer than the last survey recorded.', deniability: 'A season. Nothing in one afternoon.', minAwayMs: 6 * 3600e3 },
    { text: 'The pines have gone quiet. Not silent, just not reporting.', deniability: 'Wind. It does that.', minAwayMs: 4 * 3600e3 },
    { text: 'Something has been through the fence line. The wire is down in one place.', deniability: 'A deer, or weather.', minAwayMs: 3 * 3600e3 },
  ],
  'salt-marsh': [
    { text: 'The water is further out than it was. The flats have dried behind it.', deniability: 'A spring tide. Twice a month.', minAwayMs: 5 * 3600e3 },
    { text: 'The reeds have all leaned the same way since you last looked.', deniability: 'One wind, and they lean for days.', minAwayMs: 3 * 3600e3 },
  ],
  alpine: [
    { text: 'The snow has taken the cairn. You cannot see the top two stones.', deniability: 'It does that by October.', minAwayMs: 5 * 3600e3 },
    { text: 'The dish is pointing somewhere it was not pointing before.', deniability: 'Wind loads the mount. They drift.', minAwayMs: 8 * 3600e3 },
  ],
  'high-desert': [
    { text: 'The cracks have widened. The ground is drier than it was.', deniability: 'It has not rained here all year.', minAwayMs: 6 * 3600e3 },
    { text: 'The dishes have been recording silence for a long time now.', deniability: 'There is nothing to record out here.', minAwayMs: 8 * 3600e3 },
  ],
  coast: [
    { text: 'The sea came in further and went out further than the chart allows.', deniability: 'A storm, offshore. It would show.', minAwayMs: 5 * 3600e3 },
    { text: 'The light has been kept. Every interval, on schedule.', deniability: 'It is on a timer. You knew that.', minAwayMs: 4 * 3600e3 },
  ],
  'liminal-interior': [
    { text: 'The corridor is longer. The far end is further away than it was.', deniability: 'You are misremembering. Corridors do that.', minAwayMs: 3 * 3600e3 },
    { text: 'The lights are all on. They were on before, but fewer were.', deniability: 'A maintenance cycle. They run on a schedule.', minAwayMs: 2 * 3600e3 },
    { text: 'One of the doors is ajar. You closed it.', deniability: 'Draught.', minAwayMs: 4 * 3600e3 },
  ],
};

/** A line that works anywhere, used when the biome has nothing to say. */
const UNIVERSAL: DriftLine[] = [
  { text: 'The light moved while the engine was off. The room looks different for it.', deniability: 'It was going to.', minAwayMs: 3600e3 },
];

/** Human phrasing for a gap. */
export function phraseDuration(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} minutes`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    const rem = mins % 60;
    return rem >= 10 ? `${hours} hours` : `${hours} hours`;
  }
  const days = Math.round(hours / 24);
  return days === 1 ? 'a day' : `${days} days`;
}

/**
 * Builds the summary for a gap. Returns `worthShowing: false` for short gaps,
 * which the caller is expected to honour by showing nothing at all.
 */
export function buildAwaySummary(
  awayMs: number,
  world: WorldDefinition,
  seed: number
): AwaySummary {
  const base: AwaySummary = {
    awayMs,
    awayPhrase: phraseDuration(awayMs),
    lines: [],
    worthShowing: awayMs >= MIN_AWAY_MS,
  };
  if (!base.worthShowing) return base;

  const pool = [...(DRIFT[world.biome] ?? []), ...UNIVERSAL]
    // Only lines the gap is long enough to have earned.
    .filter((d) => awayMs >= d.minAwayMs)
    .sort((a, b) => a.minAwayMs - b.minAwayMs);

  // One line, occasionally two. A long absence earns slightly more than one.
  const want = awayMs >= LONG_AWAY_MS ? 2 : 1;
  const rnd = mulberry32((seed ^ 0x3a1f) >>> 0);
  const picked = new Set<number>();
  while (picked.size < Math.min(want, pool.length)) {
    picked.add(Math.floor(rnd() * pool.length));
  }

  // Reported oldest-last so the most recent thing is the last thing read.
  for (const i of [...picked].sort((a, b) => a - b)) {
    const d = pool[i];
    if (d) base.lines.push({ text: d.text, deniability: d.deniability });
  }

  return base;
}

/** Renders a summary as terminal lines, wrapped to the terminal's width.
 *
 *  The terminal is small by design, so a long line has to wrap rather than be
 *  truncated. Truncating the summary is the one failure this feature cannot
 *  have, because the clipped words are the unsettling ones.
 */
export function summaryToTerminalLines(summary: AwaySummary, width = 30): string[] {
  if (!summary.worthShowing) return [];
  const out: string[] = [`> AWAY ${summary.awayPhrase.toUpperCase()}`];
  for (const l of summary.lines) {
    // Wrap on words, with a two-space gutter so continuation lines read as
    // part of the same statement.
    const words = l.text.split(/\s+/);
    let row = '  ';
    for (const word of words) {
      if (row.length + word.length + 1 > width && row.trim().length > 0) {
        out.push(row);
        row = '    ';
      }
      row += (row.endsWith('  ') && row.length === 2 ? '' : ' ') + word;
    }
    if (row.trim().length > 0) out.push(row);
  }
  out.push('  RESUMING');
  return out;
}
