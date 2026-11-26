import { Router } from 'express';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  contents,
  recommendationEvents,
  userProfiles,
  userSearchHistory,
  videoWatchProgress,
} from '../db/schema.ts';
import { isGeminiEmbeddingsConfigured } from '../lib/embeddings.ts';
import {
  getContinueWatching,
  getHomePersonalizedRecommendations,
  getSmartSuggestions,
  getVideoRecommendations,
  logSearchHistoryEntry,
  runSmartSearch,
} from '../lib/search-engine.ts';
import {
  isYouTubeDiscoveryConfigured,
  searchExternalEducationalVideos,
} from '../lib/youtube-discovery.ts';
import { optionalAuth, requireAuth, type AuthRequest } from '../middleware/auth.ts';

export const searchRouter = Router();
export const discoveryRouter = Router();

function parsePosInt(val: unknown): number | null {
  const n = Number(val);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// GET /api/search/suggestions?q=...
searchRouter.get('/suggestions', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 140);
    const data = await getSmartSuggestions(q, req.user?.id);
    res.setHeader('Cache-Control', 'private, max-age=10');
    return res.json(data);
  } catch (error) {
    console.error('Search suggestions error:', error);
    return res.status(500).json({ error: 'Unable to load search suggestions.' });
  }
});

// GET /api/search?q=...&category=...&subject=...&classLevel=...&chapter=...&topic=...&duration=...&teacher=...&language=...&pricing=...&sort=...
searchRouter.get('/', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 160);
    const category = String(req.query.category || '').trim().slice(0, 80);
    const subject = String(req.query.subject || '').trim().slice(0, 80);
    const contentType = String(req.query.contentType || '').trim().slice(0, 60);
    const language = String(req.query.language || '').trim().slice(0, 40);
    const pricing = String(req.query.pricing || 'all').trim();
    const classLevel = String(req.query.classLevel || '').trim().slice(0, 60);
    const chapter = String(req.query.chapter || '').trim().slice(0, 120);
    const topic = String(req.query.topic || '').trim().slice(0, 120);
    const duration = String(req.query.duration || 'all').trim().slice(0, 20);
    const teacher = String(req.query.teacher || '').trim().slice(0, 120);
    const sort = String(req.query.sort || '').trim().slice(0, 30);
    const limit = Math.min(30, Math.max(1, Number(req.query.limit || 12)));
    const offset = Math.max(0, Number(req.query.offset || 0));
    const logHistory = req.query.log !== '0';

    const includeExternal =
      req.query.includeExternal === '1' && isYouTubeDiscoveryConfigured() && q.length >= 2;

    const [searchRes, externalRes] = await Promise.all([
      runSmartSearch(
        {
          q,
          category,
          subject,
          contentType,
          language,
          pricing,
          classLevel,
          chapter,
          topic,
          duration,
          teacher,
          sort: sort || undefined,
          limit,
          offset,
        },
        req.user?.id
      ),
      includeExternal
        ? searchExternalEducationalVideos(q, 4)
        : Promise.resolve({ enabled: isYouTubeDiscoveryConfigured(), items: [] }),
    ]);

    let historyEntryId: number | null = null;
    if (logHistory && q.length >= 2 && req.user?.id && offset === 0) {
      historyEntryId = await logSearchHistoryEntry({
        userId: req.user.id,
        query: q,
        filters: Object.fromEntries(
          Object.entries({
            category,
            subject,
            contentType,
            language,
            pricing,
            classLevel,
            chapter,
            topic,
            duration,
            teacher,
          }).filter(([, v]) => Boolean(v && v !== 'all'))
        ),
        resultsCount: searchRes.total,
      });
    }

    res.setHeader('Cache-Control', 'private, max-age=10');
    return res.json({
      ...searchRes,
      historyEntryId,
      externalVideos: externalRes.items,
      features: {
        geminiEmbeddings: isGeminiEmbeddingsConfigured(),
        youtubeDiscovery: isYouTubeDiscoveryConfigured(),
      },
    });
  } catch (error) {
    console.error('Smart search error:', error);
    return res.status(500).json({ error: 'Unable to perform smart search.' });
  }
});

// GET /api/search/history
searchRouter.get('/history', requireAuth, async (req: AuthRequest, res) => {
  try {
    const [profile] = await db
      .select({ personalizationEnabled: userProfiles.personalizationEnabled })
      .from(userProfiles)
      .where(eq(userProfiles.userId, req.user!.id))
      .limit(1);

    const rows = await db
      .select({
        id: userSearchHistory.id,
        query: userSearchHistory.query,
        resultsCount: userSearchHistory.resultsCount,
        clickedContentId: userSearchHistory.clickedContentId,
        createdAt: userSearchHistory.createdAt,
      })
      .from(userSearchHistory)
      .where(eq(userSearchHistory.userId, req.user!.id))
      .orderBy(desc(userSearchHistory.createdAt))
      .limit(20);

    return res.json({
      personalizationEnabled: profile?.personalizationEnabled !== false,
      history: rows,
    });
  } catch (error) {
    console.error('Load search history error:', error);
    return res.status(500).json({ error: 'Unable to load search history.' });
  }
});

