// The Panel contract: every composable piece of the visualiser (board, RAM die,
// code listing, narration, controls, and future panels) exposes an element and a
// uniform sync(). The facade composes panels per the injected layout and drives
// them all the same way, so new element combinations are pure configuration.

import type { ResolvedModel } from "../core/memory-model.js";

export interface SyncCtx {
  model: ResolvedModel;
  index: number;
  total: number;
  atStart: boolean;
  atEnd: boolean;
}

export interface Panel {
  readonly el: HTMLElement;
  /** Reflect the current step. Called on every step. */
  sync(ctx: SyncCtx): void;
  /** Optional animation for a forward step (e.g. board signal packets). */
  animate?(model: ResolvedModel): Promise<void>;
  /** Optional relayout hook (e.g. redraw reference arrows) on resize/font change. */
  onResize?(model: ResolvedModel): void;
}
