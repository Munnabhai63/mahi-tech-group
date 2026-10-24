/**
 * Transactional email service with real SMTP delivery via nodemailer.
 * When SMTP_HOST/SMTP_USER/SMTP_PASS are configured, messages are actually
 * delivered; otherwise an honest local audit fallback is used (nothing is
 * silently "sent" that never reaches an inbox).
 */

import nodemailer from 'nodemailer';
import { logAccess } from './auditService.js';

export class EmailService {
  constructor() {
    this.smtpHost = process.env.SMTP_HOST || null;
    this.smtpPort = Number(process.env.SMTP_PORT) || 587;
    this.smtpUser = process.env.SMTP_USER || null;
    this.smtpPass = process.env.SMTP_PASS || null;
    this.smtpSecure = process.env.SMTP_SECURE === 'true' || Number(process.env.SMTP_PORT) === 465;
    this.fromEmail = process.env.SMTP_FROM || 'no-reply@mahitechgroup.com';
    this.isConfigured = Boolean(this.smtpHost && this.smtpUser && this.smtpPass);
    this.transporter = null;
  }

  /**
   * Lazily creates the SMTP transporter (one shared connection pool).
   */
  getTransporter() {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: this.smtpHost,
        port: this.smtpPort,
        secure: this.smtpSecure,
        auth: { user: this.smtpUser, pass: this.smtpPass }
      });
    }
    return this.transporter;
  }

  /**
   * Dispatch an email message to a recipient.
   * @param {Object} options
   * @param {string} options.to - Recipient email address
   * @param {string} options.subject - Email subject
   * @param {string} options.text - Plain text content
   * @param {string} [options.html] - Optional HTML markup
   * @param {string} [options.userId] - Associated user ID for audit log
   * @returns {{ success: boolean, delivered: boolean, mode: 'smtp'|'local_audit', messageId?: string, recipient: string }}
   */
  async sendEmail({ to, subject, text, html, userId }) {
    if (!to || !subject) {
      throw new Error('Recipient (to) and subject are required to send an email');
    }

    let result;

    if (this.isConfigured) {
      try {
        const info = await this.getTransporter().sendMail({
          from: this.fromEmail,
          to,
          subject,
          text,
          html: html || `<p>${text}</p>`
        });
        result = {
          success: true,
          delivered: true,
          mode: 'smtp',
          messageId: info.messageId,
          recipient: to
        };
      } catch (err) {
        console.error('[EMAIL DISPATCH - SMTP ERROR]', err.message);
        result = {
          success: false,
          delivered: false,
          mode: 'smtp',
          error: err.message,
          recipient: to
        };
        if (userId) {
          logAccess({
            userId,
            action: 'email_dispatch_failed',
            resource: `to:${to} subject:${subject} error:${err.message.slice(0, 120)}`,
            ipAddress: '127.0.0.1'
          });
        }
        return result;
      }
    } else {
      // Local dev & test fallback — explicitly NOT delivered
      console.log(`[EMAIL DISPATCH - LOCAL AUDIT (not delivered)] To: ${to} | Subject: "${subject}" | Preview: ${String(text).slice(0, 100)}`);
      result = {
        success: true,
        delivered: false,
        mode: 'local_audit',
        messageId: null,
        recipient: to
      };
    }

    if (userId) {
      logAccess({
        userId,
        action: result.delivered ? 'email_dispatched' : 'email_dispatch_local_fallback',
        resource: `to:${to} subject:${subject}`,
        ipAddress: '127.0.0.1'
      });
    }

    return result;
  }

  /**
   * Send account application status update.
   */
  async sendAccountStatusEmail(user, status, reason = '') {
    const subject = status === 'active'
      ? 'Welcome to Mahi Tech Group — Application Approved'
      : 'Update on Your Mahi Tech Group Application';

    const text = status === 'active'
      ? `Hello ${user.name},\n\nCongratulations! Your application for role '${user.role || user.desired_role}' has been approved by the Admin. You can now sign in at the Login page and access your workspace.\n\nBest,\nMahi Tech Group Admin Team`
      : `Hello ${user.name},\n\nYour application status has been updated to '${status}'. ${reason ? `Reason: ${reason}` : ''}\n\nBest,\nMahi Tech Group Admin Team`;

    return this.sendEmail({
      to: user.email,
      subject,
      text,
      userId: user.id
    });
  }
}

export const emailService = new EmailService();
export default emailService;
