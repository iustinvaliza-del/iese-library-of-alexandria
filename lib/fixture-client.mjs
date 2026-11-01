// @ts-check
// A Blackboard client answered from a JSON fixture, for `collect --dry` and the tests.
// Fixture shape: { routes: { "<api path>": <response json> }, files: { "<download path>": "<text>" } }
import { readFileSync } from 'node:fs';

export const DRY_FIXTURE = new URL('../test/fixtures/blackboard.json', import.meta.url);

export function fixtureClient(fixture = JSON.parse(readFileSync(DRY_FIXTURE, 'utf-8'))) {
  const notFound = path => Object.assign(new Error(`HTTP 404 ${path}`), { status: 404 });
  return {
    async get(path) {
      if (!(path in fixture.routes)) throw notFound(path);
      return { data: fixture.routes[path] };
    },
    async download(path) {
      if (!(path in fixture.files)) throw notFound(path);
      return Buffer.from(fixture.files[path]);
    },
  };
}
