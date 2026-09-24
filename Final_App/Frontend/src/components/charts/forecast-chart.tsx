import { useId, useMemo, useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getDemandIntelligence } from "@/services/forecasting";
import type { ForecastPoint } from "@/types/prediction";
import { DemandForecastKpiStrip } from "@/components/charts/demand-forecast-kpi-strip";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/common/data-state";
import { cn } from "@/lib/utils";
import { Sparkles, Radio } from "lucide-react";
import {
  subscribeToPipeline,
  type LiveDemandTick,
  type PipelineEvent,
} from "@/services/pipeline";

const CRITICAL_INVENTORY_THRESHOLD = 5400;
const LIVE_MONTH_IDS = new Set(["mar-2026", "apr-2026"]);

type ChartView = "actual" | "forecast" | "confidence" | "combined";

interface LiveDemandPoint {
  period: string;
  predicted_demand: number;
  rolling_mean_3: number;
}

type ChartRow = ForecastPoint & {
  spread: number;
  liveDemand?: number | null;
};

function enrichData(
  rows: ForecastPoint[],
  livePoints: LiveDemandPoint[]
): ChartRow[] {
  // Start with base data
  const base: ChartRow[] = rows.map((d) => ({
    ...d,
    spread: d.upper - d.lower,
    liveDemand: null,
  }));

  // Append live pipeline points
  for (const lp of livePoints) {
    base.push({
      period: lp.period,
      actual: null as any,
      forecast: lp.rolling_mean_3,
      upper: lp.predicted_demand * 1.08,
      lower: lp.predicted_demand * 0.92,
      spread: lp.predicted_demand * 0.16,
      liveDemand: lp.predicted_demand,
    });
  }

  return base;
}

