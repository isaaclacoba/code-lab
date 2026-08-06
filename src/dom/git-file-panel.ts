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
import { hasConflictMarkers, resolveConflicts, type ConflictChoice } from "../core/conflict-file.js";
import { loadMonaco } from "../editors/load-monaco.js";
import { MonacoEditor } from "../editors/monaco.js";

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
  /** null = decide from the repo; true/false = the learner said so. */
  private open: boolean | null = null;
  private editHandler: ((path: string, text: string) => void) | null = null;
  private editor: MonacoEditor | null = null;
  /** The path Monaco is currently mounted for, so it is not torn down on every
   *  repaint while the learner is typing in it. */
  private editorPath: string | null = null;

  /** Told when the learner writes a file. */
  onEdit(fn: (path: string, text: string) => void): void {
    this.editHandler = fn;
  }

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
    const t = (ev.target as HTMLElement | null)?.closest<HTMLElement>(
      "[data-file],[data-zone],[data-toggle],[data-keep],[data-save]",
    );
    if (!t || !this.state) return;
    if (t.dataset.keep) {
      const path = t.dataset.path!;
      const text = this.currentConflictText(path);
      if (text !== null && this.editHandler) {
        this.editHandler(path, resolveConflicts(text, t.dataset.keep as ConflictChoice));
      }
      return;
    }
    if (t.dataset.save) {
      const path = t.dataset.path!;
      if (this.editor && this.editHandler) this.editHandler(path, this.editor.getValue());
      return;
    }
    if (t.dataset.toggle) {
      this.open = t.getAttribute("aria-expanded") !== "true";
    } else if (t.dataset.file) {
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
    // Remember the FILE, so a repaint does not jump to another one. Do NOT
    // remember the zone: leaving it null lets each repaint land on whichever
    // copy now disagrees. Pinning it here made the panel sticky, so a lesson
    // that moves work between zones showed the learner a stale, flat file.
    this.path = p.path;

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

    // Worth opening only when there is something to compare. A file that
    // reads the same in every zone teaches nothing by being on screen all the
    // time, so it collapses to one line and stays one click away. The learner's
    // own choice always wins once they have made one.
    const anyDifference = p.zones.some((z) => z.differs);
    const expanded = this.open === null ? anyDifference : this.open;

    const selected = p.zones.find((c) => c.zone === p.selected)!;
    // A file git left markers in is the one case where reading is not enough -
    // the learner has to change it before the merge can finish. It gets a real
    // editor and the three shortcuts, rather than a read-only view of a problem.
    const conflicted =
      p.selected === "tree" && selected.present && hasConflictMarkers(selected.text);
    const body = conflicted
      ? this.conflictBody(p.path)
      : p.diff
        ? this.diffBody(p)
        : this.flatBody(selected.text);
    const foot = p.comparedWith
      ? `${ZONE_PHRASE[p.selected]}, compared with ${ZONE_PHRASE[p.comparedWith]}`
      : selected.present
        ? `${ZONE_PHRASE[p.selected]} - no change behind it`
        : "not in this zone";

    const summary = anyDifference
      ? `${p.files.length > 1 ? escapeHtml(p.path) + " - " : ""}the copies differ`
      : "the files read the same everywhere";
    const toggle =
      `<button type="button" class="cl-git-fp-toggle" data-toggle="1"` +
      ` aria-expanded="${expanded}">` +
      `<span class="cl-git-fp-caret" aria-hidden="true"></span>` +
      `<span>File contents</span>` +
      `<span class="cl-git-fp-summary">${summary}</span>` +
      `</button>`;

    this.el.innerHTML =
      toggle +
      (expanded
        ? `<div class="cl-git-fp-tabs" role="tablist">${chips}</div>` +
          `<div class="cl-git-fp-box">` +
          `<div class="cl-git-fp-hd"><strong>${escapeHtml(p.path)}</strong>` +
          `<span class="cl-git-fp-seg">${zoneButtons}</span></div>` +
          body +
          `<div class="cl-git-fp-ft">${escapeHtml(foot)}</div>` +
          `</div>`
        : "");

    if (expanded && conflicted) this.mountEditor(p.path, selected.text);
    else { this.editor = null; this.editorPath = null; }
  }

  /** The shell the editor mounts into, plus the shortcuts. */
  private conflictBody(path: string): string {
    const p = escapeHtml(path);
    return (
      `<div class="cl-git-fp-conflict">` +
      `<div class="cl-git-fp-actions">` +
      `<span class="cl-git-fp-note">Git could not choose. Leave the lines you want.</span>` +
      `<button type="button" class="cl-git-fp-keep" data-keep="ours" data-path="${p}">Keep ours</button>` +
      `<button type="button" class="cl-git-fp-keep" data-keep="theirs" data-path="${p}">Keep theirs</button>` +
      `<button type="button" class="cl-git-fp-keep" data-keep="both" data-path="${p}">Keep both</button>` +
      `</div>` +
      `<div class="cl-git-fp-editor" data-editor-host="1"></div>` +
      `<div class="cl-git-fp-actions is-end">` +
      `<button type="button" class="cl-git-fp-save" data-save="1" data-path="${p}">Save the file</button>` +
      `</div>` +
      `</div>`
    );
  }

  /** Mount Monaco once per file. Re-mounting on every repaint would take the
   *  cursor away mid-word, so an editor already showing this path is left be. */
  private mountEditor(path: string, text: string): void {
    const host = this.el.querySelector<HTMLElement>("[data-editor-host]");
    if (!host) return;
    if (this.editorPath === path && this.editor) {
      // Same file, new paint: put the text back only if the repo moved on.
      if (this.editor.getValue() !== text) this.editor.setValue(text);
      return;
    }
    this.editorPath = path;
    const editor = new MonacoEditor();
    this.editor = editor;
    void loadMonaco()
      // Wrap: this panel is narrow (it shares a card with the graph and the
      // terminal) and the buffer is prose with conflict markers, not code. A
      // learner should never have to scroll sideways to read the line they are
      // being asked to fix.
      .then(() =>
        editor.mount(host, {
          value: text,
          language: "plaintext",
          readOnly: false,
          wordWrap: true,
        }),
      )
      .catch(() => {
        // No Monaco (offline, blocked CDN) must not mean no way to resolve: the
        // three buttons above still work, and they are enough to finish.
        host.innerHTML =
          `<pre class="cl-git-fp-body">${escapeHtml(text)}</pre>` +
          `<p class="cl-git-fp-ft">The editor could not load - use the buttons above.</p>`;
        this.editor = null;
      });
  }

  /** The marked-up text as it stands, for the shortcut buttons. */
  private currentConflictText(path: string): string | null {
    if (this.editor) return this.editor.getValue();
    return this.state?.worktree.get(path)?.text ?? null;
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
