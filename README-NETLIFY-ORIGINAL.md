# Ruvixsa SEO Audit — v1.5.0 deployment package

This package contains `index.html` (default Netlify entry), `seo-audit.html` (compatible route), a PageSpeed Insights/Lighthouse dashboard, a shared source analyzer, and a Netlify Function that fetches a public page's HTML and checks the source it can actually inspect.

## What works in this build

- Live URL input and source-based audit via `/.netlify/functions/audit`
- New v1.5.0 PageSpeed Insights dashboard for mobile/desktop Lighthouse tests: Performance, SEO, Accessibility and Best Practices scores; LCP, FCP, TBT, CLS, Speed Index, TTFB when supplied; request/payload and optimization-opportunity summaries
- Performance values are retrieved from the PageSpeed API; API failures/rate limits show a clear error instead of fabricated scores
- Shared deterministic analyzer used by both live URL audits and the local code editor re-test
- Title, meta description, H1–H6 content/sequence, canonical, robots directives, mobile viewport, HTML language, charset, image alt/src attributes, Open Graph, JSON-LD syntax and detected `@type`, link markup, source-integrity scan, and HTTP response checks
- Deterministic weighted source-audit score. Only Pass/Issue checks with defined weights are scored; Not Tested checks are excluded. This is not a Google ranking score.
- Source-integrity scan reports line numbers and snippets for common malformed tag boundaries, unclosed quoted attributes/comments, and duplicate attributes. It is a lexical scan, not a full HTML-standard conformance validator.
- Automated regression tests for deterministic results, issue detection, score changes after fixes, malformed markup/JSON-LD, honest Not Tested behavior, UTF-8 declaration placement, link names/href, and Open Graph URL format
- Full H1–H6 heading list and counts
- Evidence and recommendations for each finding; `Not Tested` is used where the check cannot be verified
- SHA-256 source fingerprint and comparison with the previous audit in the same open page, so users can see whether the fetched HTML itself changed
- Copy report and browser print/export
- URL hand-off from the main page: `/seo-audit.html?url=https%3A%2F%2Fexample.com`
- Basic SSRF protections for local/private IP targets, DNS checks, redirects, response type, response size, and request time limits

## Important limits

- AI/Gemini analysis is **not connected** in this build. No API key is sent or stored.
- The audit inspects fetched HTML source. It does not run a browser or fully render JavaScript, measure Core Web Vitals, crawl all links, check Google Search Console, or guarantee rankings.
- A `Pass` is only for the specific source check shown; it does not mean the whole page is SEO-perfect.
- Repeated audits of identical HTML and identical response metadata produce the same checks and score. A changed HTML source fingerprint, HTTP status, or X-Robots-Tag response can legitimately change findings. The source ID is a fingerprint, not a quality score.
- The browser-based local editor uses the same analyzer and scoring formula, but live HTTP response, rendered JavaScript, Core Web Vitals, and Google indexing remain Not Tested in local mode.
- Review the security controls before production use. Server-side URL fetching is a sensitive feature; DNS pre-checks reduce risk but cannot eliminate every DNS-rebinding scenario in all deployment environments.

## Deploy on Netlify

1. Extract the ZIP.
2. Open the extracted `ruvixsa-seo-audit` folder. It contains `index.html`, `seo-audit.html`, `audit-core.mjs`, `netlify.toml`, and `netlify/functions/audit.mjs`. The root route opens the audit tool; the old `/seo-audit.html` route remains available.
3. Deploy with Netlify CLI or connect this folder to a Git repository. Do not rely on a drag-and-drop static-only deploy for Functions.
4. Netlify CLI route:

   ```bash
   npm install
   npx netlify-cli login
   npx netlify-cli deploy --prod
   ```

   Run those commands from this folder and follow the CLI prompts. If Netlify CLI asks to link a site, choose the intended Ruvixsa site.
5. Open `https://YOUR-SITE/seo-audit.html` and audit a public `https://` URL.
6. Confirm the Function is deployed at `/.netlify/functions/audit` in Netlify's Functions dashboard/logs if a request fails.

## Connect from the existing main page

Add a URL form under the Schema demo. On submit, send the visitor to the audit page with the encoded URL, for example:

```html
<form id="seoAuditLaunchForm">
  <input id="seoAuditLaunchUrl" type="url" placeholder="https://example.com" required>
  <button type="submit">Analyze website</button>
</form>
<script>
  document.getElementById('seoAuditLaunchForm').addEventListener('submit', function (event) {
    event.preventDefault();
    const url = document.getElementById('seoAuditLaunchUrl').value.trim();
    window.location.href = '/seo-audit.html?url=' + encodeURIComponent(url);
  });
</script>
```

This assumes the main page and `seo-audit.html` are hosted on the same domain and that the audit page is at the site root. Adjust the path if your site structure differs.


### Status semantics update
- `Review` means the analyzer checked for a feature and found it absent or not automatically judgeable; it is not counted as a verified failure or in the numeric score.
- `Not Tested` is reserved for checks that cannot be evaluated from the supplied source/context (for example, no image elements to inspect, browser-rendered JavaScript/Core Web Vitals, or HTTP status during local editor re-test).
- `Issue` means the source contains a measurable problem. Missing optional metadata such as canonical, robots directives, or JSON-LD is surfaced as `Review`, not falsely labeled as a failed check.


### Audit engine update 1.4.0
- Link markup findings now include source-character positions for a few affected links, making manual fixes easier. The analyzer checks href presence and common accessible-name patterns; rendered accessibility still needs browser testing.
- Character encoding checks now look for a UTF-8 declaration in the document head, early in source, and flag duplicate charset declarations.
- Open Graph checks now validate that `og:image` and `og:url` use absolute HTTP(S) URL formats, in addition to checking missing/empty and duplicate required tags. This does not confirm that the image URL loads or that social platforms render the preview correctly.
- Seven automated tests should pass with `npm test`.


### v1.5.0 upgrade notes
- Added PageSpeed Insights/Lighthouse performance panel with mobile/desktop selection, scores, lab timing metrics, resource summaries, and top optimization opportunities.
- Existing source audit, shared analyzer, local edit/re-test, copy/print report, and Netlify Function retained.
- Default `index.html` entry added while keeping `seo-audit.html` for existing links.
- This is a client-side call to the public PageSpeed Insights endpoint; usage limits may apply. It does not claim rendered-DOM inspection by this app or guarantee field CWV availability.

## v1.5.1 UX fix
- Removed the duplicate PageSpeed URL field and the separate PageSpeed Run button.
- The single Analyze website action now starts the source-based SEO audit and PageSpeed Insights test using the same URL.
- Mobile/Desktop remains a device selector; PageSpeed API rate limits are reported honestly and do not cancel the SEO audit.
- Validation: `npm test` passes 7/7 tests; inline JavaScript passes `node --check`. Live PageSpeed API availability depends on Google's current quota/rate limits.
