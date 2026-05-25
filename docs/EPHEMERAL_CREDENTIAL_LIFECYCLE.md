# Ephemeral Credential Lifecycle Documentation

## Overview

The ephemeral credential system provides a secure, temporary wrapper for SSH authentication material (passwords, private keys, passphrases, certificates). Credentials are created with a fixed Time-To-Live (TTL), automatically expire, and securely clear their sensitive material from memory when no longer needed.

## Architecture

### Components

1. **ephemeralCredential.js** - Creates and manages credential objects with automatic expiration
2. **secretLifecycle.js** - Provides secure material cloning and clearing utilities
3. **Usage Sites** - server/index.js, server/sshWebSocket.js, electron/sshHandler.js, etc.

## Credential Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│ 1. CREATE (resolve phase)                                   │
│    - createEphemeralCredential() called                      │
│    - Material cloned (securely copied)                       │
│    - TTL calculated (expiration timestamp set)               │
│    - cleared flag = false                                    │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. RESOLVE (validation phase)                               │
│    - Check credential exists                                │
│    - Check TTL not expired: isEphemeralCredentialExpired()  │
│    - If expired: clear() and reject                          │
│    - If valid: proceed to connect                            │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. CONNECT (usage phase)                                    │
│    - Extract material from credential.material              │
│    - Pass to SSH client (ssh2)                              │
│    - Material available during:                             │
│      * connection config building                           │
│      * ssh2.Client.connect()                                │
│      * auth negotiation                                     │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. CLEAR (cleanup phase) - CRITICAL TIMING                  │
│    - In finally block: credential.clear()                   │
│    - After ssh2.Client.connect() returns/fails              │
│    - Calls clearSecretMaterial(credential.material)         │
│    - Sets credential.material = null                        │
│    - Sets credential.cleared = true                         │
│    - Returns boolean success status                         │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. DISPOSED (terminal state)                                │
│    - Material is null                                       │
│    - Credential is considered expired                       │
│    - Further access attempts fail safely                    │
└─────────────────────────────────────────────────────────────┘
```

## Key Timing Constraints

### CRITICAL: Material Must Be Available After ssh2.Client.connect()

**The timing of credential.clear() is crucial.** SSH2 may still need the material AFTER connect() is called:

- ssh2.Client.connect() is **NOT synchronous**
- Authentication happens asynchronously inside ssh2
- Material may be referenced during:
  - Key exchange
  - Authentication attempts
  - Cipher setup

**SAFE: clear() in finally block AFTER connect returns (success or error)**

```javascript
try {
  conn.connect(buildConnectConfig(host, credential.material));
} finally {
  // NOW it's safe to clear (connect() has returned)
  const cleared = credential.clear();
  if (!cleared) {
    logEvent('credentialClearFailed');
  }
}
```

**UNSAFE: clear() immediately after calling connect()**

```javascript
// ❌ WRONG - Material might still be in use by ssh2
conn.connect(buildConnectConfig(host, credential.material));
credential.clear(); // Too early!
```

## API Reference

### createEphemeralCredential(options)

Creates a new ephemeral credential with secure material cloning.

**Parameters:**
- `userId` (string, required) - User who requested the credential
- `runtime` (string, required) - Runtime environment ('browser', 'electron')
- `purpose` (string, required) - Usage purpose ('ssh', 'sftp', etc.)
- `authType` (string, required) - Auth method ('password', 'private_key', etc.)
- `material` (object, required) - Auth material (password, keys, certs, etc.)
- `hostId` (string, optional) - Target host ID
- `sessionId` (string, optional) - Session ID (auto-generated if not provided)
- `id` (string, optional) - Credential ID (auto-generated if not provided)
- `ttlMs` (number, optional) - Time-to-live in ms (default: 30000 = 30s)

**Returns:**
```javascript
{
  id: string,           // Unique credential ID
  sessionId: string,    // Session identifier
  userId: string,       // User who owns it
  hostId: string|null,  // Target host (if applicable)
  runtime: string,      // Runtime environment
  purpose: string,      // Usage purpose
  authType: string,     // Authentication type
  material: object,     // Sensitive auth material (cloned)
  createdAt: string,    // ISO timestamp
  expiresAt: string,    // ISO timestamp
  cleared: boolean,     // Whether material has been cleared
  clear: function,      // Method to securely clear material
}
```

**Example:**
```javascript
const credential = createEphemeralCredential({
  userId: user.id,
  hostId: host.id,
  runtime: 'browser',
  purpose: 'ssh',
  authType: 'private_key_passphrase',
  material: {
    privateKey: Buffer.from(keyData),
    passphrase: 'key-passphrase',
  },
  ttlMs: 30000,
});
```

### credential.clear()

Securely clears sensitive material from the credential object.

**Returns:** `boolean` - true if clear succeeded, false if error occurred

**Behavior:**
- Idempotent: safe to call multiple times
- Recursively clears nested objects
- Wipes Buffer/TypedArray contents (fill with zeros)
- Deletes sensitive key names
- Sets credential.material to null
- Sets credential.cleared to true

**Example:**
```javascript
try {
  conn.connect(buildConnectConfig(host, credential.material));
} finally {
  const cleared = credential.clear();
  logEvent(cleared ? 'credentialCleared' : 'credentialClearFailed', {
    sessionId: credential.sessionId,
  });
}
```

### isEphemeralCredentialExpired(credential, now?)

Checks if a credential has expired or been cleared.

**Parameters:**
- `credential` (object|null|undefined) - Credential to check
- `now` (number, optional) - Timestamp to check against (default: Date.now())

**Returns:** `boolean` - true if expired, cleared, null, or undefined

**Example:**
```javascript
if (isEphemeralCredentialExpired(credential)) {
  credential.clear();
  throw new Error('Credential unavailable');
}
```

## Secret Material Clearing

### clearSecretMaterial(value, seen?)

Securely clears sensitive data from objects, arrays, and buffers.

**Behavior:**

1. **Sensitive Key Detection:**
   - Recognizes: password, privateKey, passphrase, certificate, certificatePrivateKey, token, refreshToken, accessToken, keyMaterial, credentialSecret, secret
   - Case-insensitive matching
   - Deletes or sets to undefined

2. **Buffer Wiping:**
   - Fills Buffers with zeros
   - Handles TypedArray views
   - Prevents data leakage

3. **Recursive Clearing:**
   - Traverses nested objects
   - Clears arrays (empties them)
   - Handles circular references with WeakSet

4. **Error Handling:**
   - Best-effort approach
   - Returns false if error, true on success
   - Handles non-deletable properties gracefully

**Example:**
```javascript
const obj = {
  username: 'admin',
  password: Buffer.from('secret'),
  nested: {
    privateKey: 'key-data',
    publicKey: 'public-data',
  },
};

