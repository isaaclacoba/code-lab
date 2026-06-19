// jsdom setup for DOM-touching tests. Imported (side-effect) at the top of any
// test that exercises an adapter against a document. Pure-logic tests skip it.
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});

const { window } = dom;
const g = globalThis as unknown as Record<string, unknown>;

g.window = window;
g.document = window.document;
g.navigator = window.navigator;
g.HTMLElement = window.HTMLElement;
g.HTMLButtonElement = window.HTMLButtonElement;
g.Node = window.Node;
g.KeyboardEvent = window.KeyboardEvent;
g.MouseEvent = window.MouseEvent;
g.getComputedStyle = window.getComputedStyle.bind(window);

// jsdom does not implement scrolling; stub the calls the Tour makes so layout
// code under test does not throw.
const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
proto.scrollBy = function () {};
proto.scrollIntoView = function () {};

export { window };
