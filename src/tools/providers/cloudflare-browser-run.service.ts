import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type CloudflareApiError = {
  code?: number;
  message?: string;
};

type CloudflareApiResponse<T> = {
  success: boolean;
  result?: T;
  errors?: CloudflareApiError[];
};

type MarkdownWaitUntil = 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';

type MarkdownRequestBody = {
  url: string;
  gotoOptions?: {
    waitUntil?: MarkdownWaitUntil;
  };
};

@Injectable()
export class CloudflareBrowserRunService {
  private readonly logger = new Logger(CloudflareBrowserRunService.name);
  private readonly baseUrl = 'https://api.cloudflare.com/client/v4';

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.accountId() && this.apiToken());
  }

  accountId(): string | undefined {
    return this.config.get<string>('CLOUDFLARE_ACCOUNT_ID', '').trim() || undefined;
  }

  apiToken(): string | undefined {
    return this.config.get<string>('CLOUDFLARE_API_TOKEN', '').trim() || undefined;
  }

  timeoutMs(): number {
    const raw = Number(this.config.get<string>('CLOUDFLARE_BROWSER_RUN_TIMEOUT_MS', '60000'));
    return Math.min(Math.max(Number.isFinite(raw) ? raw : 60_000, 5_000), 300_000);
  }

  private formatApiFailure(
    url: string,
    status: number,
    errors: CloudflareApiError[] | undefined,
  ): string {
    const first = errors?.[0];
    const code = first?.code;
    const message = errors?.map((error) => error.message).filter(Boolean).join('; ');

    if (code === 10000 || status === 401 || status === 403) {
      return [
        'Cloudflare Browser Run API authentication failed.',
        'Verify CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.',
        'The token needs "Browser Rendering - Edit" on the same account.',
        message ? `Cloudflare: ${message}` : undefined,
      ]
        .filter(Boolean)
        .join(' ');
    }

    if (message?.toLowerCase().includes('authentication')) {
      return [
        `Could not scrape ${url}.`,
        'The target page may require login, or your Cloudflare API credentials are invalid.',
        'If this happens for every URL, fix CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN.',
        `Cloudflare: ${message}`,
      ].join(' ');
    }

    return message || `Cloudflare Browser Run request failed (${status})`;
  }

  private previewForLog(value: unknown, maxChars = 200): string {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars)}… (${text.length} chars total)`;
  }

  async fetchMarkdown(
    url: string,
    options?: { waitUntil?: MarkdownWaitUntil },
  ): Promise<string> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'Cloudflare Browser Run is not configured. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.',
      );
    }

    const body: MarkdownRequestBody = { url };
    if (options?.waitUntil) {
      body.gotoOptions = { waitUntil: options.waitUntil };
    }

    const endpoint = `${this.baseUrl}/accounts/${this.accountId()}/browser-rendering/markdown`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs());
    const started = Date.now();

    this.logger.log(`[Browser Run] POST /markdown url=${url}`);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const payload = (await response.json()) as CloudflareApiResponse<string>;

      if (!response.ok || !payload.success) {
        this.logger.warn(
          `[Browser Run] POST /markdown response status=${response.status} latencyMs=${Date.now() - started} body=${this.previewForLog({
            success: payload.success,
            errors: payload.errors,
          })}`,
        );
        const message = this.formatApiFailure(url, response.status, payload.errors);
        throw new BadGatewayException(message);
      }

      if (typeof payload.result !== 'string') {
        throw new BadGatewayException('Cloudflare Browser Run returned an empty markdown result');
      }

      this.logger.log(
        `[Browser Run] POST /markdown ok status=${response.status} latencyMs=${Date.now() - started} markdownChars=${payload.result.length} url=${url}`,
      );

      return payload.result;
    } catch (error) {
      if (error instanceof BadGatewayException || error instanceof ServiceUnavailableException) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new BadGatewayException(
          `Cloudflare Browser Run timed out after ${this.timeoutMs()}ms`,
        );
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Markdown fetch error for ${url}: ${message}`);
      throw new BadGatewayException(`Cloudflare Browser Run request failed: ${message}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}
