import type { VizLabels } from "./memory-model.js";
import { fill } from "./template.js";

/** What a button should say and draw while the learner waits.
 *
 *  `percent` is `null` when there is nothing to measure. That is not a missing
 *  value - it is the answer, and the view draws a moving bar instead of a fill.
 *  A percentage invented for an unmeasurable phase creeps to 90%, stops, and
 *  teaches the learner to distrust the number. */
export interface WaitState {
  label: string;
  percent: number | null;
}

/** The compiler host's three boot phases. Only the download has a real number:
 *  it is fetching a ~30MB runtime and reports bytes. Starting and warming up are
 *  the host executing code, with no progress to report - so they name themselves,
 *  which is what actually answers "is it stuck?". */
export function bootWait(
  labels: Pick<VizLabels, "vlBootDownload" | "vlBootStart" | "vlBootWarm">,
  phase: "download" | "start" | "warm",
  percent: number,
): WaitState {
  if (phase === "download") {
    const pct = Math.max(0, Math.min(100, Math.round(percent)));
    return { label: fill(labels.vlBootDownload, { percent: pct }), percent: pct };
  }
  return {
    label: phase === "start" ? labels.vlBootStart : labels.vlBootWarm,
    percent: null,
  };
}

/** A trace is one round trip to the host, which reports no sub-phases, so there
 *  is no honest percentage. Count the wait instead: seconds ticking up is the
 *  difference between "working" and "hung". Under a second there is nothing
 *  worth counting, so the plain label stands. */
export function traceWait(
  labels: Pick<VizLabels, "vlTracing" | "vlTracingSecs">,
  elapsedMs: number,
): WaitState {
  const secs = Math.floor(Math.max(0, elapsedMs) / 1000);
  return {
    label: secs < 1 ? labels.vlTracing : fill(labels.vlTracingSecs, { secs }),
    percent: null,
  };
}
