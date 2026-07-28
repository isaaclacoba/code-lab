// PlanboardView: the AI-track scene that shows an agent decomposing a goal into an
// ordered plan and working down it. A goal sits at the top; below it, numbered
// steps carry a state colour - pending, active (being worked now), done, or
// blocked (a signal to re-plan) - and an optional note. A small progress line
// reads "done / total". It renders the `plan` field of the current step and knows
// nothing about the model, the other panels, or the controls.

import type { PlanScene, PlanState } from "../core/planboard-model.js";
import { resolvePlan, planProgress } from "../core/planboard-model.js";
import { escapeHtml } from "../core/narration.js";
import type { Panel, SyncCtx } from "./panel.js";

/** The mark shown in each step's number badge by state. Pure presentation. */
const STATE_MARK: Record<PlanState, string> = {
  pending: "",
  active: "\u2192",
  done: "\u2713",
  blocked: "!",
};

export class PlanboardView implements Panel {
  readonly el: HTMLElement;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "cl-pb";
    this.el.innerHTML = `
      <span class="cl-pb-cap" data-cap></span>
      <div class="cl-pb-goal" data-goal hidden></div>
      <div class="cl-pb-steps" data-steps></div>
      <div class="cl-pb-prog" data-prog hidden></div>`;
  }

  sync(ctx: SyncCtx): void {
    const scene = ctx.model.plan ?? {};
    (this.el.querySelector("[data-cap]") as HTMLElement).textContent =
      scene.caption ?? "The plan";
    this.renderGoal(scene.goal);
    this.renderSteps(scene);
    this.renderProgress(scene);
  }

  private renderGoal(goal: string | undefined): void {
    const host = this.el.querySelector("[data-goal]") as HTMLElement;
    if (!goal) {
      host.hidden = true;
      host.innerHTML = "";
      return;
    }
    host.hidden = false;
    host.innerHTML =
      `<span class="cl-pb-tag">goal</span><span class="cl-pb-goal-t">${escapeHtml(goal)}</span>`;
  }

  private renderSteps(scene: PlanScene): void {
    const host = this.el.querySelector("[data-steps]") as HTMLElement;
    host.innerHTML = resolvePlan(scene)
      .map((step) => {
        const badge = STATE_MARK[step.state] || String(step.n);
        const note = step.note
          ? `<div class="cl-pb-note">${escapeHtml(step.note)}</div>`
          : "";
        return (
          `<div class="cl-pb-step is-${step.state}">` +
          `<span class="cl-pb-num">${escapeHtml(badge)}</span>` +
          `<div class="cl-pb-body">` +
          `<div class="cl-pb-text">${escapeHtml(step.text)}</div>` +
          note +
          `</div></div>`
        );
      })
      .join("");
  }

  private renderProgress(scene: PlanScene): void {
    const host = this.el.querySelector("[data-prog]") as HTMLElement;
    const { done, total } = planProgress(scene);
    if (total === 0) {
      host.hidden = true;
      host.textContent = "";
      return;
    }
    host.hidden = false;
    host.textContent = `${done} / ${total} done`;
  }
}
