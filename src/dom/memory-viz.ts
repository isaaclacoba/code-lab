// MemoryViz: the facade + composer. It builds panels from the injected layout
// (or a sensible default derived from the scene), lays them out as a two-column
// stage (visual + reading rail), and drives every panel through the shared
// player. New element combinations - board-only, swapped backgrounds, a merged
// code editor - are pure configuration: add a panel type here, place it in a
// lesson's layout, done.

import type {
  MemoryVizConfig,
  PanelSpec,
  RegionName,
  VizAction,
} from "../core/memory-model.js";
import { ALL_REGIONS } from "../core/memory-model.js";
import { VizPlayer } from "../core/viz-player.js";
import type { PlayerState } from "../core/viz-player.js";
import type { Panel, SyncCtx } from "./panel.js";
import { BoardView } from "./board-view.js";
import { MemoryDieView } from "./memory-die-view.js";
import { CodePanel } from "./code-panel.js";
import { NarrationView } from "./narration-view.js";
import { VizControls } from "./viz-controls.js";
import type { VizControlsHandlers } from "./viz-controls.js";

interface PanelBuildCtx {
  uid: number;
  code: string[];
  labels: { chipName: string; chipAddr: string };
  regions: RegionName[];
  zoomTab: boolean;
  actions: VizAction[];
  handlers: VizControlsHandlers;
  regionTags: Partial<Record<RegionName, string>>;
  nextHref?: string;
}

let instanceSeq = 0;
const WORDS_PER_MINUTE = 300;
const MIN_STEP_MS = 2600;

export class MemoryViz {
  private readonly root: HTMLElement;
  private readonly player: VizPlayer;
  private readonly panels: Panel[] = [];
  private readonly actions: VizAction[];
  private controls: VizControls | null = null;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private playing = false;
  private scale = 1;
  private readonly nextHref?: string;
  private readonly awardedKey?: string;
  private readonly xpKey: string;
  private readonly awardAmount: number;
  private awarded = false;

  private constructor(host: HTMLElement, config: MemoryVizConfig) {
    const uid = instanceSeq++;
    const scene = config.scene ?? {};
    const regions = scene.regions ?? ALL_REGIONS;
    const showBoard = scene.board !== false;
    const zoomTab = scene.zoomTab !== false;

    this.actions = config.actions ?? [];
    this.nextHref = config.nextHref;
    this.awardedKey = config.awardedKey;
    this.xpKey = config.xpKey ?? "course_global_xp";
    this.awardAmount = typeof config.awardAmount === "number" ? config.awardAmount : 20;
    this.player = new VizPlayer(config.steps ?? [], {
      deriveRefs: config.deriveRefs !== false,
      autoDim: config.autoDim !== false,
    });
    this.scale = config.fontScale ?? 1;

    const handlers: VizControlsHandlers = {
      onPrev: () => this.step(this.player.prev(), false),
      onNext: () => {
        if (this.player.state.atEnd && this.nextHref) {
          window.location.href = this.nextHref;
          return;
        }
        this.step(this.player.next());
      },
      onReset: () => { this.stop(); this.step(this.player.reset(), false); },
      onPlay: () => (this.timer ? this.stop() : this.play()),
      onAction: (i) => this.runAction(i),
      onFontSize: (s) => this.setFont(s),
      onSeek: (i) => { this.stop(); this.step(this.player.goTo(i), false); },
    };

    const buildCtx: PanelBuildCtx = {
      uid,
      code: config.code ?? [],
      labels: {
        chipName: config.chipName ?? "LPDDR5 RAM",
        chipAddr: config.chipAddr ?? "address space  0x0000 \u2192 0xFFFF",
      },
      regions,
      zoomTab,
      actions: this.actions,
      handlers,
      regionTags: config.regionTags ?? {},
      nextHref: this.nextHref,
    };

    const layout = config.layout ?? {
      visual: [
        ...(showBoard ? [{ type: "board" } as PanelSpec] : []),
        { type: "die", regions } as PanelSpec,
      ],
      aside: [{ type: "narration" } as PanelSpec, { type: "controls" } as PanelSpec],
    };

    this.root = document.createElement("div");
    this.root.className = "cl-mv";
    this.root.style.setProperty("--mv-fs", String(this.scale));
    if (config.background) this.root.style.setProperty("--mv-bg", config.background);

    const visualCol = document.createElement("div");
    visualCol.className = "cl-mv-visual";
    (layout.visual ?? []).forEach((spec) => {
      const p = this.makePanel(spec, buildCtx);
      this.panels.push(p);
      visualCol.appendChild(p.el);
    });

    const asideCol = document.createElement("div");
    asideCol.className = "cl-mv-aside";
    (layout.aside ?? []).forEach((spec) => {
      const p = this.makePanel(spec, buildCtx);
      this.panels.push(p);
      asideCol.appendChild(p.el);
    });

    this.root.append(visualCol);
    if (asideCol.childElementCount > 0) this.root.append(asideCol);
    else this.root.classList.add("cl-mv-single");

    host.appendChild(this.root);
    if (this.controls) this.controls.setActiveSize(this.scale);
    window.addEventListener("resize", this.onResize);
    this.refreshXp();
    this.step(this.player.state, false);
  }

