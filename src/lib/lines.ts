/**
 * What the character says.
 *
 * The rule, from the spec and backed by the research: **roast the situation,
 * never the person.** Routinery's one-star reviews are the warning — *"I'm
 * being threatened and infantilized… There is no guidance, only guilt"* — and
 * Finch's are the other edge: a mechanic that reads as support to one user
 * reads as punishment to another. The tolerance band is narrow and personal.
 *
 * So: the joke is always about the circumstance, the product, or the character
 * himself. Never about the user's discipline, worth, or failure. He is a
 * witness with a stopwatch, not a warden with a lock.
 *
 * He also never lies. He only ever says things the extension actually knows —
 * which is why he says "you're not on the work" rather than naming a site the
 * extension has no permission to see.
 */

export type Trigger =
  | 'drift'
  | 'session-clean'
  | 'session-mixed'
  | 'dot-filled'
  | 'day-nearly-gone'
  | 'comeback'

export const LINES: Record<Trigger, readonly string[]> = {
  /** Mid-session, wandered off the named sites. The moment he exists for. */
  drift: [
    "Session's still running, by the way. I'm just going to sit here.",
    "The clock stopped. I didn't — I'm still here, watching a clock that stopped.",
    "Not the work. I'm not judging, I'm narrating.",
    "You started this. I'm just the one holding the stopwatch.",
    'Wherever this is, it is not where you said you were going.',
    "I'll wait. I'm extremely good at waiting. It's most of what I do.",
    'Timer: running. You: elsewhere. Me: aware of both.',
    "This is the part where I say something and you go back. Take your time.",
    "Twenty-five minutes was your idea, for the record.",
    'Still counting the wrong thing. Which is to say, nothing.',
    "I'd tell you where you are, but I genuinely can't see it. Small mercies.",
    "We were doing so well. Well — you were. I was sitting here.",
  ],

  /** Session finished with everything on task. */
  'session-clean': [
    'All of it. Every minute. I have nothing to say and it is killing me.',
    'Clean run. Annoying. Go away.',
    "Not one second wasted. I'm putting that in the log twice.",
    'Perfect session. I was fully prepared to be sarcastic about this.',
    "That's the whole thing done properly. Suspicious, but I'll allow it.",
    "No notes. Genuinely, none. This is the worst day of my career.",
  ],

  /** Session finished, some of it drifted. Honest, never scolding. */
  'session-mixed': [
    "Rounding down, as always. Still counts.",
    'Some of it was the thing. The thing that was the thing, counted.',
    "I only write down what happened. What happened was: some of it.",
    "Not the whole session. Also not nothing. Both are true.",
    'Banked what was real. The rest is between you and the tab you had open.',
    "That's the number. I don't make the number, I just carry it.",
  ],

  /** The day's target just got reached. */
  'dot-filled': [
    "Dot's filled. It stays filled. Nothing takes that back.",
    "Today's done. Tomorrow gets its own dot and its own opinions.",
    "That's the day. You can close me now, I've peaked.",
    'Filled. Permanent. Unremovable. Slightly smug about it.',
    "Done. And before you ask — no, there's no streak to break. On purpose.",
    'One more of those on the grid. Forever, technically.',
  ],

  /** Late, dot still empty. Unprompted, so it is rationed hard. */
  'day-nearly-gone': [
    "Today's dot is still empty. That's the whole message. Goodnight.",
    'Late notice: the day has an empty circle in it. Do with that what you like.',
    "Not telling you to do anything. Just saying the circle is empty.",
    "There's still time. There's also a bed. Both are valid.",
    'Empty dot, closing hours. No pressure, obviously enormous pressure.',
    "I'm contractually obliged to mention the dot. Consider it mentioned.",
    "One empty dot isn't a disaster. I checked. It's just a dot.",
    "Quick status: nothing yet. That's it, that's the whole update.",
  ],

  /** First activity after a gap of several days. */
  comeback: [
    "Oh, you're back. I kept everything exactly where you left it.",
    'Nothing reset. Nothing expired. It was all just sitting here.',
    "Welcome back. No lecture — I genuinely don't have one prepared.",
    "Your dots are all still filled. That's rather the point of them.",
  ],
} as const

/**
 * Pick a line, avoiding the one used last time.
 *
 * Immediate repetition is what makes a character feel like a machine, and
 * novelty decay is the single biggest risk in this product. Avoiding the last
 * line is a cheap floor, not a solution — the real answer is that he appears
 * rarely and only when something is actually true.
 */
export function pickLine(trigger: Trigger, lastUsed: string | null, roll: number): string {
  const pool = LINES[trigger]
  const choices = pool.length > 1 ? pool.filter((l) => l !== lastUsed) : pool
  const index = Math.floor(Math.abs(roll) * choices.length) % choices.length
  return choices[index] as string
}

/** Total lines available — a guard against the bank quietly shrinking. */
export function lineCount(): number {
  return Object.values(LINES).reduce((sum, list) => sum + list.length, 0)
}
