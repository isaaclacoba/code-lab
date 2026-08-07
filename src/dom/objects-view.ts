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
import type { VizLabels, ResolvedModel } from "../core/memory-model.js";
import {
  chainRows,
  openObject,
  replayObjects,
  resolveObjects,
  short,
  type ChainRow,
  type Replay,
} from "../core/objects-scene.js";
import type { ObjectStore } from "../core/git-objects.js";

export class ObjectsView implements Panel {
  readonly el: HTMLElement;
  private readonly folderEl: HTMLElement;
  private readonly chainEl: HTMLElement;
  private readonly openEl: HTMLElement;
  private readonly noteEl: HTMLElement;
  private readonly labels: VizLabels;
  private prevStore: ObjectStore | null = null;

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
    if (wantsChain) this.chainEl.innerHTML = chainHtml(chainRows(replay), this.labels, replay.store);

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

    this.prevStore = replay.store;
  }

  /** Animate the transition between steps. Respects `prefers-reduced-motion`. */
  async animate(model: ResolvedModel): Promise<void> {
    const scene = resolveObjects(model.objects);
    if (!scene || !this.prevStore) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const replay = replayObjects(scene);
    const prevHead = this.prevStore.head;
    const currHead = replay.store.head;

    // Animate HEAD movement between branches - when HEAD moves from one ref to
    // another, fade the old marker out and the new one in.
    if (prevHead.kind === "ref" && currHead.kind === "ref" && prevHead.ref !== currHead.ref) {
      const oldMarker = this.folderEl.querySelector(`[data-head="${escapeAttr(prevHead.ref)}"]`) as HTMLElement | null;
      const newMarker = this.folderEl.querySelector(`[data-head="${escapeAttr(currHead.ref)}"]`) as HTMLElement | null;
      if (oldMarker && newMarker) {
        oldMarker.style.opacity = "0";
        newMarker.style.opacity = "1";
        newMarker.classList.add("cl-ob-head-moved");
        await sleep(600);
        newMarker.classList.remove("cl-ob-head-moved");
      }
    }
  }
}

const TINTS = 8;

/** Derive a tint class from an object id, so the same id carries the same colour
 *  everywhere - in the folder, on a ref, in `HEAD`, in the index, in the chain.
 *
 *  The colour comes from the object's POSITION in the store, not from a hash of
 *  the id. A hash collides: four buckets and three objects gave two of them the
 *  same tint, which tells the learner two different objects are the same thing -
 *  worse than no colour at all. The store is insertion-ordered and every scene
 *  replays from empty, so a position is both stable across steps and unique
 *  until the palette runs out. */
function tintClass(id: string, store: ObjectStore): string {
  let i = 0;
  for (const key of store.objects.keys()) {
    if (key === id) return `cl-ob-id-t${i % TINTS}`;
    i++;
  }
  return "cl-ob-id-t0";
}

/** Wrap an id with its tint class for hover pairing. */
function tintId(id: string, store: ObjectStore): string {
  return `<span class="cl-ob-id ${tintClass(id, store)}">${short(id)}</span>`;
}

/** Escape an attribute value for safe use in `data-*` or other HTML attributes. */
function escapeAttr(value: string): string {
  return value.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Sleep for animation timing. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    const tinted = `<span class="cl-ob-id ${tintClass(id, store)}">${id.slice(0, 2)}/${id.slice(2, 8)}...</span>`;
    const body = `${tinted}  <span class="cl-ob-type">${object.type}</span>`;
    lines.push(`    ${added.has(id) ? `<span class="cl-ob-new">${body}</span>` : body}`);
  }
  lines.push("  refs/heads/");
  if (!store.refs.size) lines.push(`    ${dim(escapeHtml(labels.objNoNames))}`);
  // Which ref does HEAD point to, if any? The HEAD marker sits beside that line.
  const headRef = store.head.kind === "ref" ? store.head.ref : null;
  for (const [name, id] of store.refs) {
    const shortName = escapeHtml(name.replace(/^refs\/heads\//, ""));
    const marker = headRef === name
      ? ` <span class="cl-ob-head" data-head="${escapeAttr(name)}">◂ HEAD</span>`
      : `<span class="cl-ob-head" data-head="${escapeAttr(name)}" style="opacity:0">◂ HEAD</span>`;
    lines.push(`    <span class="cl-ob-ref">${shortName}</span>   ${tintId(id, store)}${marker}`);
  }
  if (detail === "full") lines.push(`  ${dim("refs/tags/")}`);
  // HEAD is a text file holding one line, and that line is what it says here.
  // Drawing an arrow instead would be a rendering of the truth rather than the
  // truth, and this track's whole promise is that these are ordinary files.
  const headLine = store.head.kind === "ref"
    ? `ref: ${store.head.ref}`
    : tintId(store.head.id, store);
  lines.push(`  HEAD    ${dim(escapeHtml(headLine))}`);
  if (store.index.size) {
    lines.push("  index");
    for (const [path, id] of store.index) {
      lines.push(`    ${dim(`${escapeHtml(path)}  `)}${tintId(id, store)}`);
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
function chainHtml(rows: ChainRow[], labels: VizLabels, store: ObjectStore): string {
  if (!rows.length) return `<p class="cl-ob-empty">${escapeHtml(labels.objNothingYet)}</p>`;
  // Which ref does HEAD point to? The HEAD marker sits beside that ref's chip.
  const headRef = store.head.kind === "ref" ? store.head.ref : null;
  return rows
    .map((row) => {
      if (row.kind === "ref") {
        const shortName = escapeHtml(row.label);
        // Reconstruct the full ref name to compare with HEAD - the row's label is
        // the short name ("main") but HEAD holds the full path ("refs/heads/main").
        const fullRef = `refs/heads/${row.label}`;
        const marker = headRef === fullRef
          ? ` <span class="cl-ob-head" data-head="${escapeAttr(fullRef)}">◂ HEAD</span>`
          : `<span class="cl-ob-head" data-head="${escapeAttr(fullRef)}" style="opacity:0">◂ HEAD</span>`;
        return `<span class="cl-ob-ref">${shortName}</span>${marker}`;
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
                `<span class="cl-ob-names ${tintClass(n.id, store)}">${short(n.id)}</span>`,
            )
            .join(" ")}`
        : "";
      // Indentation is the quiet hint that this row belongs to the one above.
      const indent = row.depth > 0 ? ` style="margin-left:${row.depth * 1.1}rem"` : "";
      return (
        `<div class="${classes.join(" ")}"${indent}>` +
        `<span class="cl-ob-kind">${kind}</span>` +
        tintId(row.id, store) +
        `<span class="cl-ob-body">${escapeHtml(row.body || "")}${names}</span>` +
        `</div>`
      );
    })
    .join("");
}
