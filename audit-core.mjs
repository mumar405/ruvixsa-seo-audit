// Deterministic, dependency-free source analyzer. It never infers rendered/browser-only SEO state.
export function decodeEntities(s = '') {
  return s.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Math.min(Number(n), 0x10ffff)); } catch { return ''; } });
}
export function textOf(s = '') { return decodeEntities(s.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()); }
export function attr(tag, name) {
  const re = new RegExp('(?:^|\\s)' + name.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&') + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i');
  const m = tag.match(re); return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? '') : '';
}
const add = (checks, name, status, evidence, recommendation, weight = 1) => checks.push({ name, status, evidence, recommendation, weight });
const VOID = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
function scanMarkup(html) {
  const findings = [], seen = new Map();
  // Scan tag boundaries while respecting quoted > characters and comments. This is a source-integrity scan, not a full browser parser.
  let i = 0;
  while (i < html.length) {
    if (html.startsWith('<!--', i)) { const end = html.indexOf('-->', i + 4); if (end < 0) { findings.push({ kind: 'comment', at: i, text: 'Unclosed HTML comment', snippet: html.slice(i, i + 100) }); break; } i = end + 3; continue; }
    if (html[i] !== '<') { i++; continue; }
    if (/^<!doctype\b/i.test(html.slice(i, i + 12)) || html.startsWith('<?', i) || html.startsWith('<!', i)) { const end = html.indexOf('>', i + 2); if (end < 0) { findings.push({ kind: 'tag', at: i, text: 'Unclosed declaration', snippet: html.slice(i, i + 100) }); break; } i = end + 1; continue; }
    if (!/[A-Za-z/]/.test(html[i + 1] || '')) { i++; continue; }
    let j = i + 1, quote = '', end = -1;
    for (; j < html.length; j++) { const c = html[j]; if (quote) { if (c === quote) quote = ''; } else if (c === '"' || c === "'") quote = c; else if (c === '>') { end = j; break; } }
    if (end < 0) { findings.push({ kind: quote ? 'quote' : 'tag', at: i, text: quote ? 'Unclosed quoted attribute value' : 'Tag opening is not closed with >', snippet: html.slice(i, i + 120) }); break; }
    const raw = html.slice(i, end + 1), nameMatch = raw.match(/^<\s*([A-Za-z][\w:-]*)/), isClose = /^<\s*\//.test(raw);
    if (nameMatch && !isClose) {
      const tagName = nameMatch[1].toLowerCase();
      // Parse attribute names only outside quoted values.
      let p = nameMatch[0].length, attrs = new Set();
      while (p < raw.length - 1) {
        while (/\s|\//.test(raw[p] || '') && p < raw.length - 1) p++;
        if (p >= raw.length - 1) break;
        const m = raw.slice(p).match(/^([^\s=/>]+)/);
        if (!m) { p++; continue; }
        const key = m[1].toLowerCase(); p += m[1].length;
        if (attrs.has(key)) findings.push({ kind: 'duplicate-attribute', at: i, text: `Duplicate ${key} attribute on <${tagName}>`, snippet: raw.slice(0, 180) });
        attrs.add(key);
        while (/\s/.test(raw[p] || '') && p < raw.length - 1) p++;
        if (raw[p] === '=') { p++; while (/\s/.test(raw[p] || '') && p < raw.length - 1) p++; const q = raw[p]; if (q === '"' || q === "'") { p++; while (p < raw.length - 1 && raw[p] !== q) p++; if (raw[p] === q) p++; } else { while (p < raw.length - 1 && !/[\s>]/.test(raw[p])) p++; } }
      }
      // Avoid scanning JavaScript/CSS '<' as markup by skipping raw-text element contents.
      if (tagName === 'script' || tagName === 'style' || tagName === 'textarea' || tagName === 'title') {
        const close = new RegExp('</\\s*' + tagName + '\\s*>', 'ig'); close.lastIndex = end + 1; const cm = close.exec(html); i = cm ? close.lastIndex : end + 1; continue;
      }
    }
    i = end + 1;
  }
  // Approximate line number for each source finding.
  for (const f of findings) f.line = html.slice(0, f.at).split('\n').length;
  return findings;
}
function scoreChecks(checks) {
  const applicable = checks.filter(c => c.status === 'Pass' || c.status === 'Issue');
  const possible = applicable.reduce((n, c) => n + c.weight, 0);
  const earned = applicable.filter(c => c.status === 'Pass').reduce((n, c) => n + c.weight, 0);
  return { score: possible ? Math.round(earned / possible * 100) : null, scoredChecks: applicable.length, totalChecks: checks.length, excludedNotTested: checks.filter(c => c.status === 'Not Tested').length, formula: 'Weighted pass points / total applicable check points; Not Tested checks are excluded.' };
}
export function analyzeHtml(html, finalUrl, responseMeta = {}) {
  const checks = [];
  const titleMatches = [...html.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/gi)];
  const title = titleMatches.length ? textOf(titleMatches[0][1]) : '';
  add(checks, 'Title tag', !title ? 'Issue' : titleMatches.length > 1 ? 'Issue' : 'Pass', !title ? 'No title element found in fetched HTML.' : `${titleMatches.length} title element(s) found. First title (${title.length} characters): “${title}”.`, 'Use one unique, descriptive page title. Character length is a guideline, not a strict ranking rule.', 3);

  const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map(m => m[0]);
  const descriptions = metas.filter(t => /^description$/i.test(attr(t, 'name').trim()));
  const desc = descriptions[0] || '', dv = desc ? attr(desc, 'content').trim() : '';
  add(checks, 'Meta description', !dv ? 'Issue' : descriptions.length > 1 ? 'Issue' : 'Pass', !dv ? 'No non-empty meta description was found in fetched HTML.' : `${descriptions.length} description tag(s) found (${dv.length} characters): “${dv}”.`, 'Use one useful, page-specific summary; search engines may choose a different snippet.', 2);

  const htags = [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)].map(m => ({ level: Number(m[1]), text: textOf(m[2]).slice(0, 300), line: html.slice(0, m.index).split('\n').length }));
  const h1 = htags.filter(h => h.level === 1), emptyHeadings = htags.filter(h => !h.text);
  add(checks, 'H1 heading', !h1.length || h1.some(h => !h.text) ? 'Issue' : 'Pass', h1.length ? `Found ${h1.length} H1 heading(s): ${h1.map(h => h.text || '(empty)').join(' | ')}. ${h1.length > 1 ? 'Multiple H1s are not automatically a Google error.' : ''}` : 'No H1 heading found in fetched HTML.', 'Use clear, meaningful headings. One H1 is a useful convention, not a strict Google requirement.', 2);
  add(checks, 'Heading content', emptyHeadings.length ? 'Issue' : htags.length ? 'Pass' : 'Not Tested', htags.length ? `${htags.length} H1–H6 heading(s) found; ${emptyHeadings.length} empty heading(s).` : 'No H1–H6 heading elements found in fetched HTML.', 'Give each heading meaningful text, or remove empty heading elements.', 1);
  const jumps = []; for (let n=1;n<htags.length;n++) if (htags[n].level > htags[n-1].level + 1) jumps.push(`H${htags[n-1].level}→H${htags[n].level}`);
  add(checks, 'Heading level sequence', jumps.length ? 'Issue' : htags.length ? 'Pass' : 'Not Tested', htags.length ? (jumps.length ? `Heading level jumps found: ${jumps.join(', ')}.` : 'No skipped heading levels detected in source order.') : 'No headings to inspect.', 'Keep heading levels logically nested for a clearer document outline; this is a structure/accessibility recommendation, not a direct ranking guarantee.', 1);

  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map(m => m[0]);
  const canonicals = links.filter(t => attr(t, 'rel').toLowerCase().split(/\s+/).includes('canonical'));
  const canonicalHref = canonicals[0] ? attr(canonicals[0], 'href').trim() : '';
  let canonicalIssue = canonicals.length > 1 || (canonicals.length === 1 && !canonicalHref);
  let canonicalEvidence = !canonicals.length ? 'No canonical link was found. Absence is not automatically an error.' : `${canonicals.length} canonical link(s) found. First href: ${canonicalHref || '(empty href)'}.`;
  if (canonicalHref) { try { const c = new URL(canonicalHref, finalUrl); if (!['http:','https:'].includes(c.protocol)) canonicalIssue = true; } catch { canonicalIssue = true; canonicalEvidence += ' Canonical href is not a valid URL.'; } }
  add(checks, 'Canonical URL', !canonicals.length ? 'Review' : canonicalIssue ? 'Issue' : 'Pass', canonicalEvidence, 'If canonicalization is needed, provide one valid canonical URL pointing to the preferred page.', 2);

  const robotTags = metas.filter(t => /^(robots|googlebot|bingbot)$/i.test(attr(t, 'name').trim()));
  const robotContent = robotTags.map(t => `${attr(t,'name')}: ${attr(t,'content')}`).join('; ');
  const xrobots = responseMeta.xRobots || '';
  const directives = robotContent + ' ' + xrobots;
  // "none" is equivalent to "noindex, nofollow" for robots directives.
  const noindex = /\b(?:noindex|none)\b/i.test(directives);
  const index = /\bindex\b/i.test(directives);
  const robotConflict = noindex && index;
  add(checks, 'Robots directives', robotConflict ? 'Issue' : noindex ? 'Issue' : robotTags.length || xrobots ? 'Pass' : 'Review', `Meta directives: ${robotContent || 'not present'}; X-Robots-Tag: ${xrobots || 'not present'}.${noindex ? ' A noindex/none directive was detected.' : ''}${robotConflict ? ' Conflicting index/noindex tokens were detected; noindex takes precedence for this warning.' : ''}`, 'Confirm the page is intentionally indexable. This check inspects fetched meta/header directives only; it does not verify robots.txt or actual Google indexing.', 3);

  const viewport = metas.filter(t => /^viewport$/i.test(attr(t, 'name').trim()));
  const vp = viewport[0] ? attr(viewport[0], 'content') : '';
  add(checks, 'Mobile viewport', viewport.length === 1 && /width\s*=\s*device-width/i.test(vp) ? 'Pass' : 'Issue', viewport.length ? `${viewport.length} viewport tag(s); first content: ${vp || '(empty)'}.` : 'No viewport meta tag found.', 'For responsive pages, use width=device-width and an appropriate initial-scale value.', 2);

  const htmlOpen = (html.match(/<html\b[^>]*>/i) || [''])[0], lang = attr(htmlOpen, 'lang').trim();
  add(checks, 'HTML language', lang ? 'Pass' : 'Issue', lang ? `HTML lang attribute: ${lang}` : 'The opening html element has no lang attribute.', 'Set the correct language code on the html element.', 1);
  const headMatch = html.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i);
  const headSource = headMatch ? headMatch[1] : '';
  const charsetMatches = [...html.matchAll(/<meta\b[^>]*>/gi)].filter(m => /(?:^|\s)charset\s*=/i.test(m[0]));
  const charsetTag = charsetMatches[0]?.[0] || '';
  const contentType = metas.find(t => /^content-type$/i.test(attr(t, 'http-equiv').trim()));
  const charset = charsetTag ? attr(charsetTag,'charset') : contentType ? (attr(contentType,'content').match(/charset\s*=\s*([^;\s]+)/i)?.[1] || '') : '';
  const charsetIndex = charsetMatches.length ? charsetMatches[0].index : -1;
  const charsetInHead = !!charsetTag && !!headMatch && charsetIndex >= html.search(/<head\b[^>]*>/i) && charsetIndex < html.search(/<\/head\s*>/i);
  const charsetEarly = charsetIndex >= 0 && charsetIndex < 1024;
  const duplicateCharset = charsetMatches.length > 1;
  let charsetStatus = 'Review';
  if (charsetTag || contentType) {
    charsetStatus = /^utf-?8$/i.test(charset) && charsetInHead && charsetEarly && !duplicateCharset ? 'Pass' : 'Issue';
  }
  const charsetDetails = charsetTag || contentType
    ? `Declared encoding: ${charset || '(missing/invalid)'}. Charset meta tags: ${charsetMatches.length}. In head: ${charsetInHead ? 'yes' : 'no'}. Within first 1024 source characters: ${charsetEarly ? 'yes' : 'no'}.`
    : 'No HTML charset declaration found; response-level encoding is not inferred.';
  add(checks, 'Character encoding', charsetStatus, charsetDetails, 'Use one <meta charset="utf-8"> near the start of <head> (within the first 1024 bytes/characters). Verify the server response encoding separately.', 1);

  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map(m => m[0]);
  const missingAlt = imgs.filter(t => !/(?:^|\s)alt\s*=/i.test(t));
  const missingSrc = imgs.filter(t => !attr(t,'src').trim() && !attr(t,'srcset').trim());
  add(checks, 'Image alt attributes', !imgs.length ? 'Not Tested' : missingAlt.length ? 'Issue' : 'Pass', imgs.length ? `${imgs.length} img element(s); ${missingAlt.length} without alt attribute. ${imgs.length-missingAlt.length} have an alt attribute (empty alt can be correct for decorative images).` : 'No img elements found in fetched HTML; CSS background images are not inspected.', 'Add meaningful alt text to informative images; use alt="" for decorative images.', 2);
  add(checks, 'Image source attributes', !imgs.length ? 'Not Tested' : missingSrc.length ? 'Issue' : 'Pass', imgs.length ? `${missingSrc.length} of ${imgs.length} img element(s) have neither a non-empty src nor srcset.` : 'No img elements found in fetched HTML.', 'Provide a valid image source. This source check does not fetch each image to confirm that it loads.', 1);

  const og = metas.filter(t => /^og:/i.test(attr(t, 'property').trim()));
  const requiredOg = ['og:title','og:description','og:image','og:url'];
  const ogMissing = requiredOg.filter(name => !og.some(t => attr(t,'property').trim().toLowerCase() === name && !!attr(t,'content').trim()));
  const ogDuplicates = requiredOg.filter(name => og.filter(t => attr(t,'property').trim().toLowerCase() === name).length > 1);
  const ogImageTag = og.find(t => attr(t,'property').trim().toLowerCase() === 'og:image' && attr(t,'content').trim());
  const ogUrlTag = og.find(t => attr(t,'property').trim().toLowerCase() === 'og:url' && attr(t,'content').trim());
  const validateAbsoluteHttpUrl = value => { try { const u = new URL(value); return ['http:','https:'].includes(u.protocol) && !!u.hostname; } catch { return false; } };
  const badOgImage = !!ogImageTag && !validateAbsoluteHttpUrl(attr(ogImageTag,'content').trim());
  const badOgUrl = !!ogUrlTag && !validateAbsoluteHttpUrl(attr(ogUrlTag,'content').trim());
  const ogIssues = ogMissing.length || ogDuplicates.length || badOgImage || badOgUrl;
  const ogEvidence = `${og.length} Open Graph tag(s). Missing/empty common fields: ${ogMissing.join(', ') || 'none'}. Duplicate required fields: ${ogDuplicates.join(', ') || 'none'}. og:image absolute HTTP(S) URL: ${ogImageTag ? (badOgImage ? 'invalid' : 'valid format') : 'not available'}. og:url absolute HTTP(S) URL: ${ogUrlTag ? (badOgUrl ? 'invalid' : 'valid format') : 'not available'}. Image fetch/social-platform preview was not tested.`;
  add(checks, 'Open Graph tags', ogIssues ? 'Issue' : 'Pass', ogEvidence, 'Use one non-empty og:title, og:description, og:image, and og:url. Image and page URLs should be absolute HTTP(S) URLs; test the final preview with each social platform because this source audit cannot confirm image fetchability.', 1);

  const ld = [...html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)];
  let validLd = 0, badLd = 0; const ldErrors = [];
  for (let i=0;i<ld.length;i++) { try { const parsed=JSON.parse(ld[i][1]); if (!parsed || typeof parsed !== 'object') throw Error('Top-level JSON must be an object or array'); validLd++; } catch(e) { badLd++; ldErrors.push(`block ${i+1}: ${e.message}`); } }
  add(checks, 'JSON-LD syntax', badLd ? 'Issue' : validLd ? 'Pass' : 'Review', `${ld.length} JSON-LD block(s); ${validLd} valid JSON block(s); ${badLd} invalid block(s). ${ldErrors.slice(0,3).join('; ')}`, 'Fix JSON syntax errors. This does not fully validate Schema.org properties or Google rich-result eligibility.', 2);
  const schemaTypes = [];
  for (const m of ld) { try { const v=JSON.parse(m[1]); const visit=x=>{ if(Array.isArray(x)) x.forEach(visit); else if(x&&typeof x==='object'){ if(typeof x['@type']==='string') schemaTypes.push(x['@type']); else if(Array.isArray(x['@type'])) schemaTypes.push(...x['@type']); Object.values(x).forEach(visit); } }; visit(v); } catch {} }
  add(checks, 'Structured data type presence', !ld.length ? 'Review' : schemaTypes.length ? 'Pass' : 'Issue', ld.length ? `Detected @type values: ${[...new Set(schemaTypes)].join(', ') || 'none'}.` : 'No JSON-LD blocks found; other structured-data formats are not inspected.', 'Add relevant schema types only when they accurately describe visible page content; deeper semantic validation is not performed here.', 1);

  const anchorMatches = [...html.matchAll(/<a\b[^>]*>/gi)];
  const anchors = anchorMatches.map(m => m[0]);
  const noHrefTags = anchorMatches.filter(m => !attr(m[0],'href').trim());
  const linkContents = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)];
  const unnamedLinks = linkContents.filter(m => {
    const inner = m[2];
    const text = textOf(inner);
    const aria = attr(m[1],'aria-label').trim();
    const title = attr(m[1],'title').trim();
    const imgAlt = [...inner.matchAll(/<img\b[^>]*>/gi)].some(im => attr(im[0],'alt').trim());
    const labelledChild = /<(?:svg|input|button)\b[^>]*(?:aria-label|title)\s*=/i.test(inner);
    return !text && !aria && !title && !imgAlt && !labelledChild;
  });
  const linkExamples = [];
  for (const m of noHrefTags.slice(0,3)) linkExamples.push(`missing href near source character ${m.index}`);
  for (const m of unnamedLinks.slice(0,3)) linkExamples.push(`possibly unnamed link near source character ${m.index}`);
  const noHref = noHrefTags.length, noAccessibleName = unnamedLinks.length;
  const linkStatus = !anchors.length ? 'Not Tested' : noHref ? 'Issue' : noAccessibleName ? 'Review' : 'Pass';
  add(checks, 'Link markup', linkStatus, `${anchors.length} anchor element(s); ${noHref} without href; ${noAccessibleName} without detected text/accessibility label.${linkExamples.length ? ' Examples: ' + linkExamples.join('; ') + '.' : ''} This source scan does not verify destination status, relative URL resolution, or the browser-computed accessible name.`, 'Fix anchors missing href when they are intended as links. Review empty/unnamed anchors manually; script-controlled anchors and icon-only links can be intentional if accessible names are supplied at runtime.', 1);

  const markupFindings = scanMarkup(html);
  const severeMarkup = markupFindings.filter(f => ['quote','tag','comment'].includes(f.kind));
  const duplicateAttrs = markupFindings.filter(f => f.kind === 'duplicate-attribute');
  const shown = markupFindings.slice(0,5).map(f => `line ${f.line}: ${f.text} [${f.snippet.replace(/\s+/g,' ').slice(0,100)}]`).join(' | ');
  add(checks, 'HTML source integrity', markupFindings.length ? 'Issue' : 'Pass', markupFindings.length ? `${markupFindings.length} source-integrity finding(s) from lexical scan (${severeMarkup.length} malformed boundary/comment/quote; ${duplicateAttrs.length} duplicate attribute). ${shown}` : 'No unclosed tag boundary/comment/quoted attribute or duplicate attribute was detected by the source scanner.', 'Review the cited source lines. This lexical scan catches common source defects but is not a complete WHATWG HTML conformance validator.', 2);

  const status = Number(responseMeta.status || 200);
  add(checks, 'HTTP response', responseMeta.local ? 'Not Tested' : status >= 200 && status < 300 ? 'Pass' : 'Issue', responseMeta.local ? 'Local editor cannot test the live server response.' : `Final response returned HTTP ${status}. Final URL: ${finalUrl}. Redirects followed: ${responseMeta.redirects || 0}.`, 'Serve the intended page successfully and fix server errors or unintended redirects.', 3);
  add(checks, 'Rendered JavaScript / Core Web Vitals', 'Not Tested', 'This audit inspects fetched HTML source only; it does not run a browser, measure Core Web Vitals, or inspect Google Search Console.', 'Use browser-based performance testing and Search Console for rendered content, field performance, and indexing data.', 0);
  const score = scoreChecks(checks);
  return { checks, headings: htags, score, markupFindings, schemaTypes: [...new Set(schemaTypes)] };
}