function formatDemandTick(v: number) {
  if (Math.abs(v) >= 1000) {
    const k = v / 1000;
    return `${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  return String(Math.round(v));
}

function formatDemandDetail(n: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}

function ForecastTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: ChartRow }>;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  const isLive = row.liveDemand != null;

  return (
    <div className="min-w-[210px] rounded-md border border-border/80 bg-surface px-3.5 py-3 text-xs shadow-lg">
      <p className="font-semibold text-foreground flex items-center justify-between">
        <span>{row.period}</span>
        {isLive && (
          <span className="text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded font-medium flex items-center gap-1">
            <Radio className="h-2.5 w-2.5 animate-pulse" /> LIVE
          </span>
        )}
      </p>
      <dl className="mt-2.5 space-y-1.5 text-[11px]">
        {!isLive && row.actual != null && (
          <div className="flex justify-between gap-6">
            <dt className="text-muted-foreground">Actual</dt>
            <dd className="tabular-nums font-medium text-foreground">
              {formatDemandDetail(row.actual)}
            </dd>
          </div>
        )}
        <div className="flex justify-between gap-6">
          <dt className="text-muted-foreground">{isLive ? "Rolling Mean" : "Forecast"}</dt>
          <dd className="tabular-nums font-medium text-foreground">
            {formatDemandDetail(row.forecast)}
          </dd>
        </div>
        {isLive && (
          <div className="flex justify-between gap-6 pt-1 border-t border-border/50 text-emerald-600 dark:text-emerald-400 font-semibold">
            <dt className="flex items-center gap-1">
              <Sparkles className="h-3 w-3" /> ML Predicted Demand
            </dt>
            <dd className="tabular-nums">{formatDemandDetail(row.liveDemand!)}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

const MAX_LIVE_POINTS = 20;

export function ForecastChart({ height = 360, monthId }: { height?: number; monthId?: string }) {
  const uid = useId().replace(/:/g, "");
  const gradId = `df-confidence-${uid}`;
  const [view, setView] = useState<ChartView>("combined");
  const [livePoints, setLivePoints] = useState<LiveDemandPoint[]>([]);
  const [tickCount, setTickCount] = useState(0);

  // Subscribe to live pipeline SSE
  useEffect(() => {
    const unsub = subscribeToPipeline((event: PipelineEvent) => {
      if (event.type === "init" && event.demand_history) {
        const points = event.demand_history.map((d: LiveDemandTick) => ({
          period: d.tick,
          predicted_demand: d.predicted_demand,
          rolling_mean_3: d.rolling_mean_3,
        }));
        setLivePoints(points.slice(-MAX_LIVE_POINTS));
        setTickCount((c) => c + 1);
      }

      if (event.type === "pipeline_tick") {
        const d = event.demand;
        setLivePoints((prev) => {
          const next = [
            ...prev,
            {
              period: d.tick,
              predicted_demand: d.predicted_demand,
              rolling_mean_3: d.rolling_mean_3,
            },
          ];
          return next.slice(-MAX_LIVE_POINTS);
        });
        setTickCount((c) => c + 1);
      }
    });

    return unsub;
  }, []);

  const {
    data: demand,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["demand-intelligence", monthId ?? "all"],
    queryFn: () => getDemandIntelligence(monthId),
    staleTime: 60_000,
  });

  const showLiveOverlay = monthId ? LIVE_MONTH_IDS.has(monthId) : true;
  const displayLivePoints = showLiveOverlay ? livePoints : [];

  const data = useMemo(
    () => enrichData(demand?.forecastSeries ?? [], displayLivePoints),
    [demand?.forecastSeries, displayLivePoints, tickCount]
  );

  const showConfidence = view === "confidence" || view === "combined";
  const showActual = view === "actual" || view === "combined";
  const showForecast = view === "forecast" || view === "combined";

  if (isLoading) return <LoadingBlock />;
  if (error) return <ErrorBlock error={error} onRetry={() => refetch()} />;
  if (!data.length || !demand) return <EmptyBlock />;

  const latestLive = displayLivePoints.length > 0 ? displayLivePoints[displayLivePoints.length - 1] : null;

  return (
    <section className={cn("rounded-md border border-border/70 bg-surface p-5 sm:p-6 space-y-5")}>
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0 space-y-1">
          <h3 className="text-base font-semibold tracking-tight text-foreground sm:text-lg flex items-center gap-2">
            Demand Forecast
            {displayLivePoints.length > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                <Radio className="h-3 w-3 animate-pulse" /> Live Pipeline Active
              </span>
            )}
          </h3>
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
            Historical Gold demand with live ML predictions streaming every 10 seconds.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 self-start">
          {latestLive && (
            <Badge
              variant="outline"
              className="border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400 px-2.5 py-1 text-[11px] font-semibold tracking-wide"
            >
              Latest: {formatDemandDetail(latestLive.predicted_demand)} units
            </Badge>
          )}
          <Badge
            variant="outline"
            className="border-border/80 bg-surface-muted/50 px-3 py-1 text-[11px] font-semibold tracking-wide text-foreground"
          >
            Accuracy {demand.accuracy}
          </Badge>
        </div>
      </div>

      <DemandForecastKpiStrip items={demand.kpiStrip} />

      <Tabs value={view} onValueChange={(v) => setView(v as ChartView)}>
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-md bg-muted/60 p-1 sm:grid-cols-4">
          <TabsTrigger value="actual" className="text-xs sm:text-sm">
            Actual
          </TabsTrigger>
          <TabsTrigger value="forecast" className="text-xs sm:text-sm">
            Forecast
          </TabsTrigger>
          <TabsTrigger value="confidence" className="text-xs sm:text-sm">
            Confidence
          </TabsTrigger>
          <TabsTrigger value="combined" className="text-xs sm:text-sm">
            Combined + Live
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="rounded-md border border-border/50 bg-surface-muted/25 p-4 sm:p-5">
        <div className="w-full min-w-0" style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data}
              margin={{ top: 18, right: 16, left: 4, bottom: 8 }}
              className="text-muted-foreground"
            >
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.14} />
                  <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0.03} />
                </linearGradient>
              </defs>

              <CartesianGrid
                stroke="var(--color-border)"
                strokeDasharray="4 4"
                vertical={false}
                strokeOpacity={0.55}
              />
              <XAxis
                dataKey="period"
                tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                axisLine={false}
                tickLine={false}
                tickMargin={10}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                axisLine={false}
                tickLine={false}
                width={44}
                tickFormatter={formatDemandTick}
              />
              <Tooltip
                content={<ForecastTooltip />}
                cursor={{ stroke: "var(--color-border)", strokeWidth: 1, strokeDasharray: "4 4" }}
                animationDuration={200}
              />

              <ReferenceLine
                y={CRITICAL_INVENTORY_THRESHOLD}
                stroke="var(--color-chart-5)"
                strokeDasharray="5 5"
                strokeOpacity={0.65}
                label={{
                  value: "Critical threshold",
                  position: "insideTopRight",
                  fill: "var(--color-muted-foreground)",
                  fontSize: 11,
                  fontWeight: 500,
                }}
              />

              {showConfidence ? (
                <>
                  <Area
                    type="monotone"
                    dataKey="lower"
                    stackId="confidence"
                    stroke="none"
                    fill="var(--color-surface)"
                    fillOpacity={0}
                    isAnimationActive
                    animationDuration={420}
                  />
                  <Area
                    type="monotone"
                    dataKey="spread"
                    stackId="confidence"
                    stroke="none"
                    fill={`url(#${gradId})`}
                    fillOpacity={1}
                    isAnimationActive
                    animationDuration={420}
                  />
                </>
              ) : null}

              {showForecast ? (
                <Line
                  type="monotone"
                  dataKey="forecast"
                  name="Base forecast"
                  stroke="var(--color-chart-2)"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  dot={false}
                  activeDot={{
                    r: 4,
                    strokeWidth: 1,
                    stroke: "var(--color-surface)",
                    fill: "var(--color-chart-2)",
                  }}
                />
              ) : null}

              {showActual ? (
                <Line
                  type="monotone"
                  dataKey="actual"
                  name="Actual demand"
                  stroke="var(--color-foreground)"
                  strokeWidth={2.75}
                  strokeOpacity={0.88}
                  dot={false}
                  activeDot={{
                    r: 4,
                    strokeWidth: 1,
                    stroke: "var(--color-surface)",
                    fill: "var(--color-foreground)",
                  }}
                />
              ) : null}

              {/* Live ML Pipeline Demand */}
              <Line
                type="monotone"
                dataKey="liveDemand"
                name="Live ML Prediction"
                stroke="#10b981"
                strokeWidth={2.5}
                dot={{
                  r: 5,
                  fill: "#10b981",
                  stroke: "#ffffff",
                  strokeWidth: 2,
                }}
                activeDot={{
                  r: 7,
                  fill: "#10b981",
                  stroke: "#ffffff",
                  strokeWidth: 3,
                }}
                connectNulls
                isAnimationActive
                animationDuration={600}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}
