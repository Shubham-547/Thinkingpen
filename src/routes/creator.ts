import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  adminSettings,
  categories,
  commissionRecords,
  contentFiles,
  contents,
  contentTags,
  creatorProfiles,
  creatorWallets,
  notifications,
  subjects,
  transactions,
  users,
  withdrawals,
} from '../db/schema.ts';
import {
  ALLOWED_UPLOAD_MIMES,
  createAutoPreview,
  estimateReadingTime,
  getStorageRoot,
  sanitizeHtml,
  sanitizeSafeUrl,
  slugify,
} from '../lib/security.ts';
import { resolveCommissionRate } from '../lib/payments.ts';
import { requireAuth, requireCreator, type AuthRequest } from '../middleware/auth.ts';

const router = Router();

const storageRoot = getStorageRoot();
if (!fs.existsSync(storageRoot)) {
  fs.mkdirSync(storageRoot, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      if (!fs.existsSync(storageRoot)) {
        fs.mkdirSync(storageRoot, { recursive: true });
      }
      cb(null, storageRoot);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
      const uniqueName = `${Date.now()}-${crypto.randomBytes(10).toString('hex')}${ext}`;
      cb(null, uniqueName);
    },
  }),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB upper cap; per-MIME caps verified below
  },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_UPLOAD_MIMES[file.mimetype]) {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
      return;
    }
    cb(null, true);
  },
});

const INLINE_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const inlineImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB max per inline editor photo
  },
  fileFilter: (_req, file, cb) => {
    if (!INLINE_IMAGE_MIMES.has(file.mimetype)) {
      cb(new Error('Only JPG, PNG, WebP, and GIF images are allowed in the editor.'));
      return;
    }
    cb(null, true);
  },
});

