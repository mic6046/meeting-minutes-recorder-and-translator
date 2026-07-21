/** In-memory cache for read-aloud speech chunks (skips repeat translation API calls). */

export type SpeechTab = "minutes" | "transcript";

export interface SpeechCacheEntry {
  chunks: string[];
}

const speechChunkCache = new Map<string, SpeechCacheEntry>();

function hashContent(content: string): string {
  let hash = 5381;
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) + hash) ^ content.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

/** Stable key: history item id (or content hash) + tab + target language. */
export function buildSpeechCacheKey(opts: {
  meetingId?: string | null;
  content: string;
  tab: SpeechTab;
  targetLang: string;
}): string {
  const lang = opts.targetLang.toLowerCase().split("-")[0] || "en";
  const idPart = opts.meetingId?.trim() || `hash:${hashContent(opts.content)}`;
  return `${idPart}:${opts.tab}:${lang}`;
}

export function getSpeechCache(key: string): SpeechCacheEntry | undefined {
  return speechChunkCache.get(key);
}

export function setSpeechCache(key: string, entry: SpeechCacheEntry): void {
  speechChunkCache.set(key, entry);
}

export function invalidateSpeechCacheForMeeting(meetingId: string): void {
  const prefix = `${meetingId}:`;
  for (const key of speechChunkCache.keys()) {
    if (key.startsWith(prefix)) {
      speechChunkCache.delete(key);
    }
  }
}

export function clearSpeechCache(): void {
  speechChunkCache.clear();
}
