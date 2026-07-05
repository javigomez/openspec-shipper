import { runCli } from "./src/infrastructure/cli.js";

await runCli(process.argv.slice(2));
