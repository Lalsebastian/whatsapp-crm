import { Bookmark, Check, Clock3, LayoutGrid, Rows3, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useWorkspacePreferences } from '@/hooks/useWorkspacePreferences';

export function WorkspaceMenu() {
  const navigate = useNavigate();
  const workspace = useWorkspacePreferences();
  const records = workspace.pinned.length ? workspace.pinned : workspace.recent.slice(0, 4);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Open personal workspace" title="Personal workspace">
          <UserRound className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Personal workspace</DropdownMenuLabel>
        <div className="text-muted-foreground px-2 pb-1 text-xs">Your display settings and quick record links stay on this device.</div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-1.5"><Rows3 className="size-3" /> Interface density</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={workspace.density} onValueChange={workspace.setDensity}>
          <DropdownMenuRadioItem value="compact">Compact</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="comfortable">Comfortable</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="spacious">Spacious</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-1.5">
          {workspace.pinned.length ? <Bookmark className="size-3" /> : <Clock3 className="size-3" />}
          {workspace.pinned.length ? 'Pinned records' : 'Recent records'}
        </DropdownMenuLabel>
        {records.length ? records.map((record) => (
          <DropdownMenuItem key={record.href} onSelect={() => navigate(record.href)}>
            <LayoutGrid className="size-3.5" />
            <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{record.title}</span><span className="text-muted-foreground block truncate text-[10px]">{record.description}</span></span>
            {workspace.pinned.some((item) => item.href === record.href) ? <Check className="size-3 text-success" /> : null}
          </DropdownMenuItem>
        )) : <div className="text-muted-foreground px-2 py-3 text-xs">Open a CRM record to start building your workspace.</div>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
