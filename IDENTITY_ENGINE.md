# Smart Identity Engine

## Overview

The Smart Identity Engine is a credential resolution system that determines which SSH identity (credential) should be used for a given host and purpose at connection time. It enforces scoped access patterns where credentials are only resolved when needed, not preloaded or auto-discovered.

## Architecture

### Resolution Flow

The identity resolution process follows this sequence:

1. **User initiates connection**: Browser or Electron app requests SSH connection for a host
2. **Authorization check**: Connect token is consumed to verify user has permission for this purpose
3. **Identity resolution**: `resolveIdentity()` is called with connection context
4. **Secret material retrieval**: For the selected credential, raw secret material is loaded
5. **Ephemeral credential creation**: Secret material is wrapped in an ephemeral credential object
6. **Connection establishment**: Connection is made using the ephemeral credential
7. **Cleanup**: Secret material and ephemeral credential are cleared from memory

### Resolution Paths

#### Server-side (Browser)

**File**: `server/identityResolver.js`

```
loadHost(userId, hostId)
  ↓
loadCredential(userId, credentialId)
  ↓
readCredentialSecret(storage_ref)
  ↓
resolveSecretMaterial(credential, secret, runtime)
  ↓
createEphemeralCredential(material)
```

**Parameters**:
- `userId`: Authenticated user from session
- `hostId`: SSH host to connect to
- `runtime`: 'browser' or 'electron'
- `authType`: Optional auth method override
- `credentialId`: Optional credential override
- `purpose`: 'ssh' or 'sftp'
- `sessionId`: Connection session identifier

**Returns**:
```javascript
{
  host: { /* metadata only, password cleared */ },
  credential: { /* metadata only, no secrets */ },
  authType: 'password|private_key|...',
  runtime: 'browser|electron',
  purpose: 'ssh|sftp',
  ephemeralCredential: {
    id, sessionId, userId, runtime, purpose, authType,
    createdAt, expiresAt, cleared,
    material: { /* raw secrets */ }
  }
}
```

#### Electron-side (Desktop)

**File**: `electron/identityResolver.js`

Synchronous resolution from local secure storage. Does not create ephemeral credentials (simplified interface for IPC).

```
readCredentialSecret(userId, credentialId)
  ↓
resolveSecretMaterial(secret, runtime)
  ↓
return { connection: { /* secrets */ }, ... }
```

## Scoped Identity Selection

### Principle

No auto-discovery. Credentials are selected explicitly in this order:

1. **Explicitly provided credential** (highest priority)
   - User overrides host's default identity for this connection
   - Must pass ownership check: credential must belong to user
   - Must match auth type if host specifies one (with narrow exception for password-only hosts)

2. **Host-assigned credential** (medium priority)
   - Host has a configured `credential_id`
   - Must match host's auth type preference
   - User cannot override if mismatched

3. **Host password** (legacy, lowest priority)
   - Host row has password field (legacy schema compatibility)
   - Only used if no credential is assigned
   - Creates ephemeral credential for this connection

4. **None** (no default)
   - If no credential available and authType requires one, error

### Enforcement

**Ownership checks**:
```javascript
// Host ownership
if (hostId && hostUserId && hostUserId !== effectiveUserId) {
  throw new Error('Host does not belong to user');
}

// Credential ownership
if (credential.user_id !== userId) {
  throw new Error('Identity does not belong to user');
}
```

**Auth type matching**:
```javascript
// Host specifies private_key, but password credential selected
if (host.auth_type === 'private_key' && selectedAuthType === 'password') {
  if (host.credential_id) {
    throw new Error('Identity is not assigned to this host');
  }
  // Allow fallback to host password if no credential assigned
}
```

**Credential-host binding**:
```javascript
// If host has a credential assigned and different one is provided
if (host.credential_id && credentialId && host.credential_id !== credentialId) {
  throw new Error('Identity is not assigned to this host');
}
```

## Metadata-Only Responses

### Security Property

The response returned to the client/renderer contains **only metadata**, never raw secrets. This prevents credential leakage through logs, network monitoring, or compromised processes.

### Metadata Fields

**Credential metadata** (returned in response):
```javascript
credential: {
  id: '...',
  type: 'password|private_key|key_with_certificate|agent|...',
  label: 'Production SSH Key',
  username: 'deploy',
  fingerprint: 'SHA256:...',           // For agent-forwarded keys
  publicKeyFingerprint: 'SHA256:...',   // For public key
  certificateFingerprint: 'SHA256:...',  // For certificates
  notes: 'Used for production deployments'
}
```

