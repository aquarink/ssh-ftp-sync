function emailError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function serviceUnavailable(message = 'Email verification service is unavailable') {
  return emailError(message, 503);
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

async function verifySignupEmail(email) {
  const apiKey = process.env.QUICKEMAILVERIFICATION_API_KEY;
  if (!apiKey) throw emailError('Email verification is not configured', 503);

  const url = new URL('https://api.quickemailverification.com/v1/verify');
  url.searchParams.set('email', email);
  url.searchParams.set('apikey', apiKey);

  const { signal, cleanup } = createTimeoutSignal(Number(process.env.EMAIL_VERIFY_TIMEOUT_MS || 4000));
  try {
    const response = await fetch(url, { signal });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.success === false) {
      throw serviceUnavailable();
    }

    const disposable = result.disposable === true || result.disposable === 'true';
    const safeToSend = result.safe_to_send === true || result.safe_to_send === 'true';
    const isValid = result.result === 'valid';

    if (disposable) {
      throw emailError('Use a permanent email address');
    }
    if (!safeToSend && !isValid) {
      const suggestion = result.did_you_mean ? ` Did you mean ${result.did_you_mean}?` : '';
      throw emailError(`Email address could not be verified.${suggestion}`);
    }

    return {
      result: result.result || 'safe_to_send',
      safeToSend,
    };
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      throw serviceUnavailable('Email verification timed out. Retry again.');
    }
    if (error?.status) throw error;
    throw serviceUnavailable('Email verification service is unavailable. Retry later.');
  } finally {
    cleanup();
  }
}

module.exports = { verifySignupEmail };
