/**
 * Optional External Educational Video Discovery (YouTube Data API v3).
 * Strictly gated behind `process.env.YOUTUBE_API_KEY`.
 * If not configured, cleanly returns `{ enabled: false, items: [] }` without any mock/fake data.
 */

export interface ExternalVideoResult {
  externalId: string;
  title: string;
  channelTitle: string;
  description: string;
  thumbnailUrl: string;
  watchUrl: string;
  embedUrl: string;
  publishedAt: string;
  isExternal: true;
  sourceLabel: 'External Educational Video';
}

const YT_CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_YT_CACHE = 120;
const ytCache = new Map<string, { items: ExternalVideoResult[]; expiresAt: number }>();

export function isYouTubeDiscoveryConfigured(): boolean {
  return Boolean(process.env.YOUTUBE_API_KEY && process.env.YOUTUBE_API_KEY.trim().length > 10);
}

export async function searchExternalEducationalVideos(
  query: string,
  maxResults = 6
): Promise<{ enabled: boolean; items: ExternalVideoResult[] }> {
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  const cleanQuery = String(query || '').trim();
  if (!apiKey || cleanQuery.length < 2) {
    return { enabled: Boolean(apiKey), items: [] };
  }

  const cacheKey = `${cleanQuery.toLowerCase()}::${maxResults}`;
  const cached = ytCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { enabled: true, items: cached.items };
  }

  try {
    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('type', 'video');
    url.searchParams.set('videoEmbeddable', 'true');
    url.searchParams.set('safeSearch', 'strict');
    url.searchParams.set('maxResults', String(Math.min(10, Math.max(1, maxResults))));
    url.searchParams.set('q', `${cleanQuery} educational lecture`);
    url.searchParams.set('key', apiKey);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const resp = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timer);

    if (!resp.ok) {
      return { enabled: true, items: [] };
    }

    const json = (await resp.json()) as {
      items?: Array<{
        id?: { videoId?: string };
        snippet?: {
          title?: string;
          channelTitle?: string;
          description?: string;
          publishedAt?: string;
          thumbnails?: { medium?: { url?: string }; high?: { url?: string } };
        };
      }>;
    };

    const items: ExternalVideoResult[] = (json.items || [])
      .filter((it) => Boolean(it.id?.videoId && it.snippet?.title))
      .map((it) => {
        const videoId = it.id!.videoId!;
        return {
          externalId: videoId,
          title: it.snippet!.title || 'Educational Video',
          channelTitle: it.snippet!.channelTitle || 'YouTube Educator',
          description: it.snippet!.description || '',
          thumbnailUrl:
            it.snippet!.thumbnails?.high?.url ||
            it.snippet!.thumbnails?.medium?.url ||
            `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          watchUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
          embedUrl: `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?rel=0`,
          publishedAt: it.snippet!.publishedAt || '',
          isExternal: true,
          sourceLabel: 'External Educational Video',
        };
      });

    if (ytCache.size >= MAX_YT_CACHE) {
      const oldest = ytCache.keys().next().value;
      if (oldest) ytCache.delete(oldest);
    }
    ytCache.set(cacheKey, { items, expiresAt: Date.now() + YT_CACHE_TTL_MS });
    return { enabled: true, items };
  } catch {
    return { enabled: true, items: [] };
  }
}
