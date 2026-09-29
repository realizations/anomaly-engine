/**
 * Records a SHA-256 digest of the deployed renderer.
 *
 * Worlds are data and cannot execute, but the bundle that draws them is code.
 * Writing a digest at build time and checking it at startup means a modified
 * install directory is detected rather than run, which is the difference between
 * "someone edited a file" and "something is now executing as this user".
 *
 * The digest covers every file under the renderer directory, sorted by relative
 * path, hashing the name and then the contents of each. The host computes it
 * the same way, so the two must stay in step: if this changes, so must
 * ComputeDirectoryDigest in WallpaperHost.cs.
 *
 *   node tools/write-bundle-digest.mjs <renderer-dir> <output-file>
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? 'src/AnomalyEngine/bin/Debug/net8.0-windows/renderer');
const out = resolve(process.argv[3] ?? 'src/AnomalyEngine/bin/Debug/net8.0-windows/renderer.bundle.sha256');

/** Every file under the directory, sorted by relative path for stability. */
function walk(base, current = base) {
  const found = [];
  for (const name of readdirSync(current)) {
    const p = join(current, name);
    if (statSync(p).isDirectory()) found.push(...walk(base, p));
    else found.push(p);
  }
  return found;
}

const files = walk(dir).sort((a, b) =>
  relative(dir, a).toLowerCase() < relative(dir, b).toLowerCase() ? -1 : 1
);

const sha = createHash('sha256');
for (const file of files) {
  const rel = relative(dir, file).replace(/\\/g, '/');
  sha.update(Buffer.from(rel, 'utf8'));
  sha.update(readFileSync(file));
}
const digest = sha.digest('hex');

writeFileSync(out, `${digest}\n`, 'utf8');
console.log(`Wrote ${relative(process.cwd(), out)}`);
console.log(`  ${files.length} files, sha256 ${digest}`);
