/** Shelf packing of the map: countries (communities) inside a continent, continents across the sea. Pure, shared by the export and the browser. */

/** Community id of the "Various" island: unlinked pages and groups too small to get a tag of their own. */
export const MISC = "~misc";
/** A group needs this many pages to get its own island and tag. */
export const MIN_ISLAND = 4;
/** Sea between two continents, in graph units. */
export const SEA = 170;

export const islandRadius = (size: number) => 45 + Math.sqrt(size) * 27;

type Box = { w: number; h: number };

function shelf(boxes: Box[], rowWidth: number, gap: number) {
  let left = 0, top = 0, rowHeight = 0, width = 0;
  const centers = boxes.map(({ w, h }) => {
    if (left && left + w > rowWidth) { top += rowHeight + gap; left = 0; rowHeight = 0; }
    const center = { x: left + w / 2, y: -top - h / 2 };
    left += w + gap; rowHeight = Math.max(rowHeight, h); width = Math.max(width, left - gap);
    return center;
  });
  return { centers, aspect: width / Math.max(1, top + rowHeight) };
}

/** Centers of boxes (largest first) packed in rows whose overall width/height ratio is closest to `aspect`. */
export function packBoxes(boxes: Box[], aspect: number, gap: number) {
  const area = boxes.reduce((sum, b) => sum + (b.w + gap) * (b.h + gap), 0);
  let best = shelf(boxes, Math.sqrt(area * aspect), gap);
  // ponytail: 40 tries of a linear packing, cheap for the few dozen boxes a wiki has
  for (let k = 0.5; k <= 4; k += 0.09) {
    const next = shelf(boxes, Math.sqrt(area * aspect * k), gap);
    if (Math.abs(Math.log(next.aspect / aspect)) < Math.abs(Math.log(best.aspect / aspect))) best = next;
  }
  return best.centers;
}

/** Island centers for community sizes (largest first): each island is a square of its diameter. */
export const packIslands = (sizes: number[], aspect: number, gap = 65) =>
  packBoxes(sizes.map((size) => ({ w: 2 * islandRadius(size), h: 2 * islandRadius(size) })), aspect, gap);
