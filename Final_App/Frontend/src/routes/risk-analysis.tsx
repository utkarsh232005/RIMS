import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page-header";
import { RiskChart } from "@/components/charts/risk-chart";
import { ActivityPanel } from "@/components/dashboard/activity-panel";
import { AIInsights } from "@/components/dashboard/ai-insights";
import { getRegionalPerformance } from "@/services/risk";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/common/data-state";
import { ShieldAlert, AlertTriangle, TrendingUp } from "lucide-react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";

export const Route = createFileRoute("/risk-analysis")({
  head: () => ({
    meta: [
      { title: "Risk Analysis · RIMS" },
      {
        name: "description",
        content: "Supplier risk scoring, anomaly detection, and predictive risk analytics.",
      },
    ],
  }),
  component: RiskPage,
});

function RiskPage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["regional-performance"],
    queryFn: getRegionalPerformance,
    staleTime: 60_000,
  });
  const riskMatrix = data?.riskMatrix ?? [];
  const riskTrend = data?.riskTrend ?? [];
  const summary = data?.summary;

  const high = summary?.highExposure ?? riskMatrix.filter((r) => r.exposure > 60).length;
  const tooltipStyle = {
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: 4,
    fontSize: 12,
    boxShadow: "none",
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Risk"
        title="Risk Analysis"
        description="Risk exposure across suppliers, logistics, and external disruptions."
      />

      {isLoading ? <LoadingBlock /> : null}
      {error ? <ErrorBlock error={error} onRetry={() => refetch()} /> : null}
      {!isLoading && !error && !riskMatrix.length ? (
        <EmptyBlock label="No risk data returned" />
      ) : null}

      {!isLoading && !error && riskMatrix.length ? (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <p className="text-xs font-semibold uppercase tracking-wider text-destructive">
                  High exposure
                </p>
              </div>
              <p className="mt-2 text-2xl font-semibold text-foreground">{high}</p>
              <p className="text-[11px] text-muted-foreground">above threshold</p>
            </div>
            <div className="rounded-md border border-border bg-surface p-4">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-primary" />
                <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                  Network risk
                </p>
              </div>
              <p className="mt-2 text-2xl font-semibold text-foreground">
                {summary?.networkRisk ?? 0}
                <span className="text-sm text-muted-foreground"> / 100</span>
              </p>
              <p className="text-[11px] text-muted-foreground">derived from Gold features</p>
            </div>
            <div className="rounded-md border border-border bg-surface p-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-warning-foreground" />
                <p className="text-xs font-semibold uppercase tracking-wider text-warning-foreground">
                  Anomalies (24h)
                </p>
              </div>
              <p className="mt-2 text-2xl font-semibold text-foreground">
                {summary?.anomalies ?? 0}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {summary?.resolved ?? 0} resolved · {summary?.reviewing ?? 0} reviewing
              </p>
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <RiskChart data={riskMatrix} />
            </div>
            <div className="rounded-md border border-border bg-surface">
              <div className="border-b border-border px-5 py-3.5">
                <h3 className="text-sm font-semibold text-foreground">Risk Trend</h3>
                <p className="text-[11px] text-muted-foreground">8-week score</p>
              </div>
              <div className="p-3" style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={riskTrend} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="riskG" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-destructive)" stopOpacity={0.35} />
                        <stop
                          offset="100%"
                          stopColor="var(--color-destructive)"
                          stopOpacity={0.02}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      stroke="var(--color-border)"
                      strokeDasharray="3 3"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="week"
                      tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                      axisLine={false}
                      tickLine={false}
                      width={32}
                    />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Area
                      type="monotone"
                      dataKey="risk"
                      stroke="var(--color-destructive)"
                      strokeWidth={2}
                      fill="url(#riskG)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <ActivityPanel />
            <AIInsights />
          </div>
        </>
      ) : null}
    </div>
  );
}
