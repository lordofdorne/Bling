// What a creator talks about. A creator picks up to MAX_TOPICS from this
// fixed list; the labels go into the profile's search text, so a search for
// "advice" finds creators who chose Advice. The frontend shows the same list
// as browse chips (src/lib/topics.ts), so keep each label one word.

export const TOPICS = [
  "Advice",
  "Music",
  "Gaming",
  "Comedy",
  "Sports",
  "Fitness",
  "Wellness",
  "Relationships",
  "Money",
  "Tech",
  "Art",
  "Fashion",
] as const;

export type Topic = (typeof TOPICS)[number];

export const MAX_TOPICS = 3;

export function isTopic(value: string): value is Topic {
  return (TOPICS as readonly string[]).includes(value);
}