function hasValidImageSignature(buf: Buffer, mime: string): boolean {
  if (buf.length < 12) return false;
  if (mime === 'image/jpeg') {
    return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  }
  if (mime === 'image/png') {
    return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  }
  if (mime === 'image/gif') {
    const header = buf.subarray(0, 6).toString('ascii');
    return header === 'GIF87a' || header === 'GIF89a';
  }
  if (mime === 'image/webp') {
    return (
      buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buf.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  return false;
}

const SUPPORTED_CONTENT_TYPES = [
  'Notes',
  'PDF / Documents',
  'Articles',
  'E-books',
  'Video Lectures',
  'Online Tutorials',
  'Poems',
  'Stories',
  'Research Papers',
  'Other Educational Content',
];

// GET /api/creator/dashboard
router.get('/dashboard', requireAuth, requireCreator, async (req: AuthRequest, res) => {
  try {
    const creatorId = req.user!.id;

    let [wallet] = await db
      .select()
      .from(creatorWallets)
      .where(eq(creatorWallets.creatorId, creatorId))
      .limit(1);

    if (!wallet) {
      [wallet] = await db
        .insert(creatorWallets)
        .values({ creatorId })
        .onConflictDoNothing()
        .returning();
      if (!wallet) {
        [wallet] = await db
          .select()
          .from(creatorWallets)
          .where(eq(creatorWallets.creatorId, creatorId))
          .limit(1);
      }
    }

    const [profile] = await db
      .select()
      .from(creatorProfiles)
      .where(eq(creatorProfiles.userId, creatorId))
      .limit(1);

    const myContents = await db
      .select({
        id: contents.id,
        title: contents.title,
        slug: contents.slug,
        shortDescription: contents.shortDescription,
        coverImageUrl: contents.coverImageUrl,
        contentType: contents.contentType,
        language: contents.language,
        priceInr: contents.priceInr,
        isFree: contents.isFree,
        status: contents.status,
        rejectionReason: contents.rejectionReason,
        customCommissionRate: contents.customCommissionRate,
        viewsCount: contents.viewsCount,
        likesCount: contents.likesCount,
        purchasesCount: contents.purchasesCount,
        avgRating: contents.avgRating,
        reviewsCount: contents.reviewsCount,
        categoryId: contents.categoryId,
        subjectId: contents.subjectId,
        categoryName: categories.name,
        subjectName: subjects.name,
        publishedAt: contents.publishedAt,
        createdAt: contents.createdAt,
        updatedAt: contents.updatedAt,
      })
      .from(contents)
      .leftJoin(categories, eq(contents.categoryId, categories.id))
      .leftJoin(subjects, eq(contents.subjectId, subjects.id))
      .where(eq(contents.creatorId, creatorId))
      .orderBy(desc(contents.updatedAt));

    const myCommissions = await db
      .select({
        id: commissionRecords.id,
        contentId: commissionRecords.contentId,
        contentTitle: contents.title,
        grossAmountInr: commissionRecords.grossAmountInr,
        commissionRate: commissionRecords.commissionRate,
        commissionSource: commissionRecords.commissionSource,
        platformCommissionInr: commissionRecords.platformCommissionInr,
        creatorEarningsInr: commissionRecords.creatorEarningsInr,
        status: commissionRecords.status,
        createdAt: commissionRecords.createdAt,
      })
      .from(commissionRecords)
      .innerJoin(contents, eq(commissionRecords.contentId, contents.id))
      .where(eq(commissionRecords.creatorId, creatorId))
      .orderBy(desc(commissionRecords.createdAt))
      .limit(100);

    const myWithdrawals = await db
      .select()
      .from(withdrawals)
      .where(eq(withdrawals.creatorId, creatorId))
      .orderBy(desc(withdrawals.createdAt));

    const myTransactions = await db
      .select()
      .from(transactions)
      .where(eq(transactions.creatorId, creatorId))
      .orderBy(desc(transactions.createdAt))
      .limit(100);

    const [minWithdrawalRow] = await db
      .select()
      .from(adminSettings)
      .where(eq(adminSettings.key, 'min_withdrawal_inr'))
      .limit(1);

    const [defaultCommRow] = await db
      .select()
      .from(adminSettings)
      .where(eq(adminSettings.key, 'default_commission_rate'))
      .limit(1);

    const effectiveCommissionRate = profile?.customCommissionRate
      ? Number(profile.customCommissionRate)
      : Number(defaultCommRow?.value || 10);

    const totalViews = myContents.reduce((sum, c) => sum + c.viewsCount, 0);
    const totalLikes = myContents.reduce((sum, c) => sum + c.likesCount, 0);
    const totalPurchases = myContents.reduce((sum, c) => sum + c.purchasesCount, 0);

    return res.json({
      profile: profile || null,
      wallet,
      minWithdrawalInr: Number(minWithdrawalRow?.value || 100),
      effectiveCommissionRate,
      analytics: {
        totalViews,
        totalLikes,
        totalPurchases,
        publishedCount: myContents.filter((c) => c.status === 'approved').length,
        draftCount: myContents.filter((c) => c.status === 'draft').length,
        pendingCount: myContents.filter((c) => c.status === 'pending').length,
        rejectedCount: myContents.filter((c) => c.status === 'rejected').length,
      },
      contents: myContents,
      commissions: myCommissions,
      withdrawals: myWithdrawals,
      transactions: myTransactions,
    });
  } catch (error) {
    console.error('Creator dashboard error:', error);
    return res.status(500).json({ error: 'Unable to load creator dashboard.' });
  }
});

// GET /api/creator/contents/:id (for editing own content)
router.get('/contents/:id', requireAuth, requireCreator, async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const [item] = await db.select().from(contents).where(eq(contents.id, id)).limit(1);
    if (!item) return res.status(404).json({ error: 'Content not found.' });
    if (item.creatorId !== req.user!.id && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'You can only manage your own content.' });
    }
    const files = await db.select().from(contentFiles).where(eq(contentFiles.contentId, id));
    const tags = await db.select().from(contentTags).where(eq(contentTags.contentId, id));
    const comm = await resolveCommissionRate(id, item.creatorId);
    return res.json({
      content: { ...item, tags: tags.map((t) => t.tag) },
      files,
      commission: comm,
    });
  } catch (error) {
    console.error('Fetch creator content error:', error);
    return res.status(500).json({ error: 'Unable to load content for editing.' });
  }
});

