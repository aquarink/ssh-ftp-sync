/**
 * Storage for the device authorization flow (see deviceAuth.js and
 * docs/DESKTOP_DEVICE_LOGIN_DESIGN.md).
 *
 * Rows live in MySQL, not in memory: the approval arrives from the browser and
 * the poll from the desktop, and a login in progress must survive an API
 * restart. The memory store implements the same interface for tests and for
 * the integration script, so the flow logic is exercised without a database.
 *
 * Row shape (snake_case, as in the table):
 *   id, device_code_hash, user_code, status, user_id, runtime, device_label,
 *   app_version, requester_ip, approver_ip, poll_count, last_polled_at,
 *   approved_at, consumed_at, expires_at, created_at
 */
const DEVICE_AUTH_COLUMNS = `id, device_code_hash, user_code, status, user_id, runtime, device_label,
            app_version, requester_ip, approver_ip, poll_count, last_polled_at,
            approved_at, consumed_at, expires_at, created_at`;

const SESSION_COLUMNS = 'id, client, device_label, created_at, last_seen_at, expires_at, token_hash';

function createMysqlDeviceAuthStore(pool) {
  return {
    async insert(row) {
      await pool.execute(
        `INSERT INTO device_authorizations
          (id, device_code_hash, user_code, status, runtime, device_label, app_version, requester_ip, expires_at, created_at)
         VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
        [row.id, row.device_code_hash, row.user_code, row.runtime, row.device_label, row.app_version, row.requester_ip, row.expires_at, row.created_at]
      );
    },

    async findByDeviceCodeHash(hash) {
      const [rows] = await pool.execute(
        `SELECT ${DEVICE_AUTH_COLUMNS} FROM device_authorizations WHERE device_code_hash = ? LIMIT 1`,
        [hash]
      );
      return rows[0] || null;
    },

    async findByUserCode(userCode) {
      const [rows] = await pool.execute(
        `SELECT ${DEVICE_AUTH_COLUMNS} FROM device_authorizations WHERE user_code = ? LIMIT 1`,
        [userCode]
      );
      return rows[0] || null;
    },

    async listPendingByIp(ip) {
      const [rows] = await pool.execute(
        `SELECT ${DEVICE_AUTH_COLUMNS}
           FROM device_authorizations
          WHERE requester_ip = ? AND status = 'pending'
          ORDER BY created_at DESC`,
        [ip]
      );
      return rows;
    },

    // Moves a row from one status to another; false when another request got
    // there first (the WHERE on the old status is the single-use guard).
    async transition(id, fromStatus, patch) {
      const sets = ['status = ?'];
      const params = [patch.status];
      for (const [column, value] of Object.entries(patch)) {
        if (column === 'status') continue;
        sets.push(`${column} = ?`);
        params.push(value);
      }
      params.push(id, fromStatus);
      const [result] = await pool.execute(
        `UPDATE device_authorizations SET ${sets.join(', ')} WHERE id = ? AND status = ?`,
        params
      );
      return result.affectedRows === 1;
    },

    async recordPoll(id, at) {
      await pool.execute(
        'UPDATE device_authorizations SET poll_count = poll_count + 1, last_polled_at = ? WHERE id = ?',
        [at, id]
      );
    },

    async findUser(userId) {
      const [rows] = await pool.execute(
        'SELECT id, email, username, role, approval_status FROM users WHERE id = ? LIMIT 1',
        [userId]
      );
      return rows[0] || null;
    },

    async sweep(now) {
      await pool.execute(
        `UPDATE device_authorizations SET status = 'expired'
          WHERE status IN ('pending', 'approved') AND expires_at <= ?`,
        [now]
      );
      await pool.execute(
        'DELETE FROM device_authorizations WHERE expires_at < ?',
        [new Date(now.getTime() - 24 * 3600 * 1000)]
      );
    },

    async listSessions(userId) {
      const [rows] = await pool.execute(
        `SELECT ${SESSION_COLUMNS} FROM sessions
          WHERE user_id = ? AND expires_at > UTC_TIMESTAMP()
          ORDER BY created_at DESC`,
        [userId]
      );
      return rows;
    },

    async deleteSession(userId, sessionId) {
      const [result] = await pool.execute(
        'DELETE FROM sessions WHERE id = ? AND user_id = ?',
        [sessionId, userId]
      );
      return result.affectedRows === 1;
    },
  };
}

function createMemoryDeviceAuthStore({ users = [], sessions = [] } = {}) {
  const rows = new Map();
  const sessionRows = sessions.map((row) => ({ ...row }));
  const clone = (row) => (row ? { ...row } : null);

  return {
    rows,
    sessions: sessionRows,

    async insert(row) {
      for (const existing of rows.values()) {
        if (existing.user_code === row.user_code || existing.device_code_hash === row.device_code_hash) {
          throw Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
        }
      }
      rows.set(row.id, {
        status: 'pending',
        user_id: null,
        approver_ip: null,
        poll_count: 0,
        last_polled_at: null,
        approved_at: null,
        consumed_at: null,
        created_at: new Date(),
        ...row,
      });
    },

    async findByDeviceCodeHash(hash) {
      return clone([...rows.values()].find((row) => row.device_code_hash === hash));
    },

    async findByUserCode(userCode) {
      return clone([...rows.values()].find((row) => row.user_code === userCode));
    },

    async listPendingByIp(ip) {
      return [...rows.values()]
        .filter((row) => row.requester_ip === ip && row.status === 'pending')
        .sort((a, b) => b.created_at - a.created_at)
        .map(clone);
    },

    async transition(id, fromStatus, patch) {
      const row = rows.get(id);
      if (!row || row.status !== fromStatus) return false;
      Object.assign(row, patch);
      return true;
    },

    async recordPoll(id, at) {
      const row = rows.get(id);
      if (!row) return;
      row.poll_count += 1;
      row.last_polled_at = at;
    },

    async findUser(userId) {
      return clone(users.find((user) => user.id === userId));
    },

    async sweep(now) {
      for (const [id, row] of rows.entries()) {
        if (['pending', 'approved'].includes(row.status) && row.expires_at <= now) row.status = 'expired';
        if (row.expires_at < new Date(now.getTime() - 24 * 3600 * 1000)) rows.delete(id);
      }
    },

    async listSessions(userId) {
      return sessionRows.filter((row) => row.user_id === userId).map(clone);
    },

    async deleteSession(userId, sessionId) {
      const index = sessionRows.findIndex((row) => row.id === sessionId && row.user_id === userId);
      if (index === -1) return false;
      sessionRows.splice(index, 1);
      return true;
    },
  };
}

module.exports = {
  createMemoryDeviceAuthStore,
  createMysqlDeviceAuthStore,
};
