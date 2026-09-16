#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { parseArgs, USAGE } from "../src/cli.js";
import { UserError } from "../src/errors.js";
import { run } from "../src/run.js";

const here = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    process.stdout.write(USAGE);
    return;
  }
  if (options.version) {
    const pkg = JSON.parse(await readFile(path.join(here, "..", "package.json"), "utf8"));
    process.stdout.write(`${pkg.version}\n`);
    return;
  }

  await run(options);
}

main().catch((error) => {
  if (error instanceof UserError) {
    process.stderr.write(`jhhzzy: error: ${error.message}\n`);
    if (error.hint) process.stderr.write(`jhhzzy: hint: ${error.hint}\n`);
    process.exitCode = 1;
    return;
  }
  process.stderr.write(`jhhzzy: unexpected error: ${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
