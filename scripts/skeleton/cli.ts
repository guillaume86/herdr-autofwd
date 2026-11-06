#!/usr/bin/env node
import { parseArgs } from "node:util";
import { nodeHost } from "../../hosts/node.ts";
import { formatInfo, info } from "./core.ts";

const HELP = `Usage: __name__ [options]

Options:
      --on <machine> Run on that herdr-core machine (hc machine ls)
      --json         JSON output
  -h, --help         This help`;

async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      on: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  const i = await info(nodeHost, { on: values.on ?? null });
  for (const line of values.json ? [JSON.stringify(i, null, 2)] : formatInfo(i)) console.log(line);
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(`__name__: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  },
);