// POST /api/creator/contents
router.post('/contents', requireAuth, requireCreator, async (req: AuthRequest, res) => {
  try {
    const title = String(req.body?.title || '').trim();
    const shortDescription = String(req.body?.shortDescription || '').trim();
    const bodyHtml = sanitizeHtml(req.body?.bodyHtml || '');
    const customPreview = sanitizeHtml(req.body?.previewHtml || '');
    const coverImageUrl = sanitizeSafeUrl(req.body?.coverImageUrl, true);
    const categoryId = req.body?.categoryId ? Number(req.body.categoryId) : null;
    const subjectId = req.body?.subjectId ? Number(req.body.subjectId) : null;
    const language = String(req.body?.language || 'English').trim();
    const contentType = String(req.body?.contentType || 'Notes').trim();
    const isFree = Boolean(req.body?.isFree);
    const rawPrice = Number(req.body?.priceInr || 0);
    const ownershipConfirmed = Boolean(req.body?.ownershipConfirmed);
    const submitAction = req.body?.action === 'submit' ? 'submit' : 'draft';
    const externalVideoUrl = sanitizeSafeUrl(req.body?.externalVideoUrl, false) || '';
    const tagsInput: string[] = Array.isArray(req.body?.tags)
      ? req.body.tags
      : String(req.body?.tags || '')
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);

    if (title.length < 4 || title.length > 180) {
      return res.status(400).json({ error: 'Title must be between 4 and 180 characters.' });
    }
    if (shortDescription.length < 15) {
      return res.status(400).json({ error: 'Short description must be at least 15 characters.' });
    }
    if (!SUPPORTED_CONTENT_TYPES.includes(contentType)) {
      return res.status(400).json({ error: 'Invalid content type selected.' });
    }
    if (!isFree && (Number.isNaN(rawPrice) || rawPrice < 10 || rawPrice > 50000)) {
      return res.status(400).json({ error: 'Paid content price must be between ₹10 and ₹50,000.' });
    }
    if (submitAction === 'submit' && !ownershipConfirmed) {
      return res.status(400).json({
        error: 'You must confirm copyright ownership or publishing permission before submitting.',
      });
    }

    const [approvalSetting] = await db
      .select()
      .from(adminSettings)
      .where(eq(adminSettings.key, 'require_content_approval'))
      .limit(1);

    const requireApproval = approvalSetting?.value !== 'false';
    let status: string = 'draft';
    let publishedAt: Date | null = null;
    if (submitAction === 'submit') {
      if (!requireApproval || req.user!.role === 'admin') {
        status = 'approved';
        publishedAt = new Date();
      } else {
        status = 'pending';
      }
    }

    const finalPrice = isFree ? '0.00' : rawPrice.toFixed(2);
    const previewHtml = customPreview || createAutoPreview(bodyHtml || shortDescription);
    const readingTimeMins = estimateReadingTime(bodyHtml || shortDescription);

    const [created] = await db
      .insert(contents)
      .values({
        creatorId: req.user!.id,
        title,
        slug: slugify(title),
        shortDescription,
        bodyHtml,
        previewHtml,
        coverImageUrl,
        categoryId,
        subjectId,
        language,
        contentType,
        priceInr: finalPrice,
        isFree,
        status,
        ownershipConfirmed,
        readingTimeMins,
        publishedAt,
      })
      .returning();

    if (tagsInput.length > 0) {
      const uniqueTags = Array.from(
        new Set(tagsInput.map((t) => t.toLowerCase().slice(0, 40)))
      ).slice(0, 10);
      await db
        .insert(contentTags)
        .values(uniqueTags.map((tag) => ({ contentId: created.id, tag })));
    }

    if (externalVideoUrl && /^https?:\/\//i.test(externalVideoUrl)) {
      await db.insert(contentFiles).values({
        contentId: created.id,
        fileType: 'video',
        originalName: `${title} - Authorized Video Stream`,
        storagePath: 'external',
        mimeType: 'video/external',
        sizeBytes: 0,
        isPreview: false,
        externalVideoUrl,
      });
    }

    if (status === 'pending') {
      const admins = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, 'admin'));
      if (admins.length > 0) {
        await db.insert(notifications).values(
          admins.map((a) => ({
            userId: a.id,
            type: 'content_submission',
            title: 'New content awaiting approval',
            message: `${req.user!.name} submitted "${title}" (${contentType}) for review.`,
            link: '#/admin/approvals',
          }))
        );
      }
    }

    return res.status(201).json({
      content: created,
      message:
        status === 'approved'
          ? 'Content published live!'
          : status === 'pending'
          ? 'Content submitted for administrator approval.'
          : 'Draft saved.',
    });
  } catch (error) {
    console.error('Create content error:', error);
    return res.status(500).json({ error: 'Unable to save content.' });
  }
});

