// The `repo` panel: a git repository as one step of a narrated explainer.
//
// This view draws nothing itself. The practical lessons already render a
// repository with GitGraph - graph, refs, and the three zones - so a theory step
// is that same picture held still. Reusing it is the point: the learner meets the
// exact surface they will type into next lesson, so nothing has to be re-learned
// when the keyboard appears.
//
// The step gives commands, not a state, so the replay happens here (see
// repo-scene.ts for why). It runs the real git the practical lessons run.

import type { Panel, SyncCtx } from "./panel.js";
import { GitGraph } from "./git-graph-view.js";
import { resolveRepo } from "../core/repo-scene.js";
import { init, addFiles, type RepoState } from "../core/git-model.js";
import { run as runGit } from "../core/git-cli.js";
import { escapeHtml } from "../core/narration.js";

export class RepoView implements Panel {
  readonly el: HTMLElement;
  private readonly graphHost: HTMLElement;
  private readonly noteEl: HTMLElement;
  private readonly ranEl: HTMLElement;
  private readonly graph = new GitGraph();
  private mounted = false;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "cl-rp";
    this.graphHost = document.createElement("div");
    this.graphHost.className = "cl-rp-graph";
    this.noteEl = document.createElement("p");
    // Follows the `.cl-<scene>-cap` convention the other scenes use.
    this.noteEl.className = "cl-rp-cap";
    // The command strip sits ABOVE the board, because it is the cause and the
    // board is the effect - a learner reads "git switch feature", then sees where
    // HEAD ended up. Without it the picture changes and nothing says why.
    this.ranEl = document.createElement("p");
    this.ranEl.className = "cl-rp-ran";
    this.el.append(this.ranEl, this.graphHost, this.noteEl);
  }

  /** Replay a step's commands into the repository it describes. A command that
   *  errors is an authoring bug, not a learner mistake: it is reported and the
   *  replay continues, so the graph shows the shortfall instead of vanishing. */
  private build(files: string[], commands: string[]): RepoState {
    let state = files.length ? addFiles(init(), files).state : init();
    for (const line of commands) {
      let res;
      try {
        res = runGit(line, state);
      } catch (err) {
        console.warn(`repo scene: setup command failed - '${line}':`, err);
        continue;
      }
      if (res.error) console.warn(`repo scene: setup command failed - '${line}': ${res.output}`);
      if (res.state) state = res.state;
    }
    return state;
  }

  sync(ctx: SyncCtx): void {
    const scene = resolveRepo(ctx.model.repo);
    if (!scene) return;
    const state = this.build(scene.files, scene.commands);
    // GitGraph builds its DOM on mount and diffs on setState, so mounting once
    // and stepping through setState gives the same animated transitions the
    // practical lessons already have.
    if (!this.mounted) {
      this.graph.mount(this.graphHost, { state });
      this.mounted = true;
    } else {
      this.graph.setState(state, { animate: true });
    }
    this.noteEl.innerHTML = scene.note ? escapeHtml(scene.note) : "";
    this.noteEl.hidden = !scene.note;
    // Commands are never translated - they are what the learner types verbatim.
    this.ranEl.innerHTML = scene.ran
      .map((c) => `<code class="cl-rp-cmd">$ ${escapeHtml(c)}</code>`)
      .join("");
    this.ranEl.hidden = scene.ran.length === 0;
  }
}
