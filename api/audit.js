import handler from './_lib/audit-handler.mjs';

export default async function audit(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST with a JSON body.' });
  try {
    const request = new Request('https://vercel.local/api/audit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req.body ?? {})
    });
    const response = await handler(request);
    const body = await response.json();
    return res.status(response.status).json(body);
  } catch (error) {
    return res.status(500).json({ error: 'Audit function failed safely. Check Vercel Function Logs.' });
  }
}
