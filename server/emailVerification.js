function emailError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

async function verifySignupEmail(email) {
  const apiKey = process.env.QUICKEMAILVERIFICATION_API_KEY;
  if (!apiKey) throw emailError('Email verification is not configured', 503);

  const url = new URL('https://api.quickemailverification.com/v1/verify');
  url.searchParams.set('email', email);
  url.searchParams.set('apikey', apiKey);

  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success === false) {
    throw emailError('Email verification service is unavailable', 503);
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
}

module.exports = { verifySignupEmail };
