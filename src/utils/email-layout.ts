/**
 * Kullaniciya giden tum e-postalarin ortak duzeni (dogrulama, sifre sifirlama, yeni eslesme,
 * ban bildirimi, destek yaniti). Tek kaynak: 600px tablo duzeni, inline stil, bulletproof
 * buton, gizli preheader, RTL ve koyu mod destegi. JS yok, harici gorsel yok (wordmark metindir).
 *
 * Guvenlik: disaridan gelen HER deger (ad, destek mesaji, url) burada kacislanir; cagiranlar
 * ham metin verir. Baglantilar yalniz http(s) olabilir.
 */

const RTL_LOCALES = new Set(["ar"]);

// Marka (qulov2/lib/core/theme/app_colors.dart): primary #BB86FC, zemin #0D0D0D.
const FONT = "Poppins,Helvetica,Arial,sans-serif";

export interface EmailLink {
  label: string;
  url: string;
}

export interface EmailLayoutInput {
  locale: string;
  /** Kutu onizlemesinde gorunen gizli metin. */
  preheader: string;
  /** Baslik altindaki kisa marka cumlesi (opsiyonel). */
  tagline?: string;
  title: string;
  /** Her oge ayri paragraf; "\n" satir sonu olur. */
  paragraphs: string[];
  /** Vurgulu kutu (ban sebebi gibi): "Etiket: metin". */
  highlight?: { label: string; text: string };
  /** Tek ana buton. */
  button?: EmailLink;
  /** Buton calismazsa ham baglanti gosterilir. */
  fallback?: EmailLink;
  /** Butonun altindaki ikincil metin baglantisi. */
  secondaryLink?: EmailLink;
  /** Alt bilgi satirlari (neden aldin, yok sayabilirsin vb.). */
  footerLines: string[];
  /** Alt bilgideki baglanti (abonelikten cik). */
  footerLink?: EmailLink;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Yalniz http(s) baglanti kabul edilir; digeri programlama hatasidir. */
function safeUrl(url: string): string {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("email-layout: only http(s) urls are allowed");
  }
  return escapeHtml(url);
}

function multiline(text: string): string {
  return escapeHtml(text).replace(/\r?\n/g, "<br>");
}

function paragraph(text: string, last: boolean): string {
  return `<p class="q-text" style="margin:0 0 ${last ? 0 : 16}px 0;font-family:${FONT};font-size:16px;line-height:1.65;color:#2B2B33;">${multiline(text)}</p>`;
}

function highlightBlock(h: { label: string; text: string }): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 0 0;"><tr><td class="q-soft" bgcolor="#F4ECFF" style="padding:14px 16px;border-radius:10px;font-family:${FONT};font-size:14px;line-height:1.6;color:#2B2B33;"><strong>${escapeHtml(h.label)}:</strong> ${multiline(h.text)}</td></tr></table>`;
}

function buttonBlock(b: EmailLink): string {
  const href = safeUrl(b.url);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:28px auto 0 auto;"><tr><td align="center" bgcolor="#BB86FC" style="border-radius:10px;background-color:#BB86FC;"><a href="${href}" target="_blank" style="display:inline-block;padding:15px 40px;font-family:${FONT};font-size:16px;font-weight:700;line-height:20px;color:#0D0D0D;text-decoration:none;border-radius:10px;border:1px solid #BB86FC;">${escapeHtml(b.label)}</a></td></tr></table>`;
}

function secondaryBlock(l: EmailLink): string {
  return `<p style="margin:18px 0 0 0;text-align:center;font-family:${FONT};font-size:14px;line-height:1.5;"><a class="q-link" href="${safeUrl(l.url)}" target="_blank" style="color:#6B2FD0;text-decoration:underline;">${escapeHtml(l.label)}</a></p>`;
}