**Secret material** (NOT in response, only in ephemeral credential):
```javascript
ephemeralCredential.material: {
  password: '...',          // Only in ephemeralCredential
  privateKey: '...',        // Only in ephemeralCredential
  passphrase: '...',        // Only in ephemeralCredential
  cert: '...',              // Only in ephemeralCredential
  agent: '...'              // Only in ephemeralCredential
}
```

### Separation of Concerns

```
Response to renderer/client:
├── host metadata (password field cleared)
├── credential metadata (fingerprints only)
└── ephemeralCredential reference (for material access)

Material (separate channel):
└── ephemeralCredential.material (passed to connection handler)
```

## Browser vs Electron Behavior

### Browser Runtime

- **Resolution**: Async database queries on server
- **Storage**: Server-side encrypted vault
- **Material handling**: Passed through WebSocket to browser relay
- **Supported auth types**: password, private_key, key_with_certificate, certificate
- **Unsupported**: agent (requires local socket forwarding)
- **Session**: WebSocket connection session
- **Cleanup**: Server-side on WebSocket close

### Electron Runtime

- **Resolution**: Can use local secure storage or server database
- **Storage**: Electron secure storage (keychain/credential manager)
- **Material handling**: Kept in IPC process, passed to ssh2 library
- **Supported auth types**: password, private_key, key_with_certificate, certificate, agent
- **Unsupported**: none (all methods available locally)
- **Session**: IPC session with terminal manager
- **Cleanup**: Process cleanup or explicit clear

### Runtime Enforcement

```javascript
if (runtime === 'browser' && authType === 'agent') {
  throw new Error('Authentication method is not supported in browser runtime');
}
```

## Ephemeral Credentials

### Purpose

Wrap secret material in a time-limited, connection-scoped object that can be:
- Passed to connection handlers without duplicating secrets
- Cleared from memory after use
- Tracked for audit logging
- Monitored for leaks or misuse

### Lifecycle

```
Created: At resolution time
├── material: { password|privateKey|... }
├── expiresAt: createdAt + 30 seconds
├── cleared: false
│
Used: By connection handler
│
Cleared: After connection attempt
├── material overwritten
└── cleared: true
```

### Clearing

```javascript
// Server-side
clearSecretMaterial(secret);      // Null out secret fields
clearSecretMaterial(material);    // Null out material fields
clearSecretMaterial(ephemeralCredential);  // Also nulls material

// Electron-side
ephemeralCredential.clear();      // In-process cleanup
```

## Logging and Audit

All identity resolution events are logged with **metadata only**:

```javascript
logIdentityEvent('credentialResolved', {
  userId,        // Resolved user
  hostId,        // Host identifier
  credentialId,  // Credential identifier (NOT the secret itself)
  sessionId,     // Connection session
  authType,      // Method used
  runtime,       // 'browser' or 'electron'
  purpose,       // 'ssh', 'sftp', 'test_connection'
  result,        // 'ok' or 'error'
  timestamp      // ISO 8601
});
```

**Never logged**:
- Passwords
- Private keys
- Passphrases
- Certificates
- Any actual secret material

## Error Handling

### Host Not Found
```
Status: 404
Condition: No matching host for user
```

### Identity Not Found
```
Status: 404
Condition: Credential ID doesn't exist
```

### Identity Not Owned
```
Status: 403
Condition: Credential belongs to different user
```

### Credential Secret Unavailable
```
Status: 400
Condition: Secret material cannot be loaded or is incomplete
Examples:
  - Password field is empty
  - Private key missing from storage
  - Certificate missing for key_with_certificate type
```

### Auth Type Unsupported
```
Status: 400
Condition: Auth method not available in this runtime
Example: Agent forwarding in browser
```

### Identity Not Assigned to Host
```
Status: 403
Condition: Selected credential doesn't match host's assignment
Examples:
  - Host requires private_key but password selected
  - Host has credential A assigned but credential B selected
```

## Future Enhancements

### One-Time Identities

Currently partially modeled. Future implementation should:
- Generate temporary SSH keys for single connection
- Auto-cleanup after use or timeout
- Log as transient credentials
- Support certificate-based one-time access

### Certificate-Based Identities

Currently supported structurally. Future expansion should:
- Support SSH user certificates
- Validate certificate chain
- Check revocation lists
- Support certificate rotation

### Dynamic Credential Injection

Future capability:
- Request credentials from external vault at resolution time
- Support OIDC token exchange for SSH access
- Integrate with key management systems

## References

- [Practical Privacy-Preserving Authentication for SSH](https://research.example.com)
- [On the Security of SSH Client Signatures](https://research.example.com)
- [Enabling Secure Shell Access with OpenID Connect](https://research.example.com)
