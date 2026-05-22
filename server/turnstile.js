function turnstileError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function visitorIp(req) {
  const cloudflareIp = req.headers['cf-connecting-ip'];
  if (cloudflareIp) return String(cloudflareIp);

  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.socket.remoteAddress;
}

async function validateTurnstile(req, token) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) throw turnstileError('Human verification is not configured', 503);
  if (typeof token !== 'string' || !token || token.length > 2048) {
    throw turnstileError('Complete the human verification challenge');
  }

  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret,
      response: token,
      remoteip: visitorIp(req),
    }),
    signal: AbortSignal.timeout(10000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success !== true) {
    throw turnstileError('Human verification failed. Retry the challenge.');
  }
}

module.exports = { validateTurnstile };
