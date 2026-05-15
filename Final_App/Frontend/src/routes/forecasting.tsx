import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page-header";
import { ForecastChart } from "@/components/charts/forecast-chart";
import { AIConfidence } from "@/components/dashboard/ai-confidence";
import { AIInsights } from "@/components/dashboard/ai-insights";
import { getDemandIntelligence } from "@/services/forecasting";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/common/data-state";
import { TrendingUp, Zap } from "lucide-react";

export const Route = createFileRoute("/forecasting")({
  head: () => ({
    meta: [
      { title: "Forecasting · RIMS" },
      { name: "description", content: "Demand projections, AI confidence, and what-if scenarios." },
    ],
  }),
  component: ForecastingPage,
});

function ForecastingPage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["demand-intelligence"],
    queryFn: getDemandIntelligence,
    staleTime: 60_000,
  });
  const scenarios = data?.scenarios ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Predictive Intelligence"
        title="Demand Forecasting"
        description="14 to 90-day projections with confidence bands and scenario simulation."
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <ForecastChart height={360} />
        </div>
        <AIConfidence items={data?.modelConfidence} />
      </div>

      {isLoading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock error={error} onRetry={() => refetch()} />
      ) : !scenarios.length ? (
        <EmptyBlock label="No scenario data returned" />
      ) : (
        <div className="rounded-md border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">What-if Scenarios</h3>
            </div>
            <span className="text-[11px] text-muted-foreground">{scenarios.length} modeled</span>
          </div>
          <div className="grid gap-3 p-5 md:grid-cols-3">
            {scenarios.map((s) => (
              <div key={s.name} className={`rounded-lg border ${s.tone} p-4`}>
                <div className="flex items-start justify-between">
                  <p className="text-sm font-semibold text-foreground">{s.name}</p>
                  <TrendingUp className="h-4 w-4 text-primary" />
                </div>
                <p className="mt-2 text-xl font-semibold tracking-tight text-foreground">
                  {s.impact}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <AIInsights />
    </div>
  );
}
