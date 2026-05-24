function turnstileError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function serviceUnavailable(message = 'Human verification service is unavailable') {
  return turnstileError(message, 503);
}

function createTimeoutSignal(timeoutMs) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return { signal: AbortSignal.timeout(timeoutMs), cleanup: () => {} };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timer),
  };
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

  const { signal, cleanup } = createTimeoutSignal(Number(process.env.TURNSTILE_VERIFY_TIMEOUT_MS || 4000));
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret,
        response: token,
        remoteip: visitorIp(req),
      }),
      signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.success !== true) {
      throw turnstileError('Human verification failed. Retry the challenge.');
    }
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      throw serviceUnavailable('Human verification timed out. Retry again.');
    }
    if (error?.status) throw error;
    throw serviceUnavailable('Human verification service is unavailable. Retry later.');
  } finally {
    cleanup();
  }
}

module.exports = { validateTurnstile };
