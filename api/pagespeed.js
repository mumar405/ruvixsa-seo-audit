const ALLOWED_STRATEGIES = new Set(['mobile', 'desktop']);
const ALLOWED_CATEGORIES = ['PERFORMANCE', 'SEO', 'ACCESSIBILITY', 'BEST_PRACTICES'];

export default async function pagespeed(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST with a JSON body.' });

  const key = process.env.PAGESPEED_API_KEY;
  if (!key) return res.status(500).json({
    error: 'PAGESPEED_API_KEY is not configured in Vercel Project Settings → Environment Variables. Add it, then redeploy.'
  });

  const body = req.body || {};
  if (typeof body.url !== 'string' || body.url.length > 2048) {
    return res.status(400).json({ error: 'Provide a valid public website URL.' });
  }
  let target;
  try {
    target = new URL(body.url);
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new Error();
  } catch {
    return res.status(400).json({ error: 'Please provide a valid http:// or https:// website URL.' });
  }
  const strategy = ALLOWED_STRATEGIES.has(body.strategy) ? body.strategy : 'mobile';
  const params = new URLSearchParams({ url: target.href, strategy, key });
  for (const category of ALLOWED_CATEGORIES) params.append('category', category);

  try {
    const upstream = await fetch('https://www.googleapis.com/pagespeedonline/v5/runPagespeed?' + params.toString(), {
      signal: AbortSignal.timeout(90000)
    });
    const raw = await upstream.text();
    let data;
    try { data = JSON.parse(raw); }
    catch {
      return res.status(upstream.status || 502).json({
        error: `Google PageSpeed returned non-JSON (HTTP ${upstream.status}). ${raw.slice(0, 180)}`
      });
    }
    if (!upstream.ok) {
      const googleMessage = data?.error?.message || data?.error?.status || 'Google API request failed.';
      const message = upstream.status === 429
        ? `Google PageSpeed returned HTTP 429 (rate/quota limit). ${googleMessage} Check Google Cloud quota and wait before retrying.`
        : `Google PageSpeed returned HTTP ${upstream.status}. ${googleMessage}`;
      return res.status(upstream.status === 429 ? 429 : 502).json({ error: message, upstreamStatus: upstream.status });
    }
    if (!data.lighthouseResult) return res.status(502).json({ error: 'Google API response did not include a Lighthouse result.' });
    return res.status(200).json(data);
  } catch (error) {
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return res.status(timeout ? 504 : 502).json({ error: timeout ? 'PageSpeed request timed out. Try again later.' : 'Could not reach Google PageSpeed API.' });
  }
                        }