// PUT /api/creator/contents/:id
router.put('/contents/:id', requireAuth, requireCreator, async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const [existing] = await db.select().from(contents).where(eq(contents.id, id)).limit(1);
    if (!existing) return res.status(404).json({ error: 'Content not found.' });
    if (existing.creatorId !== req.user!.id && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'You can only edit your own content.' });
    }

    const title = String(req.body?.title || existing.title).trim();
    const shortDescription = String(req.body?.shortDescription || existing.shortDescription).trim();
    const bodyHtml =
      req.body?.bodyHtml !== undefined ? sanitizeHtml(req.body.bodyHtml) : existing.bodyHtml;
    const previewHtml =
      req.body?.previewHtml !== undefined
        ? sanitizeHtml(req.body.previewHtml) || createAutoPreview(bodyHtml || shortDescription)
        : existing.previewHtml;
    const coverImageUrl =
      req.body?.coverImageUrl !== undefined
        ? sanitizeSafeUrl(req.body.coverImageUrl, true)
        : existing.coverImageUrl;
    const categoryId =
      req.body?.categoryId !== undefined
        ? req.body.categoryId
          ? Number(req.body.categoryId)
          : null
        : existing.categoryId;
    const subjectId =
      req.body?.subjectId !== undefined
        ? req.body.subjectId
          ? Number(req.body.subjectId)
          : null
        : existing.subjectId;
    const language = String(req.body?.language || existing.language).trim();
    const contentType = String(req.body?.contentType || existing.contentType).trim();
    const isFree = req.body?.isFree !== undefined ? Boolean(req.body.isFree) : existing.isFree;
    const rawPrice =
      req.body?.priceInr !== undefined ? Number(req.body.priceInr) : Number(existing.priceInr);
    const ownershipConfirmed =
      req.body?.ownershipConfirmed !== undefined
        ? Boolean(req.body.ownershipConfirmed)
        : existing.ownershipConfirmed;

    if (!isFree && (Number.isNaN(rawPrice) || rawPrice < 10 || rawPrice > 50000)) {
      return res.status(400).json({ error: 'Paid content price must be between ₹10 and ₹50,000.' });
    }

    let nextStatus = existing.status;
    let publishedAt = existing.publishedAt;
    if (req.body?.action === 'submit') {
      if (!ownershipConfirmed) {
        return res.status(400).json({
          error: 'Please confirm copyright ownership before submitting for publication.',
        });
      }
      const [approvalSetting] = await db
        .select()
        .from(adminSettings)
        .where(eq(adminSettings.key, 'require_content_approval'))
        .limit(1);
      const requireApproval = approvalSetting?.value !== 'false';
      if (!requireApproval || req.user!.role === 'admin') {
        nextStatus = 'approved';
        publishedAt = publishedAt || new Date();
      } else {
        nextStatus = 'pending';
      }
    } else if (req.body?.action === 'draft') {
      nextStatus = 'draft';
    }

    const [updated] = await db
      .update(contents)
      .set({
        title,
        shortDescription,
        bodyHtml,
        previewHtml,
        coverImageUrl,
        categoryId,
        subjectId,
        language,
        contentType,
        isFree,
        priceInr: isFree ? '0.00' : rawPrice.toFixed(2),
        ownershipConfirmed,
        status: nextStatus,
        publishedAt,
        readingTimeMins: estimateReadingTime(bodyHtml || shortDescription),
        updatedAt: new Date(),
      })
      .where(eq(contents.id, id))
      .returning();

    if (req.body?.tags !== undefined) {
      const tagsInput: string[] = Array.isArray(req.body.tags)
        ? req.body.tags
        : String(req.body.tags || '')
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean);
      await db.delete(contentTags).where(eq(contentTags.contentId, id));
      if (tagsInput.length > 0) {
        const uniqueTags = Array.from(
          new Set(tagsInput.map((t) => t.toLowerCase().slice(0, 40)))
        ).slice(0, 10);
        await db.insert(contentTags).values(uniqueTags.map((tag) => ({ contentId: id, tag })));
      }
    }

    return res.json({ content: updated, message: 'Publication updated.' });
  } catch (error) {
    console.error('Update content error:', error);
    return res.status(500).json({ error: 'Unable to update content.' });
  }
});

