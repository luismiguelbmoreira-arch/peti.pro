export function setCorsHeaders(req, res) {
  const isDev = process.env.NODE_ENV !== 'production';
  const allow = isDev ? '*' : (process.env.ALLOWED_ORIGIN || '*');

  res.setHeader('Access-Control-Allow-Origin', allow);
  if (allow !== '*') res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// Responde preflight e retorna true se for OPTIONS (interrompe handler)
export function handleOptions(req, res) {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(req, res);
    res.status(204).end();
    return true;
  }
  return false;
}
