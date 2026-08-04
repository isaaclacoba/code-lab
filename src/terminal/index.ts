// The terminal module: a command-running console.
//
// `Shell` is the emulator core - tokenizing, dispatch, `help`, `clear`, error
// handling - and it is generic over the state your commands act on. A command
// set (git, files, anything) is just a `ShellCommand` you register. `LineTerminal`
// is the view; `CommandHistory` is the readline recall behind its arrow keys.

export { Shell, tokenize, editDistance } from "./shell.js";
export type { ShellCommand, ShellResult, ClearEffect } from "./shell.js";

export { LineTerminal } from "./line-terminal.js";
export type { LineTerminalOptions, LineKind } from "./line-terminal.js";

export { CommandHistory } from "./history.js";
