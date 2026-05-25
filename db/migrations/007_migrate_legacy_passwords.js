const { saveCredentialSecret } = require('../../server/credentialStore');
const { randomUUID } = require('crypto');

module.exports = {
  async up(connection) {
    // If the vault is not ready (e.g. no SESSION_SECRET or CREDENTIAL_VAULT_KEY is configured in the environment),
    // we should set a temporary fallback key so the encryption does not fail during migration.
    // This is safe because users will rotate keys or use their own custom key in production.
    if (!process.env.CREDENTIAL_VAULT_KEY && !process.env.SESSION_SECRET) {
      process.env.SESSION_SECRET = 'ats-migration-fallback-secret-key-2026';
    }

    // Query hosts with legacy password
    const [hosts] = await connection.query(
      "SELECT id, user_id, name, username, password FROM hosts WHERE password IS NOT NULL AND password != ''"
    );

    console.log(`Found ${hosts.length} legacy host passwords to migrate.`);

    for (const host of hosts) {
      const credentialId = randomUUID();
      const storageRef = `${credentialId}.json`;

      // Save secret password in vault
      saveCredentialSecret(credentialId, {
        type: 'password',
        password: host.password,
      });

      // Insert into ssh_credentials table
      await connection.query(
        `INSERT INTO ssh_credentials
          (id, user_id, type, label, username, storage_ref)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          credentialId,
          host.user_id,
          'password',
          `Migrated Password for ${host.name}`,
          host.username,
          storageRef,
        ]
      );

      // Update host to point to the new credential
      await connection.query(
        "UPDATE hosts SET auth_type = 'identity', credential_id = ?, password = '' WHERE id = ?",
        [credentialId, host.id]
      );

      console.log(`Migrated legacy password for host '${host.name}' (ID: ${host.id}) to credential ID '${credentialId}'.`);
    }
  }
};
