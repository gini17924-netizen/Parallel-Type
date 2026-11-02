// Regenerates frontend/src/keybr/@keybr/* from the local keybr.com snapshot.
// Idempotent: wipes and re-copies everything, then applies the post-patches.
// Run from the repo root:  node scripts/vendor-keybr.mjs
// Requires the keybr.com snapshot at ../keybr.com (sibling of this repo).
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(import.meta.dirname, "../../../keybr.com/packages");
const DEST = path.resolve(import.meta.dirname, "../frontend/src/keybr/@keybr");

const PACKAGES = [
  "keybr-lang",
  "keybr-math",
  "keybr-rand",
  "keybr-unicode",
  "keybr-keyboard",
  "keybr-phonetic-model",
  "keybr-lesson",
  "keybr-content",
  "keybr-content-words",
  "keybr-result",
  "keybr-settings",
  "keybr-textinput",
  "keybr-textinput-events",
  "keybr-code",
  "keybr-binary",
];

//files never vendored (React-bound or CLI-only)
const EXCLUDE = new Set([
  "keybr-keyboard/lib/context.tsx",
  "keybr-keyboard/lib/use-formatted-names.ts",
  "keybr-phonetic-model/lib/example.ts",
  "keybr-phonetic-model/lib/example-letter-count.ts",
  "keybr-phonetic-model/lib/Alphabet.tsx",
  "keybr-phonetic-model/lib/PhoneticModelLoader.tsx",
  "keybr-phonetic-model/lib/context.ts",
  "keybr-content/lib/books/BookPreview.tsx",
  "keybr-content/lib/books/BookSelector.tsx",
  "keybr-content/lib/books/ParagraphPreview.tsx",
  "keybr-content/lib/books/ParagraphSelector.tsx",
  "keybr-settings/lib/fake.tsx",
  "keybr-result/lib/fake.tsx",
  "keybr-textinput-events/lib/TextEvents.tsx",
  "keybr-textinput-events/lib/use-depressed-keys.ts",
  "keybr-code/lib/compile.ts",
  "keybr-code/lib/example.ts",
  "keybr-binary/lib/Dir.tsx",
]);

fs.rmSync(DEST, { recursive: true, force: true });

let totalFiles = 0;
const excluded = [];

for (const pkg of PACKAGES) {
  const pkgJson = JSON.parse(
    fs.readFileSync(path.join(SRC, pkg, "package.json"), "utf8"),
  );
  const shortName = pkgJson.name.replace("@keybr/", "");
  const srcDir = path.join(SRC, pkg, "lib");
  const destDir = path.join(DEST, shortName, "lib");

  function copyDir(dir, destDir) {
    fs.mkdirSync(destDir, { recursive: true });
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const src = path.join(dir, entry.name);
      const dst = path.join(destDir, entry.name);
      if (entry.isDirectory()) {
        copyDir(src, dst);
        continue;
      }
      const rel = `${pkg}/lib/${path.relative(srcDir, src).split(path.sep).join("/")}`;
      if (
        entry.name.endsWith(".tsx") ||
        entry.name.includes(".test.") ||
        EXCLUDE.has(rel)
      ) {
        excluded.push(rel);
        continue;
      }
      fs.copyFileSync(src, dst);
      totalFiles++;
    }
  }
  copyDir(srcDir, destDir);

  //assets that live at the package root (relative ../../assets refs resolve)
  const pkgAssets = path.join(SRC, pkg, "assets");
  if (fs.existsSync(pkgAssets)) {
    fs.cpSync(pkgAssets, path.join(DEST, shortName, "assets"), {
      recursive: true,
    });
  }

  //strip re-exports/imports of excluded files
  function stripRefs(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stripRefs(file);
        continue;
      }
      if (!entry.name.endsWith(".ts")) continue;
      let content = fs.readFileSync(file, "utf8");
      const lines = content.split(/\r?\n/).filter((line) => {
        if (/\.tsx["']|\.test\.ts["']/.test(line)) return false;
        for (const bad of EXCLUDE) {
          const base = path.basename(bad);
          if (line.includes(base) && line.includes(`./${base}`)) return false;
        }
        return true;
      });
      const next = lines.join("\n");
      if (next !== content) fs.writeFileSync(file, next);
    }
  }
  stripRefs(destDir);

  fs.writeFileSync(
    path.join(DEST, shortName, "VENDORED.md"),
    `Vendored verbatim from keybr.com (AGPL-3.0), package ${pkgJson.name}. React-bound *.tsx files and upstream tests removed; re-exports stripped. See SoftwareRelease/docs/KEYBR_PORT_ARCHITECTURE.md.`,
  );
  console.log(`vendored ${pkgJson.name} -> @keybr/${shortName}`);
}

