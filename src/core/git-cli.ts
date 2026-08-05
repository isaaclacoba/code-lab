// Backwards-compatible entry point for the teaching git command line.
//
// The implementation moved to `../terminal/commands/git.ts`, where git is one
// command set among others in the terminal's `Shell`. This module stays because
// consumers already call it with a whole typed LINE - the course's git plugin
// and the Node lesson verifier both go through `CodeLab.gitRun(line, state)` -
// so it keeps that signature and does the only thing the shell would do first:
// split the line into words, then hand them to the git command.
//
// Tokenizing lives in the shell now, so there is no copy of it here.

import { tokenizeLine } from "../terminal/shell.js";
import { runGit, type GitRunResult } from "../terminal/commands/git.js";
import { echoCommand } from "../terminal/commands/echo.js";
import type { RepoState } from "./git-model.js";

/** The uniform result of running one command line. */
export type RunResult = GitRunResult;

const ECHO = echoCommand();

/**
 * Run one git command line against a RepoState.
 *
 * @param line  the raw command, e.g. `git commit -m "add readme"`. The leading
 *              `git` is optional.
 * @param state the current repository state (never mutated).
 * @returns the new state + terminal output + the op's Effect (+ `error` on failure).
 */
export function run(line: string, state: RepoState): RunResult {
  const { tokens, error } = tokenizeLine(line);
  // An unclosed quote is a broken line, not a command with a lucky ending.
  if (error) return { state, output: error, error, effect: { kind: "none" } };
  if (tokens.length === 0) return { state, output: "", effect: { kind: "none" } };

  // `echo ... > file` is the only way anything changes what is INSIDE a file,
  // so it has to be reachable from here: the course plugin and the Node lesson
  // verifier both drive lessons through this one entry point, not through the
  // interactive Shell.
  if (tokens[0] === "echo") {
    const r = ECHO.run(tokens.slice(1), state);
    // The shell reports failure as a flag; this entry point reports it as the
    // message, which is what the course paints.
    return {
      state: r.state,
      output: r.output,
      error: r.error ? r.output : undefined,
      effect: { kind: "none" },
    };
  }

  return runGit(tokens, state);
}
