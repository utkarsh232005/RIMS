import { fetchJson } from "@/services/api";
import type { DemandIntelligence } from "@/types/api";
import type { ForecastPoint } from "@/types/prediction";

export function getDemandIntelligence(monthId?: string): Promise<DemandIntelligence> {
  const path = monthId ? `/api/demand-intelligence?monthId=${encodeURIComponent(monthId)}` : "/api/demand-intelligence";
  return fetchJson<DemandIntelligence>(path);
}

export async function getForecast(monthId?: string): Promise<ForecastPoint[]> {
  const data = await getDemandIntelligence(monthId);
  return data.forecastSeries;
}
