import { RotateCcw, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function TableViewControls({ columns, density, hidden, onDensityChange, onToggleColumn, onReset }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Customize table view">
          <Settings2 className="size-3.5" /> View
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Table density</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={density} onValueChange={onDensityChange}>
          <DropdownMenuRadioItem value="compact">Compact</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="comfortable">Comfortable</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="spacious">Spacious</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
        {columns.filter((column) => !column.required).map((column) => (
          <DropdownMenuCheckboxItem
            key={column.key}
            checked={!hidden.includes(column.key)}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={() => onToggleColumn(column.key)}
          >
            {column.header}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <button type="button" onClick={onReset} className="text-muted-foreground hover:bg-muted flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm">
          <RotateCcw className="size-3.5" /> Reset view
        </button>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
