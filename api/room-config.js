export default function handler(_req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ apiBase: process.env.ROOMS_API_URL || '' });
}
