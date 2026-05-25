const {
  remotePath,
  mutableRemotePath,
  joinRemote,
} = require('../sftpService');

describe('server/sftpService - Path Validation Tests', () => {
  describe('remotePath', () => {
    test('returns / by default when no path is provided', () => {
      expect(remotePath()).toBe('/');
      expect(remotePath(undefined)).toBe('/');
    });

    test('prepends a leading slash if not present', () => {
      expect(remotePath('foo')).toBe('/foo');
      expect(remotePath('foo/bar')).toBe('/foo/bar');
    });

    test('normalizes multiple slashes and trailing slashes', () => {
      expect(remotePath('//foo///bar')).toBe('/foo/bar');
      expect(remotePath('/foo/bar/')).toBe('/foo/bar/');
      expect(remotePath('///')).toBe('/');
    });

    test('throws 400 when path is not a string', () => {
      const invalidInputs = [null, 123, true, {}, [], () => {}];
      for (const input of invalidInputs) {
        let thrown = false;
        try {
          remotePath(input);
        } catch (err) {
          thrown = true;
          expect(err.message).toBe('Invalid remote path');
          expect(err.status).toBe(400);
        }
        expect(thrown).toBe(true);
      }
    });

    test('throws 400 when path contains a null byte', () => {
      let thrown = false;
      try {
        remotePath('/foo\0bar');
      } catch (err) {
        thrown = true;
        expect(err.message).toBe('Invalid remote path');
        expect(err.status).toBe(400);
      }
      expect(thrown).toBe(true);
    });

    test('throws 400 when path contains dot-dot traversal segments', () => {
      const badPaths = [
        '../foo',
        '/foo/../bar',
        '/foo/bar/..',
        '/..',
        '..',
        '/foo/../..',
      ];

      for (const badPath of badPaths) {
        let thrown = false;
        try {
          remotePath(badPath);
        } catch (err) {
          thrown = true;
          expect(err.message).toBe('Remote path traversal is not allowed');
          expect(err.status).toBe(400);
        }
        expect(thrown).toBe(true);
      }
    });

    test('allows paths containing dot or dot-dot inside names but not as segments', () => {
      // E.g. filename is "..foo" or "foo.." or "foo.bar"
      expect(remotePath('/foo..bar')).toBe('/foo..bar');
      expect(remotePath('/..foo')).toBe('/..foo');
      expect(remotePath('/foo.bar')).toBe('/foo.bar');
      expect(remotePath('/.foo')).toBe('/.foo');
    });
  });

  describe('joinRemote', () => {
    test('joins and normalizes base path and subpath correctly', () => {
      expect(joinRemote('/foo', 'bar')).toBe('/foo/bar');
      expect(joinRemote('foo/', '/bar/')).toBe('/foo/bar/');
      expect(joinRemote('/', 'foo')).toBe('/foo');
    });

    test('throws when base path is invalid or traversal', () => {
      expect(() => joinRemote('../foo', 'bar')).toThrow('Remote path traversal is not allowed');
    });
  });

  describe('mutableRemotePath', () => {
    test('returns safe normalized path for valid non-root paths', () => {
      expect(mutableRemotePath('/foo')).toBe('/foo');
      expect(mutableRemotePath('foo/bar')).toBe('/foo/bar');
    });

    test('throws 400 when path resolves to remote root /', () => {
      const rootPaths = ['/', '///', '', undefined];
      for (const p of rootPaths) {
        let thrown = false;
        try {
          mutableRemotePath(p);
        } catch (err) {
          thrown = true;
          expect(err.message).toBe('Operation on remote root is not allowed');
          expect(err.status).toBe(400);
        }
        expect(thrown).toBe(true);
      }
    });
  });
});