// DELETE /api/creator/contents/:id
router.delete('/contents/:id', requireAuth, requireCreator, async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const [existing] = await db.select().from(contents).where(eq(contents.id, id)).limit(1);
    if (!existing) return res.status(404).json({ error: 'Content not found.' });
    if (existing.creatorId !== req.user!.id && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'You can only delete your own content.' });
    }

    // Remove associated stored files cleanly
    const files = await db.select().from(contentFiles).where(eq(contentFiles.contentId, id));
    for (const f of files) {
      if (f.storagePath && f.storagePath !== 'external') {
        const resolved = path.resolve(storageRoot, path.basename(f.storagePath));
        if (resolved.startsWith(storageRoot) && fs.existsSync(resolved)) {
          fs.unlinkSync(resolved);
        }
      }
    }

    await db.delete(contents).where(eq(contents.id, id));
    return res.json({ deleted: true });
  } catch (error) {
    console.error('Delete content error:', error);
    return res.status(500).json({ error: 'Unable to delete content.' });
  }
});

// POST /api/creator/contents/:id/files (Secure file upload for PDFs, videos, cover images, docs)
router.post(
  '/contents/:id/files',
  requireAuth,
  requireCreator,
  upload.single('file'),
  async (req: AuthRequest, res) => {
    try {
      const contentId = Number(req.params.id);
      const [content] = await db
        .select()
        .from(contents)
        .where(eq(contents.id, contentId))
        .limit(1);

      if (!content) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(404).json({ error: 'Content item not found.' });
      }
      if (content.creatorId !== req.user!.id && req.user!.role !== 'admin') {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(403).json({ error: 'Unauthorized to upload files to this content.' });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'No file attached.' });
      }

      const rule = ALLOWED_UPLOAD_MIMES[req.file.mimetype];
      if (!rule || req.file.size > rule.maxBytes) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({
          error: `File exceeds maximum size limit for ${req.file.mimetype}.`,
        });
      }

      const isPreview = req.body?.isPreview === 'true' || rule.fileType === 'cover';

      const [savedFile] = await db
        .insert(contentFiles)
        .values({
          contentId,
          fileType: rule.fileType,
          originalName: req.file.originalname,
          storagePath: req.file.filename,
          mimeType: req.file.mimetype,
          sizeBytes: req.file.size,
          isPreview,
        })
        .returning();

      // If it's a cover image, also update the content's coverImageUrl
      if (rule.fileType === 'cover' && req.body?.setAsCover !== 'false') {
        await db
          .update(contents)
          .set({ coverImageUrl: `/api/catalog/files/${savedFile.id}`, updatedAt: new Date() })
          .where(eq(contents.id, contentId));
      }

      return res.status(201).json({
        file: {
          ...savedFile,
          accessUrl: `/api/catalog/files/${savedFile.id}`,
        },
      });
    } catch (error) {
      console.error('File upload error:', error);
      return res.status(500).json({ error: 'File upload failed.' });
    }
  }
);

