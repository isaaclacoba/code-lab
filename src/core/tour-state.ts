// A tiny, DOM-free state machine for tour navigation. The Tour adapter holds one
// of these and re-renders when it changes; tests can drive it without a browser.

export interface TourModel {
  readonly index: number;
  readonly count: number;
}

export function makeTour(count: number, index = 0): TourModel {
  const safeCount = Math.max(0, Math.floor(count));
  return { count: safeCount, index: clamp(index, safeCount) };
}

function clamp(index: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(0, Math.floor(index)), count - 1);
}

/** Move to an explicit index. Out-of-range requests are ignored (model
 *  unchanged), matching the adapter's guard behaviour. */
export function goTo(model: TourModel, index: number): TourModel {
  if (index < 0 || index >= model.count) return model;
  return { ...model, index };
}

export function next(model: TourModel): TourModel {
  return goTo(model, model.index + 1);
}

export function prev(model: TourModel): TourModel {
  return goTo(model, model.index - 1);
}

export function atFirst(model: TourModel): boolean {
  return model.index <= 0;
}

export function atLast(model: TourModel): boolean {
  return model.count === 0 || model.index >= model.count - 1;
}

/** "n / total" counter label, 1-based. */
export function counterLabel(model: TourModel): string {
  return `${model.index + 1} / ${model.count}`;
}
