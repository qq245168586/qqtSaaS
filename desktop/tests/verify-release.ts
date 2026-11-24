// Verify an extracted Windows installer against the final local build before publishing.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import * as asar from '@electron/asar';
import { z } from 'zod';
const extracted = process.argv[2];
assert.ok(extracted, 'Pass the extracted installer app directory');
const version = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/)
  .parse(JSON.parse(readFileSync('package.json', 'utf8')).version);
const archive = path.join(extracted, 'resources/app.asar');
const packageInfo = JSON.parse(asar.extractFile(archive, 'package.json').toString());
assert.equal(packageInfo.version, version);
function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(path.join(directory, entry.name))
      : [path.join(directory, entry.name)],
  );
}
const buildFiles = [...walk('dist'), ...walk('dist-electron')];
for (const file of buildFiles)
  assert.ok(
    asar.extractFile(archive, file.replaceAll(path.sep, '/')).equals(readFileSync(file)),
    `Stale or missing packaged file: ${file}`,
  );
const headerHash = createHash('sha256')
  .update(asar.getRawHeader(archive).headerString)
  .digest('hex');
assert.ok(
  readFileSync(path.join(extracted, '天美意趣趣特管理.exe')).includes(Buffer.from(headerHash)),
  'EXE ASAR integrity mismatch',
);
const name = `TMY-TRI-Manager-${version}-x64-Setup.exe`,
  exe = readFileSync('release/' + name),
  manifest = readFileSync('release/latest.yml', 'utf8');
assert.match(manifest, new RegExp(`^version: ${version.replaceAll('.', '\\.')}$`, 'm'));
assert.equal(manifest.match(/^path: (.+)$/m)?.[1], name);
assert.equal(manifest.match(/- url: (.+)/)?.[1], name);
const sha512 = createHash('sha512').update(exe).digest('base64');
for (const match of manifest.matchAll(/sha512: (.+)/g)) assert.equal(match[1], sha512);
assert.equal(Number(manifest.match(/size: (\d+)/)?.[1]), exe.length);
const blockmap = z
  .object({
    version: z.string(),
    files: z.array(
      z.object({
        offset: z.number(),
        checksums: z.array(z.string()),
        sizes: z.array(z.number().positive()),
      }),
    ),
  })
  .parse(JSON.parse(gunzipSync(readFileSync('release/' + name + '.blockmap')).toString()));
for (const file of blockmap.files) assert.equal(file.checksums.length, file.sizes.length);
assert.equal(
  Math.max(...blockmap.files.map((file) => file.offset + file.sizes.reduce((a, b) => a + b, 0))),
  exe.length,
);
const files = [name, name + '.blockmap', 'latest.yml'].map((name) => {
  const data = readFileSync('release/' + name);
  return { name, size: data.length, sha256: createHash('sha256').update(data).digest('hex') };
});
writeFileSync(
  'release/SHA256SUMS-' + version,
  files.map((f) => `${f.sha256}  ${f.name}\n`).join(''),
);
const result = { version, comparedFiles: buildFiles.length, files };
writeFileSync('release/verification-' + version + '.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
