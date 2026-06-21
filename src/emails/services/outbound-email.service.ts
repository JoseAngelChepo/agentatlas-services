import { Injectable, Logger } from '@nestjs/common';
import { ResendService } from './resend.service';
import type { SendEmailOptions, SendEmailResult } from '../types/email-send.types';

/**
 * Outbound transactional email via Resend (single provider).
 * Thin facade over {@link ResendService} for backwards-compatible helpers.
 */
@Injectable()
export class OutboundEmailService {
  private readonly logger = new Logger(OutboundEmailService.name);

  constructor(private readonly resendService: ResendService) {}

  isConfigured(): boolean {
    return this.resendService.isConfigured();
  }

  async sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
    return this.resendService.sendEmail(options);
  }

  async sendSimpleEmail(
    to: string | string[],
    subject: string,
    text: string,
    from?: string,
  ): Promise<SendEmailResult> {
    return this.resendService.sendSimpleEmail(to, subject, text, from);
  }

  async sendHtmlEmail(
    to: string,
    subject: string,
    html: string,
    text?: string,
  ): Promise<void> {
    if (!this.resendService.isConfigured()) {
      this.logger.warn(
        `Skipping email "${subject}" to ${to}: set RESEND_API_KEY and EMAIL_FROM or RESEND_FROM_EMAIL to enable outbound mail.`,
      );
      return;
    }

    const result = await this.resendService.sendHtmlEmail(to, subject, html, text);
    if (!result.success) {
      this.logger.error(`Resend error: ${result.error ?? 'unknown'}`);
      throw new Error(result.error ?? 'Failed to send email');
    }
  }

  async sendHtmlEmailResult(
    to: string | string[],
    subject: string,
    html: string,
    text?: string,
    from?: string,
  ): Promise<SendEmailResult> {
    return this.resendService.sendHtmlEmail(to, subject, html, text, from);
  }

  async sendTemplatedEmail(
    to: string | string[],
    templateId: string,
    dynamicTemplateData: Record<string, unknown>,
    subject?: string,
    from?: string,
  ): Promise<SendEmailResult> {
    return this.resendService.sendTemplatedEmail(
      to,
      templateId,
      dynamicTemplateData,
      subject,
      from,
    );
  }

  async sendBulkEmails(
    recipients: Array<{
      to: string;
      subject: string;
      text?: string;
      html?: string;
      dynamicTemplateData?: Record<string, unknown>;
    }>,
    options?: { templateId?: string; from?: string },
  ): Promise<SendEmailResult[]> {
    return this.resendService.sendBulkEmails(recipients, options);
  }
}