function fallbackBlock(f: EmailLink): string {
  const href = safeUrl(f.url);
  return `<p class="q-muted" style="margin:22px 0 0 0;text-align:center;font-family:${FONT};font-size:12px;line-height:1.6;color:#6A6A75;">${escapeHtml(f.label)}<br><a class="q-link" href="${href}" target="_blank" style="color:#6B2FD0;word-break:break-all;">${href}</a></p>`;
}

export function renderEmailLayout(input: EmailLayoutInput): string {
  const rtl = RTL_LOCALES.has(input.locale);
  const dir = rtl ? "rtl" : "ltr";
  const align = rtl ? "right" : "left";
  const lang = escapeHtml(input.locale);

  const paragraphs = input.paragraphs
    .map((p, i) => paragraph(p, i === input.paragraphs.length - 1 && !input.highlight))
    .join("");

  const footerLines = input.footerLines
    .map((l) => `<p class="q-muted" style="margin:0 0 8px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:#6A6A75;">${escapeHtml(l)}</p>`)
    .join("");
  const footerLink = input.footerLink
    ? `<p style="margin:0 0 8px 0;font-family:${FONT};font-size:12px;line-height:1.6;"><a class="q-link" href="${safeUrl(input.footerLink.url)}" style="color:#6B2FD0;text-decoration:underline;">${escapeHtml(input.footerLink.label)}</a></p>`
    : "";

  const tagline = input.tagline
    ? `<div style="margin:6px 0 0 0;font-family:${FONT};font-size:13px;line-height:1.4;color:#CFCFD6;">${escapeHtml(input.tagline)}</div>`
    : "";

  // Preheader sonrasi bosluk: istemcinin govde metnini onizlemeye cekmesini onler.
  const padding = "&#847;&zwnj;&nbsp;".repeat(40);

  return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(input.title)}</title>
<style>
  @media only screen and (max-width:620px) {
    .q-wrap { width:100% !important; }
    .q-pad { padding-left:20px !important; padding-right:20px !important; }
  }
  @media (prefers-color-scheme: dark) {
    .q-bg { background-color:#000000 !important; }
    .q-card { background-color:#1A1A20 !important; }
    .q-text { color:#F1F1F5 !important; }
    .q-title { color:#FFFFFF !important; }
    .q-muted { color:#A9A9B5 !important; }
    .q-link { color:#CDA9FF !important; }
    .q-soft { background-color:#2A2238 !important; color:#F1F1F5 !important; }
  }
</style>
</head>
<body class="q-bg" style="margin:0;padding:0;background-color:#F2F0F7;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:#F2F0F7;">${escapeHtml(input.preheader)}${padding}</div>
<table role="presentation" class="q-bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F2F0F7" dir="${dir}" style="background-color:#F2F0F7;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" class="q-wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
<tr><td align="center" bgcolor="#0D0D0D" style="background-color:#0D0D0D;padding:28px 20px;border-radius:16px 16px 0 0;">
<div style="font-family:${FONT};font-size:32px;font-weight:700;letter-spacing:2px;line-height:1.1;color:#BB86FC;">Qulo</div>${tagline}
</td></tr>
<tr><td class="q-card q-pad" bgcolor="#FFFFFF" style="background-color:#FFFFFF;padding:36px 40px;text-align:${align};">
<h1 class="q-title" style="margin:0 0 16px 0;font-family:${FONT};font-size:24px;font-weight:700;line-height:1.3;color:#14141A;">${escapeHtml(input.title)}</h1>
${paragraphs}${input.highlight ? highlightBlock(input.highlight) : ""}${input.button ? buttonBlock(input.button) : ""}${input.secondaryLink ? secondaryBlock(input.secondaryLink) : ""}${input.fallback ? fallbackBlock(input.fallback) : ""}
</td></tr>
<tr><td class="q-pad" align="center" style="padding:20px 40px 8px 40px;text-align:center;">
${footerLines}${footerLink}<p class="q-muted" style="margin:0;font-family:${FONT};font-size:11px;line-height:1.6;color:#6A6A75;">&copy; 2026 Qulo</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