// POST /api/search/history/click
searchRouter.post('/history/click', requireAuth, async (req: AuthRequest, res) => {
  try {
    const historyId = parsePosInt(req.body?.historyId);
    const contentId = parsePosInt(req.body?.contentId);
    if (!contentId) return res.status(400).json({ error: 'Valid contentId is required.' });

    if (historyId) {
      await db
        .update(userSearchHistory)
        .set({ clickedContentId: contentId })
        .where(
          and(eq(userSearchHistory.id, historyId), eq(userSearchHistory.userId, req.user!.id))
        );
    }

    return res.json({ ok: true });
  } catch (error) {
    console.error('Record search click error:', error);
    return res.status(500).json({ error: 'Unable to record search selection.' });
  }
});

// DELETE /api/search/history?id=...
searchRouter.delete('/history', requireAuth, async (req: AuthRequest, res) => {
  try {
    const entryId = parsePosInt(req.query.id);
    if (entryId) {
      await db
        .delete(userSearchHistory)
        .where(
          and(eq(userSearchHistory.id, entryId), eq(userSearchHistory.userId, req.user!.id))
        );
      return res.json({ ok: true, deletedId: entryId, message: 'Search entry removed.' });
    }

    await db.delete(userSearchHistory).where(eq(userSearchHistory.userId, req.user!.id));
    return res.json({ ok: true, clearedAll: true, message: 'Search history cleared.' });
  } catch (error) {
    console.error('Delete search history error:', error);
    return res.status(500).json({ error: 'Unable to clear search history.' });
  }
});

// PATCH /api/search/preferences
searchRouter.patch('/preferences', requireAuth, async (req: AuthRequest, res) => {
  try {
    const personalizationEnabled = Boolean(req.body?.personalizationEnabled);
    await db
      .insert(userProfiles)
      .values({
        userId: req.user!.id,
        personalizationEnabled,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userProfiles.userId,
        set: {
          personalizationEnabled,
          updatedAt: new Date(),
        },
      });

    return res.json({
      ok: true,
      personalizationEnabled,
      message: personalizationEnabled
        ? 'Personalized search and recommendations enabled.'
        : 'Search personalization paused.',
    });
  } catch (error) {
    console.error('Update search preferences error:', error);
    return res.status(500).json({ error: 'Unable to update search preferences.' });
  }
});

// ===== DISCOVERY & VIDEO RECOMMENDATION / WATCH PROGRESS ROUTES (Mounted at /api) =====

// GET /api/videos/:id/related
discoveryRouter.get('/videos/:id/related', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const contentId = parsePosInt(req.params.id);
    if (!contentId) return res.status(400).json({ error: 'Invalid content ID.' });

    const [item] = await db
      .select({ id: contents.id, title: contents.title, status: contents.status, deletedAt: contents.deletedAt })
      .from(contents)
      .where(eq(contents.id, contentId))
      .limit(1);

    if (!item || item.status !== 'approved' || item.deletedAt) {
      return res.status(404).json({ error: 'Content not found.' });
    }

    const includeExternal =
      req.query.includeExternal === '1' && isYouTubeDiscoveryConfigured();

    const [recs, externalRes] = await Promise.all([
      getVideoRecommendations(contentId, req.user?.id),
      includeExternal
        ? searchExternalEducationalVideos(item.title, 4)
        : Promise.resolve({ enabled: isYouTubeDiscoveryConfigured(), items: [] }),
    ]);

    res.setHeader('Cache-Control', 'private, max-age=15');
    return res.json({
      ...recs,
      externalVideos: externalRes.items,
      youtubeDiscoveryEnabled: externalRes.enabled,
    });
  } catch (error) {
    console.error('Related videos error:', error);
    return res.status(500).json({ error: 'Unable to load related educational videos.' });
  }
});

// GET /api/recommendations
discoveryRouter.get('/recommendations', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const limit = Math.min(12, Math.max(1, Number(req.query.limit || 4)));
    const [homeRecs, continueWatching] = await Promise.all([
      getHomePersonalizedRecommendations(req.user?.id, limit),
      req.user?.id ? getContinueWatching(req.user.id, 4) : Promise.resolve([]),
    ]);

    res.setHeader('Cache-Control', 'private, max-age=15');
    return res.json({
      personalized: homeRecs.personalized,
      items: homeRecs.items,
      continueWatching,
    });
  } catch (error) {
    console.error('Home recommendations error:', error);
    return res.status(500).json({ error: 'Unable to load recommendations.' });
  }
});

// GET /api/continue-watching
discoveryRouter.get('/continue-watching', requireAuth, async (req: AuthRequest, res) => {
  try {
    const limit = Math.min(12, Math.max(1, Number(req.query.limit || 6)));
    const items = await getContinueWatching(req.user!.id, limit);
    return res.json({ items });
  } catch (error) {
    console.error('Continue watching error:', error);
    return res.status(500).json({ error: 'Unable to load continue watching list.' });
  }
});

