export function escapeHtmlForEmail(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Mirrors `agentatlas-platform` `globals.css` tokens for transactional mail. */
export const EMAIL_THEME = {
  bg: '#fbfbfa',
  surface: '#ffffff',
  surfaceMuted: '#fafaf8',
  border: '#eaeaea',
  text: '#0a0a0a',
  textMuted: '#525866',
  textFaint: '#8a8f99',
  accent: '#1463ff',
  primary: '#0a0a0a',
  primaryFg: '#ffffff',
  radius: '8px',
  radiusLg: '12px',
  font:
    '"Red Hat Display", system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
} as const;

export type TransactionalEmailLayoutOptions = {
  eyebrow: string;
  title: string;
  innerHtml: string;
  ctaHtml: string;
  footerRightLabel: string;
};

export function renderTransactionalEmailLayout(
  options: TransactionalEmailLayoutOptions,
): string {
  const e = escapeHtmlForEmail;
  const t = EMAIL_THEME;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>agentatlas</title>
  <link href="https://fonts.googleapis.com/css2?family=Red+Hat+Display:wght@400;500;600;700&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background:${t.bg};font-family:${t.font};">

  <table width="100%" cellpadding="0" cellspacing="0" style="background:${t.bg};padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:${t.surface};max-width:560px;width:100%;border:1px solid ${t.border};border-radius:${t.radiusLg};overflow:hidden;box-shadow:0 4px 12px -2px rgba(10,10,10,0.06),0 2px 4px -2px rgba(10,10,10,0.04);">

          <tr>
            <td style="padding:24px 32px;border-bottom:1px solid ${t.border};">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-right:10px;vertical-align:middle;">
                    <div style="width:24px;height:24px;border-radius:6px;background:${t.primary};position:relative;">
                      <div style="position:absolute;right:3px;bottom:3px;width:8px;height:8px;border-radius:2px;background:${t.accent};"></div>
                    </div>
                  </td>
                  <td style="font-family:${t.font};font-size:17px;letter-spacing:-0.03em;line-height:1;vertical-align:middle;">
                    <span style="color:${t.textMuted};font-weight:500;">agent</span><span style="color:${t.text};font-weight:600;">atlas</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:28px 32px 8px 32px;">
              <p style="margin:0 0 8px 0;font-family:${t.font};font-size:11px;color:${t.textFaint};letter-spacing:0.04em;text-transform:uppercase;font-weight:500;">
                ${e(options.eyebrow)}
              </p>
              <h1 style="margin:0;font-family:${t.font};font-size:24px;font-weight:600;color:${t.text};line-height:1.25;letter-spacing:-0.03em;">
                ${e(options.title)}
              </h1>
              <div style="width:32px;height:2px;background:${t.accent};margin-top:14px;border-radius:1px;opacity:0.85;"></div>
            </td>
          </tr>

          <tr>
            <td style="padding:12px 32px 28px 32px;">
              ${options.innerHtml}
            </td>
          </tr>

          ${options.ctaHtml}

          <tr>
            <td style="border-top:1px solid ${t.border};padding:18px 32px;background:${t.surfaceMuted};">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-family:${t.font};font-size:11px;color:${t.textFaint};letter-spacing:0.02em;">
                    &copy; ${new Date().getFullYear()} agentatlas
                  </td>
                  <td align="right">
                    <span style="font-family:${t.font};font-size:11px;color:${t.textFaint};letter-spacing:0.02em;">
                      ${e(options.footerRightLabel)}
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>
    `.trim();
}

/** Primary CTA button — matches platform `Button` variant="primary". */
export function renderEmailPrimaryButton(label: string, href: string): string {
  const t = EMAIL_THEME;
  const safeLabel = escapeHtmlForEmail(label);
  const safeHref = escapeHtmlForEmail(href);

  return `
          <tr>
            <td style="padding:0 32px 20px 32px;">
              <a href="${safeHref}" style="display:inline-block;padding:10px 16px;background:${t.primary};color:${t.primaryFg};text-decoration:none;font-family:${t.font};font-size:15px;font-weight:500;letter-spacing:0.01em;line-height:1.25;border-radius:${t.radius};border:1px solid ${t.primary};">
                ${safeLabel}
              </a>
            </td>
          </tr>
  `.trim();
}

/** Fallback URL block below the CTA. */
export function renderEmailLinkFallback(url: string): string {
  const t = EMAIL_THEME;
  const safeUrl = escapeHtmlForEmail(url);

  return `
          <tr>
            <td style="padding:0 32px 32px 32px;">
              <p style="margin:0 0 6px 0;font-family:${t.font};font-size:11px;color:${t.textFaint};letter-spacing:0.02em;">
                Or paste this link
              </p>
              <p style="margin:0;font-family:${t.font};font-size:12px;color:${t.textMuted};line-height:1.55;word-break:break-all;">
                ${safeUrl}
              </p>
            </td>
          </tr>
  `.trim();
}

/** Body copy paragraph. */
export function renderEmailParagraph(html: string): string {
  const t = EMAIL_THEME;
  return `<p style="margin:0 0 14px 0;font-family:${t.font};font-size:15px;color:${t.textMuted};line-height:1.6;">${html}</p>`;
}
