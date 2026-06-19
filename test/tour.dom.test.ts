import { test } from "node:test";
import assert from "node:assert/strict";
import "./setup-dom.ts";
import { Tour } from "../src/tour.ts";

const steps = () => [
  { text: "first", lines: 1 },
  { text: "second", lines: [2, 3] },
  { text: "third", lines: 2 },
];

function nextButton(): HTMLButtonElement {
  const btns = [
    ...document.querySelectorAll<HTMLButtonElement>(".cl-tour-footer .cl-btn"),
  ];
  const btn = btns.find((b) => b.textContent === "Next");
  assert.ok(btn, "Next button present");
  return btn;
}

test("open renders a modal with one row per code line and a 1-based counter", () => {
  const tour = new Tour({ language: "csharp" });
  tour.open({ title: "T", code: "a\nb\nc", steps: steps() });

  assert.ok(document.querySelector(".cl-tour-modal"));
  assert.equal(document.querySelectorAll(".cl-tour-line").length, 3);
  assert.equal(document.querySelector(".cl-tour-counter")?.textContent, "1 / 3");
  assert.equal(document.querySelector(".cl-tour-narration")?.textContent, "first");

  tour.destroy();
});

test("Next advances the step and updates active/dim line classes", () => {
  const tour = new Tour();
  tour.open({ code: "a\nb\nc", steps: steps() });
  const rows = [...document.querySelectorAll(".cl-tour-line")];

  assert.ok(rows[0].classList.contains("is-active"));
  assert.ok(rows[1].classList.contains("is-dim"));

  nextButton().click();

  assert.ok(rows[1].classList.contains("is-active"));
  assert.ok(rows[2].classList.contains("is-active"));
  assert.ok(rows[0].classList.contains("is-dim"));
  assert.equal(document.querySelector(".cl-tour-counter")?.textContent, "2 / 3");

  tour.destroy();
});

test("arrow keys navigate forward and back", () => {
  const tour = new Tour();
  tour.open({ code: "a\nb\nc", steps: steps() });

  document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
  assert.equal(document.querySelector(".cl-tour-counter")?.textContent, "2 / 3");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
  assert.equal(document.querySelector(".cl-tour-counter")?.textContent, "1 / 3");

  tour.destroy();
});

test("Escape closes the tour and restores the previously focused element", () => {
  const trigger = document.createElement("button");
  document.body.appendChild(trigger);
  trigger.focus();

  const tour = new Tour();
  tour.open({ code: "a\nb", steps: [{ text: "x", lines: 1 }] });
  const overlay = document.querySelector(".cl-tour-overlay") as HTMLElement;
  assert.equal(overlay.hidden, false);

  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  assert.equal(overlay.hidden, true);
  assert.equal(document.activeElement, trigger);

  tour.destroy();
  trigger.remove();
});

test("a tour with no steps still opens safely", () => {
  const tour = new Tour();
  tour.open({ code: "a", steps: [] });
  assert.equal(document.querySelector(".cl-tour-counter")?.textContent, "1 / 1");
  tour.destroy();
});
