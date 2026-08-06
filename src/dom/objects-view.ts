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
import { DEFAULT_VIZ_LABELS } from "../core/memory-model.js";
import type { VizLabels } from "../core/memory-model.js";
import {
  chainRows,
  openObject,
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
  private readonly openEl: HTMLElement;
  private readonly noteEl: HTMLElement;
  private readonly labels: VizLabels;

  constructor(labels: VizLabels = DEFAULT_VIZ_LABELS) {
    this.labels = labels;
    this.el = document.createElement("div");
    this.el.className = "cl-ob";
    this.folderEl = document.createElement("pre");
    this.folderEl.className = "cl-ob-folder";
    this.chainEl = document.createElement("div");
    this.chainEl.className = "cl-ob-chain";
    this.openEl = document.createElement("pre");
    this.openEl.className = "cl-ob-open";
    this.noteEl = document.createElement("p");
    // Follows the `.cl-<scene>-cap` convention the other scenes use.
    this.noteEl.className = "cl-ob-cap";
    this.el.append(this.folderEl, this.chainEl, this.openEl, this.noteEl);
  }

  sync(ctx: SyncCtx): void {
    const scene = resolveObjects(ctx.model.objects);
    if (!scene) return;
    const replay = replayObjects(scene);

    const wantsFolder = scene.lens === "folder" || scene.lens === "both";
    const wantsChain = scene.lens === "chain" || scene.lens === "both";
    this.folderEl.hidden = !wantsFolder;
    this.chainEl.hidden = !wantsChain;
    if (wantsFolder) this.folderEl.innerHTML = folderHtml(replay, this.labels, scene.detail);
    if (wantsChain) this.chainEl.innerHTML = chainHtml(chainRows(replay), this.labels);

    const opened = scene.open ? openObject(replay, scene.open, scene.openRaw) : null;
    this.openEl.hidden = !opened;
    if (opened) {
      const rawHead = opened.header
        ? `<span class="cl-ob-rawhead">${escapeHtml(opened.header)}</span>\n`
        : "";
      this.openEl.innerHTML =
        `<span class="cl-ob-openhead">${escapeHtml(opened.type)} ${short(opened.id)}</span>\n` +
        rawHead + escapeHtml(opened.text);
    }

    this.noteEl.innerHTML = scene.note ? escapeHtml(scene.note) : "";
    this.noteEl.hidden = !scene.note;
  }
}

/** The folder listing. Object ids are split the way git splits them on disk -
 *  two characters of directory, the rest of the name inside it.
 *
 *  `full` adds everything else `git init` really creates. It is dimmed, because
 *  the point of showing it is that a learner opening a real `.git` finds no
 *  surprises - not that any of it matters yet. */
function folderHtml(replay: Replay, labels: VizLabels, detail: "core" | "full"): string {
  const { store, added } = replay;
  const lines: string[] = [".git/"];
  if (detail === "full") {
    lines.push(`  ${dim("config")}`, `  ${dim("description")}`, `  ${dim("hooks/")}`, `  ${dim("info/")}`);
  }
  lines.push("  objects/");
  if (detail === "full") lines.push(`    ${dim("info/")}`, `    ${dim("pack/")}`);
  if (!store.objects.size) lines.push(`    ${dim(escapeHtml(labels.objEmpty))}`);
  for (const [id, object] of store.objects) {
    const body = `${id.slice(0, 2)}/${id.slice(2, 8)}...  <span class="cl-ob-type">${object.type}</span>`;
    lines.push(`    ${added.has(id) ? `<span class="cl-ob-new">${body}</span>` : body}`);
  }
  lines.push("  refs/heads/");
  if (!store.refs.size) lines.push(`    ${dim(escapeHtml(labels.objNoNames))}`);
  for (const [name, id] of store.refs) {
    lines.push(`    ${escapeHtml(name.replace(/^refs\/heads\//, ""))}   ${dim(short(id))}`);
  }
  if (detail === "full") lines.push(`  ${dim("refs/tags/")}`);
  // HEAD is a text file holding one line, and that line is what it says here.
  // Drawing an arrow instead would be a rendering of the truth rather than the
  // truth, and this track's whole promise is that these are ordinary files.
  const headLine = store.head.kind === "ref"
    ? `ref: ${store.head.ref}`
    : short(store.head.id);
  lines.push(`  HEAD    ${dim(escapeHtml(headLine))}`);
  if (store.index.size) {
    lines.push("  index");
    for (const [path, id] of store.index) {
      lines.push(`    ${dim(`${escapeHtml(path)}  ${short(id)}`)}`);
    }
  }
  if (store.worktree.size) {
    lines.push("", escapeHtml(labels.objYourFolder));
    // Show each file's first line beside its name. Without it the learner has to
    // take the lesson's word for which files hold the same bytes - and "same
    // bytes, same name" is the one claim this track cannot ask anyone to take on
    // trust. Names are padded so the contents line up and two identical files
    // are obvious at a glance.
    const width = Math.max(...[...store.worktree.keys()].map((p) => p.length));
    for (const [path, text] of store.worktree) {
      const firstLine = text.split("\n")[0];
      const shown = firstLine.length > 30 ? `${firstLine.slice(0, 29)}\u2026` : firstLine;
      const pad = " ".repeat(width - path.length);
      lines.push(`  ${escapeHtml(path)}${pad}   ${dim(escapeHtml(shown))}`);
    }
  }
  return lines.join("\n");
}

function dim(text: string): string {
  return `<span class="cl-ob-dim">${text}</span>`;
}

/** One row per object, each saying what it names. The `names` chip repeats the
 *  next row's id verbatim so a learner can follow it by eye rather than by
 *  trusting a line. */
function chainHtml(rows: ChainRow[], labels: VizLabels): string {
  if (!rows.length) return `<p class="cl-ob-empty">${escapeHtml(labels.objNothingYet)}</p>`;
  return rows
    .map((row) => {
      if (row.kind === "ref") {
        return `<span class="cl-ob-ref">${escapeHtml(row.label)}</span>`;
      }
      const classes = ["cl-ob-row"];
      if (row.fresh) classes.push("cl-ob-fresh");
      if (row.unreachable) classes.push("cl-ob-orphan");
      // `blob`, `tree` and `commit` stay git's own words - the learner will meet
      // them verbatim in real git output. Only the qualifier around them moves.
      const kind = row.unreachable
        ? `${escapeHtml(row.label)} (${escapeHtml(labels.objUnnamed)})`
        : escapeHtml(row.label);
      // `tree` and `parent` are git's own field names and stay untranslated,
      // like `blob`. Without them two ids sit side by side looking identical.
      const names = row.names.length
        ? ` ${escapeHtml(labels.objNames)} ${row.names
            .map(
              (n) =>
                `<span class="cl-ob-role">${escapeHtml(n.role)}</span>` +
                `<span class="cl-ob-names">${short(n.id)}</span>`,
            )
            .join(" ")}`
        : "";
      // Indentation is the quiet hint that this row belongs to the one above.
      const indent = row.depth > 0 ? ` style="margin-left:${row.depth * 1.1}rem"` : "";
      return (
        `<div class="${classes.join(" ")}"${indent}>` +
        `<span class="cl-ob-kind">${kind}</span>` +
        `<span class="cl-ob-id">${short(row.id)}</span>` +
        `<span class="cl-ob-body">${escapeHtml(row.body || "")}${names}</span>` +
        `</div>`
      );
    })
    .join("");
}
