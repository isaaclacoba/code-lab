// MemoryViz: the facade + composer. It builds panels from the injected layout
// (or a sensible default derived from the scene), lays them out as a two-column
// stage (visual + reading rail), and drives every panel through the shared
// player. New element combinations - board-only, swapped backgrounds, a merged
// code editor - are pure configuration: add a panel type here, place it in a
// lesson's layout, done.

import type {
  MemoryVizConfig,
  PanelSpec,
  PanelType,
  RegionName,
  VizAction,
  LegendItem,
  Step,
  VizLayout,
  VizLabels,
} from "../core/memory-model.js";
import { ALL_REGIONS, DEFAULT_VIZ_LABELS } from "../core/memory-model.js";
import { VizPlayer } from "../core/viz-player.js";
import type { PlayerState } from "../core/viz-player.js";
import { ProgressStore } from "../core/progress-store.js";
import { Autoplay } from "../core/autoplay.js";
import { deriveTrace } from "../core/exec-trace.js";
import type { Panel, SyncCtx } from "./panel.js";
import { BoardView } from "./board-view.js";
import { MemoryDieView } from "./memory-die-view.js";
import { CodePanel } from "./code-panel.js";
import { VarTableView } from "./vartable-view.js";
import { CallStackView } from "./callstack-view.js";
import { HeapCardsView } from "./heapcards-view.js";
import { NarrationView } from "./narration-view.js";
import { ConsoleView } from "./console-view.js";
import { AgentView } from "./agent-view.js";
import { AgentLoopView } from "./agent-loop-view.js";
import { MemoryShelfView } from "./memory-shelf-view.js";
import { ToolRackView } from "./tool-rack-view.js";
import { TranscriptView } from "./transcript-view.js";
import { RetrievalView } from "./retrieval-view.js";
import { PlanboardView } from "./planboard-view.js";
import { RepoView } from "./repo-view.js";
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
  legend?: LegendItem[];
  nextHref?: string;
  nextLabel?: string;
  vizLabels: VizLabels;
}

let instanceSeq = 0;
const WORDS_PER_MINUTE = 300;
const MIN_STEP_MS = 2600;

export class MemoryViz {
  private readonly root: HTMLElement;
  private readonly visualCol: HTMLElement;
  private readonly asideCol: HTMLElement;
  private player: VizPlayer;
  private readonly panels: Panel[] = [];
  private readonly actions: VizAction[];
  private controls: VizControls | null = null;
  private readonly handlers: VizControlsHandlers;
  private readonly buildCtx: PanelBuildCtx;
  private layout: VizLayout;
  private steps: Step[];
  private readonly deriveRefs: boolean;
  private readonly autoDim: boolean;

  private scale = 1;
  private readonly nextHref?: string;
  private readonly nextLabel?: string;
  private readonly onXpChange?: (xp: number) => void;
  private readonly onStep?: (info: { pc: number; index: number; total: number }) => void;
  private readonly progress: ProgressStore;
  private autoplay!: Autoplay;

  private readonly panelFactories: Record<PanelType, (spec: PanelSpec, ctx: PanelBuildCtx) => Panel> = {
    board: (_spec, ctx) => new BoardView(ctx.uid),
    die: (spec, ctx) =>
      new MemoryDieView(ctx.uid, ctx.code, ctx.labels, spec.regions ?? ctx.regions, ctx.zoomTab, ctx.regionTags),
    code: (_spec, ctx) => new CodePanel(ctx.code),
    vartable: () => new VarTableView(),
    callstack: () => new CallStackView(),
    heapcards: (_spec, ctx) => new HeapCardsView(ctx.uid),
    narration: (_spec, ctx) => new NarrationView(ctx.vizLabels),
    console: () => new ConsoleView(),
    agent: (spec, ctx) => new AgentView(spec.fan, ctx.vizLabels),
    agentloop: () => new AgentLoopView(),
    memoryshelf: () => new MemoryShelfView(),
    toolrack: (_spec, ctx) => new ToolRackView(ctx.vizLabels),
    transcript: (_spec, ctx) => new TranscriptView(ctx.vizLabels),
    retrieval: () => new RetrievalView(),
    planboard: () => new PlanboardView(),
    repo: () => new RepoView(),
    controls: (_spec, ctx) =>
      (this.controls = new VizControls(ctx.actions, ctx.handlers, ctx.nextHref, ctx.legend, ctx.nextLabel, ctx.vizLabels)),
  };

