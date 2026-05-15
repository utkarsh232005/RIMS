import { Link, useRouterState } from "@tanstack/react-router";
import { Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { MAIN_NAV } from "@/components/layout/nav-config";

export function SidebarNavLinks({
  className,
  onNavigate,
}: {
  className?: string;
  onNavigate?: () => void;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav className={cn("flex flex-col gap-0.5", className)}>
      <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Operations
      </p>
      {MAIN_NAV.map((item) => {
        const active = pathname === item.url;
        const Icon = item.icon;
        return (
          <Link
            key={item.url}
            to={item.url}
            onClick={onNavigate}
            className={cn(
              "group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
            )}
          >
            <Icon
              className={cn(
                "h-4 w-4",
                active ? "text-primary" : "text-muted-foreground group-hover:text-primary",
              )}
            />
            <span>{item.title}</span>
            {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />}
          </Link>
        );
      })}
    </nav>
  );
}

export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar lg:w-72 md:flex">
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-sidebar-border px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Activity className="h-4 w-4" strokeWidth={2.25} />
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-sidebar-foreground">RIMS</p>
          <p className="text-[11px] text-muted-foreground">Supply chain control</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-5">
        <SidebarNavLinks />
      </div>

      <div className="m-3 mt-auto shrink-0 rounded-md border border-sidebar-border bg-surface p-3">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full bg-success" />
          <p className="text-xs font-medium text-sidebar-foreground">All systems healthy</p>
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
          12 agents active · No incidents (90 days)
        </p>
      </div>
    </aside>
  );
}