// POST /api/creator/editor-image (Inline photo upload for Rich-Text Editor, persistent across restarts)
router.post(
  '/editor-image',
  requireAuth,
  requireCreator,
  inlineImageUpload.single('image'),
  async (req: AuthRequest, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Please select an image file to upload.' });
      }
      const { mimetype, buffer, originalname, size } = req.file;
      if (!INLINE_IMAGE_MIMES.has(mimetype) || !hasValidImageSignature(buffer, mimetype)) {
        return res.status(400).json({
          error: 'Invalid image file. Please upload a valid JPG, PNG, WebP, or GIF photo.',
        });
      }
      const base64 = buffer.toString('base64');
      const alt = path
        .basename(originalname, path.extname(originalname))
        .replace(/[^a-zA-Z0-9 _-]/g, ' ')
        .trim()
        .slice(0, 80) || 'Illustration';

      return res.status(201).json({
        url: `data:${mimetype};base64,${base64}`,
        alt,
        sizeBytes: size,
      });
    } catch (error) {
      console.error('Editor inline image upload error:', error);
      return res.status(500).json({ error: 'Failed to process uploaded photo.' });
    }
  }
);

// DELETE /api/creator/files/:fileId
router.delete('/files/:fileId', requireAuth, requireCreator, async (req: AuthRequest, res) => {
  try {
    const fileId = Number(req.params.fileId);
    const [file] = await db
      .select()
      .from(contentFiles)
      .where(eq(contentFiles.id, fileId))
      .limit(1);
    if (!file) return res.status(404).json({ error: 'File not found.' });

    const [content] = await db
      .select()
      .from(contents)
      .where(eq(contents.id, file.contentId))
      .limit(1);
    if (!content || (content.creatorId !== req.user!.id && req.user!.role !== 'admin')) {
      return res.status(403).json({ error: 'Unauthorized.' });
    }

    if (file.storagePath && file.storagePath !== 'external') {
      const resolved = path.resolve(storageRoot, path.basename(file.storagePath));
      if (resolved.startsWith(storageRoot) && fs.existsSync(resolved)) {
        fs.unlinkSync(resolved);
      }
    }
    await db.delete(contentFiles).where(eq(contentFiles.id, fileId));
    return res.json({ deleted: true });
  } catch (error) {
    console.error('Delete file error:', error);
    return res.status(500).json({ error: 'Unable to delete file.' });
  }
});

// PUT /api/creator/payout-details
router.put('/payout-details', requireAuth, requireCreator, async (req: AuthRequest, res) => {
  try {
    const payoutMethod = req.body?.payoutMethod === 'bank_transfer' ? 'bank_transfer' : 'upi';
    const upiId = String(req.body?.upiId || '').trim();
    const accountHolder = String(req.body?.accountHolder || '').trim();
    const accountNumber = String(req.body?.accountNumber || '').trim();
    const ifscCode = String(req.body?.ifscCode || '').trim().toUpperCase();
    const bankName = String(req.body?.bankName || '').trim();

    if (payoutMethod === 'upi' && !upiId.includes('@')) {
      return res.status(400).json({ error: 'Please provide a valid UPI ID (e.g., name@upi).' });
    }
    if (payoutMethod === 'bank_transfer' && (!accountHolder || accountNumber.length < 8 || ifscCode.length < 8)) {
      return res.status(400).json({ error: 'Please provide valid bank account holder, number, and IFSC code.' });
    }

    const payoutDetails =
      payoutMethod === 'upi'
        ? { upiId }
        : { accountHolder, accountNumber, ifscCode, bankName };

    await db
      .update(creatorProfiles)
      .set({ payoutMethod, payoutDetails, updatedAt: new Date() })
      .where(eq(creatorProfiles.userId, req.user!.id));

    return res.json({ message: 'Payout details updated.', payoutMethod, payoutDetails });
  } catch (error) {
    console.error('Payout details error:', error);
    return res.status(500).json({ error: 'Unable to update payout details.' });
  }
});

