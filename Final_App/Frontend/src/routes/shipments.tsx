import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page-header";
import { ShipmentTable } from "@/components/dashboard/shipment-table";
import { ShipmentChart } from "@/components/charts/shipment-chart";
import { ActivityPanel } from "@/components/dashboard/activity-panel";
import { getShipmentAnalytics } from "@/services/shipments";
import { ErrorBlock, LoadingBlock } from "@/components/common/data-state";
import { Truck, Clock, AlertTriangle, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/shipments")({
  head: () => ({
    meta: [
      { title: "Shipments · RIMS" },
      {
        name: "description",
        content: "Live shipment tracking, ETA predictions, and route intelligence.",
      },
    ],
  }),
  component: ShipmentsPage,
});

const statChrome = [
  { Icon: Truck, tone: "text-primary bg-primary-soft" },
  { Icon: CheckCircle2, tone: "text-success bg-success/10" },
  { Icon: Clock, tone: "text-warning-foreground bg-warning/15" },
  { Icon: AlertTriangle, tone: "text-destructive bg-destructive/10" },
];

function ShipmentsPage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["shipment-analytics"],
    queryFn: getShipmentAnalytics,
    staleTime: 60_000,
  });
  const stats = data?.stats ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Logistics"
        title="Shipments"
        description="Real-time tracking with AI-driven ETA and dynamic re-routing."
      />

      {isLoading ? <LoadingBlock /> : null}
      {error ? <ErrorBlock error={error} onRetry={() => refetch()} /> : null}

      {!isLoading && !error ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {stats.map((s, index) => {
            const chrome = statChrome[index] ?? statChrome[0];
            return (
              <div key={s.label} className="rounded-md border border-border bg-surface p-4">
                <div
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${chrome.tone}`}
                >
                  <chrome.Icon className="h-4.5 w-4.5" />
                </div>
                <p className="mt-3 text-2xl font-semibold text-foreground">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            );
          })}
        </div>
      ) : null}

      {!isLoading && !error ? (
        <>
          <ShipmentChart />
          <ShipmentTable data={data?.shipments} title="All Shipments" />
          <ActivityPanel />
        </>
      ) : null}
    </div>
  );
}