clearSecretMaterial(obj);
// Result:
// {
//   username: 'admin',
//   nested: {
//     publicKey: 'public-data',
//   },
// }
// Buffers are zero-filled, sensitive keys deleted
```

### cloneSecretMaterial(value, seen?)

Securely clones objects, arrays, and buffers while preserving structure.

**Behavior:**

1. **Preserves Immutables:**
   - Primitives returned as-is
   - null/undefined returned unchanged

2. **Clones Collections:**
   - Buffers: creates new Buffer with same content
   - Arrays: recursively clones elements
   - Objects: recursively clones properties
   - Dates: creates new Date with same time

3. **Circular Reference Handling:**
   - Uses WeakMap to track seen objects
   - Points cloned circular refs to cloned parent (not original)

**Example:**
```javascript
const original = {
  username: 'user',
  password: Buffer.from('secret'),
  nested: { key: 'data' },
};

const cloned = cloneSecretMaterial(original);
// Cloned is structurally identical but completely separate
// Modifying cloned.password doesn't affect original
```

## Audit Trail: .clear() Call Sites

All locations where credential.clear() is called **must ensure proper timing:**

### server/index.js
- **Line 642:** In finally block after test SSH connection
  - ✅ SAFE: After `testSshConnection()` returns
- **Line 691:** Before throwing expiration error
  - ✅ SAFE: Handles check before use
- **Line 730:** In finally block after test connection
  - ✅ SAFE: After `testSshConnection()` returns
- **Line 773:** Before throwing expired error
  - ✅ SAFE: Preventive check
- **Line 828:** In finally block after SFTP operation
  - ✅ SAFE: After `runSftpOperation()` returns

### server/sshWebSocket.js
- **Line 81:** Before throwing expiration error
  - ✅ SAFE: Preventive check before use
- **Clear in finally block after connect:**
  - ✅ SAFE: After ssh2 connect returns

### electron/sshHandler.js
- **Lines:** Same patterns as server/index.js
  - ✅ SAFE: All clear() calls in finally blocks after connect

## Testing Guidelines

### Unit Tests
- Test credential creation and field initialization
- Test expiration logic
- Test clear() idempotency
- Test sensitive key detection
- Test buffer wiping
- Test circular reference handling

### Integration Tests
- Test resolve-then-connect workflow
- Test material availability during connection setup
- Test material clearing after connection
- Test expired credential rejection
- Test error scenarios (connection failure, auth error)
- Test multiple credential independence

### Security Tests
- Verify cleared Buffers contain only zeros
- Verify deleted keys cannot be accessed
- Verify TypedArray wiping
- Verify circular references handled without infinite loop
- Verify nested structure clearing

## Common Pitfalls

### 1. Clearing Too Early
❌ **Don't:** Clear immediately after calling connect()
```javascript
conn.connect(buildConnectConfig(host, material));
credential.clear(); // Too early!
```

✅ **Do:** Clear in finally block after connect returns
```javascript
try {
  conn.connect(buildConnectConfig(host, material));
} finally {
  credential.clear();
}
```

### 2. Not Checking Expiration
❌ **Don't:** Use credential without checking expiration
```javascript
const config = buildConnectConfig(host, credential.material);
```

✅ **Do:** Check expiration before using
```javascript
if (isEphemeralCredentialExpired(credential)) {
  throw new Error('Credential expired');
}
const config = buildConnectConfig(host, credential.material);
```

### 3. Ignoring Clear Result
❌ **Don't:** Ignore whether clear succeeded
```javascript
credential.clear();
// Continue without checking
```

✅ **Do:** Log clear result for audit trail
```javascript
const cleared = credential.clear();
logSecurityEvent(cleared ? 'credentialCleared' : 'credentialClearFailed', {
  credentialId: credential.id,
  sessionId: credential.sessionId,
});
```

### 4. Not Handling Multiple Credentials
❌ **Don't:** Assume only one credential exists
```javascript
const credential = resolveCredential();
// Later...
credential.clear(); // Might affect other credentials
```

✅ **Do:** Clear each credential independently
```javascript
const credential1 = resolveCredential(host1);
const credential2 = resolveCredential(host2);
try {
  // Use both...
} finally {
  credential1.clear();
  credential2.clear();
}
```

## Environment Variables

- `EPHEMERAL_CREDENTIAL_TTL_MS` - Default TTL in milliseconds (default: 30000)

Example:
```bash
export EPHEMERAL_CREDENTIAL_TTL_MS=60000  # 60 second TTL
```

## Future Considerations

1. **Hardened Scheduling:** Consider using setImmediate() to ensure clear() runs after event loop
2. **WeakRef Integration:** Use WeakRef for automatic cleanup when credential is GC'd
3. **Audit Logging:** Consider centralized audit trail for all clear() operations
4. **Memory Monitoring:** Track credential lifecycle with memory profilers
5. **Credential Pooling:** Implement credential reuse with reference counting

## References

- [Node.js Buffer documentation](https://nodejs.org/api/buffer.html)
- [ssh2 Client documentation](https://github.com/mscdex/ssh2)
- [OWASP: Sensitive Data Exposure](https://owasp.org/www-project-top-ten/)
- [Node.js Memory Management](https://nodejs.org/en/docs/guides/simple-profiling/)
