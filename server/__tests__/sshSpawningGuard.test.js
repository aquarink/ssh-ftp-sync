const fs = require('fs');
const path = require('path');

function getFilesRecursively(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.git' && file !== 'dist' && file !== '.antigravitycli' && file !== 'coverage') {
        results = results.concat(getFilesRecursively(filePath));
      }
    } else {
      if (/\.(js|ts|tsx|jsx)$/.test(file)) {
        results.push(filePath);
      }
    }
  });
  return results;
}

describe('OS SSH Command Spawning Guard', () => {
  const rootDir = path.resolve(__dirname, '../..');
  const files = [
    ...getFilesRecursively(path.join(rootDir, 'server')),
    ...getFilesRecursively(path.join(rootDir, 'electron')),
    ...getFilesRecursively(path.join(rootDir, 'src')),
  ].filter(file => !file.endsWith('sshSpawningGuard.test.js'));

  const forbiddenPatterns = [
    { pattern: /child_process\s*\.\s*(spawn|exec|execSync|spawnSync)/, name: 'child_process execution' },
    { pattern: /require\(\s*['"`]child_process['"`]\s*\)/, name: 'require("child_process")' },
    { pattern: /import\s+.*\s+from\s+['"`]child_process['"`]/, name: 'import child_process' },
    { pattern: /require\(\s*['"`]execa['"`]\s*\)/, name: 'require("execa")' },
    { pattern: /import\s+.*\s+from\s+['"`]execa['"`]/, name: 'import execa' },
    { pattern: /spawn\(\s*['"`]ssh['"`]/, name: 'spawning ssh CLI' },
    { pattern: /exec\(\s*['"`]ssh\s+/, name: 'executing ssh CLI' },
    { pattern: /spawn\(\s*['"`]sftp['"`]/, name: 'spawning sftp CLI' },
    { pattern: /exec\(\s*['"`]sftp\s+/, name: 'executing sftp CLI' },
    { pattern: /spawn\(\s*['"`]scp['"`]/, name: 'spawning scp CLI' },
    { pattern: /exec\(\s*['"`]scp\s+/, name: 'executing scp CLI' },
  ];

  test('ensures no files spawn OS SSH/SFTP/SCP CLI commands or use child_process', () => {
    files.forEach((filePath) => {
      const content = fs.readFileSync(filePath, 'utf8');
      forbiddenPatterns.forEach(({ pattern, name }) => {
        const hasPattern = pattern.test(content);
        if (hasPattern) {
          console.error(`CRITICAL SECURITY FAILURE: ${name} detected in ${filePath}`);
        }
        expect(hasPattern).toBe(false);
      });
    });
  });

  test('verifies codebase does not automatically check ~/.ssh', () => {
    files.forEach((filePath) => {
      const content = fs.readFileSync(filePath, 'utf8');
      const hasDotSshReference = /(\b\.ssh\b|~\/\.ssh)/i.test(content) && 
        !filePath.includes('PROJECT_STATE.md') && 
        !filePath.includes('README.md') && 
        !filePath.includes('localhostBridge.test.js') && 
        !filePath.includes('sshSpawningGuard.test.js');
      if (hasDotSshReference) {
        console.log("FAILED FILE FOR .ssh:", filePath);
      }
      expect(hasDotSshReference).toBe(false);
    });
  });
});
