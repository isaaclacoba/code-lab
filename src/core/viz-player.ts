// DOM-free playback state machine for MemoryViz. Owns the position in the step
// script and the current resolved model; knows nothing about the DOM, so it can
// be unit-tested directly. Views observe the state it returns.

import type { ResolvedModel, Step, VizAction } from "./memory-model.js";
import { deepClone, resolveModel } from "./memory-model.js";

export interface PlayerState {
  index: number;
  total: number;
  model: ResolvedModel;
  atStart: boolean;
  atEnd: boolean;
  /** True after an interactive action moved the model off the scripted timeline. */
  offScript: boolean;
}

export class VizPlayer {
  private index = 0;
  private offScript = false;
  private model: ResolvedModel;

  constructor(
    private readonly steps: Step[],
    private readonly opts: { deriveRefs: boolean; autoDim: boolean },
  ) {
    if (steps.length === 0) throw new Error("VizPlayer needs at least one step");
    this.model = this.resolve(this.steps[0]);
  }

  private resolve(step: Step): ResolvedModel {
    return resolveModel(deepClone(step), this.opts);
  }

  get state(): PlayerState {
    return {
      index: this.index,
      total: this.steps.length,
      model: this.model,
      atStart: this.index <= 0,
      atEnd: this.index >= this.steps.length - 1,
      offScript: this.offScript,
    };
  }

  goTo(n: number): PlayerState {
    this.index = Math.max(0, Math.min(this.steps.length - 1, n));
    this.offScript = false;
    this.model = this.resolve(this.steps[this.index]);
    return this.state;
  }

  next(): PlayerState {
    return this.goTo(this.index + 1);
  }

  prev(): PlayerState {
    return this.goTo(this.index - 1);
  }

  reset(): PlayerState {
    return this.goTo(0);
  }

  /** Apply an interactive verb over the live model. Stays off the script until
   *  the caller steps or resets. */
  applyAction(action: VizAction): PlayerState {
    this.model = this.resolve(action.apply(deepClone(this.model as Step)));
    this.offScript = true;
    return this.state;
  }
}
