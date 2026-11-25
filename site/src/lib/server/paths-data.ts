import type { MaintenanceData, PathData } from "#lib/paths.js";
import { dataFile } from "./data.js";

/** Reading paths and the maintenance summary, written by `cortex export` next to data.json (the site never reads the wiki itself). */
let paths: PathData[] | undefined, upkeep: MaintenanceData | undefined;
export const readingPaths = (): PathData[] => (paths ??= JSON.parse(dataFile("paths.json")));
export const maintenanceData = (): MaintenanceData => (upkeep ??= JSON.parse(dataFile("maintenance.json")));
