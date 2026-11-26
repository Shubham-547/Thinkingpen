import crypto from 'node:crypto';
import { Router } from 'express';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { contents, payments, purchases, users } from '../db/schema.ts';
import {
  createRazorpayOrder,
  generatePaymentSignature,
  getPaymentGatewayConfig,
  refundCapturedPayment,
  settleVerifiedPayment,
  verifyAndCaptureRazorpayPayment,
  verifyPaymentSignature,
  verifyRazorpayWebhookSignature,
} from '../lib/payments.ts';
import { generateReceiptNumber } from '../lib/security.ts';
import { requireAuth, type AuthRequest } from '../middleware/auth.ts';

const router = Router();

// GET /api/payments/config
router.get('/config', (_req, res) => {
  return res.json(getPaymentGatewayConfig());
});

// POST /api/payments/create-order
router.post('/create-order', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const contentId = Number(req.body?.contentId);
    if (!Number.isInteger(contentId) || contentId <= 0) {
      return res.status(400).json({ error: 'Invalid publication ID.' });
    }

    const [content] = await db
      .select()
      .from(contents)
      .where(eq(contents.id, contentId))
      .limit(1);

    if (!content || content.status !== 'approved') {
      return res.status(404).json({ error: 'Publication is not available for purchase.' });
    }
    if (content.isFree || Number(content.priceInr) <= 0) {
      return res.status(400).json({ error: 'This publication is free and requires no payment.' });
    }
    if (content.creatorId === userId) {
      return res.status(400).json({ error: 'You already have full access to your own publication.' });
    }

    // Duplicate purchase protection
    const [existingPurchase] = await db
      .select()
      .from(purchases)
      .where(
        and(
          eq(purchases.userId, userId),
          eq(purchases.contentId, contentId),
          eq(purchases.status, 'active')
        )
      )
      .limit(1);

    if (existingPurchase) {
      return res.status(409).json({ error: 'You have already purchased this publication.' });
    }

    const amountInr = Number(content.priceInr);
    const receiptNumber = generateReceiptNumber();
    const idempotencyKey =
      String(req.body?.idempotencyKey || '').trim() ||
      `idem_${userId}_${contentId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    const order = await createRazorpayOrder({
      amountInr,
      receipt: receiptNumber,
      notes: {
        contentId: String(content.id),
        userId: String(userId),
        receipt: receiptNumber,
      },
    });

    const [paymentRow] = await db
      .insert(payments)
      .values({
        userId,
        contentId: content.id,
        provider: 'razorpay',
        mode: order.mode,
        providerOrderId: order.orderId,
        amountInr: amountInr.toFixed(2),
        currency: 'INR',
        status: 'created',
        idempotencyKey,
        receiptNumber,
        metadata: { contentTitle: content.title },
      })
      .returning();

    // Only generate simulated sandbox token when no Razorpay keys are configured yet
    const isSimulatedSandbox = !order.keyId;
    const sandboxPaymentId = isSimulatedSandbox
      ? `pay_sandbox_${crypto.randomBytes(8).toString('hex')}`
      : null;
    const sandboxSignature =
      isSimulatedSandbox && sandboxPaymentId
        ? generatePaymentSignature(order.orderId, sandboxPaymentId)
        : null;

    return res.status(201).json({
      paymentId: paymentRow.id,
      orderId: order.orderId,
      receiptNumber,
      amountInr,
      amountPaise: Math.round(amountInr * 100),
      currency: 'INR',
      mode: order.mode,
      configured: Boolean(order.keyId),
      keyId: order.keyId,
      contentTitle: content.title,
      sandboxCheckout:
        isSimulatedSandbox
          ? {
              providerPaymentId: sandboxPaymentId,
              providerSignature: sandboxSignature,
            }
          : null,
    });
  } catch (error) {
    console.error('Create payment order error:', error);
    return res.status(500).json({ error: 'Unable to initialize checkout order.' });
  }
});

// POST /api/payments/verify
router.post('/verify', requireAuth, async (req: AuthRequest, res) => {
  try {
    const orderId = String(req.body?.orderId || '').trim();
    const providerPaymentId = String(req.body?.providerPaymentId || '').trim();
    const providerSignature = String(req.body?.providerSignature || '').trim();

    if (!orderId || !providerPaymentId || !providerSignature) {
      return res.status(400).json({ error: 'Incomplete payment verification payload.' });
    }

    const [payment] = await db
      .select()
      .from(payments)
      .where(and(eq(payments.providerOrderId, orderId), eq(payments.userId, req.user!.id)))
      .limit(1);

    if (!payment) {
      return res.status(404).json({ error: 'Payment order not found.' });
    }

    const valid = verifyPaymentSignature(orderId, providerPaymentId, providerSignature);
    if (!valid) {
      await db
        .update(payments)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(payments.id, payment.id));
      return res.status(400).json({ error: 'Payment signature verification failed.' });
    }

    const gwCfg = getPaymentGatewayConfig();
    if (gwCfg.configured && !providerPaymentId.startsWith('pay_sandbox_')) {
      await verifyAndCaptureRazorpayPayment({
        providerPaymentId,
        expectedOrderId: orderId,
        expectedAmountInr: Number(payment.amountInr),
      });
    }

    const settled = await settleVerifiedPayment({
      paymentId: payment.id,
      providerPaymentId,
      providerSignature,
    });

    return res.json({
      verified: true,
      alreadySettled: settled.alreadySettled,
      receiptNumber: payment.receiptNumber,
      paymentId: payment.id,
      message: 'Payment verified. Content is now unlocked in your library.',
    });
  } catch (error) {
    console.error('Payment verification error:', error);
    return res.status(500).json({ error: 'Unable to verify payment.' });
  }
});

// POST /api/payments/fail (Record failed or cancelled checkout cleanly — never credits creator)
router.post('/fail', requireAuth, async (req: AuthRequest, res) => {
  try {
    const orderId = String(req.body?.orderId || '').trim();
    const reason = String(req.body?.reason || 'Cancelled or declined at checkout').trim();

    const [payment] = await db
      .select()
      .from(payments)
      .where(and(eq(payments.providerOrderId, orderId), eq(payments.userId, req.user!.id)))
      .limit(1);

    if (!payment) return res.status(404).json({ error: 'Order not found.' });
    if (payment.status === 'captured') {
      return res.status(409).json({ error: 'Payment is already captured.' });
    }

    await db
      .update(payments)
      .set({
        status: 'failed',
        refundReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, payment.id));

    return res.json({ status: 'failed', message: 'Payment marked as failed. No earnings were credited.' });
  } catch (error) {
    console.error('Payment fail error:', error);
    return res.status(500).json({ error: 'Unable to record failed payment.' });
  }
});

// POST /api/payments/webhook/razorpay (Verified HMAC-SHA256 webhook receiver)
router.post('/webhook/razorpay', async (req, res) => {
  try {
    if (!process.env.RAZORPAY_WEBHOOK_SECRET?.trim()) {
      return res.status(503).json({ error: 'Razorpay webhook secret is not configured.' });
    }
    const signature = String(req.headers['x-razorpay-signature'] || '');
    const rawBody =
      typeof (req as unknown as { rawBody?: string }).rawBody === 'string'
        ? (req as unknown as { rawBody: string }).rawBody
        : JSON.stringify(req.body);

    if (!verifyRazorpayWebhookSignature(rawBody, signature)) {
      return res.status(400).json({ error: 'Invalid webhook signature.' });
    }

    const event = String(req.body?.event || '');
    const entity = req.body?.payload?.payment?.entity;

    if (event === 'payment.captured' && entity?.order_id && entity?.id) {
      const [payment] = await db
        .select()
        .from(payments)
        .where(eq(payments.providerOrderId, entity.order_id))
        .limit(1);
      if (payment && payment.status !== 'captured') {
        await settleVerifiedPayment({
          paymentId: payment.id,
          providerPaymentId: entity.id,
          providerSignature: signature,
        });
      }
    } else if (event === 'payment.failed' && entity?.order_id) {
      await db
        .update(payments)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(
          and(eq(payments.providerOrderId, entity.order_id), eq(payments.status, 'created'))
        );
    } else if (event === 'refund.created' && entity?.order_id) {
      const [payment] = await db
        .select()
        .from(payments)
        .where(eq(payments.providerOrderId, entity.order_id))
        .limit(1);
      if (payment && payment.status === 'captured') {
        await refundCapturedPayment(payment.id, 'Refunded via Razorpay webhook', { skipGatewayApi: true });
      }
    }

    return res.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: 'Webhook processing error.' });
  }
});

// GET /api/payments/receipt/:paymentId
router.get('/receipt/:paymentId', requireAuth, async (req: AuthRequest, res) => {
  try {
    const paymentId = Number(req.params.paymentId);
    if (!Number.isInteger(paymentId) || paymentId <= 0) {
      return res.status(400).json({ error: 'Invalid payment receipt ID.' });
    }
    const [row] = await db
      .select({
        payment: payments,
        contentTitle: contents.title,
        contentType: contents.contentType,
        contentSlug: contents.slug,
        buyerName: users.name,
        buyerEmail: users.email,
      })
      .from(payments)
      .innerJoin(contents, eq(payments.contentId, contents.id))
      .innerJoin(users, eq(payments.userId, users.id))
      .where(eq(payments.id, paymentId))
      .limit(1);

    if (!row) return res.status(404).json({ error: 'Receipt not found.' });
    if (row.payment.userId !== req.user!.id && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized.' });
    }

    return res.json({
      receipt: {
        receiptNumber: row.payment.receiptNumber,
        orderId: row.payment.providerOrderId,
        providerPaymentId: row.payment.providerPaymentId,
        mode: row.payment.mode,
        status: row.payment.status,
        amountInr: row.payment.amountInr,
        currency: row.payment.currency,
        issuedAt: row.payment.createdAt,
        contentTitle: row.contentTitle,
        contentType: row.contentType,
        contentSlug: row.contentSlug,
        buyerName: row.buyerName,
        buyerEmail: row.buyerEmail,
        refundReason: row.payment.refundReason,
      },
    });
  } catch (error) {
    console.error('Receipt error:', error);
    return res.status(500).json({ error: 'Unable to load receipt.' });
  }
});

export default router;
