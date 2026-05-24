const path = require('path');
const { Client } = require('ssh2');
const AdmZip = require('adm-zip');
const { isEphemeralCredentialExpired } = require('./ephemeralCredential');

const maxTextFileBytes = 2 * 1024 * 1024;

function remotePath(value = '/') {
  if (typeof value !== 'string' || value.includes('\0')) {
    throw Object.assign(new Error('Invalid remote path'), { status: 400 });
  }
  const normalized = path.posix.normalize(value.startsWith('/') ? value : `/${value}`);
  if (normalized.split('/').includes('..')) {
    throw Object.assign(new Error('Remote path traversal is not allowed'), { status: 400 });
  }
  return normalized;
}

function joinRemote(base, name) {
  return remotePath(path.posix.join(remotePath(base), name));
}

function mutableRemotePath(value) {
  const safePath = remotePath(value);
  if (safePath === '/') {
    throw Object.assign(new Error('Operation on remote root is not allowed'), { status: 400 });
  }
  return safePath;
}

function buildConnectConfig(hostConfig, material) {
  return {
    host: hostConfig.host,
    port: hostConfig.port || 22,
    username: hostConfig.username,
    password: material?.password || undefined,
    privateKey: material?.privateKey || undefined,
    passphrase: material?.passphrase || undefined,
    cert: material?.certificate || material?.cert || undefined,
    agent: material?.agent || undefined,
    readyTimeout: 15000,
    keepaliveInterval: 25000,
    keepaliveCountMax: 3,
  };
}

function connectSftp(hostConfig, credential) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.once('ready', () => {
      conn.sftp((error, sftp) => {
        if (error) {
          conn.end();
          reject(error);
          return;
        }
        resolve({ conn, sftp });
      });
    });
    conn.once('error', reject);
    conn.connect(buildConnectConfig(hostConfig, credential.material));
  });
}

async function withSftp(hostConfig, credential, work) {
  if (!credential) {
    throw Object.assign(new Error('Credential secret unavailable'), { status: 400 });
  }
  if (isEphemeralCredentialExpired(credential)) {
    credential.clear();
    throw Object.assign(new Error('Credential secret unavailable'), { status: 400 });
  }

  const { conn, sftp } = await connectSftp(hostConfig, credential);
  try {
    return await work(sftp);
  } finally {
    conn.end();
  }
}

function sftpCall(sftp, method, ...args) {
  return new Promise((resolve, reject) => {
    sftp[method](...args, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

function readFile(sftp, targetPath) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const stream = sftp.createReadStream(remotePath(targetPath));
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolve(Buffer.concat(chunks)));
  });
}

function writeFile(sftp, targetPath, buffer, onProgress) {
  return new Promise((resolve, reject) => {
    let transferred = 0;
    const stream = sftp.createWriteStream(remotePath(targetPath));
    stream.once('error', reject);
    stream.once('finish', resolve);
    stream.end(buffer, () => {
      transferred = buffer.length;
      onProgress?.({ transferred, total: buffer.length });
    });
  });
}

async function statEntry(sftp, targetPath) {
  const attrs = await sftpCall(sftp, 'stat', remotePath(targetPath));
  return {
    size: attrs.size,
    uid: attrs.uid,
    gid: attrs.gid,
    mode: attrs.mode,
    permissions: (attrs.mode & 0o777).toString(8).padStart(3, '0'),
    atime: attrs.atime,
    mtime: attrs.mtime,
    isDirectory: attrs.isDirectory(),
    isFile: attrs.isFile(),
    isSymbolicLink: attrs.isSymbolicLink(),
  };
}

async function listDirectory(sftp, targetPath) {
  const directory = remotePath(targetPath);
  const items = await sftpCall(sftp, 'readdir', directory);
  return items.map((item) => ({
    name: item.filename,
    path: joinRemote(directory, item.filename),
    size: item.attrs.size,
    mode: item.attrs.mode,
    permissions: (item.attrs.mode & 0o777).toString(8).padStart(3, '0'),
    mtime: item.attrs.mtime,
    isDirectory: item.attrs.isDirectory(),
    isFile: item.attrs.isFile(),
    isSymbolicLink: item.attrs.isSymbolicLink(),
  })).sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));
}

async function deletePath(sftp, targetPath) {
  const safePath = mutableRemotePath(targetPath);
  const attrs = await sftpCall(sftp, 'stat', safePath);
  if (!attrs.isDirectory()) {
    await sftpCall(sftp, 'unlink', safePath);
    return;
  }
  const items = await sftpCall(sftp, 'readdir', safePath);
  for (const item of items) {
    await deletePath(sftp, joinRemote(safePath, item.filename));
  }
  await sftpCall(sftp, 'rmdir', safePath);
}

async function copyPath(sftp, from, to) {
  const source = remotePath(from);
  const target = mutableRemotePath(to);
  const attrs = await sftpCall(sftp, 'stat', source);
  if (!attrs.isDirectory()) {
    await ensureDir(sftp, path.posix.dirname(target));
    await writeFile(sftp, target, await readFile(sftp, source));
    return;
  }
  await ensureDir(sftp, target);
  const items = await sftpCall(sftp, 'readdir', source);
  for (const item of items) {
    await copyPath(sftp, joinRemote(source, item.filename), joinRemote(target, item.filename));
  }
}

