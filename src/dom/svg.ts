// Small helper for building namespaced SVG elements.
const SVG_NS = "http://www.w3.org/2000/svg";

export function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const key in attrs) node.setAttribute(key, String(attrs[key]));
  return node;
}
