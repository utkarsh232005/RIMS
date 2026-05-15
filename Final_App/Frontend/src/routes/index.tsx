import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { KpiGrid } from "@/components/dashboard/operations/kpi-grid";
import { MonthlyLogisticsPie } from "@/components/dashboard/operations/monthly-logistics-pie";
import { AIInsights } from "@/components/dashboard/ai-insights";
import { ActivityPanel } from "@/components/dashboard/activity-panel";
import { ShipmentTable } from "@/components/dashboard/shipment-table";
import { AutonomousDecisions } from "@/components/dashboard/autonomous-decisions";
import { ForecastChart } from "@/components/charts/forecast-chart";
import { getDashboardSummary } from "@/services/dashboard";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/common/data-state";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Operations Overview · RIMS" },
      {
        name: "description",
        content: "Live overview of shipments, demand, and autonomous decisions.",
      },
    ],
  }),
  component: Overview,
});

function Overview() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: getDashboardSummary,
    staleTime: 60_000,
  });
  const overviewKpiMetrics = (data?.kpiMetrics ?? []).filter((m) =>
    ["k1", "k2", "k4", "k6"].includes(m.id),
  );

  return (
    <div className="flex w-full min-w-0 flex-col gap-10 pb-2">
      <PageHeader
        title="Operations Overview"
        description="Live network health, demand signals, and exceptions."
        actions={
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-sm border border-border/80 bg-surface px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-border hover:bg-surface-muted"
          >
            <Download className="h-4 w-4 text-muted-foreground" />
            Export
          </button>
        }
      />

      <section className="space-y-3" aria-labelledby="overview-snapshot-heading">
        <h2
          id="overview-snapshot-heading"
          className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Snapshot
        </h2>
        {isLoading ? (
          <LoadingBlock />
        ) : error ? (
          <ErrorBlock error={error} onRetry={() => refetch()} />
        ) : !overviewKpiMetrics.length ? (
          <EmptyBlock />
        ) : (
          <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="min-w-0">
              <KpiGrid metrics={overviewKpiMetrics} className="h-full w-full" />
            </div>
            <div className="min-w-0">
              <MonthlyLogisticsPie className="h-full w-full" />
            </div>
          </div>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="overview-forecast-heading">
        <h2
          id="overview-forecast-heading"
          className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Forecast
        </h2>
        <ForecastChart height={400} />
      </section>

      <section className="space-y-3" aria-labelledby="overview-insights-heading">
        <h2
          id="overview-insights-heading"
          className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Insights & activity
        </h2>
        <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-2 lg:gap-6">
          <AIInsights variant="compact" insights={data?.aiInsights} maxPreview={3} />
          <ActivityPanel variant="compact" events={data?.activityFeed} previewCount={5} />
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="overview-shipments-heading">
        <h2
          id="overview-shipments-heading"
          className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Active shipments
        </h2>
        <ShipmentTable />
      </section>

      <section aria-labelledby="overview-decisions-heading">
        <h2 id="overview-decisions-heading" className="sr-only">
          Autonomous decisions
        </h2>
        <AutonomousDecisions decisions={data?.autonomousDecisions} />
      </section>
    </div>
  );
}
