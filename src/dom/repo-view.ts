// The `repo` panel: a git repository as one step of a narrated explainer.
//
// This view draws nothing itself. The practical lessons already render a
// repository with GitGraph - graph, refs, and the three zones - so a theory step
// is that same picture held still. Reusing it is the point: the learner meets
// the exact surface they will type into next lesson, so nothing has to be
// re-learned when the keyboard appears.

import type { Panel, SyncCtx } from "./panel.js";
import { GitGraph } from "./git-graph-view.js";
import { resolveRepo } from "../core/repo-scene.js";
import { escapeHtml } from "../core/narration.js";

export class RepoView implements Panel {
  readonly el: HTMLElement;
  private readonly graphHost: HTMLElement;
  private readonly noteEl: HTMLElement;
  private readonly graph = new GitGraph();
  private mounted = false;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "cl-rp";
    this.graphHost = document.createElement("div");
    this.graphHost.className = "cl-rp-graph";
    this.noteEl = document.createElement("p");
    // Follows the `.cl-<scene>-cap` convention every other scene uses; the rule
    // still has to be added to the shared caption group in code-lab.css.
    this.noteEl.className = "cl-rp-cap";
    this.el.append(this.graphHost, this.noteEl);
  }

  sync(ctx: SyncCtx): void {
    const scene = resolveRepo(ctx.model.repo);
    if (!scene) return;
    const overlay = { ghost: scene.ghost, diverged: scene.diverged };
    // GitGraph builds its DOM on mount and diffs on setState, so mounting once
    // and stepping through setState is what gives the animated transitions the
    // practical lessons already have.
    if (!this.mounted) {
      this.graph.mount(this.graphHost, { state: scene.state, ...overlay });
      this.mounted = true;
    } else {
      this.graph.setState(scene.state, { animate: true, ...overlay });
    }
    this.noteEl.innerHTML = scene.note ? escapeHtml(scene.note) : "";
    this.noteEl.hidden = !scene.note;
  }
}
