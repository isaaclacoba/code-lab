// `echo ... > file` - the one way a lesson or a learner can change what is IN a
// file.
//
// Without it the git track has a hole it cannot teach around: every seeded file
// is untracked, nothing ever modifies a tracked one, and so `git diff` prints
// nothing on every card in the course and a merge conflict can never be built
// from two different edits. Measured before this existed: 20 of 20 cards had
// zero modified files.
//
// `echo` is the right shape for it because it is what the learner will actually
// see in every git tutorial they read next. Redirection is handled here rather
// than in the shell: `echo` is the only command in this course that writes, and
// a general redirection layer would be machinery with one caller.

import { edit, headCommit, fileAt, type RepoState } from "../../core/git-model.js";
import type { ShellCommand, ShellResult } from "../shell.js";

/** What the file holds right now, reading the way git does: the folder first,
 *  then the staged copy, then the last commit. */
function currentText(state: RepoState, path: string): string | null {
  const inTree = state.worktree.get(path);
  if (inTree) return inTree.text;
  if (state.index.has(path)) return state.index.get(path)!;
  return fileAt(state, headCommit(state), path);
}

/** `echo`, with `>` and `>>`. Without a redirection it just prints, like the
 *  real thing. */
export function echoCommand(): ShellCommand<RepoState> {
  return {
    name: "echo",
    summary: "Print a line, or write it into a file: echo \"text\" > notes.md",
    help() {
      return [
        "echo <text>              print it",
        "echo -e <text>           turn \\n into a real line break",
        "echo <text> > <file>     replace the file with it",
        "echo <text> >> <file>    add it as a new line at the end",
        "",
        "Quote text that has spaces in it.",
      ].join("\n");
    },
    run(argv: string[], state: RepoState): ShellResult<RepoState> {
      // `-e` turns \n into a real line break, exactly as it does in a shell.
      // A lesson needs it to seed a file with more than one line in it.
      const escapes = argv[0] === "-e";
      if (escapes) argv = argv.slice(1);
      const at = argv.findIndex((a) => a === ">" || a === ">>");
      const expand = (t: string): string =>
        escapes ? t.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\\\/g, "\\") : t;

      if (at < 0) return { state, output: expand(argv.join(" ")) };

      const path = argv[at + 1];
      if (!path) {
        return { state, output: `bash: syntax error near unexpected token 'newline'`, error: true };
      }
      if (argv.length > at + 2) {
        return { state, output: `bash: ${argv[at + 2]}: ambiguous redirect`, error: true };
      }

      const written = expand(argv.slice(0, at).join(" "));
      const append = argv[at] === ">>";
      const before = currentText(state, path);
      const text = append && before !== null && before !== "" ? `${before}\n${written}` : written;

      return { state: edit(state, path, text).state, output: "" };
    },
  };
}