async function addPathToZip(sftp, zip, targetPath, zipPath) {
  const attrs = await sftpCall(sftp, 'stat', targetPath);
  if (attrs.isDirectory()) {
    const items = await sftpCall(sftp, 'readdir', targetPath);
    for (const item of items) {
      await addPathToZip(sftp, zip, joinRemote(targetPath, item.filename), path.posix.join(zipPath, item.filename));
    }
    return;
  }
  zip.addFile(zipPath, await readFile(sftp, targetPath));
}

async function ensureDir(sftp, directory) {
  const safeDir = remotePath(directory);
  const parts = safeDir.split('/').filter(Boolean);
  let current = '/';
  for (const part of parts) {
    current = joinRemote(current, part);
    try {
      await sftpCall(sftp, 'mkdir', current);
    } catch (error) {
      if (error.code !== 4) throw error;
    }
  }
}

async function extractZip(sftp, archivePath, destinationPath) {
  const archive = new AdmZip(await readFile(sftp, archivePath));
  const destination = remotePath(destinationPath);
  for (const entry of archive.getEntries()) {
    const entryPath = remotePath(path.posix.join(destination, entry.entryName));
    if (!entryPath.startsWith(`${destination}/`) && entryPath !== destination) {
      throw Object.assign(new Error('Archive contains unsafe paths'), { status: 400 });
    }
    if (entry.isDirectory) {
      await ensureDir(sftp, entryPath);
    } else {
      await ensureDir(sftp, path.posix.dirname(entryPath));
      await writeFile(sftp, entryPath, entry.getData());
    }
  }
}

const sftpOperations = {
  list: (sftp, { path: targetPath }) => listDirectory(sftp, targetPath || '/'),
  stat: (sftp, { path: targetPath }) => statEntry(sftp, targetPath),
  read: async (sftp, { path: targetPath }) => {
    const attrs = await sftpCall(sftp, 'stat', remotePath(targetPath));
    if (attrs.size > maxTextFileBytes) throw Object.assign(new Error('File is too large to edit as text'), { status: 413 });
    return { content: (await readFile(sftp, targetPath)).toString('utf8') };
  },
  download: async (sftp, { path: targetPath }) => {
    const safePath = remotePath(targetPath);
    const attrs = await sftpCall(sftp, 'stat', safePath);
    if (attrs.isDirectory()) {
      const zip = new AdmZip();
      await addPathToZip(sftp, zip, safePath, path.posix.basename(safePath));
      return { name: `${path.posix.basename(safePath)}.zip`, data: zip.toBuffer().toString('base64') };
    }
    const buffer = await readFile(sftp, safePath);
    return { name: path.posix.basename(safePath), data: buffer.toString('base64') };
  },
  write: async (sftp, { path: targetPath, content }) => {
    await writeFile(sftp, mutableRemotePath(targetPath), Buffer.from(String(content || ''), 'utf8'));
    return { ok: true };
  },
  upload: async (sftp, { path: targetPath, data }) => {
    const safePath = mutableRemotePath(targetPath);
    await ensureDir(sftp, path.posix.dirname(safePath));
    await writeFile(sftp, safePath, Buffer.from(String(data || ''), 'base64'));
    return { ok: true };
  },
  mkdir: async (sftp, { path: targetPath }) => {
    await sftpCall(sftp, 'mkdir', mutableRemotePath(targetPath));
    return { ok: true };
  },
  rename: async (sftp, { from, to }) => {
    await sftpCall(sftp, 'rename', mutableRemotePath(from), mutableRemotePath(to));
    return { ok: true };
  },
  delete: async (sftp, { path: targetPath }) => {
    await deletePath(sftp, targetPath);
    return { ok: true };
  },
  chmod: async (sftp, { path: targetPath, mode }) => {
    const parsed = Number.parseInt(String(mode), 8);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 0o777) {
      throw Object.assign(new Error('Permission must be an octal mode like 644'), { status: 400 });
    }
    await sftpCall(sftp, 'chmod', mutableRemotePath(targetPath), parsed);
    return { ok: true };
  },
  copy: async (sftp, { from, to }) => {
    await copyPath(sftp, from, to);
    return { ok: true };
  },
  move: async (sftp, { from, to }) => {
    await sftpCall(sftp, 'rename', mutableRemotePath(from), mutableRemotePath(to));
    return { ok: true };
  },
  archive: async (sftp, { paths, destination }) => {
    const zip = new AdmZip();
    for (const itemPath of Array.isArray(paths) ? paths : []) {
      const safePath = remotePath(itemPath);
      await addPathToZip(sftp, zip, safePath, path.posix.basename(safePath));
    }
    await writeFile(sftp, mutableRemotePath(destination), zip.toBuffer());
    return { ok: true };
  },
  extract: async (sftp, { archive, destination }) => {
    await extractZip(sftp, archive, destination);
    return { ok: true };
  },
};

async function runSftpOperation(hostConfig, operation, payload = {}) {
  const handler = sftpOperations[operation];
  if (!handler) throw Object.assign(new Error('Unsupported SFTP operation'), { status: 400 });
  return withSftp(hostConfig.host, hostConfig.credential, (sftp) => handler(sftp, payload));
}

module.exports = {
  runSftpOperation,
  remotePath,
};
