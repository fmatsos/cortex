import { maintenanceData } from "#lib/server/paths-data.js";

export const load = () => ({ upkeep: maintenanceData() });
