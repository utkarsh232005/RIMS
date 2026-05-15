import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page-header";
import { InventoryChart } from "@/components/charts/inventory-chart";
import { WarehouseUtilization } from "@/components/dashboard/warehouse-utilization";
import { AIInsights } from "@/components/dashboard/ai-insights";
import { getInventoryAnalytics } from "@/services/inventory";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/common/data-state";
import { cn } from "@/lib/utils";
import { AlertTriangle, Boxes } from "lucide-react";

export const Route = createFileRoute("/inventory")({
  head: () => ({
    meta: [
      { title: "Inventory · RIMS" },
      { name: "description", content: "Stock levels, reorder signals, and warehouse utilization." },
    ],
  }),
  component: InventoryPage,
});

const statusTone = {
  Healthy: "bg-success/10 text-success",
  Low: "bg-warning/15 text-warning-foreground",
  Critical: "bg-destructive/10 text-destructive",
  Overstock: "bg-info/10 text-info",
} as const;

function InventoryPage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["inventory-analytics"],
    queryFn: getInventoryAnalytics,
    staleTime: 60_000,
  });
  const inventoryItems = data?.items ?? [];
  const critical = inventoryItems.filter((i) => i.status === "Critical").length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Inventory"
        title="Stock Health"
        description="Live stock levels, reorder signals, and warehouse capacity."
      />

      {isLoading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock error={error} onRetry={() => refetch()} />
      ) : critical > 0 ? (
        <div className="flex items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <div>
            <p className="text-sm font-semibold text-destructive">
              {critical} critical SKU{critical > 1 ? "s" : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              Auto-replenishment triggered. Review pending POs.
            </p>
          </div>
        </div>
      ) : null}

      {!isLoading && !error && !inventoryItems.length ? (
        <EmptyBlock label="No inventory items returned" />
      ) : null}

      {!isLoading && !error && inventoryItems.length ? (
        <>
          <div className="grid gap-6 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <InventoryChart />
            </div>
            <WarehouseUtilization />
          </div>

          <div className="rounded-md border border-border bg-surface overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
              <div className="flex items-center gap-2">
                <Boxes className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">SKU-Level Inventory</h3>
              </div>
              <span className="text-[11px] text-muted-foreground">
                {inventoryItems.length} SKUs
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-muted text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-5 py-2.5 font-semibold">SKU</th>
                    <th className="px-5 py-2.5 font-semibold">Product</th>
                    <th className="px-5 py-2.5 font-semibold">Warehouse</th>
                    <th className="px-5 py-2.5 font-semibold text-right">Stock</th>
                    <th className="px-5 py-2.5 font-semibold text-right">Reorder pt</th>
                    <th className="px-5 py-2.5 font-semibold text-right">Cover</th>
                    <th className="px-5 py-2.5 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {inventoryItems.map((it) => (
                    <tr key={`${it.sku}-${it.warehouse}`} className="hover:bg-muted/40">
                      <td className="px-5 py-3 font-mono text-xs text-foreground">{it.sku}</td>
                      <td className="px-5 py-3 text-xs">
                        <p className="font-medium text-foreground">{it.name}</p>
                        <p className="text-[10px] text-muted-foreground">{it.category}</p>
                      </td>
                      <td className="px-5 py-3 text-xs text-muted-foreground">{it.warehouse}</td>
                      <td className="px-5 py-3 text-right text-xs tabular-nums text-foreground">
                        {it.stock.toLocaleString()}
                      </td>
                      <td className="px-5 py-3 text-right text-xs tabular-nums text-muted-foreground">
                        {it.reorderPoint.toLocaleString()}
                      </td>
                      <td className="px-5 py-3 text-right text-xs tabular-nums text-foreground">
                        {it.daysOfCover}d
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                            statusTone[it.status],
                          )}
                        >
                          {it.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}

      <AIInsights />
    </div>
  );
}
