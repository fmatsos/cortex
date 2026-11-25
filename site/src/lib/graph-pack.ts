/** Shelf packing of the community islands (pure, shared by the export and the browser). */

export const islandRadius = (size: number) => 45 + Math.sqrt(size) * 27;
const GAP = 65;

function shelf(sizes: number[], rowWidth: number) {
  let left = 0, top = 0, rowHeight = 0, width = 0;
  const centers = sizes.map((size) => {
    const radius = islandRadius(size), side = 2 * radius + GAP;
    if (left && left + side > rowWidth) { top += rowHeight; left = 0; rowHeight = 0; }
    const center = { x: left + radius, y: -top - radius };
    left += side; rowHeight = Math.max(rowHeight, side); width = Math.max(width, left);
    return center;
  });
  return { centers, aspect: width / Math.max(1, top + rowHeight) };
}

/** Centers of islands of the given sizes (largest first), packed in rows whose overall width/height ratio is closest to `aspect`. */
export function packIslands(sizes: number[], aspect: number) {
  const area = sizes.reduce((sum, size) => sum + (2 * islandRadius(size) + GAP) ** 2, 0);
  let best = shelf(sizes, Math.sqrt(area * aspect));
  // ponytail: 40 tries of a linear packing, cheap for the few dozen islands a wiki has
  for (let k = 0.5; k <= 4; k += 0.09) {
    const next = shelf(sizes, Math.sqrt(area * aspect * k));
    if (Math.abs(Math.log(next.aspect / aspect)) < Math.abs(Math.log(best.aspect / aspect))) best = next;
  }
  return best.centers;
}
