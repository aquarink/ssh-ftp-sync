# Evaluation Notes - Test Evidence

This document records the evaluation results and test evidence of Phase 1 implementation for the **Ant Tech Async** remote operations platform.

## Evaluation Environment

- **OS**: Linux
- **Node.js**: v18+ (tested via local Node.js environment)
- **Database**: MySQL 8 (local instance `ant_tech_async`)
- **Test Framework**: Jest
- **Repository Branch**: `main`
- **Active Feature Status**: Phase 1 fully integrated (Phases 1.1 to 1.5)

---

## Test Execution Summary

A total of 118 automated unit and integration tests across 7 test suites were executed successfully. The complete test suite is green and runs on the `main` branch.

### Test Run Output Log (2026-05-25)

```text
> sshftp@0.0.0 test
> jest

PASS server/__tests__/sshIntegration.test.js
  ● Console

    console.info
      [session] created {
        sessionId: 'test-session-uuid-123',
        userId: 42,
        hostId: 101,
        runtime: 'browser',
        purpose: 'sftp',
        state: 'connecting',
        closeReason: null,
        result: 'ok',
        timestamp: '2026-05-25T02:32:17.457Z'
      }

      at info (server/sessionLifecycle.js:38:11)

    console.info
      [session] closing {
        sessionId: 'test-session-uuid-123',
        userId: 42,
        hostId: 101,
        runtime: 'browser',
        purpose: 'sftp',
        state: 'closing',
        closeReason: 'sftp_complete',
        result: 'ok',
        timestamp: '2026-05-25T02:32:17.585Z'
      }

      at info (server/sessionLifecycle.js:38:11)

    console.info
      [session] closed {
        sessionId: 'test-session-uuid-123',
        userId: 42,
        hostId: 101,
        runtime: 'browser',
        purpose: 'sftp',
        state: 'closed',
        closeReason: 'sftp_complete',
        result: 'ok',
        timestamp: '2026-05-25T02:32:17.586Z'
      }

      at info (server/sessionLifecycle.js:38:11)

    console.info
      [session] created {
        sessionId: 'stress-session-uuid-999',
        userId: 42,
        hostId: 101,
        runtime: 'browser',
        purpose: 'sftp',
        state: 'connecting',
        closeReason: null,
        result: 'ok',
        timestamp: '2026-05-25T02:32:17.589Z'
      }

      at info (server/sessionLifecycle.js:38:11)

    console.info
      [session] closing {
        sessionId: 'stress-session-uuid-999',
        userId: 42,
        hostId: 101,
        runtime: 'browser',
        purpose: 'sftp',
        state: 'closing',
        closeReason: 'sftp_complete',
        result: 'ok',
        timestamp: '2026-05-25T02:32:17.643Z'
      }

      at info (server/sessionLifecycle.js:38:11)

    console.info
      [session] closed {
        sessionId: 'stress-session-uuid-999',
        userId: 42,
        hostId: 101,
        runtime: 'browser',
        purpose: 'sftp',
        state: 'closed',
        closeReason: 'sftp_complete',
        result: 'ok',
        timestamp: '2026-05-25T02:32:17.644Z'
      }

      at info (server/sessionLifecycle.js:38:11)

    console.info
      [session] created {
        sessionId: 'stress-session-uuid-999',
        userId: 42,
        hostId: 101,
        runtime: 'browser',
        purpose: 'sftp',
        state: 'connected',
        closeReason: null,
        result: 'ok',
        timestamp: '2026-05-25T02:32:17.644Z'
      }

      at info (server/sessionLifecycle.js:38:11)

    console.info
      [session] closing {
        sessionId: 'stress-session-uuid-999',
        userId: 42,
        hostId: 101,
        runtime: 'browser',
        purpose: 'sftp',
        state: 'closing',
        closeReason: 'abrupt_disconnect',
        result: 'ok',
        timestamp: '2026-05-25T02:32:17.644Z'
      }

      at info (server/sessionLifecycle.js:38:11)

    console.info
      [session] closed {
        sessionId: 'stress-session-uuid-999',
        userId: 42,
        hostId: 101,
        runtime: 'browser',
        purpose: 'sftp',
        state: 'closed',
        closeReason: 'abrupt_disconnect',
        result: 'ok',
        timestamp: '2026-05-25T02:32:17.645Z'
      }

      at info (server/sessionLifecycle.js:38:11)
PASS server/__tests__/ephemeralCredentialLifecycle.test.js
PASS server/__tests__/sftpPathValidation.test.js
PASS server/__tests__/identityResolver.test.js
PASS electron/identityResolver.test.js
PASS server/__tests__/secretLifecycle.test.js
PASS server/__tests__/ephemeralCredential.test.js

Test Suites: 7 passed, 7 total
Tests:       118 passed, 118 total
Snapshots:   0 total
Time:        1.307 s
Ran all test suites.
```

