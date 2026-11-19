import nodemailer from 'nodemailer';

export interface EmailSendResult {
  sent: boolean;
  configured: boolean;
  provider: string;
  note: string;
}

export function isMailerConfigured(): boolean {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
}

function createTransporter() {
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  if (!user || !pass) return null;

  const host = process.env.SMTP_HOST?.trim() || 'smtp.gmail.com';
  const port = Number(process.env.SMTP_PORT || 465);
  const secure = process.env.SMTP_SECURE
    ? process.env.SMTP_SECURE === 'true'
    : port === 465;

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
}

function escapeHtml(raw: string): string {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function sendAccountDeletedEmail(params: {
  toEmail: string;
  userName: string;
  publicUid?: string | null;
  reason: string;
  deletedAt?: Date;
}): Promise<EmailSendResult> {
  const transporter = createTransporter();
  if (!transporter) {
    return {
      sent: false,
      configured: false,
      provider: 'smtp',
      note: 'SMTP_USER / SMTP_PASS not configured in environment. Deletion reason was logged in the database and will display on login attempts.',
    };
  }

  const from = process.env.SMTP_FROM?.trim() || `ScholarPress Administration <${process.env.SMTP_USER}>`;
  const when = (params.deletedAt || new Date()).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const subject = 'Important: Your ScholarPress Account Has Been Permanently Deleted';
  const text = [
    `Hello ${params.userName},`,
    '',
    'Your ScholarPress account and all associated data (profile, saved items, publications, and history) have been permanently deleted by a platform administrator.',
    '',
    `Account Email: ${params.toEmail}`,
    params.publicUid ? `Former 10-Digit UID: ${params.publicUid}` : null,
    `Date & Time (IST): ${when}`,
    `Reason for Deletion: ${params.reason}`,
    '',
    'Because your account has been permanently removed from our database, you will need to register a brand-new account from scratch if you wish to use ScholarPress again.',
    '',
    '— ScholarPress Administration',
  ]
    .filter(Boolean)
    .join('\n');

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; color: #0f172a; line-height: 1.6;">
      <div style="background: #0F2547; color: #ffffff; padding: 20px 24px; border-radius: 8px 8px 0 0;">
        <h2 style="margin: 0; font-size: 18px; font-weight: 600;">ScholarPress Account Notice</h2>
      </div>
      <div style="border: 1px solid #e2e8f0; border-top: none; padding: 24px; border-radius: 0 0 8px 8px; background: #ffffff;">
        <p style="margin-top: 0;">Hello <strong>${escapeHtml(params.userName)}</strong>,</p>
        <p>Your ScholarPress account and all associated records (profile, library, publications, and activity history) have been <strong>permanently deleted</strong> from our database by an administrator.</p>
        <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 14px 16px; margin: 18px 0;">
          <div style="font-size: 12px; color: #991b1b; font-weight: 600; margin-bottom: 4px;">Reason for Account Deletion</div>
          <div style="font-size: 14px; color: #7f1d1d;">${escapeHtml(params.reason)}</div>
        </div>
        <table style="width: 100%; font-size: 13px; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 6px 0; color: #64748b;">Account Email</td><td style="padding: 6px 0; font-weight: 600; text-align: right;">${escapeHtml(params.toEmail)}</td></tr>
          ${params.publicUid ? `<tr><td style="padding: 6px 0; color: #64748b;">Former 10-Digit UID</td><td style="padding: 6px 0; font-family: monospace; text-align: right;">${escapeHtml(params.publicUid)}</td></tr>` : ''}
          <tr><td style="padding: 6px 0; color: #64748b;">Deleted On (IST)</td><td style="padding: 6px 0; text-align: right;">${escapeHtml(when)}</td></tr>
        </table>
        <p style="font-size: 13px; color: #475569;">All prior data has been completely erased. If you want to use ScholarPress in the future, you will need to create a brand-new account from the beginning.</p>
        <p style="font-size: 12px; color: #94a3b8; margin-bottom: 0; padding-top: 12px; border-top: 1px solid #f1f5f9;">ScholarPress Administration</p>
      </div>
    </div>
  `;

  try {
    const info = await transporter.sendMail({
      from,
      to: params.toEmail,
      subject,
      text,
      html,
    });
    return {
      sent: true,
      configured: true,
      provider: 'smtp',
      note: `Email delivered to ${params.toEmail} (Message ID: ${info.messageId || 'sent'}).`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'SMTP delivery failed';
    console.error('Failed to send account deleted email:', msg);
    return {
      sent: false,
      configured: true,
      provider: 'smtp',
      note: `SMTP error: ${msg}`,
    };
  }
}

export async function sendAccountBlockedEmail(params: {
  toEmail: string;
  userName: string;
  status: 'blocked' | 'suspended';
  reason: string;
  blockedUntil: Date | null;
}): Promise<EmailSendResult> {
  const transporter = createTransporter();
  if (!transporter) {
    return {
      sent: false,
      configured: false,
      provider: 'smtp',
      note: 'SMTP not configured — block reason is saved and shown directly when the user tries to sign in.',
    };
  }

  const from = process.env.SMTP_FROM?.trim() || `ScholarPress Administration <${process.env.SMTP_USER}>`;
  const durationLabel = params.blockedUntil
    ? `Until ${params.blockedUntil.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        dateStyle: 'medium',
        timeStyle: 'short',
      })} IST`
    : 'Permanent (until reviewed by an administrator)';

  const subject = `Notice: Your ScholarPress Account Has Been ${params.status === 'blocked' ? 'Blocked' : 'Suspended'}`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; color: #0f172a; line-height: 1.6;">
      <div style="background: #0F2547; color: #ffffff; padding: 20px 24px; border-radius: 8px 8px 0 0;">
        <h2 style="margin: 0; font-size: 18px; font-weight: 600;">ScholarPress Account Restriction</h2>
      </div>
      <div style="border: 1px solid #e2e8f0; border-top: none; padding: 24px; border-radius: 0 0 8px 8px; background: #ffffff;">
        <p style="margin-top: 0;">Hello <strong>${escapeHtml(params.userName)}</strong>,</p>
        <p>Your ScholarPress account (<strong>${escapeHtml(params.toEmail)}</strong>) has been <strong>${escapeHtml(params.status)}</strong> by a platform administrator.</p>
        <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 14px 16px; margin: 18px 0;">
          <div style="font-size: 12px; color: #92400e; font-weight: 600; margin-bottom: 4px;">Reason</div>
          <div style="font-size: 14px; color: #78350f;">${escapeHtml(params.reason)}</div>
          <div style="font-size: 12px; color: #92400e; margin-top: 10px;"><strong>Duration:</strong> ${escapeHtml(durationLabel)}</div>
        </div>
        <p style="font-size: 13px; color: #475569;">If this is a timed restriction, your account will automatically unlock once the duration expires.</p>
      </div>
    </div>
  `;

  try {
    await transporter.sendMail({
      from,
      to: params.toEmail,
      subject,
      html,
      text: `Hello ${params.userName},\n\nYour ScholarPress account has been ${params.status}.\nReason: ${params.reason}\nDuration: ${durationLabel}\n\n— ScholarPress Administration`,
    });
    return {
      sent: true,
      configured: true,
      provider: 'smtp',
      note: `Restriction notice emailed to ${params.toEmail}.`,
    };
  } catch (err) {
    return {
      sent: false,
      configured: true,
      provider: 'smtp',
      note: `SMTP error: ${err instanceof Error ? err.message : 'delivery failed'}`,
    };
  }
}
