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

export async function sendSignupOtpEmail(params: {
  toEmail: string;
  userName: string;
  otpCode: string;
  expiresMinutes?: number;
}): Promise<EmailSendResult> {
  const transporter = createTransporter();
  if (!transporter) {
    return {
      sent: false,
      configured: false,
      provider: 'smtp',
      note: 'SMTP credentials (SMTP_HOST, SMTP_USER, SMTP_PASS) are not configured on the server.',
    };
  }

  const expiresMinutes = params.expiresMinutes ?? 2;
  const from = process.env.SMTP_FROM?.trim() || `ScholarPress <${process.env.SMTP_USER}>`;
  const subject = `${params.otpCode} is your ScholarPress verification OTP`;

  const text = [
    `Hello ${params.userName || 'Scholar'},`,
    '',
    'Welcome to ScholarPress — Your Knowledge, Our Mission.',
    '',
    `Your 4-digit verification OTP is: ${params.otpCode}`,
    '',
    `This OTP is valid for ${expiresMinutes} minutes.`,
    'Security Warning: Do not share your OTP with anyone. ScholarPress will never ask you for this code.',
    '',
    'If you did not request a ScholarPress account, you can safely ignore this email.',
    '',
    '— ScholarPress Team',
  ].join('\n');

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background-color: #EEF4FF; padding: 28px 14px; color: #0A1E44;">
      <div style="max-width: 560px; margin: 0 auto; background-color: #FFFFFF; border-radius: 18px; overflow: hidden; border: 1px solid #DCE6F7; box-shadow: 0 12px 30px rgba(10, 30, 68, 0.08);">
        <div style="background: linear-gradient(135deg, #0A1647 0%, #0F52FC 100%); padding: 26px 28px; text-align: center; color: #FFFFFF;">
          <div style="font-size: 24px; font-weight: 800; letter-spacing: -0.3px;">ScholarPress</div>
          <div style="font-size: 13px; color: #DBEAFE; margin-top: 4px; font-weight: 500;">Your Knowledge, Our Mission</div>
        </div>

        <div style="padding: 30px 28px;">
          <h1 style="margin: 0 0 10px 0; font-size: 20px; font-weight: 700; color: #0A1647;">Verify Your Email Address</h1>
          <p style="margin: 0 0 18px 0; font-size: 14px; line-height: 1.6; color: #334155;">
            Hello <strong>${escapeHtml(params.userName || 'Scholar')}</strong>, thank you for registering with <strong>ScholarPress</strong>. Enter the 4-digit verification code below to complete your account signup:
          </p>

          <div style="background: #F0F6FF; border: 1.5px solid #BFDBFE; border-radius: 14px; padding: 22px 16px; text-align: center; margin: 22px 0;">
            <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #1D4ED8; margin-bottom: 8px;">Your 4-Digit Verification OTP</div>
            <div style="font-family: 'Courier New', Courier, monospace; font-size: 38px; font-weight: 800; letter-spacing: 14px; color: #0A1647; padding-left: 14px;">${escapeHtml(params.otpCode)}</div>
            <div style="font-size: 13px; font-weight: 600; color: #1E40AF; margin-top: 10px;">
              OTP will expire in ${expiresMinutes} minutes.
            </div>
          </div>

          <div style="background: #FEF2F2; border: 1px solid #FECACA; border-radius: 10px; padding: 12px 14px; margin: 18px 0;">
            <div style="font-size: 12.5px; font-weight: 700; color: #991B1B; margin-bottom: 2px;">Security Warning</div>
            <div style="font-size: 12.5px; line-height: 1.5; color: #7F1D1D;">
              Do not share your OTP with anyone. ScholarPress staff will never call or email asking for your verification code.
            </div>
          </div>

          <p style="margin: 18px 0 0 0; font-size: 12.5px; line-height: 1.5; color: #64748B;">
            If you did not initiate this signup on ScholarPress, please disregard this email. No account will be created without OTP verification.
          </p>
        </div>

        <div style="background: #F8FAFC; border-top: 1px solid #E2E8F0; padding: 16px 28px; text-align: center; font-size: 12px; color: #64748B;">
          &copy; ${new Date().getFullYear()} ScholarPress &bull; Secure Email Verification
        </div>
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
      note: `OTP email sent to ${params.toEmail} (Message ID: ${info.messageId || 'sent'}).`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'SMTP delivery failed';
    console.error('Failed to send signup OTP email:', msg);
    return {
      sent: false,
      configured: true,
      provider: 'smtp',
      note: `SMTP error: ${msg}`,
    };
  }
}