async function handleUpsertWatchProgress(req: AuthRequest, res: import('express').Response, contentIdParam?: unknown) {
  try {
    const contentId = parsePosInt(contentIdParam ?? req.body?.contentId);
    if (!contentId) return res.status(400).json({ error: 'Invalid content ID.' });

    const [contentRow] = await db
      .select({
        id: contents.id,
        status: contents.status,
        deletedAt: contents.deletedAt,
        durationSeconds: contents.durationSeconds,
      })
      .from(contents)
      .where(and(eq(contents.id, contentId), eq(contents.status, 'approved'), isNull(contents.deletedAt)))
      .limit(1);

    if (!contentRow) {
      return res.status(404).json({ error: 'Publication not found.' });
    }

    const rawWatched = Math.max(0, Math.round(Number(req.body?.watchedSeconds || 0)));
    const rawDuration = Math.max(0, Math.round(Number(req.body?.durationSeconds || 0)));
    const rawPosition = Math.max(
      0,
      Math.round(Number(req.body?.lastPositionSeconds ?? rawWatched))
    );
    const completedEvent = Boolean(req.body?.completedEvent);

    const [existing] = await db
      .select()
      .from(videoWatchProgress)
      .where(
        and(
          eq(videoWatchProgress.userId, req.user!.id),
          eq(videoWatchProgress.contentId, contentId)
        )
      )
      .limit(1);

    const effectiveDuration =
      rawDuration > 0 ? rawDuration : existing?.durationSeconds || contentRow.durationSeconds || 0;

    const computedPercent = completedEvent
      ? 100
      : effectiveDuration > 0
      ? Math.min(100, Math.max(0, Math.round((rawPosition / effectiveDuration) * 100)))
      : existing?.progressPercent || 0;

    const maxWatched = Math.max(rawWatched, existing?.watchedSeconds || 0);
    const maxPercent = Math.max(computedPercent, existing?.progressPercent || 0);

    // Never mark completed merely on video open or < 90% watch time unless genuine 'ended' event fired
    const isCompleted = Boolean(
      existing?.completed ||
        completedEvent ||
        (effectiveDuration > 0 && computedPercent >= 90)
    );

    const now = new Date();
    const [saved] = await db
      .insert(videoWatchProgress)
      .values({
        userId: req.user!.id,
        contentId,
        watchedSeconds: maxWatched,
        durationSeconds: effectiveDuration,
        lastPositionSeconds: isCompleted && completedEvent ? 0 : rawPosition,
        progressPercent: isCompleted ? Math.max(90, maxPercent) : maxPercent,
        completed: isCompleted,
        completedAt: isCompleted ? now : null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [videoWatchProgress.userId, videoWatchProgress.contentId],
        set: {
          watchedSeconds: maxWatched,
          durationSeconds: effectiveDuration,
          lastPositionSeconds: isCompleted && completedEvent ? 0 : rawPosition,
          progressPercent: isCompleted ? Math.max(90, maxPercent) : maxPercent,
          completed: isCompleted,
          completedAt: existing?.completedAt || (isCompleted ? now : null),
          updatedAt: now,
        },
      })
      .returning();

    // Populate real detected duration on content row if missing
    if (!contentRow.durationSeconds && rawDuration >= 10) {
      db.update(contents)
        .set({ durationSeconds: rawDuration })
        .where(eq(contents.id, contentId))
        .catch(() => {});
    }

    return res.json({
      ok: true,
      progress: saved,
    });
  } catch (error) {
    console.error('Save watch progress error:', error);
    return res.status(500).json({ error: 'Unable to save playback progress.' });
  }
}

// POST /api/videos/:id/progress
discoveryRouter.post('/videos/:id/progress', requireAuth, async (req: AuthRequest, res) => {
  return handleUpsertWatchProgress(req, res, req.params.id);
});

// POST /api/watch-history
discoveryRouter.post('/watch-history', requireAuth, async (req: AuthRequest, res) => {
  return handleUpsertWatchProgress(req, res, req.body?.contentId);
});

// POST /api/recommendations/event
discoveryRouter.post('/recommendations/event', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const targetContentId = parsePosInt(req.body?.targetContentId);
    if (!targetContentId) return res.status(400).json({ error: 'Invalid targetContentId.' });

    const sourceContentId = parsePosInt(req.body?.sourceContentId);
    const eventType = req.body?.eventType === 'click' ? 'click' : 'impression';
    const section = String(req.body?.section || 'relatedVideos').trim().slice(0, 60);

    await db.insert(recommendationEvents).values({
      userId: req.user?.id || null,
      sourceContentId: sourceContentId || null,
      targetContentId,
      section,
      eventType,
    });

    return res.json({ ok: true });
  } catch {
    return res.status(200).json({ ok: false });
  }
});
