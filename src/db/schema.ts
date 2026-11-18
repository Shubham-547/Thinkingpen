import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// 1. Users (linked to Firebase Auth UID or platform email/password UID)
export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    uid: text('uid').notNull().unique(),
    publicUid: text('public_uid'), // 10-digit unique numeric UID assigned at account creation
    username: text('username'), // Unique user ID / handle (one name per user)
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash'),
    name: text('name').notNull(),
    role: text('role').notNull().default('user'), // 'user' | 'creator' | 'admin'
    status: text('status').notNull().default('active'), // 'active' | 'suspended' | 'blocked'
    emailVerified: boolean('email_verified').notNull().default(false),
    avatarUrl: text('avatar_url'),
    bio: text('bio'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_users_role').on(table.role),
    index('idx_users_status').on(table.status),
    index('idx_users_public_uid').on(table.publicUid),
    index('idx_users_username').on(table.username),
  ]
);

// 2. User Profiles
export const userProfiles = pgTable('user_profiles', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  headline: text('headline'),
  institution: text('institution'),
  location: text('location'),
  state: text('state'),
  country: text('country'),
  occupationRole: text('occupation_role'), // e.g., School Student, College Student, Engineer, Doctor, Artist, Businessman
  gender: text('gender'), // Male | Female | Non-binary | Prefer not to say
  dateOfBirth: text('date_of_birth'), // YYYY-MM-DD
  profileCompleted: boolean('profile_completed').notNull().default(false),
  languagePreference: text('language_preference').default('English'),
  websiteUrl: text('website_url'),
  socialLinks: jsonb('social_links').$type<Record<string, string>>(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 3. Creator Profiles
export const creatorProfiles = pgTable('creator_profiles', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  displayName: text('display_name').notNull(),
  tagline: text('tagline'),
  expertise: text('expertise'),
  payoutMethod: text('payout_method').default('upi'), // 'upi' | 'bank_transfer'
  payoutDetails: jsonb('payout_details').$type<{
    upiId?: string;
    accountHolder?: string;
    accountNumber?: string;
    ifscCode?: string;
    bankName?: string;
  }>(),
  customCommissionRate: numeric('custom_commission_rate', { precision: 5, scale: 2 }),
  verified: boolean('verified').notNull().default(false),
  acceptedCreatorAgreement: boolean('accepted_creator_agreement').notNull().default(false),
  agreementAcceptedAt: timestamp('agreement_accepted_at'),
  totalSales: integer('total_sales').notNull().default(0),
  followerCount: integer('follower_count').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 4. Categories
export const categories = pgTable('categories', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  slug: text('slug').notNull().unique(),
  description: text('description'),
  displayOrder: integer('display_order').notNull().default(0),
  isFeatured: boolean('is_featured').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 5. Subjects
export const subjects = pgTable(
  'subjects',
  {
    id: serial('id').primaryKey(),
    categoryId: integer('category_id')
      .references(() => categories.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    description: text('description'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_subjects_category').on(table.categoryId)]
);

// 6. Content Items
export const contents = pgTable(
  'contents',
  {
    id: serial('id').primaryKey(),
    creatorId: integer('creator_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    title: text('title').notNull(),
    slug: text('slug').notNull().unique(),
    shortDescription: text('short_description').notNull(),
    bodyHtml: text('body_html'),
    previewHtml: text('preview_html'),
    coverImageUrl: text('cover_image_url'),
    categoryId: integer('category_id').references(() => categories.id, { onDelete: 'set null' }),
    subjectId: integer('subject_id').references(() => subjects.id, { onDelete: 'set null' }),
    language: text('language').notNull().default('English'),
    contentType: text('content_type').notNull(), // 'Notes' | 'PDF / Documents' | 'Articles' | 'E-books' | 'Video Lectures' | 'Online Tutorials' | 'Poems' | 'Stories' | 'Research Papers' | 'Other Educational Content'
    priceInr: numeric('price_inr', { precision: 10, scale: 2 }).notNull().default('0.00'),
    isFree: boolean('is_free').notNull().default(true),
    customCommissionRate: numeric('custom_commission_rate', { precision: 5, scale: 2 }),
    status: text('status').notNull().default('draft'), // 'draft' | 'pending' | 'approved' | 'rejected' | 'removed'
    rejectionReason: text('rejection_reason'),
    isFeatured: boolean('is_featured').notNull().default(false),
    ownershipConfirmed: boolean('ownership_confirmed').notNull().default(false),
    viewsCount: integer('views_count').notNull().default(0),
    likesCount: integer('likes_count').notNull().default(0),
    purchasesCount: integer('purchases_count').notNull().default(0),
    avgRating: numeric('avg_rating', { precision: 3, scale: 2 }).notNull().default('0.00'),
    reviewsCount: integer('reviews_count').notNull().default(0),
    readingTimeMins: integer('reading_time_mins').notNull().default(5),
    publishedAt: timestamp('published_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_contents_creator').on(table.creatorId),
    index('idx_contents_category').on(table.categoryId),
    index('idx_contents_status').on(table.status),
    index('idx_contents_type').on(table.contentType),
  ]
);

// 7. Content Files (protected PDFs, videos, attachments)
export const contentFiles = pgTable(
  'content_files',
  {
    id: serial('id').primaryKey(),
    contentId: integer('content_id')
      .references(() => contents.id, { onDelete: 'cascade' })
      .notNull(),
    fileType: text('file_type').notNull(), // 'pdf' | 'video' | 'document' | 'cover'
    originalName: text('original_name').notNull(),
    storagePath: text('storage_path').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull().default(0),
    isPreview: boolean('is_preview').notNull().default(false),
    externalVideoUrl: text('external_video_url'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_content_files_content').on(table.contentId)]
);

// 8. Content Tags
export const contentTags = pgTable(
  'content_tags',
  {
    id: serial('id').primaryKey(),
    contentId: integer('content_id')
      .references(() => contents.id, { onDelete: 'cascade' })
      .notNull(),
    tag: text('tag').notNull(),
  },
  (table) => [
    index('idx_content_tags_content').on(table.contentId),
    index('idx_content_tags_tag').on(table.tag),
  ]
);

// 9. Payments (Razorpay & modular gateway ledger)
export const payments = pgTable(
  'payments',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    contentId: integer('content_id')
      .references(() => contents.id, { onDelete: 'cascade' })
      .notNull(),
    provider: text('provider').notNull().default('razorpay'),
    mode: text('mode').notNull().default('sandbox'), // 'sandbox' | 'live'
    providerOrderId: text('provider_order_id').notNull().unique(),
    providerPaymentId: text('provider_payment_id'),
    providerSignature: text('provider_signature'),
    amountInr: numeric('amount_inr', { precision: 10, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('INR'),
    status: text('status').notNull().default('created'), // 'created' | 'captured' | 'failed' | 'refunded'
    idempotencyKey: text('idempotency_key').notNull().unique(),
    receiptNumber: text('receipt_number').notNull().unique(),
    refundReason: text('refund_reason'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_payments_user').on(table.userId),
    index('idx_payments_content').on(table.contentId),
    index('idx_payments_status').on(table.status),
  ]
);

// 10. Purchases (entitlements)
export const purchases = pgTable(
  'purchases',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    contentId: integer('content_id')
      .references(() => contents.id, { onDelete: 'cascade' })
      .notNull(),
    paymentId: integer('payment_id').references(() => payments.id, { onDelete: 'set null' }),
    pricePaidInr: numeric('price_paid_inr', { precision: 10, scale: 2 }).notNull(),
    status: text('status').notNull().default('active'), // 'active' | 'refunded'
    purchasedAt: timestamp('purchased_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_purchases_user_content').on(table.userId, table.contentId),
    index('idx_purchases_content').on(table.contentId),
  ]
);

// 11. Commission Records
export const commissionRecords = pgTable(
  'commission_records',
  {
    id: serial('id').primaryKey(),
    paymentId: integer('payment_id')
      .references(() => payments.id, { onDelete: 'cascade' })
      .notNull(),
    purchaseId: integer('purchase_id').references(() => purchases.id, { onDelete: 'set null' }),
    contentId: integer('content_id')
      .references(() => contents.id, { onDelete: 'cascade' })
      .notNull(),
    creatorId: integer('creator_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    grossAmountInr: numeric('gross_amount_inr', { precision: 10, scale: 2 }).notNull(),
    commissionRate: numeric('commission_rate', { precision: 5, scale: 2 }).notNull(),
    commissionSource: text('commission_source').notNull().default('platform'), // 'content' | 'creator' | 'platform'
    platformCommissionInr: numeric('platform_commission_inr', { precision: 10, scale: 2 }).notNull(),
    creatorEarningsInr: numeric('creator_earnings_inr', { precision: 10, scale: 2 }).notNull(),
    status: text('status').notNull().default('credited'), // 'credited' | 'reversed'
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_commission_creator').on(table.creatorId),
    index('idx_commission_payment').on(table.paymentId),
  ]
);

// 12. Creator Wallets
export const creatorWallets = pgTable('creator_wallets', {
  id: serial('id').primaryKey(),
  creatorId: integer('creator_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  totalEarningsInr: numeric('total_earnings_inr', { precision: 12, scale: 2 }).notNull().default('0.00'),
  pendingEarningsInr: numeric('pending_earnings_inr', { precision: 12, scale: 2 }).notNull().default('0.00'),
  availableBalanceInr: numeric('available_balance_inr', { precision: 12, scale: 2 }).notNull().default('0.00'),
  withdrawnAmountInr: numeric('withdrawn_amount_inr', { precision: 12, scale: 2 }).notNull().default('0.00'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 13. Withdrawals
export const withdrawals = pgTable(
  'withdrawals',
  {
    id: serial('id').primaryKey(),
    creatorId: integer('creator_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    amountInr: numeric('amount_inr', { precision: 12, scale: 2 }).notNull(),
    payoutMethod: text('payout_method').notNull(), // 'upi' | 'bank_transfer'
    payoutDetails: jsonb('payout_details').$type<Record<string, string>>(),
    status: text('status').notNull().default('pending'), // 'pending' | 'approved' | 'rejected' | 'paid'
    adminNote: text('admin_note'),
    payoutReference: text('payout_reference'),
    reviewedBy: integer('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at'),
    paidAt: timestamp('paid_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_withdrawals_creator').on(table.creatorId),
    index('idx_withdrawals_status').on(table.status),
  ]
);

// 14. Ledger Transactions
export const transactions = pgTable(
  'transactions',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    creatorId: integer('creator_id').references(() => users.id, { onDelete: 'set null' }),
    paymentId: integer('payment_id').references(() => payments.id, { onDelete: 'set null' }),
    withdrawalId: integer('withdrawal_id').references(() => withdrawals.id, { onDelete: 'set null' }),
    type: text('type').notNull(), // 'purchase' | 'creator_earning' | 'platform_commission' | 'withdrawal' | 'refund'
    amountInr: numeric('amount_inr', { precision: 12, scale: 2 }).notNull(),
    direction: text('direction').notNull(), // 'credit' | 'debit'
    description: text('description').notNull(),
    status: text('status').notNull().default('completed'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_transactions_user').on(table.userId),
    index('idx_transactions_creator').on(table.creatorId),
    index('idx_transactions_type').on(table.type),
  ]
);

// 15. Bookmarks
export const bookmarks = pgTable(
  'bookmarks',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    contentId: integer('content_id')
      .references(() => contents.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('uq_bookmarks_user_content').on(table.userId, table.contentId)]
);

// 16. Likes
export const likes = pgTable(
  'likes',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    contentId: integer('content_id')
      .references(() => contents.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('uq_likes_user_content').on(table.userId, table.contentId)]
);

// 17. Comments & Replies
export const comments = pgTable(
  'comments',
  {
    id: serial('id').primaryKey(),
    contentId: integer('content_id')
      .references(() => contents.id, { onDelete: 'cascade' })
      .notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    parentId: integer('parent_id'),
    body: text('body').notNull(),
    isHidden: boolean('is_hidden').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_comments_content').on(table.contentId)]
);

// 18. Ratings & Reviews
export const reviews = pgTable(
  'reviews',
  {
    id: serial('id').primaryKey(),
    contentId: integer('content_id')
      .references(() => contents.id, { onDelete: 'cascade' })
      .notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    rating: integer('rating').notNull(), // 1..5
    title: text('title'),
    body: text('body').notNull(),
    isVerifiedPurchase: boolean('is_verified_purchase').notNull().default(false),
    isHidden: boolean('is_hidden').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_reviews_user_content').on(table.userId, table.contentId),
    index('idx_reviews_content').on(table.contentId),
  ]
);

// 19. Followers
export const followers = pgTable(
  'followers',
  {
    id: serial('id').primaryKey(),
    followerId: integer('follower_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    creatorId: integer('creator_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_followers_pair').on(table.followerId, table.creatorId),
    index('idx_followers_creator').on(table.creatorId),
  ]
);

// 20. Notifications
export const notifications = pgTable(
  'notifications',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    type: text('type').notNull(),
    title: text('title').notNull(),
    message: text('message').notNull(),
    link: text('link'),
    isRead: boolean('is_read').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_notifications_user').on(table.userId)]
);

// 21. Reports & Copyright Complaints
export const reports = pgTable(
  'reports',
  {
    id: serial('id').primaryKey(),
    reporterId: integer('reporter_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    contentId: integer('content_id')
      .references(() => contents.id, { onDelete: 'cascade' })
      .notNull(),
    reportType: text('report_type').notNull().default('inappropriate'), // 'inappropriate' | 'copyright' | 'spam' | 'other'
    reason: text('reason').notNull(),
    details: text('details'),
    copyrightProof: text('copyright_proof'),
    status: text('status').notNull().default('open'), // 'open' | 'reviewing' | 'resolved' | 'dismissed'
    resolutionNote: text('resolution_note'),
    reviewedBy: integer('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('idx_reports_status').on(table.status)]
);

// 22. Admin Settings (platform commission, minimum withdrawal, site branding, announcements)
export const adminSettings = pgTable('admin_settings', {
  id: serial('id').primaryKey(),
  key: text('key').notNull().unique(),
  value: text('value').notNull(),
  description: text('description'),
  updatedBy: integer('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 23. Audit Logs
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: serial('id').primaryKey(),
    actorId: integer('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    details: jsonb('details').$type<Record<string, unknown>>(),
    ipAddress: text('ip_address'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_audit_logs_created').on(table.createdAt)]
);

// 24. Auth Tokens (Email Verification & Password Reset)
export const authTokens = pgTable('auth_tokens', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  token: text('token').notNull().unique(),
  type: text('type').notNull(), // 'email_verify' | 'password_reset'
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 25. Contact Inquiries
export const contactMessages = pgTable('contact_messages', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  subject: text('subject').notNull(),
  message: text('message').notNull(),
  status: text('status').notNull().default('new'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 26. User Activity & Content Viewing Sessions (Admin Digital Tracking)
export const userActivitySessions = pgTable(
  'user_activity_sessions',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    contentId: integer('content_id').references(() => contents.id, { onDelete: 'set null' }),
    pagePath: text('page_path').notNull(),
    pageTitle: text('page_title'),
    durationSeconds: integer('duration_seconds').notNull().default(0),
    visitDate: text('visit_date').notNull(), // YYYY-MM-DD
    startedAt: timestamp('started_at').defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_activity_user_last_seen').on(table.userId, table.lastSeenAt),
    index('idx_activity_user_content').on(table.userId, table.contentId),
    index('idx_activity_user_date').on(table.userId, table.visitDate),
  ]
);

// 27. User Daily Visits (Day / Month / Year Visit Calendar)
export const userDailyVisits = pgTable(
  'user_daily_visits',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    visitDate: text('visit_date').notNull(), // YYYY-MM-DD
    visitYear: integer('visit_year').notNull(),
    visitMonth: integer('visit_month').notNull(), // 1..12
    visitDay: integer('visit_day').notNull(), // 1..31
    pageViews: integer('page_views').notNull().default(1),
    totalSeconds: integer('total_seconds').notNull().default(0),
    firstSeenAt: timestamp('first_seen_at').defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_user_daily_visit').on(table.userId, table.visitDate),
    index('idx_daily_visits_user_ym').on(table.userId, table.visitYear, table.visitMonth),
  ]
);

// Relations
export const usersRelations = relations(users, ({ one, many }) => ({
  profile: one(userProfiles, { fields: [users.id], references: [userProfiles.userId] }),
  creatorProfile: one(creatorProfiles, { fields: [users.id], references: [creatorProfiles.userId] }),
  wallet: one(creatorWallets, { fields: [users.id], references: [creatorWallets.creatorId] }),
  contents: many(contents),
  purchases: many(purchases),
  notifications: many(notifications),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  subjects: many(subjects),
  contents: many(contents),
}));

export const contentsRelations = relations(contents, ({ one, many }) => ({
  creator: one(users, { fields: [contents.creatorId], references: [users.id] }),
  category: one(categories, { fields: [contents.categoryId], references: [categories.id] }),
  subject: one(subjects, { fields: [contents.subjectId], references: [subjects.id] }),
  files: many(contentFiles),
  tags: many(contentTags),
  comments: many(comments),
  reviews: many(reviews),
}));
