# Ruvixsa SEO Audit Tool v1.5.3 — Vercel PageSpeed fix

## What's changed
- PageSpeed requests now go through `/api/pagespeed` (server-side); the API key is not sent to the browser.
- Reads the key from `process.env.PAGESPEED_API_KEY`.
- Handles Google non-JSON responses safely, reports HTTP 429 with quota/rate-limit context, and never invents scores.
- The source audit frontend now calls `/api/audit`; its existing server-side audit logic is adapted for Vercel.
- Includes the existing `audit-core.mjs` analyzer and both HTML pages.

## Deploy
1. Import/upload this project to Vercel (project root is this folder).
2. In Vercel: Project → Settings → Environment Variables.
3. Add `PAGESPEED_API_KEY` with your Google PageSpeed API key. Select Production (and Preview if you test previews).
4. Save, then redeploy the latest deployment.
5. Test the deployed site's audit and PageSpeed panel.

Do not put the API key in HTML, Git, or share it in chat. Restrict the key in Google Cloud to the PageSpeed Insights API and, where compatible with your server-side setup, appropriate API restrictions.

## Important
- Adding the key fixes the missing-key configuration only. Google can still return HTTP 429 if project quota/rate limits are reached, the API is disabled, or quota/billing configuration is incorrect.
- This package has not been deployed to your Vercel account from this chat. Deploy it to test.

## v1.5.4 JSON error handling
- Both the source-audit and PageSpeed frontends now read response text safely before JSON parsing.
- If Vercel returns an HTML 404/NOT_FOUND page, the UI explains that the API route is missing or the old deployment is still live instead of showing `Unexpected token`.
- API error JSON (including HTTP 429) is shown as a readable message. This prevents the parsing crash; it does not bypass Google's real quota/rate limits.

Important: replace the files in the connected GitHub repository with these extracted project files, commit and push, then wait for Vercel's new deployment to finish. Uploading a ZIP to a repo without replacing the deployed project files will not update the live site.
