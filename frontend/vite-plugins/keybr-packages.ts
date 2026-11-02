import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Vendored keybr.com engine packages (AGPL) resolve to their sources, in the
// app and in tests alike — see SoftwareRelease/docs/KEYBR_PORT_ARCHITECTURE.md.
const keybrDir = fileURLToPath(new URL("../src/keybr/@keybr", import.meta.url));

type Alias = { find: RegExp | string; replacement: string };

const entries = readdirSync(keybrDir, { withFileTypes: true }).filter(
  (entry) =>
    entry.isDirectory() &&
    //only packages with the upstream lib layout; the flat practice-state
    //directory gets its own alias below
    existsSync(`${keybrDir}/${entry.name}/lib/index.ts`),
);

export const keybrPackagesAlias: Alias[] = entries.flatMap((entry) => [
  {
    find: new RegExp(`^@keybr/${entry.name}$`),
    replacement: `${keybrDir}/${entry.name}/lib/index.ts`,
  },
  {
    find: new RegExp(`^@keybr/${entry.name}/assets/(.*)$`),
    replacement: `${keybrDir}/${entry.name}/assets/$1`,
  },
]);

// the vendored practice-page state machine (framework-free subset)
export const keybrStateAlias: Alias[] = [
  {
    find: "@keybr/practice-state",
    replacement: `${keybrDir}/practice-state/index.ts`,
  },
];
