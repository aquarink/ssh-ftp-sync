const sensitiveKeyPattern = /^(password|privateKey|passphrase|certificate|certificatePrivateKey|token|refreshToken|accessToken|keyMaterial|credentialSecret|secret)$/i;

function cloneSecretMaterial(value, seen = new WeakMap()) {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (Array.isArray(value)) return value.map((item) => cloneSecretMaterial(item, seen));
  if (value instanceof Date) return new Date(value.getTime());
  if (seen.has(value)) return seen.get(value);

  const clone = {};
  seen.set(value, clone);
  for (const [key, entry] of Object.entries(value)) {
    clone[key] = cloneSecretMaterial(entry, seen);
  }
  return clone;
}

function wipeBufferLike(value) {
  try {
    if (Buffer.isBuffer(value)) {
      value.fill(0);
      return true;
    }

    if (ArrayBuffer.isView(value)) {
      const view = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      view.fill(0);
      return true;
    }
  } catch {
    return false;
  }

  return true;
}

function clearSecretMaterial(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return true;

  try {
    if (typeof value !== 'object') return true;
    if (seen.has(value)) return true;
    seen.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        clearSecretMaterial(item, seen);
      }
      value.length = 0;
      return true;
    }

    for (const key of Object.keys(value)) {
      const entry = value[key];
      const isSensitive = sensitiveKeyPattern.test(key);

      if (isSensitive) {
        if (entry && typeof entry === 'object') {
          clearSecretMaterial(entry, seen);
          wipeBufferLike(entry);
        } else if (Buffer.isBuffer(entry) || ArrayBuffer.isView(entry)) {
          wipeBufferLike(entry);
        }

        try {
          delete value[key];
        } catch {
          try {
            value[key] = undefined;
          } catch {
            // Best-effort cleanup only. Strings cannot be reliably wiped in JS.
          }
        }
        continue;
      }

      if (entry && typeof entry === 'object') {
        clearSecretMaterial(entry, seen);
      }
    }
  } catch {
    return false;
  }

  return true;
}

module.exports = {
  clearSecretMaterial,
  cloneSecretMaterial,
  sensitiveKeyPattern,
};
