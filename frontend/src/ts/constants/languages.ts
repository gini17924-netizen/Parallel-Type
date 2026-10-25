import { Language, LanguageSchema } from "@monkeytype/schemas/languages";

export const LanguageList: Language[] = LanguageSchema._def.values;

/**
 * desktop offline build: only languages with bundled word lists are grouped
 * here (english, persian and code languages). The schema enum is untouched,
 * so this list is the single source of truth for what the UI offers.
 */
export const LanguageGroups: Record<string, Language[]> = {
  english: [
    "english",
    "english_1k",
    "english_5k",
    "english_10k",
    "english_25k",
    "english_450k",
    "english_commonly_misspelled",
    "english_contractions",
    "english_doubleletter",
    "english_shakespearean",
    "english_old",
    "english_medical",
    "english_legal",
  ],
  persian: [
    "persian",
    "persian_1k",
    "persian_5k",
    "persian_20k",
    "persian_romanized",
  ],
  code: [
    "code_python",
    "code_python_1k",
    "code_python_2k",
    "code_python_5k",
    "code_c",
    "code_css",
    "code_csharp",
    "code_c++",
    "code_dart",
    "code_brainfck",
    "code_fsharp",
    "code_javascript",
    "code_javascript_1k",
    "code_javascript_react",
    "code_jule",
    "code_julia",
    "code_haskell",
    "code_html",
    "code_nim",
    "code_nix",
    "code_pascal",
    "code_java",
    "code_kotlin",
    "code_go",
    "code_rockstar",
    "code_rust",
    "code_ruby",
    "code_r",
    "code_r_2k",
    "code_swift",
    "code_scala",
    "code_bash",
    "code_powershell",
    "code_lua",
    "code_luau",
    "code_latex",
    "code_typst",
    "code_matlab",
    "code_sql",
    "code_perl",
    "code_php",
    "code_vim",
    "code_vimscript",
    "code_opencl",
    "code_visual_basic",
    "code_arduino",
    "code_systemverilog",
    "code_elixir",
    "code_gleam",
    "code_zig",
    "code_gdscript",
    "code_gdscript_2",
    "code_assembly",
    "code_v",
    "code_ook",
    "code_typescript",
    "code_cobol",
    "code_clojure",
    "code_common_lisp",
    "code_erlang",
    "code_ocaml",
    "code_odin",
    "code_fortran",
    "code_abap",
    "code_abap_1k",
    "code_yoptascript",
    "code_cuda",
    "code_vhdl",
    "code_6502_assembly",
  ],
};

export type LanguageGroupName = keyof typeof LanguageGroups;
export const LanguageGroupNames: LanguageGroupName[] = Array.from(
  Object.keys(LanguageGroups),
);

/** every language that has a bundled word list in this build */
export const AvailableLanguageList: Language[] = Array.from(
  new Set(Object.values(LanguageGroups).flat()),
);

/**
 * Fetches the language group for a given language.
 * @param language The language code.
 * @returns the language group.
 */
export function getGroupForLanguage(
  language: Language,
): LanguageGroupName | undefined {
  return LanguageGroupNames.find((group) => group.includes(language));
}
