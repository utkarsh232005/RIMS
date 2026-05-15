import { useState } from "react";
import { Bell, Menu, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SidebarNavLinks } from "@/components/layout/sidebar";

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-4 lg:px-6">
        <button
          type="button"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:hidden"
          aria-label="Open menu"
          onClick={() => setMobileOpen(true)}
        >
          <Menu className="h-4 w-4" />
        </button>

        <div className="relative min-w-0 flex-1 max-w-lg">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search orders, SKUs, shipments…"
            className="h-9 border-border/80 bg-surface pl-9 text-sm shadow-none focus-visible:ring-1"
          />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className="relative flex h-9 w-9 items-center justify-center rounded-full border border-border/80 bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Notifications"
          >
            <Bell className="h-4 w-4" />
            <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-destructive" />
          </button>
          <div className="flex items-center gap-2 border-l border-border/80 pl-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              AK
            </div>
            <div className="hidden leading-tight sm:block">
              <p className="text-xs font-semibold text-foreground">Alex Kim</p>
              <p className="text-[11px] text-muted-foreground">Operations</p>
            </div>
          </div>
        </div>
      </header>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="w-[min(100%,20rem)] border-r border-border p-0 sm:max-w-xs"
        >
          <SheetHeader className="border-b border-border px-5 py-4 text-left">
            <SheetTitle className="text-base font-semibold">RIMS</SheetTitle>
          </SheetHeader>
          <div className="px-3 py-4">
            <SidebarNavLinks onNavigate={() => setMobileOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
