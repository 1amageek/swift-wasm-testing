#!/usr/bin/env node
// swift-wasm-testing — CLI driver.
//
// Subcommands:
//   run   Boot a .wasm smoke in headless Chromium and emit TAP.
//
// Exit codes:
//   0  all tests passed and runner reported success
//   1  any failure (runner error, test failure, timeout, unparsable args)
//   2  unknown subcommand

import { runCommand } from "../cli/run.mjs";

const USAGE = `\
usage: swift-wasm-testing <command> [options]

Commands:
  run     Boot a WASM smoke in headless Chromium and emit TAP output.

Run \`swift-wasm-testing <command> --help\` for command-specific options.
`;

async function main() {
    const [, , cmd, ...rest] = process.argv;
    if (!cmd || cmd === "-h" || cmd === "--help") {
        process.stdout.write(USAGE);
        process.exit(cmd ? 0 : 1);
    }
    switch (cmd) {
        case "run": {
            const code = await runCommand(rest);
            process.exit(code);
        }
        default:
            process.stderr.write(`unknown command: ${cmd}\n`);
            process.stderr.write(USAGE);
            process.exit(2);
    }
}

main().catch((err) => {
    process.stderr.write(`[swift-wasm-testing] fatal: ${err?.message ?? err}\n`);
    process.exit(1);
});