export async function sendPasswordResetEmail(params: {
  toEmail: string;
  userName?: string | null;
  resetUrl: string;
  expiresMinutes?: number;
}): Promise<EmailSendResult> {
  const transporter = createTransporter();
  if (!transporter) {
    return {
      sent: false,
      configured: false,
      provider: 'smtp',
      note: 'SMTP credentials (SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS) are not configured on the server.',
    };
  }

  const expiresMinutes = params.expiresMinutes ?? 15;
  const from = process.env.SMTP_FROM?.trim() || `ScholarPress <${process.env.SMTP_USER}>`;
  const subject = 'Reset Your ScholarPress Password';
  const safeResetUrl = escapeHtml(params.resetUrl);

  const text = [
    'Hello,',
    '',
    'We received a request to reset your ScholarPress account password.',
    '',
    'Click the link below to create a new password:',
    params.resetUrl,
    '',
    `This link will expire in ${expiresMinutes} minutes.`,
    '',
    'If you did not request this password reset, you can safely ignore this email. Your existing password will remain unchanged.',
    '',
    'Regards,',
    'ScholarPress Team',
  ].join('\n');

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background-color: #EEF4FF; padding: 30px 14px; color: #0A1E44;">
      <div style="max-width: 560px; margin: 0 auto; background-color: #FFFFFF; border-radius: 18px; overflow: hidden; border: 1px solid #DCE6F7; box-shadow: 0 12px 30px rgba(10, 30, 68, 0.08);">
        <div style="background: linear-gradient(135deg, #0A1647 0%, #0F52FC 100%); padding: 28px 28px; text-align: center; color: #FFFFFF;">
          <div style="font-size: 25px; font-weight: 800; letter-spacing: -0.3px;">ScholarPress</div>
          <div style="font-size: 13px; color: #DBEAFE; margin-top: 4px; font-weight: 500;">Your Knowledge, Our Mission</div>
        </div>

        <div style="padding: 32px 28px;">
          <h1 style="margin: 0 0 12px 0; font-size: 21px; font-weight: 700; color: #0A1647;">Reset Your Password</h1>
          <p style="margin: 0 0 14px 0; font-size: 14.5px; line-height: 1.65; color: #334155;">Hello,</p>
          <p style="margin: 0 0 14px 0; font-size: 14.5px; line-height: 1.65; color: #334155;">
            We received a request to reset your <strong>ScholarPress</strong> account password.
          </p>
          <p style="margin: 0 0 24px 0; font-size: 14.5px; line-height: 1.65; color: #334155;">
            Click the button below to create a new password.
          </p>

          <div style="text-align: center; margin: 28px 0;">
            <a
              href="${safeResetUrl}"
              target="_blank"
              rel="noopener noreferrer"
              style="display: inline-block; background: linear-gradient(135deg, #0F76FF 0%, #004AE2 55%, #002EC4 100%); background-color: #004AE2; color: #FFFFFF; text-decoration: none; font-weight: 700; font-size: 15px; padding: 14px 34px; border-radius: 12px; box-shadow: 0 8px 20px rgba(0, 62, 216, 0.28);"
            >
              Reset Password
            </a>
          </div>

          <div style="background: #F0F6FF; border: 1px solid #BFDBFE; border-radius: 10px; padding: 12px 15px; margin: 20px 0; text-align: center;">
            <span style="font-size: 13px; font-weight: 600; color: #1E40AF;">
              This link will expire in ${expiresMinutes} minutes.
            </span>
          </div>

          <p style="margin: 18px 0 0 0; font-size: 13.5px; line-height: 1.6; color: #475569;">
            If you did not request this password reset, you can safely ignore this email. Your existing password will remain unchanged.
          </p>

          <p style="margin: 22px 0 0 0; font-size: 14px; line-height: 1.6; color: #0A1647;">
            Regards,<br />
            <strong>ScholarPress Team</strong>
          </p>

          <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #E2E8F0; font-size: 11.5px; color: #64748B; word-break: break-all;">
            If the button above does not work, copy and paste this secure link into your browser:<br />
            <a href="${safeResetUrl}" style="color: #0F52FC; text-decoration: underline;">${safeResetUrl}</a>
          </div>
        </div>

        <div style="background: #F8FAFC; border-top: 1px solid #E2E8F0; padding: 16px 28px; text-align: center; font-size: 12px; color: #64748B;">
          &copy; ${new Date().getFullYear()} ScholarPress &bull; Account Security
        </div>
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
      note: `Password reset email sent (Message ID: ${info.messageId || 'sent'}).`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'SMTP delivery failed';
    console.error('Failed to send password reset email:', msg);
    return {
      sent: false,
      configured: true,
      provider: 'smtp',
      note: `SMTP error: ${msg}`,
    };
  }
}


