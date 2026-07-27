import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { Autoplay } from "../src/core/autoplay.ts";

test("advances forward on each tick and stops at the end", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let index = 0;
    const total = 3; // steps 0, 1, 2
    let stopCount = 0;
    const ap = new Autoplay({
      stepMs: () => 100,
      atEnd: () => index >= total - 1,
      advance: () => {
        index += 1;
      },
      onStop: () => {
        stopCount += 1;
      },
    });
    ap.start();
    assert.equal(ap.isPlaying, true);
    mock.timers.tick(100); // 0 -> 1
    assert.equal(index, 1);
    assert.equal(ap.isPlaying, true);
    mock.timers.tick(100); // 1 -> 2, now atEnd -> stop
    assert.equal(index, 2);
    assert.equal(ap.isPlaying, false);
    assert.ok(stopCount >= 1);
  } finally {
    mock.timers.reset();
  }
});

test("stop halts further scheduling", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let index = 0;
    const ap = new Autoplay({
      stepMs: () => 50,
      atEnd: () => false,
      advance: () => {
        index += 1;
      },
      onStop: () => {},
    });
    ap.start();
    mock.timers.tick(50); // 0 -> 1
    assert.equal(index, 1);
    ap.stop();
    assert.equal(ap.isPlaying, false);
    mock.timers.tick(500); // no further advances
    assert.equal(index, 1);
  } finally {
    mock.timers.reset();
  }
});
