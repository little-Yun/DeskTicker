const fs = require('fs');
const path = require('path');

const packageDir = path.resolve(process.argv[2] || '');
const keptLocales = new Set(['zh-CN.pak', 'zh-TW.pak', 'en-US.pak']);

if (!packageDir || !fs.existsSync(packageDir)) {
  console.error(`Package directory not found: ${packageDir}`);
  process.exit(1);
}

const localesDir = path.join(packageDir, 'locales');
if (fs.existsSync(localesDir)) {
  for (const entry of fs.readdirSync(localesDir)) {
    const entryPath = path.join(localesDir, entry);
    if (!keptLocales.has(entry) && fs.statSync(entryPath).isFile()) {
      fs.rmSync(entryPath, { force: true });
    }
  }
}

console.log(`Trimmed package: kept locales ${Array.from(keptLocales).join(', ')}`);