//stubs for the two leaf packages whose full sources are React-bound
fs.mkdirSync(path.join(DEST, "themes", "lib"), { recursive: true });
fs.copyFileSync(
  path.join(SRC, "keybr-themes/lib/fonts/index.ts"),
  path.join(DEST, "themes/lib/index.ts"),
);
{
  const f = path.join(DEST, "themes/lib/index.ts");
  let s = fs.readFileSync(f, "utf8");
  s = s.replace(
    'import { type CSSProperties } from "react";',
    "type CSSProperties = Record<string, string | number>;",
  );
  fs.writeFileSync(f, s);
}
fs.mkdirSync(path.join(DEST, "widget", "lib"), { recursive: true });
fs.writeFileSync(
  path.join(DEST, "widget/lib/index.ts"),
  "export type Focusable = { focus(): void };\n",
);

//practice state machine (framework-free subset of page-practice)
const stateDir = path.join(SRC, "page-practice/lib/practice/state");
const stateDest = path.join(DEST, "practice-state");
fs.mkdirSync(stateDest, { recursive: true });
for (const entry of fs.readdirSync(stateDir)) {
  if (entry.endsWith(".ts") && !entry.includes(".test.")) {
    fs.copyFileSync(path.join(stateDir, entry), path.join(stateDest, entry));
  }
}
//strip the React-bound EventAlert re-export
fs.writeFileSync(
  path.join(stateDest, "index.ts"),
  [
    "// @ts-nocheck -- vendored from keybr.com (AGPL); React-bound EventAlert re-exports stripped",
    'export * from "./event-types.ts";',
    'export * from "./last-lesson.ts";',
    'export * from "./lesson-state.ts";',
    'export * from "./progress.ts";',
    "",
  ].join("\n"),
);

//de-react result/lib/speedunit.ts (react-intl → local stub)
{
  const f = path.join(DEST, "result/lib/speedunit.ts");
  let c = fs.readFileSync(f, "utf8");
  c = c.replace(
    'import { defineMessage, type MessageDescriptor } from "react-intl";',
    "type MessageDescriptor = { id: string; defaultMessage?: string };\nconst defineMessage = <T,>(value: T): T => value;",
  );
  fs.writeFileSync(f, c);
}

//suppress typechecking inside vendored files (upstream strictness differs:
//no noUncheckedIndexedAccess etc. — the app tsconfig is stricter)
let nochecked = 0;
function applyNocheck(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      applyNocheck(f);
      continue;
    }
    if (entry.name.endsWith(".ts")) {
      const c = fs.readFileSync(f, "utf8");
      if (!c.startsWith("// @ts-nocheck")) {
        fs.writeFileSync(
          f,
          "// @ts-nocheck -- vendored from keybr.com (AGPL); typechecked upstream with a different strictness profile\n" +
            c,
        );
        nochecked++;
      }
    }
  }
}
applyNocheck(DEST);

console.log(
  `total files: ${totalFiles}, ts-nocheck: ${nochecked}, excluded: ${excluded.length}`,
);
fs.writeFileSync(path.join(DEST, "EXCLUDED.txt"), excluded.sort().join("\n"));
