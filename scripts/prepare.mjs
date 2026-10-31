import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

if (process.env.HUSKY === '0' || !existsSync('.git')) {
  process.exit(0);
}

let huskyBin;
try {
  const huskyEntry = createRequire(import.meta.url).resolve('husky');
  huskyBin = join(dirname(huskyEntry), 'bin.js');
} catch {
  process.exit(0);
}

const result = spawnSync(process.execPath, [huskyBin], { stdio: 'inherit' });
process.exit(result.status ?? 1);
