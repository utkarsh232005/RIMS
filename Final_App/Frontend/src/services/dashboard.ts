import { fetchJson } from "@/services/api";
import type {
  DashboardSummary,
  MonthlyLogisticsResponse,
  RevenueTrendsResponse,
} from "@/types/api";

export function getDashboardSummary(monthId?: string): Promise<DashboardSummary> {
  const path = monthId ? `/api/dashboard-summary?monthId=${encodeURIComponent(monthId)}` : "/api/dashboard-summary";
  return fetchJson<DashboardSummary>(path);
}

export function getMonthlyLogistics(): Promise<MonthlyLogisticsResponse> {
  return fetchJson<MonthlyLogisticsResponse>("/api/monthly-logistics");
}

export function getRevenueTrends(): Promise<RevenueTrendsResponse> {
  return fetchJson<RevenueTrendsResponse>("/api/revenue-trends");
}
