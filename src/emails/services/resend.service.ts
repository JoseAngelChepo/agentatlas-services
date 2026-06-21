import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import type { SendEmailOptions, SendEmailResult } from '../types/email-send.types';

@Injectable()
export class ResendService {
  private readonly logger = new Logger(ResendService.name);
  private readonly client?: Resend;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('RESEND_API_KEY')?.trim();

    if (!apiKey) {
      this.logger.warn(
        'RESEND_API_KEY not configured. Outbound email via Resend is disabled.',
      );
    } else {
      this.client = new Resend(apiKey);
      this.logger.log('Resend service initialized');
    }
  }

  /** Full Resend `from` header: optional EMAIL_FROM override, else name + RESEND_FROM_EMAIL. */
  private defaultFromString(): string {
    const explicit = this.configService.get<string>('EMAIL_FROM')?.trim();
    if (explicit) {
      return explicit;
    }
    const email = this.configService.get<string>('RESEND_FROM_EMAIL')?.trim() ?? '';
    const name = this.configService.get<string>('RESEND_FROM_NAME')?.trim();
    if (!email) {
      return '';
    }
    if (name) {
      return `${name} <${email}>`;
    }
    return email;
  }

  private resolveFrom(override?: string): string {
    const from = override?.trim() || this.defaultFromString();
    return from;
  }

  async sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
    try {
      if (options.templateId) {
        return {
          success: false,
          error:
            'Dynamic templates are not supported. Send HTML or plain text content instead.',
        };
      }

      if (!options.text && !options.html) {
        throw new Error('Email must have text or html content');
      }

      if (!this.client) {
        return {
          success: false,
          error: 'RESEND_API_KEY not configured. Outbound email is disabled.',
        };
      }

      const from = this.resolveFrom(options.from);
      if (!from) {
        return {
          success: false,
          error:
            'Missing sender: set EMAIL_FROM or RESEND_FROM_EMAIL (and optionally RESEND_FROM_NAME).',
        };
      }

      const attachments =
        options.attachments && options.attachments.length > 0
          ? options.attachments.map((att) => ({
              content: att.content,
              filename: att.filename,
              contentType: att.type,
            }))
          : undefined;

      const base = {
        from,
        to: options.to,
        subject: options.subject,
        ...(options.cc !== undefined ? { cc: options.cc } : {}),
        ...(options.bcc !== undefined ? { bcc: options.bcc } : {}),
        ...(options.replyTo !== undefined ? { replyTo: options.replyTo } : {}),
        ...(attachments !== undefined ? { attachments } : {}),
      };

      const { data, error } = options.html
        ? await this.client.emails.send({
            ...base,
            html: options.html,
            ...(options.text ? { text: options.text } : {}),
          })
        : await this.client.emails.send({
            ...base,
            text: options.text as string,
          });

      if (error) {
        this.logger.error(`Resend API error: ${error.message}`);
        return {
          success: false,
          error: error.message,
        };
      }

      const toLabel = Array.isArray(options.to) ? options.to.join(', ') : options.to;
      this.logger.log(`Email sent successfully to ${toLabel}`);

      return {
        success: true,
        messageId: data?.id,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      this.logger.error(`Error sending email via Resend: ${message}`, stack);
      return {
        success: false,
        error: message,
      };
    }
  }

  async sendSimpleEmail(
    to: string | string[],
    subject: string,
    text: string,
    from?: string,
  ): Promise<SendEmailResult> {
    return this.sendEmail({
      to,
      subject,
      text,
      from,
    });
  }

  async sendHtmlEmail(
    to: string | string[],
    subject: string,
    html: string,
    text?: string,
    from?: string,
  ): Promise<SendEmailResult> {
    return this.sendEmail({
      to,
      subject,
      html,
      text,
      from,
    });
  }

  async sendTemplatedEmail(
    _to: string | string[],
    _templateId: string,
    _dynamicTemplateData: Record<string, unknown>,
    _subject?: string,
    _from?: string,
  ): Promise<SendEmailResult> {
    return {
      success: false,
      error:
        'Dynamic templates are not supported. Send HTML or plain text content instead.',
    };
  }

  async sendBulkEmails(
    recipients: Array<{
      to: string;
      subject: string;
      text?: string;
      html?: string;
      dynamicTemplateData?: Record<string, unknown>;
    }>,
    options?: {
      templateId?: string;
      from?: string;
    },
  ): Promise<SendEmailResult[]> {
    const results: SendEmailResult[] = [];
    for (const recipient of recipients) {
      const result = await this.sendEmail({
        to: recipient.to,
        from: options?.from,
        subject: recipient.subject,
        text: recipient.text,
        html: recipient.html,
        templateId: options?.templateId,
        dynamicTemplateData: recipient.dynamicTemplateData,
      });
      results.push(result);
    }
    return results;
  }

  isConfigured(): boolean {
    const apiKey = this.configService.get<string>('RESEND_API_KEY')?.trim();
    if (!apiKey) {
      return false;
    }
    return Boolean(this.defaultFromString());
  }
}
