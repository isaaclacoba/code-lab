// The file panel under the git board: one file, read in one zone, with the
// zones that disagree marked. See `core/file-panel.ts` for why the disagreement
// is the thing worth showing.
//
// Labels here are English, matching the zone headings the board already draws.
// If those are ever localized, this reads from the same place.

import type { RepoState } from "../core/git-model.js";
import {
  resolveFilePanel,
  PANEL_ZONES,
  type PanelZone,
  type FilePanel,
} from "../core/file-panel.js";
import { escapeHtml } from "../core/narration.js";

const ZONE_LABEL: Record<PanelZone, string> = {
  tree: "Working tree",
  index: "Staging",
  repo: "Last commit",
};

/** Lower-case for use inside a sentence ("compared with staging"). */
const ZONE_PHRASE: Record<PanelZone, string> = {
  tree: "working tree",
  index: "staging",
  repo: "the last commit",
};

export class GitFilePanel {
  readonly el: HTMLElement;
  private path: string | null = null;
  private zone: PanelZone | null = null;
  private state: RepoState | null = null;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "cl-git-fp";
    this.el.addEventListener("click", this.onClick);
  }

  /** Repaint for a new repo state, keeping the learner's file and zone choice
   *  when they still make sense. */
  sync(state: RepoState): void {
    this.state = state;
    this.paint(resolveFilePanel(state, this.path, this.zone));
  }

  private readonly onClick = (ev: Event): void => {
    const t = (ev.target as HTMLElement | null)?.closest<HTMLElement>("[data-file],[data-zone]");
    if (!t || !this.state) return;
    if (t.dataset.file) {
      this.path = t.dataset.file;
      // A different file may not exist in the zone we were reading.
      this.zone = null;
    } else if (t.dataset.zone) {
      this.zone = t.dataset.zone as PanelZone;
    }
    this.paint(resolveFilePanel(this.state, this.path, this.zone));
  };

  private paint(p: FilePanel): void {
    if (p.path === null) {
      this.el.hidden = true;
      this.el.innerHTML = "";
      return;
    }
    this.el.hidden = false;
    // Keep the resolved choices, so the next sync starts from what is on screen.
    this.path = p.path;
    this.zone = p.selected;

    const chips = p.files
      .map(
        (f) =>
          `<button type="button" class="cl-git-fp-tab" data-file="${escapeHtml(f)}"` +
          ` aria-selected="${f === p.path}">${escapeHtml(f)}</button>`,
      )
      .join("");

    const zoneButtons = PANEL_ZONES.map((z) => {
      const copy = p.zones.find((c) => c.zone === z)!;
      const dot = copy.differs ? '<i class="cl-git-fp-dot" aria-hidden="true"></i>' : "";
      const title = copy.present
        ? copy.differs
          ? `${ZONE_LABEL[z]} - this copy differs from the one behind it`
          : ZONE_LABEL[z]
        : `${ZONE_LABEL[z]} - does not hold this file`;
      return (
        `<button type="button" class="cl-git-fp-zone" data-zone="${z}"` +
        ` aria-pressed="${z === p.selected}"${copy.present ? "" : " disabled"}` +
        ` title="${escapeHtml(title)}">${ZONE_LABEL[z]}${dot}</button>`
      );
    }).join("");

    const selected = p.zones.find((c) => c.zone === p.selected)!;
    const body = p.diff ? this.diffBody(p) : this.flatBody(selected.text);
    const foot = p.comparedWith
      ? `${ZONE_PHRASE[p.selected]}, compared with ${ZONE_PHRASE[p.comparedWith]}`
      : selected.present
        ? `${ZONE_PHRASE[p.selected]} - no change behind it`
        : "not in this zone";

    this.el.innerHTML =
      `<div class="cl-git-fp-tabs" role="tablist">${chips}</div>` +
      `<div class="cl-git-fp-box">` +
      `<div class="cl-git-fp-hd"><strong>${escapeHtml(p.path)}</strong>` +
      `<span class="cl-git-fp-seg">${zoneButtons}</span></div>` +
      body +
      `<div class="cl-git-fp-ft">${escapeHtml(foot)}</div>` +
      `</div>`;
  }

  private flatBody(text: string): string {
    const lines = text === "" ? [] : text.split("\n");
    if (lines.length === 0) {
      return `<pre class="cl-git-fp-body is-empty">(empty file)</pre>`;
    }
    return (
      `<pre class="cl-git-fp-body">` +
      lines
        .map((l, i) => `<span class="cl-git-fp-ln">${i + 1}</span>${escapeHtml(l)}`)
        .join("\n") +
      `</pre>`
    );
  }

  private diffBody(p: FilePanel): string {
    const cls = { " ": "", "-": " is-del", "+": " is-add" };
    return (
      `<pre class="cl-git-fp-body is-diff">` +
      p.diff!
        .map(
          (l) =>
            `<span class="cl-git-fp-line${cls[l.kind]}">` +
            `<span class="cl-git-fp-mark">${l.kind === " " ? "&nbsp;" : l.kind}</span>` +
            `${escapeHtml(l.text)}</span>`,
        )
        .join("\n") +
      `</pre>`
    );
  }
}
