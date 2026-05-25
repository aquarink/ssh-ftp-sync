const {
  clearSecretMaterial,
  cloneSecretMaterial,
  sensitiveKeyPattern,
} = require('../secretLifecycle');

describe('secretLifecycle', () => {
  describe('cloneSecretMaterial', () => {
    it('should handle null and undefined values', () => {
      expect(cloneSecretMaterial(null)).toBeNull();
      expect(cloneSecretMaterial(undefined)).toBeUndefined();
    });

    it('should return primitive values unchanged', () => {
      expect(cloneSecretMaterial(42)).toBe(42);
      expect(cloneSecretMaterial('string')).toBe('string');
      expect(cloneSecretMaterial(true)).toBe(true);
    });

    it('should create a copy of Buffer', () => {
      const buffer = Buffer.from('secret');
      const clone = cloneSecretMaterial(buffer);

      expect(Buffer.isBuffer(clone)).toBe(true);
      expect(clone).not.toBe(buffer);
      expect(clone.toString()).toBe(buffer.toString());
    });

    it('should clone Date objects', () => {
      const date = new Date('2024-01-15T10:30:00Z');
      const clone = cloneSecretMaterial(date);

      expect(clone).toEqual(date);
      expect(clone).not.toBe(date);
      expect(clone instanceof Date).toBe(true);
    });

    it('should clone arrays recursively', () => {
      const original = [
        'string',
        Buffer.from('buffer'),
        { key: 'value' },
      ];
      const clone = cloneSecretMaterial(original);

      expect(Array.isArray(clone)).toBe(true);
      expect(clone).not.toBe(original);
      expect(clone[0]).toBe('string');
      expect(clone[1]).not.toBe(original[1]);
      expect(Buffer.isBuffer(clone[1])).toBe(true);
      expect(clone[2]).not.toBe(original[2]);
      expect(clone[2].key).toBe('value');
    });

    it('should clone plain objects recursively', () => {
      const original = {
        username: 'user',
        password: 'secret',
        nested: {
          privateKey: Buffer.from('key'),
          passphrase: 'phrase',
        },
      };
      const clone = cloneSecretMaterial(original);

      expect(clone).not.toBe(original);
      expect(clone.username).toBe('user');
      expect(clone.password).toBe('secret');
      expect(clone.nested).not.toBe(original.nested);
      expect(clone.nested.privateKey).not.toBe(original.nested.privateKey);
      expect(clone.nested.passphrase).toBe('phrase');
    });

    it('should handle circular references', () => {
      const original = { a: 1 };
      original.self = original; // Circular reference
      
      const clone = cloneSecretMaterial(original);

      expect(clone).not.toBe(original);
      expect(clone.a).toBe(1);
      expect(clone.self).toBe(clone); // Points to cloned object, not original
    });

    it('should handle deeply nested structures', () => {
      const original = {
        level1: {
          level2: {
            level3: {
              password: 'secret',
              key: Buffer.from('data'),
            },
          },
        },
      };
      const clone = cloneSecretMaterial(original);

      expect(clone).not.toBe(original);
      expect(clone.level1).not.toBe(original.level1);
      expect(clone.level1.level2).not.toBe(original.level1.level2);
      expect(clone.level1.level2.level3).not.toBe(original.level1.level2.level3);
      expect(clone.level1.level2.level3.password).toBe('secret');
    });

    it('should preserve object property order', () => {
      const original = {
        first: 1,
        second: 2,
        third: 3,
      };
      const clone = cloneSecretMaterial(original);

      expect(Object.keys(clone)).toEqual(Object.keys(original));
    });
  });

  describe('clearSecretMaterial', () => {
    it('should handle null and undefined values', () => {
      expect(clearSecretMaterial(null)).toBe(true);
      expect(clearSecretMaterial(undefined)).toBe(true);
    });

    it('should return true for primitive values', () => {
      expect(clearSecretMaterial(42)).toBe(true);
      expect(clearSecretMaterial('string')).toBe(true);
      expect(clearSecretMaterial(true)).toBe(true);
    });

    it('should wipe Buffer contents', () => {
      const buffer = Buffer.from('secret-data');
      const originalContent = buffer.toString();

      // Create a test object to clear (buffers need to be in an object with sensitive keys)
      const obj = {
        password: buffer,
      };

      const result = clearSecretMaterial(obj);

      expect(result).toBe(true);
      // Buffer should be filled with zeros after clearSecretMaterial
      expect(buffer.every(byte => byte === 0)).toBe(true);
      expect(buffer.toString()).not.toBe(originalContent);
      // Password property should be deleted
      expect(obj.password).toBeUndefined();
    });

    it('should delete sensitive properties', () => {
      const obj = {
        username: 'user',
        password: 'secret123',
        publicKey: 'public',
      };

      const result = clearSecretMaterial(obj);

      expect(result).toBe(true);
      expect(obj.username).toBe('user'); // Non-sensitive
      expect(obj.password).toBeUndefined(); // Sensitive, deleted
      expect(obj.publicKey).toBe('public'); // Non-sensitive
    });

    it('should recognize all sensitive key patterns', () => {
      const sensitiveFields = [
        'password',
        'privateKey',
        'passphrase',
        'certificate',
        'certificatePrivateKey',
        'token',
        'refreshToken',
        'accessToken',
        'keyMaterial',
        'credentialSecret',
        'secret',
      ];

      sensitiveFields.forEach(field => {
        expect(sensitiveKeyPattern.test(field)).toBe(true);
      });
    });

    it('should be case-insensitive for sensitive keys', () => {
      expect(sensitiveKeyPattern.test('Password')).toBe(true);
      expect(sensitiveKeyPattern.test('PRIVATEKEY')).toBe(true);
      expect(sensitiveKeyPattern.test('Secret')).toBe(true);
    });

    it('should clear nested objects recursively', () => {
      const obj = {
        username: 'user',
        auth: {
          password: 'secret',
          nested: {
            privateKey: 'keydata',
          },
        },
        publicInfo: 'public',
      };

      clearSecretMaterial(obj);

      expect(obj.username).toBe('user');
      expect(obj.auth.password).toBeUndefined();
      expect(obj.auth.nested.privateKey).toBeUndefined();
      expect(obj.publicInfo).toBe('public');
    });

    it('should handle arrays of sensitive materials', () => {
      const arr = [
        { password: 'secret1' },
        { password: 'secret2' },
        { publicKey: 'public' },
      ];

      clearSecretMaterial(arr);

      expect(arr.length).toBe(0); // Array is emptied
    });

    it('should handle circular references without infinite loop', () => {
      const obj = {
        username: 'user',
        password: 'secret',
      };
      obj.self = obj; // Circular reference

      const result = clearSecretMaterial(obj);

      expect(result).toBe(true);
      expect(obj.password).toBeUndefined();
      expect(obj.self).toBe(obj); // Circular ref still exists (expected)
    });

    it('should clear TypedArray views', () => {
      const buffer = new ArrayBuffer(8);
      const view = new Uint8Array(buffer);
      view[0] = 255;
      view[1] = 128;

      const obj = {
        password: view,
      };

      clearSecretMaterial(obj);

      expect(obj.password).toBeUndefined();
      expect(view.every(byte => byte === 0)).toBe(true);
    });

    it('should handle mixed sensitive and insensitive properties', () => {
      const obj = {
        id: '123',
        username: 'admin',
        password: 'secret123',
        token: 'abc-def-ghi',
        host: 'example.com',
        port: 22,
        privateKey: Buffer.from('key-data'),
      };

      clearSecretMaterial(obj);

      expect(obj.id).toBe('123');
      expect(obj.username).toBe('admin');
      expect(obj.host).toBe('example.com');
      expect(obj.port).toBe(22);
      expect(obj.password).toBeUndefined();
      expect(obj.token).toBeUndefined();
      expect(obj.privateKey).toBeUndefined();
    });

    it('should handle deeply nested structures', () => {
      const obj = {
        level1: {
          level2: {
            level3: {
              password: 'secret',
              key: 'data',
            },
          },
        },
      };

      clearSecretMaterial(obj);

      expect(obj.level1.level2.level3.password).toBeUndefined();
      expect(obj.level1.level2.level3.key).toBe('data');
    });

    it('should return true on success even with complex structures', () => {
      const obj = {
        password: Buffer.from('secret'),
        nested: {
          privateKey: 'key',
          arr: [
            { token: 'abc' },
            { token: 'def' },
          ],
        },
      };

      const result = clearSecretMaterial(obj);

      expect(result).toBe(true);
    });

    it('should handle objects with no sensitive fields', () => {
      const obj = {
        username: 'user',
        host: 'example.com',
        port: 22,
      };

      clearSecretMaterial(obj);

      expect(obj.username).toBe('user');
      expect(obj.host).toBe('example.com');
      expect(obj.port).toBe(22);
    });

    it('should not modify insensitive nested objects', () => {
      const innerObj = {
        data: 'value',
      };
      const obj = {
        password: 'secret',
        public: innerObj,
      };

      clearSecretMaterial(obj);

      expect(obj.public).toBe(innerObj);
      expect(innerObj.data).toBe('value');
      expect(obj.password).toBeUndefined();
    });
  });

  describe('sensitiveKeyPattern', () => {
    it('should match all documented sensitive fields', () => {
      const sensitiveFields = [
        'password',
        'privateKey',
        'passphrase',
        'certificate',
        'certificatePrivateKey',
        'token',
        'refreshToken',
        'accessToken',
        'keyMaterial',
        'credentialSecret',
        'secret',
      ];

      sensitiveFields.forEach(field => {
        expect(sensitiveKeyPattern.test(field)).toBe(true);
      });
    });

    it('should not match non-sensitive fields', () => {
      const nonSensitiveFields = [
        'username',
        'host',
        'port',
        'public',
        'data',
        'id',
        'userId',
        'hostId',
        'createdAt',
        'expiresAt',
      ];

      nonSensitiveFields.forEach(field => {
        expect(sensitiveKeyPattern.test(field)).toBe(false);
      });
    });
  });
});
