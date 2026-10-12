/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const origin = 'https://instantmemeeditandpost.online';
const source = path.resolve(__dirname, '../chrome-ext');
const destination = path.resolve(__dirname, '../dist/chrome-ext');
fs.mkdirSync(destination, { recursive: true });
for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
  if (!entry.isFile() || !/\.(js|json|html|css|png|svg|ico)$/.test(entry.name)) continue;
  const input = path.join(source, entry.name);
  const output = path.join(destination, entry.name);
  if (/\.(js|json|html|css)$/.test(entry.name)) {
    const text = fs.readFileSync(input, 'utf8').replaceAll('http://localhost:3000', origin)
      .replace('const DIRECT_STORAGE_UPLOAD = false;', 'const DIRECT_STORAGE_UPLOAD = true;')
      .replaceAll('running on :3000', 'available online');
    fs.writeFileSync(output, text);
  } else fs.copyFileSync(input, output);
}
console.log(`Production extension prepared at ${destination}. Local extension files were not repointed.`);