  static create(host: HTMLElement, config: MemoryVizConfig): MemoryViz {
    return new MemoryViz(host, config);
  }

  destroy(): void {
    this.stop();
    window.removeEventListener("resize", this.onResize);
    this.root.remove();
  }

  // ---- composition ------------------------------------------------------
  private makePanel(spec: PanelSpec, ctx: PanelBuildCtx): Panel {
    switch (spec.type) {
      case "board":
        return new BoardView(ctx.uid);
      case "die":
        return new MemoryDieView(ctx.uid, ctx.code, ctx.labels, spec.regions ?? ctx.regions, ctx.zoomTab, ctx.regionTags);
      case "code":
        return new CodePanel(ctx.code);
      case "narration":
        return new NarrationView();
      case "controls": {
        this.controls = new VizControls(ctx.actions, ctx.handlers, ctx.nextHref);
        return this.controls;
      }
      default:
        throw new Error("MemoryViz: unknown panel type " + String(spec.type));
    }
  }

  // ---- orchestration ----------------------------------------------------
  private step(state: PlayerState, animate = true): void {
    if (this.controls) this.controls.resetActions();
    this.syncAll(state);
    if (animate) this.animateAll(state);
    if (state.atEnd) {
      this.stop();
      this.markComplete();
    }
  }

  /** Refresh the course XP label in the hero, if the page has one. */
  private refreshXp(): void {
    const label = document.getElementById("courseXpLabel");
    if (label) label.textContent = `Course XP: ${this.storedXp()}`;
  }

  private storedXp(): number {
    return parseInt(localStorage.getItem(this.xpKey) || "0", 10);
  }

  /** Mark the lesson complete and grant XP once, when the last step is reached. */
  private markComplete(): void {
    if (this.awarded || !this.awardedKey) return;
    this.awarded = true;
    try {
      const done = JSON.parse(localStorage.getItem(this.awardedKey) || "{}");
      if (!done.done) {
        localStorage.setItem(this.awardedKey, JSON.stringify({ done: true }));
        localStorage.setItem(this.xpKey, String(this.storedXp() + this.awardAmount));
      }
      this.refreshXp();
    } catch {
      /* storage unavailable - progress simply is not saved */
    }
  }

  private runAction(index: number): void {
    const action = this.actions[index];
    if (!action) return;
    const state = this.player.applyAction(action);
    this.syncAll(state);
    this.animateAll(state);
    if (action.once && this.controls) this.controls.disableAction(index);
  }

  private syncAll(state: PlayerState): void {
    const ctx: SyncCtx = {
      model: state.model,
      index: state.index,
      total: state.total,
      atStart: state.atStart,
      atEnd: state.atEnd,
    };
    for (const p of this.panels) p.sync(ctx);
  }

  private animateAll(state: PlayerState): void {
    for (const p of this.panels) if (p.animate) void p.animate(state.model);
  }

  private play(): void {
    if (!this.controls) return;
    this.playing = true;
    this.controls.setPlaying(true);
    if (this.player.state.atEnd) this.step(this.player.reset(), false);
    this.scheduleAdvance();
  }

  /** Hold each step long enough to read its narration at ~300 words/minute. */
  private scheduleAdvance(): void {
    this.timer = setTimeout(() => {
      if (!this.playing) return;
      if (this.player.state.atEnd) return this.stop();
      this.step(this.player.next());
      if (this.player.state.atEnd) this.stop();
      else this.scheduleAdvance();
    }, this.stepDurationMs());
  }

  private stepDurationMs(): number {
    const words = (this.player.state.model.narr ?? "").trim().split(/\s+/).filter(Boolean).length;
    const readMs = (words / WORDS_PER_MINUTE) * 60000;
    return Math.max(MIN_STEP_MS, Math.round(readMs) + 500);
  }

  private stop(): void {
    this.playing = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.controls) this.controls.setPlaying(false);
  }

  private setFont(scale: number): void {
    this.scale = scale;
    this.root.style.setProperty("--mv-fs", String(scale));
    if (this.controls) this.controls.setActiveSize(scale);
    this.relayout();
  }

  private relayout(): void {
    const model = this.player.state.model;
    for (const p of this.panels) if (p.onResize) p.onResize(model);
  }

  private onResize = (): void => {
    this.relayout();
  };
}