// POST /api/creator/withdrawals
router.post('/withdrawals', requireAuth, requireCreator, async (req: AuthRequest, res) => {
  try {
    const creatorId = req.user!.id;
    const requestedAmount = Number(req.body?.amountInr);

    const [minRow] = await db
      .select()
      .from(adminSettings)
      .where(eq(adminSettings.key, 'min_withdrawal_inr'))
      .limit(1);
    const minWithdrawal = Number(minRow?.value || 100);

    if (Number.isNaN(requestedAmount) || requestedAmount < minWithdrawal) {
      return res.status(400).json({
        error: `Minimum withdrawal amount is ₹${minWithdrawal.toFixed(2)}.`,
      });
    }

    const [profile] = await db
      .select()
      .from(creatorProfiles)
      .where(eq(creatorProfiles.userId, creatorId))
      .limit(1);

    const payoutMethod = req.body?.payoutMethod || profile?.payoutMethod || 'upi';
    const payoutDetails = req.body?.payoutDetails || profile?.payoutDetails || {};

    if (
      (payoutMethod === 'upi' && !payoutDetails?.upiId) ||
      (payoutMethod === 'bank_transfer' && !payoutDetails?.accountNumber)
    ) {
      return res.status(400).json({
        error: 'Please configure your UPI ID or bank account details before requesting a withdrawal.',
      });
    }

    const result = await db.transaction(async (tx) => {
      const [wallet] = await tx
        .select()
        .from(creatorWallets)
        .where(eq(creatorWallets.creatorId, creatorId))
        .limit(1);

      const available = Number(wallet?.availableBalanceInr || 0);
      if (!wallet || available < requestedAmount) {
        throw new Error(`Insufficient available balance (₹${available.toFixed(2)}).`);
      }

      const nextAvailable = (available - requestedAmount).toFixed(2);
      const nextPending = (Number(wallet.pendingEarningsInr) + requestedAmount).toFixed(2);

      await tx
        .update(creatorWallets)
        .set({
          availableBalanceInr: nextAvailable,
          pendingEarningsInr: nextPending,
          updatedAt: new Date(),
        })
        .where(eq(creatorWallets.creatorId, creatorId));

      const [withdrawal] = await tx
        .insert(withdrawals)
        .values({
          creatorId,
          amountInr: requestedAmount.toFixed(2),
          payoutMethod,
          payoutDetails,
          status: 'pending',
        })
        .returning();

      await tx.insert(transactions).values({
        creatorId,
        withdrawalId: withdrawal.id,
        type: 'withdrawal',
        amountInr: requestedAmount.toFixed(2),
        direction: 'debit',
        description: `Withdrawal request #${withdrawal.id} via ${payoutMethod.toUpperCase()} (pending review)`,
        status: 'pending',
      });

      const admins = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, 'admin'));
      if (admins.length > 0) {
        await tx.insert(notifications).values(
          admins.map((a) => ({
            userId: a.id,
            type: 'withdrawal_request',
            title: 'New creator withdrawal request',
            message: `${req.user!.name} requested ₹${requestedAmount.toFixed(2)} via ${payoutMethod.toUpperCase()}.`,
            link: '#/admin/withdrawals',
          }))
        );
      }

      return withdrawal;
    });

    return res.status(201).json({
      withdrawal: result,
      message: 'Withdrawal request submitted for administrator verification.',
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unable to submit withdrawal request.';
    if (msg.startsWith('Insufficient')) {
      return res.status(400).json({ error: msg });
    }
    console.error('Withdrawal request error:', error);
    return res.status(500).json({ error: 'Unable to process withdrawal request.' });
  }
});

export default router;