  private constructor(host: HTMLElement, config: MemoryVizConfig) {
    const uid = instanceSeq++;
    const scene = config.scene ?? {};
    const regions = scene.regions ?? ALL_REGIONS;
    const showBoard = scene.board !== false;
    const zoomTab = scene.zoomTab !== false;

    this.actions = config.actions ?? [];
    this.nextHref = config.nextHref;
    this.nextLabel = config.nextLabel;
    this.onXpChange = config.onXpChange;
    this.onStep = config.onStep;
    this.progress = new ProgressStore(
      config.xpKey ?? "codelab_xp",
      config.awardedKey,
      typeof config.awardAmount === "number" ? config.awardAmount : 20,
    );
    this.deriveRefs = config.deriveRefs !== false;
    this.autoDim = config.autoDim !== false;
    this.steps = config.steps ?? [];
    this.player = new VizPlayer(this.steps, {
      deriveRefs: this.deriveRefs,
      autoDim: this.autoDim,
    });
    this.autoplay = new Autoplay({
      stepMs: () => this.stepDurationMs(),
      atEnd: () => this.player.state.atEnd,
      advance: () => this.step(this.player.next()),
      onStop: () => this.controls?.setPlaying(false),
    });
    this.scale = config.fontScale ?? 1;

    this.handlers = {
      onPrev: () => this.step(this.player.prev(), false),
      onNext: () => {
        if (this.player.state.atEnd && this.nextHref) {
          window.location.href = this.nextHref;
          return;
        }
        this.step(this.player.next());
      },
      onReset: () => { this.stop(); this.step(this.player.reset(), false); },
      onPlay: () => (this.autoplay.isPlaying ? this.stop() : this.play()),
      onAction: (i) => this.runAction(i),
      onFontSize: (s) => this.setFont(s),
      onSeek: (i) => { this.stop(); this.step(this.player.goTo(i), false); },
    };

    const vizLabels: VizLabels = { ...DEFAULT_VIZ_LABELS, ...config.labels };
    this.buildCtx = {
      uid,
      code: config.code ?? [],
      labels: {
        chipName: config.chipName ?? "LPDDR5 RAM",
        chipAddr: config.chipAddr ?? "address space  0x0000 \u2192 0xFFFF",
      },
      regions,
      zoomTab,
      actions: this.actions,
      handlers: this.handlers,
      regionTags: config.regionTags ?? {},
      legend: config.legend,
      nextHref: this.nextHref,
      nextLabel: this.nextLabel ?? vizLabels.nextLesson,
      vizLabels,
    };

    this.layout = config.layout ?? {
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

    this.visualCol = document.createElement("div");
    this.visualCol.className = "cl-mv-visual";
    this.asideCol = document.createElement("div");
    this.asideCol.className = "cl-mv-aside";
    this.root.append(this.visualCol);

    this.buildPanels();

    host.appendChild(this.root);
    this.wireControls();
    window.addEventListener("resize", this.onResize);
    this.refreshXp();
    this.step(this.player.state, false);
  }

  /** Replace the scene without tearing the widget down: rebuild the player and
   *  the panels in place, and (by default) hold the current step index so a
   *  level toggle does not send the learner back to the first step. `code` and
   *  `layout` override the code lines and the panel arrangement when given. */
  setSteps(
    steps: Step[],
    opts: { code?: string[]; layout?: VizLayout; preserveIndex?: boolean } = {},
  ): void {
    if (steps.length === 0) throw new Error("MemoryViz.setSteps needs at least one step");
    this.stop();
    const keepIndex = opts.preserveIndex !== false ? this.player.state.index : 0;
    this.steps = steps;
    if (opts.code) this.buildCtx.code = opts.code;
    if (opts.layout) this.layout = opts.layout;
    this.player = new VizPlayer(steps, { deriveRefs: this.deriveRefs, autoDim: this.autoDim });
    this.buildPanels();
    this.wireControls();
    this.step(this.player.goTo(Math.min(keepIndex, steps.length - 1)), false);
  }

  /** (Re)build the visual + aside panels from the current layout into the two
   *  columns. Clears any prior panels first, so it is safe to call repeatedly. */
  private buildPanels(): void {
    this.controls = null;
    this.panels.length = 0;
    this.visualCol.textContent = "";
    this.asideCol.textContent = "";
    (this.layout.visual ?? []).forEach((spec) => {
      const p = this.makePanel(spec, this.buildCtx);
      this.panels.push(p);
      this.visualCol.appendChild(p.el);
    });
    (this.layout.aside ?? []).forEach((spec) => {
      const p = this.makePanel(spec, this.buildCtx);
      this.panels.push(p);
      this.asideCol.appendChild(p.el);
    });
    if (this.asideCol.childElementCount > 0) {
      if (!this.asideCol.parentNode) this.root.append(this.asideCol);
      this.root.classList.remove("cl-mv-single");
    } else {
      if (this.asideCol.parentNode) this.asideCol.remove();
      this.root.classList.add("cl-mv-single");
    }
  }

  /** Feed the freshly built controls panel the font size and the derived-trace
   *  scrubber for the current steps. No-op when the layout has no controls. */
  private wireControls(): void {
    if (!this.controls) return;
    this.controls.setActiveSize(this.scale);
    this.controls.setDerived(deriveTrace(this.steps), this.handlers.onSeek);
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
    const build = this.panelFactories[spec.type];
    if (!build) throw new Error("MemoryViz: unknown panel type " + String(spec.type));
    return build(spec, ctx);
  }

  // ---- orchestration ----------------------------------------------------
  private step(state: PlayerState, animate = true): void {
    if (this.controls) this.controls.resetActions();
    this.syncAll(state);
    this.onStep?.({ pc: state.model.pc ?? -1, index: state.index, total: state.total });
    if (animate) this.animateAll(state);
    if (state.atEnd) {
      this.stop();
      this.markComplete();
    }
  }

  /** Report the current tracked XP to the host, which owns any XP label. */
  private refreshXp(): void {
    this.onXpChange?.(this.progress.xp());
  }

  /** Mark the lesson complete and grant XP once, when the last step is reached. */
  private markComplete(): void {
    this.progress.awardOnce();
    this.refreshXp();
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
    if (this.player.state.atEnd) this.step(this.player.reset(), false);
    this.controls.setPlaying(true);
    this.autoplay.start();
  }

  /** Hold each step long enough to read its narration at ~300 words/minute. */
  private stepDurationMs(): number {
    const words = (this.player.state.model.narr ?? "").trim().split(/\s+/).filter(Boolean).length;
    const readMs = (words / WORDS_PER_MINUTE) * 60000;
    return Math.max(MIN_STEP_MS, Math.round(readMs) + 500);
  }

  private stop(): void {
    this.autoplay.stop();
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
