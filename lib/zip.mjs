// @ts-check
import { Zip, ZipDeflate } from 'fflate';
import { openSync, writeSync, closeSync, readFileSync, renameSync, rmSync, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';

/**
 * Writes a zip from entries [{ name, data?: Uint8Array, file?: string }], one file in memory
 * at a time. The zip appears at zipPath only when complete, so a killed run never leaves a
 * half-written zip that looks finished.
 */
export function writeZip(zipPath, entries) {
  const partial = `${zipPath}.partial`;
  const fd = openSync(partial, 'w');
  let failure = null;
  try {
    // ZipDeflate is synchronous, so the callback runs in order inside push()/end().
    const zip = new Zip((err, chunk) => {
      if (err) failure = err;
      else writeSync(fd, chunk);
    });
    for (const entry of entries) {
      const member = new ZipDeflate(entry.name, { level: 6 });
      zip.add(member);
      member.push(entry.data ?? readFileSync(entry.file), true);
      if (failure) throw failure;
    }
    zip.end();
    if (failure) throw failure;
  } catch (e) {
    closeSync(fd);
    rmSync(partial, { force: true });
    throw e;
  }
  closeSync(fd);
  renameSync(partial, zipPath);
}

export function sha256File(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', chunk => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}
