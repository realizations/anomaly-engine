/**
 * Verifies a downloaded font file and prints its real family and style.
 *
 * Deliberately reads the sfnt table directory and the name table rather than
 * trusting the filename or the download URL. A licence record that names the
 * wrong file is worse than no record, because it looks verified.
 *
 *   node tools/verify-fonts.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolved from this file, not from the working directory, because the tools
// runner invokes everything with cwd set to tools/.
const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(HERE, '../assets/fonts');

/** Offsets into the name table, per the OpenType spec. */
const NAME_IDS = { copyright: 0, family: 1, subfamily: 2, full: 4, version: 5, license: 13 };

function readNames(buf) {
  const numTables = buf.readUInt16BE(4);
  let nameOff = -1;
  let nameLen = 0;
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    const tag = buf.toString('ascii', rec, rec + 4);
    if (tag === 'name') {
      nameOff = buf.readUInt32BE(rec + 8);
      nameLen = buf.readUInt32BE(rec + 12);
    }
  }
  if (nameOff < 0) return null;
  const count = buf.readUInt16BE(nameOff + 2);
  const stringOffset = nameOff + buf.readUInt16BE(nameOff + 4);
  const out = {};
  for (let i = 0; i < count; i++) {
    const rec = nameOff + 6 + i * 12;
    const platform = buf.readUInt16BE(rec);
    const nameId = buf.readUInt16BE(rec + 6);
    const len = buf.readUInt16BE(rec + 8);
    const off = buf.readUInt16BE(rec + 10);
    const key = Object.keys(NAME_IDS).find((k) => NAME_IDS[k] === nameId);
    if (!key || out[key]) continue;
    // Platform 3 is Windows/Unicode, stored UTF-16BE. Node only has utf16le,
    // so the bytes have to be swapped before decoding.
    if (platform === 3) {
      const slice = Buffer.from(buf.subarray(stringOffset + off, stringOffset + off + len));
      out[key] = slice.swap16().toString('utf16le');
    } else if (platform === 1) {
      out[key] = buf.toString('latin1', stringOffset + off, stringOffset + off + len);
    }
  }
  return out;
}

let failures = 0;
console.log('file                      family                 style            version');
console.log('-------------------------------------------------------------------------');
for (const file of readdirSync(DIR).filter((f) => f.endsWith('.ttf') || f.endsWith('.otf')).sort()) {
  const buf = readFileSync(join(DIR, file));
  const sfnt = buf.readUInt32BE(0);
  const kind = sfnt === 0x00010000 ? 'TrueType' : sfnt === 0x4f54544f ? 'OTTO' : sfnt === 0x74746366 ? 'TTC' : 'unknown';
  if (kind === 'unknown') {
    console.error(`FAIL  ${file}: unrecognised sfnt version 0x${sfnt.toString(16)}`);
    failures++;
    continue;
  }
  const names = readNames(buf);
  if (!names?.family) {
    console.error(`FAIL  ${file}: no readable name table`);
    failures++;
    continue;
  }
  const version = (names.version ?? '').split(':').pop()?.trim() ?? '?';
  console.log(
    `${file.padEnd(25)} ${(names.family ?? '').padEnd(21)} `
    + `${(names.subfamily ?? '').padEnd(16)} ${version}`
  );
}

console.log('');
if (failures) {
  console.error(`FAIL  ${failures} font file(s) did not parse.`);
  process.exit(1);
}
console.log('PASS  every font file parses and declares a family and style.');
