import { useState } from 'react';
import { Eye, LayoutDashboard, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

const WIDGET_META = [
  { key: 'today', label: "Today's workload", description: 'Schedule and items needing attention' },
  { key: 'performance', label: 'Performance summary', description: 'Revenue, bookings, conversion and CSAT' },
  { key: 'revenue', label: 'Revenue and workload', description: 'Revenue trend and booking pipeline' },
  { key: 'operations', label: 'Operations', description: 'Progress, statuses, services and utilisation' },
  { key: 'customerCare', label: 'Customer care', description: 'Complaints, surveys and recent bookings' },
];

export function DashboardCustomizer({ widgets, onToggle, onReset }) {
  const [open, setOpen] = useState(false);
  const visible = Object.values(widgets).filter(Boolean).length;

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <SlidersHorizontal /> Customize
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-md">
          <SheetHeader className="notification-hero border-b p-6 pr-12">
            <span className="clay-icon mb-2 grid size-10 place-items-center bg-primary/15 text-primary"><LayoutDashboard /></span>
            <SheetTitle className="text-xl">Your dashboard</SheetTitle>
            <SheetDescription>Choose the dashboard sections that are useful to you. Your selection stays on this device.</SheetDescription>
          </SheetHeader>
          <div className="space-y-2 p-4">
            <div className="text-muted-foreground mb-3 flex items-center justify-between px-1 text-xs"><span className="flex items-center gap-1.5"><Eye className="size-3.5" /> Visible sections</span><span>{visible} of {WIDGET_META.length}</span></div>
            {WIDGET_META.map((item) => (
              <label key={item.key} className="hover:bg-muted/50 flex cursor-pointer items-center gap-3 rounded-xl border border-border/70 p-3 transition-colors">
                <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{item.label}</span><span className="text-muted-foreground block text-xs">{item.description}</span></span>
                <Switch checked={widgets[item.key]} onCheckedChange={() => onToggle(item.key)} aria-label={`Show ${item.label}`} />
              </label>
            ))}
            <Button variant="outline" className="mt-4 w-full" onClick={onReset}><RotateCcw /> Restore default layout</Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
