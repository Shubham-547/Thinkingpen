import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  adminSettings,
  commissionRecords,
  contents,
  creatorProfiles,
  creatorWallets,
  notifications,
  payments,
  purchases,
  transactions,
} from '../db/schema.ts';

export interface GatewayConfig {
  provider: 'razorpay';
  mode: 'live' | 'sandbox';
  keyId: string | null;
  currency: 'INR';
  configured: boolean;
}

export function getPaymentGatewayConfig(): GatewayConfig {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim() || '';
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim() || '';
  const configured = Boolean(keyId && keySecret);
  const mode: 'live' | 'sandbox' =
    configured && !keyId.startsWith('rzp_test_') ? 'live' : 'sandbox';
  return {
    provider: 'razorpay',
    mode,
    keyId: configured ? keyId : null,
    currency: 'INR',
    configured,
  };
}

function getSigningSecret(): string {
  return (
    process.env.RAZORPAY_KEY_SECRET?.trim() ||
    process.env.SESSION_SECRET ||
    'scholarpress-razorpay-sandbox-secret'
  );
}

export async function createRazorpayOrder(params: {
  amountInr: number;
  receipt: string;
  notes: Record<string, string>;
}): Promise<{ orderId: string; mode: 'live' | 'sandbox'; keyId: string | null }> {
  const cfg = getPaymentGatewayConfig();
  const amountPaise = Math.round(params.amountInr * 100);

  if (cfg.configured && cfg.keyId) {
    const authHeader = Buffer.from(
      `${cfg.keyId}:${process.env.RAZORPAY_KEY_SECRET!.trim()}`
    ).toString('base64');

    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${authHeader}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: 'INR',
        receipt: params.receipt,
        notes: params.notes,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Razorpay order creation failed (${response.status}): ${errBody}`);
    }
    const order = (await response.json()) as { id: string };
    return { orderId: order.id, mode: cfg.mode, keyId: cfg.keyId };
  }

  // Sandbox / Test mode when gateway credentials are not yet supplied
  const orderId = `order_sandbox_${crypto.randomBytes(8).toString('hex')}`;
  return { orderId, mode: 'sandbox', keyId: null };
}

export function generatePaymentSignature(orderId: string, paymentId: string): string {
  return crypto
    .createHmac('sha256', getSigningSecret())
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
}

export function verifyPaymentSignature(
  orderId: string,
  paymentId: string,
  signature: string
): boolean {
  const expected = generatePaymentSignature(orderId, paymentId);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature || '', 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function verifyRazorpayWebhookSignature(rawBody: string, headerSignature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim() || getSigningSecret();
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(headerSignature || '', 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function resolveCommissionRate(contentId: number, creatorId: number): Promise<{
  rate: number;
  source: 'content' | 'creator' | 'platform';
}> {
  const [contentRow] = await db
    .select({ customCommissionRate: contents.customCommissionRate })
    .from(contents)
    .where(eq(contents.id, contentId))
    .limit(1);

  if (contentRow?.customCommissionRate !== null && contentRow?.customCommissionRate !== undefined) {
    const val = clampCommission(Number(contentRow.customCommissionRate));
    return { rate: val, source: 'content' };
  }

  const [creatorRow] = await db
    .select({ customCommissionRate: creatorProfiles.customCommissionRate })
    .from(creatorProfiles)
    .where(eq(creatorProfiles.userId, creatorId))
    .limit(1);

  if (creatorRow?.customCommissionRate !== null && creatorRow?.customCommissionRate !== undefined) {
    const val = clampCommission(Number(creatorRow.customCommissionRate));
    return { rate: val, source: 'creator' };
  }

  const [settingRow] = await db
    .select({ value: adminSettings.value })
    .from(adminSettings)
    .where(eq(adminSettings.key, 'default_commission_rate'))
    .limit(1);

  const defaultRate = clampCommission(Number(settingRow?.value || 10));
  return { rate: defaultRate, source: 'platform' };
}

export function clampCommission(rate: number): number {
  if (Number.isNaN(rate)) return 10;
  return Math.min(20, Math.max(5, Math.round(rate * 100) / 100));
}

export function calculateCommissionSplit(grossInr: number, commissionRate: number) {
  const grossPaise = Math.round(grossInr * 100);
  const commissionPaise = Math.round((grossPaise * commissionRate) / 100);
  const creatorPaise = grossPaise - commissionPaise;
  return {
    grossInr: Number((grossPaise / 100).toFixed(2)),
    platformCommissionInr: Number((commissionPaise / 100).toFixed(2)),
    creatorEarningsInr: Number((creatorPaise / 100).toFixed(2)),
  };
}

/**
 * Settles a verified payment idempotently:
 * - Marks payment captured
 * - Grants purchase entitlement
 * - Records commission split
 * - Credits creator wallet
 * - Appends ledger transactions
 * - Increments content purchases & creator totalSales
 * - Sends buyer & creator notifications
 */
export async function settleVerifiedPayment(params: {
  paymentId: number;
  providerPaymentId: string;
  providerSignature: string;
}) {
  return await db.transaction(async (tx) => {
    const [payment] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, params.paymentId))
      .limit(1);

    if (!payment) {
      throw new Error('Payment order not found');
    }

    // Duplicate settlement protection
    if (payment.status === 'captured') {
      const [existingPurchase] = await tx
        .select()
        .from(purchases)
        .where(eq(purchases.paymentId, payment.id))
        .limit(1);
      return { alreadySettled: true, payment, purchase: existingPurchase };
    }

    if (payment.status === 'refunded') {
      throw new Error('Cannot settle a refunded payment');
    }

    const [content] = await tx
      .select()
      .from(contents)
      .where(eq(contents.id, payment.contentId))
      .limit(1);

    if (!content) {
      throw new Error('Content item no longer exists');
    }

    const { rate, source } = await resolveCommissionRate(content.id, content.creatorId);
    const split = calculateCommissionSplit(Number(payment.amountInr), rate);

    const [updatedPayment] = await tx
      .update(payments)
      .set({
        status: 'captured',
        providerPaymentId: params.providerPaymentId,
        providerSignature: params.providerSignature,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, payment.id))
      .returning();

    const [purchase] = await tx
      .insert(purchases)
      .values({
        userId: payment.userId,
        contentId: content.id,
        paymentId: payment.id,
        pricePaidInr: split.grossInr.toFixed(2),
        status: 'active',
      })
      .onConflictDoUpdate({
        target: [purchases.userId, purchases.contentId],
        set: {
          paymentId: payment.id,
          pricePaidInr: split.grossInr.toFixed(2),
          status: 'active',
          purchasedAt: new Date(),
        },
      })
      .returning();

    await tx.insert(commissionRecords).values({
      paymentId: payment.id,
      purchaseId: purchase.id,
      contentId: content.id,
      creatorId: content.creatorId,
      grossAmountInr: split.grossInr.toFixed(2),
      commissionRate: rate.toFixed(2),
      commissionSource: source,
      platformCommissionInr: split.platformCommissionInr.toFixed(2),
      creatorEarningsInr: split.creatorEarningsInr.toFixed(2),
      status: 'credited',
    });

    // Ensure wallet exists and credit creator earnings
    const [existingWallet] = await tx
      .select()
      .from(creatorWallets)
      .where(eq(creatorWallets.creatorId, content.creatorId))
      .limit(1);

    if (!existingWallet) {
      await tx.insert(creatorWallets).values({
        creatorId: content.creatorId,
        totalEarningsInr: split.creatorEarningsInr.toFixed(2),
        pendingEarningsInr: '0.00',
        availableBalanceInr: split.creatorEarningsInr.toFixed(2),
        withdrawnAmountInr: '0.00',
      });
    } else {
      const nextTotal = (
        Number(existingWallet.totalEarningsInr) + split.creatorEarningsInr
      ).toFixed(2);
      const nextAvailable = (
        Number(existingWallet.availableBalanceInr) + split.creatorEarningsInr
      ).toFixed(2);
      await tx
        .update(creatorWallets)
        .set({
          totalEarningsInr: nextTotal,
          availableBalanceInr: nextAvailable,
          updatedAt: new Date(),
        })
        .where(eq(creatorWallets.creatorId, content.creatorId));
    }

    // Ledger transactions
    await tx.insert(transactions).values([
      {
        userId: payment.userId,
        creatorId: content.creatorId,
        paymentId: payment.id,
        type: 'purchase',
        amountInr: split.grossInr.toFixed(2),
        direction: 'debit',
        description: `Purchased "${content.title}" (Receipt ${payment.receiptNumber})`,
        status: 'completed',
      },
      {
        userId: payment.userId,
        creatorId: content.creatorId,
        paymentId: payment.id,
        type: 'creator_earning',
        amountInr: split.creatorEarningsInr.toFixed(2),
        direction: 'credit',
        description: `Creator net earnings (${(100 - rate).toFixed(0)}%) for "${content.title}"`,
        status: 'completed',
      },
      {
        userId: payment.userId,
        creatorId: content.creatorId,
        paymentId: payment.id,
        type: 'platform_commission',
        amountInr: split.platformCommissionInr.toFixed(2),
        direction: 'credit',
        description: `Platform commission (${rate.toFixed(1)}%) for "${content.title}"`,
        status: 'completed',
      },
    ]);

    // Update counters
    await tx
      .update(contents)
      .set({ purchasesCount: content.purchasesCount + 1 })
      .where(eq(contents.id, content.id));

    const [creatorProfile] = await tx
      .select()
      .from(creatorProfiles)
      .where(eq(creatorProfiles.userId, content.creatorId))
      .limit(1);

    if (creatorProfile) {
      await tx
        .update(creatorProfiles)
        .set({ totalSales: creatorProfile.totalSales + 1 })
        .where(eq(creatorProfiles.userId, content.creatorId));
    }

    // Notifications to buyer and creator
    await tx.insert(notifications).values([
      {
        userId: payment.userId,
        type: 'purchase_ready',
        title: 'Purchase unlocked in your library',
        message: `"${content.title}" is now unlocked. Receipt: ${payment.receiptNumber}.`,
        link: `#/content/${content.slug}`,
      },
      {
        userId: content.creatorId,
        type: 'creator_sale',
        title: 'New sale credited to your wallet',
        message: `You earned ₹${split.creatorEarningsInr.toFixed(2)} (after ${rate.toFixed(1)}% platform commission) from "${content.title}".`,
        link: '#/creator/wallet',
      },
    ]);

    return {
      alreadySettled: false,
      payment: updatedPayment,
      purchase,
      split,
      commissionRate: rate,
    };
  });
}

