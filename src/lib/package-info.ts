import { readFileSync } from 'node:fs';

const pkgUrl = new URL('../../package.json', import.meta.url);

export const pkg = JSON.parse(readFileSync(pkgUrl, 'utf8')) as {
  name: string;
  version: string;
};
