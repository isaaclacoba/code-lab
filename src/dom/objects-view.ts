// The `objects` panel: a git object store as one step of a narrated explainer.
//
// TWO PICTURES OF ONE STATE
// `folder` draws what is on disk - the point being that these are ordinary files
// you could open. `chain` draws who names whom, which the folder cannot show
// because a folder listing is alphabetical, not meaningful. `both` draws them
// together, for the step where a learner has to see they are the same thing.
//
// WHY THE CHAIN IS ROWS AND NOT BOXES WITH ARROWS
// Measured inside this widget: the visual panel is 562px at a 1440 viewport, and
// existing viz lessons run about 487px tall. A horizontal chain needs 664px and
// wraps into an unreadable order; a vertical stack of boxes reaches 721px and
// pushes the last object below the fold. Rows fit in 478px. Nesting would fit
// too, and would say a commit CONTAINS its parent - the one thing it does not do.
import type { Panel, SyncCtx } from "./panel.js";
import { escapeHtml } from "../core/narration.js";
import {
  chainRows,
  replayObjects,
  resolveObjects,
  short,
  type ChainRow,
  type Replay,
} from "../core/objects-scene.js";

export class ObjectsView implements Panel {
  readonly el: HTMLElement;
  private readonly folderEl: HTMLElement;
  private readonly chainEl: HTMLElement;
  private readonly noteEl: HTMLElement;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "cl-ob";
    this.folderEl = document.createElement("pre");
    this.folderEl.className = "cl-ob-folder";
    this.chainEl = document.createElement("div");
    this.chainEl.className = "cl-ob-chain";
    this.noteEl = document.createElement("p");
    // Follows the `.cl-<scene>-cap` convention the other scenes use.
    this.noteEl.className = "cl-ob-cap";
    this.el.append(this.folderEl, this.chainEl, this.noteEl);
  }

  sync(ctx: SyncCtx): void {
    const scene = resolveObjects(ctx.model.objects);
    if (!scene) return;
    const replay = replayObjects(scene);

    const wantsFolder = scene.lens === "folder" || scene.lens === "both";
    const wantsChain = scene.lens === "chain" || scene.lens === "both";
    this.folderEl.hidden = !wantsFolder;
    this.chainEl.hidden = !wantsChain;
    if (wantsFolder) this.folderEl.innerHTML = folderHtml(replay);
    if (wantsChain) this.chainEl.innerHTML = chainHtml(chainRows(replay));

    this.noteEl.innerHTML = scene.note ? escapeHtml(scene.note) : "";
    this.noteEl.hidden = !scene.note;
  }
}

/** The folder listing. Object ids are split the way git splits them on disk -
 *  two characters of directory, the rest of the name inside it. */
function folderHtml(replay: Replay): string {
  const { store, added } = replay;
  const lines: string[] = [".git/", "  objects/"];
  if (!store.objects.size) lines.push(`    ${dim("(empty)")}`);
  for (const [id, object] of store.objects) {
    const body = `${id.slice(0, 2)}/${id.slice(2, 8)}...  <span class="cl-ob-type">${object.type}</span>`;
    lines.push(`    ${added.has(id) ? `<span class="cl-ob-new">${body}</span>` : body}`);
  }
  lines.push("  refs/heads/");
  if (!store.refs.size) lines.push(`    ${dim("(no names yet)")}`);
  for (const [name, id] of store.refs) {
    lines.push(`    ${escapeHtml(name.replace(/^refs\/heads\//, ""))}   ${dim(short(id))}`);
  }
  lines.push(`  HEAD    ${dim(`-> ${store.head.kind === "ref" ? store.head.ref : short(store.head.id)}`)}`);
  if (store.index.size) {
    lines.push("  index");
    for (const [path, id] of store.index) {
      lines.push(`    ${dim(`${escapeHtml(path)}  ${short(id)}`)}`);
    }
  }
  if (store.worktree.size) {
    lines.push("", "your folder");
    for (const [path] of store.worktree) lines.push(`  ${escapeHtml(path)}`);
  }
  return lines.join("\n");
}

function dim(text: string): string {
  return `<span class="cl-ob-dim">${text}</span>`;
}

/** One row per object, each saying what it names. The `names` chip repeats the
 *  next row's id verbatim so a learner can follow it by eye rather than by
 *  trusting a line. */
function chainHtml(rows: ChainRow[]): string {
  if (!rows.length) return `<p class="cl-ob-empty">Nothing points at anything yet.</p>`;
  return rows
    .map((row) => {
      if (row.kind === "ref") {
        return `<span class="cl-ob-ref">${escapeHtml(row.label)}</span>`;
      }
      const classes = ["cl-ob-row"];
      if (row.fresh) classes.push("cl-ob-fresh");
      if (row.unreachable) classes.push("cl-ob-orphan");
      const names = row.names.length
        ? ` names ${row.names.map((id) => `<span class="cl-ob-names">${short(id)}</span>`).join(" ")}`
        : "";
      return (
        `<div class="${classes.join(" ")}">` +
        `<span class="cl-ob-kind">${escapeHtml(row.label)}</span>` +
        `<span class="cl-ob-id">${short(row.id)}</span>` +
        `<span class="cl-ob-body">${escapeHtml(row.body || "")}${names}</span>` +
        `</div>`
      );
    })
    .join("");
}