/**
 * Refunds a captured payment and reverses creator earnings & platform commission.
 */
export async function refundCapturedPayment(paymentId: number, reason: string) {
  return await db.transaction(async (tx) => {
    const [payment] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId))
      .limit(1);

    if (!payment) throw new Error('Payment not found');
    if (payment.status !== 'captured') {
      throw new Error(`Only captured payments can be refunded (current status: ${payment.status})`);
    }

    const [comm] = await tx
      .select()
      .from(commissionRecords)
      .where(eq(commissionRecords.paymentId, payment.id))
      .limit(1);

    await tx
      .update(payments)
      .set({ status: 'refunded', refundReason: reason, updatedAt: new Date() })
      .where(eq(payments.id, payment.id));

    await tx
      .update(purchases)
      .set({ status: 'refunded' })
      .where(eq(purchases.paymentId, payment.id));

    if (comm && comm.status === 'credited') {
      await tx
        .update(commissionRecords)
        .set({ status: 'reversed' })
        .where(eq(commissionRecords.id, comm.id));

      const [wallet] = await tx
        .select()
        .from(creatorWallets)
        .where(eq(creatorWallets.creatorId, comm.creatorId))
        .limit(1);

      if (wallet) {
        const reversal = Number(comm.creatorEarningsInr);
        const nextTotal = Math.max(0, Number(wallet.totalEarningsInr) - reversal).toFixed(2);
        const nextAvail = Math.max(0, Number(wallet.availableBalanceInr) - reversal).toFixed(2);
        await tx
          .update(creatorWallets)
          .set({
            totalEarningsInr: nextTotal,
            availableBalanceInr: nextAvail,
            updatedAt: new Date(),
          })
          .where(eq(creatorWallets.creatorId, comm.creatorId));
      }

      await tx.insert(transactions).values({
        userId: payment.userId,
        creatorId: comm.creatorId,
        paymentId: payment.id,
        type: 'refund',
        amountInr: Number(payment.amountInr).toFixed(2),
        direction: 'debit',
        description: `Refund issued for receipt ${payment.receiptNumber}: ${reason}`,
        status: 'completed',
      });

      await tx.insert(notifications).values([
        {
          userId: payment.userId,
          type: 'refund',
          title: 'Payment refunded',
          message: `Your payment of ₹${Number(payment.amountInr).toFixed(2)} (Receipt ${payment.receiptNumber}) has been refunded. Reason: ${reason}`,
          link: '#/dashboard/history',
        },
        {
          userId: comm.creatorId,
          type: 'refund',
          title: 'Sale refunded and earnings reversed',
          message: `₹${Number(comm.creatorEarningsInr).toFixed(2)} was reversed due to a refund on receipt ${payment.receiptNumber}.`,
          link: '#/creator/transactions',
        },
      ]);
    }

    return { refunded: true, paymentId: payment.id };
  });
}
