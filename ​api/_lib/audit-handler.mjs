import { createHash } from 'node:crypto';
import { analyzeHtml } from '../../audit-core.mjs';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
});
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 10_000;

function privateV4(host) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false;
  const a = host.split('.').map(Number);
  if (a.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  return a[0] === 10 || a[0] === 127 || a[0] === 0 ||
    (a[0] === 169 && a[1] === 254) ||
    (a[0] === 172 && a[1] >= 16 && a[1] <= 31) ||
    (a[0] === 192 && a[1] === 168) ||
    (a[0] === 100 && a[1] >= 64 && a[1] <= 127) ||
    (a[0] === 192 && a[1] === 0) || (a[0] === 198 && (a[1] === 18 || a[1] === 19)) ||
    a[0] >= 224;
}
function privateV6(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  if (h === '::' || h === '::1' || h.startsWith('fc') || h.startsWith('fd') ||
      /^fe[89ab]/.test(h) || h.startsWith('ff') || h.startsWith('2001:db8')) return true;
  const mapped = h.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? privateV4(mapped[1]) : false;
}
function safeUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw Error('Please provide a valid public website URL.'); }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw Error('Only public http/https URLs are supported.');
  const h = u.hostname.toLowerCase();
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') ||
      h.endsWith('.internal') || h.endsWith('.test') || h.endsWith('.invalid') ||
      privateV4(h) || (isIP(h.replace(/^\[|\]$/g, '')) === 6 && privateV6(h))) {
    throw Error('Local/private network targets are blocked.');
  }
  return u;
}
async function ensurePublicDns(url) {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const ipType = isIP(host);
  if (ipType === 4 && privateV4(host)) throw Error('Local/private network targets are blocked.');
  if (ipType === 6 && privateV6(host)) throw Error('Local/private network targets are blocked.');
  if (ipType) return;
  let records;
  try { records = await lookup(host, { all: true, verbatim: true }); }
  catch { throw Error('The website hostname could not be resolved. Check the URL and DNS.'); }
  if (!records.length || records.some(r => r.family === 4 ? privateV4(r.address) : privateV6(r.address))) {
    throw Error('The website resolves to a local or non-public IP address and was blocked.');
  }
}
function decodeEntities(s = '') {
  return s.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Math.min(Number(n), 0x10ffff)); } catch { return ''; } });
}
function textOf(s = '') { return decodeEntities(s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()); }
function attr(tag, name) {
  const m = tag.match(new RegExp('\\b' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i'));
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? '') : '';
}
function addCheck(checks, name, status, evidence, recommendation) { checks.push({ name, status, evidence, recommendation }); }
async function fetchWithTimeout(url) {
  await ensurePublicDns(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { redirect: 'manual', signal: controller.signal, headers: {
      'user-agent': 'RuvixsaSEOAudit/1.1 (+HTML source inspection)',
      'accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1'
    } });
  } finally { clearTimeout(timer); }
}
async function readLimited(response) {
  const reader = response.body?.getReader();
  if (!reader) throw Error('Could not read the page response.');
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; reader.cancel().catch(() => {}); }, TIMEOUT_MS);
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) { if (timedOut) throw Error('The website took too long to send its HTML (10-second limit).'); break; }
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw Object.assign(Error('HTML response exceeds the 1.5 MB audit limit.'), { status: 413 }); }
      chunks.push(value);
    }
  } catch (e) {
    if (e.name === 'AbortError') throw Error('The website took too long to send its HTML (10-second limit).');
    throw e;
  } finally { clearTimeout(timer); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return { html: new TextDecoder('utf-8').decode(bytes), size };
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Use POST with a JSON body.' }, 405);
  try {
    const body = await req.json();
    if (!body || typeof body.url !== 'string' || body.url.length > 2048) return json({ error: 'Provide a website URL (maximum 2048 characters).' }, 400);
    let target = safeUrl(body.url);
    let response = await fetchWithTimeout(target);
    let redirects = 0;
    while (REDIRECTS.has(response.status) && redirects < 3) {
      const location = response.headers.get('location');
      if (!location) return json({ error: 'The site returned a redirect without a Location header.' }, 422);
      target = safeUrl(new URL(location, target).href);
      response = await fetchWithTimeout(target);
      redirects++;
    }
    if (REDIRECTS.has(response.status)) return json({ error: 'More than three redirects detected. Audit the final destination URL directly.' }, 422);
    // Never score an error/challenge page as if it were the user's website.
    if (response.status < 200 || response.status >= 300) {
      const detail = response.status === 429
        ? 'The target returned HTTP 429 (rate limited). No SEO score was generated. Wait and retry, or test the canonical website URL directly.'
        : `The target returned HTTP ${response.status}. No SEO score was generated because this is not a successful page response.`;
      return json({ error: detail, targetUrl: target.href, status: response.status, redirects, auditMode: 'fetch-error' }, 422);
    }
    const type = response.headers.get('content-type') || '';
    if (!type.toLowerCase().includes('text/html') && !type.toLowerCase().includes('application/xhtml+xml')) return json({ error: `URL did not return HTML (content-type: ${type || 'missing'}).` }, 422);
    const { html, size } = await readLimited(response);
    const challengeUrl = /(^|\.)google\.com$/i.test(target.hostname) && /\/sorry\//i.test(target.pathname);
    const challengeBody = /unusual traffic|not a robot|automated queries|google\.com\/sorry/i.test(html.slice(0, 120000));
    if (challengeUrl || challengeBody) {
      return json({ error: 'Google returned a CAPTCHA / Sorry challenge instead of your website. The audit was stopped to prevent a misleading score. Retry later or test the site from a normal browser session.', targetUrl: target.href, status: response.status, redirects, auditMode: 'challenge-page' }, 422);
    }
    const audit = analyzeHtml(html, target.href, { status: response.status, redirects, xRobots: response.headers.get('x-robots-tag') || '' });
    const { checks, headings } = audit;
    const sourceHash = createHash('sha256').update(html, 'utf8').digest('hex');
    return json({ url: target.href, status: response.status, bytes: size, redirects, checks, headings, score: audit.score, markupFindings: audit.markupFindings, schemaTypes: audit.schemaTypes, sourceHtml: html, sourceHash, auditMode: 'fetched-html-source', auditVersion: '1.4.0' });
  } catch (e) {
    const status = e.status || (e.name === 'AbortError' ? 504 : 400);
    const msg = e.name === 'AbortError' ? 'The website took too long to respond (10-second limit).' : (e.message || 'Could not audit this URL.');
    return json({ error: msg }, status);
  }
}