---

## Detailed Test Coverage Evidence

### 1. Smart Identity Engine Verification (`server/identityResolver.js` & `electron/identityResolver.js`)
- **Tests**: `server/__tests__/identityResolver.test.js` (23 tests), `electron/identityResolver.test.js` (21 tests)
- **Evidence**:
  - Verification that the top-level API response does not expose raw secrets (`password`, `privateKey`).
  - Verification that `resolveIdentity` throws 404/403 errors when loading hosts or credentials belonging to different users (cross-user validation).
  - Validation of host-to-identity assignment checks.
  - Validation that browser mode throws an exception if local agent socket usage is requested.

### 2. Secure Vault & Key Isolation Verification (`server/ephemeralCredential.js` & `server/secretLifecycle.js`)
- **Tests**: `server/__tests__/ephemeralCredential.test.js` (11 tests), `server/__tests__/secretLifecycle.test.js` (19 tests), `server/__tests__/ephemeralCredentialLifecycle.test.js` (16 tests).
- **Evidence**:
  - Verification of `clearSecretMaterial` which overwrites buffers with 0s and deletes keys.
  - Verification that `cloneSecretMaterial` correctly duplicates arrays, buffers, and nested objects.
  - Verification that `ephemeralCredential` expires after a set TTL and automatically wipes its secrets from memory.
  - Verification that `finally` block execution in resolvers ensures secrets do not persist in Node memory maps after connection.

### 3. Session Cleanup Verification (`server/sessionLifecycle.js` & `electron/sessionLifecycle.js`)
- **Tests**: Included in E2E integration test suite (`server/__tests__/sshIntegration.test.js`).
- **Evidence**:
  - Verification that connection establishment creates a session entry.
  - Verification that `cleanupSession` successfully removes session records, ends the connection socket, and transitions state to `closed` with the appropriate close reason (`sftp_complete`, `abrupt_disconnect`).
  - Abrupt close test verifies no socket or connection references leak on disconnection.

### 4. Zero-Trust Access Layer (`server/connectToken.js`)
- **Tests**: Included in E2E integration test suite (`server/__tests__/sshIntegration.test.js`).
- **Evidence**:
  - Verification that calling `issueAuthorizedConnectToken` generates a valid signed connect token.
  - Verification that calling `consumeTokenFromRequest` with the token validates scope constraints (userId, hostId, runtime, purpose) and invalidates the token upon consumption (preventing replay attacks).

### 5. SFTP Path Validation (`server/sftpService.js`)
- **Tests**: `server/__tests__/sftpPathValidation.test.js` (11 tests)
- **Evidence**:
  - Verification of `remotePath()` behavior preventing dot-dot (`..`) traversal segments and null-byte (`\0`) injections.
  - Verification of `mutableRemotePath()` throwing a 400 error when resolving to the remote root `/`.
  - Verification of `joinRemote()` safely joining base paths and filenames.
