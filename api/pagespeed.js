import fetch from 'node-fetch';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url, strategy = 'mobile' } = req.query;
  if (!url) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }

  const apiKey = process.env.PAGESPEED_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server configuration error: PAGESPEED_API_KEY is missing' });
  }

  const apiEndpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${strategy}&key=${apiKey}`;

  try {
    const apiResponse = await fetch(apiEndpoint);
    const responseText = await apiResponse.text();

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      if (apiResponse.status === 429 || responseText.includes('Quota exceeded') || responseText.includes('Rate Limit')) {
        return res.status(429).json({
          error: 'Google PageSpeed API rate limit reached (HTTP 429). Please try again later or check your Google Cloud quota.'
        });
      }
      return res.status(502).json({
        error: 'Invalid response received from Google PageSpeed API.',
        raw: responseText.slice(0, 300)
      });
    }

    if (!apiResponse.ok) {
      return res.status(apiResponse.status).json({
        error: data.error?.message || 'Error from PageSpeed API'
      });
    }

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
