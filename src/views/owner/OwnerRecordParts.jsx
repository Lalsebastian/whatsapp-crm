import { useState } from 'react';
import { Download } from 'lucide-react';
import { formatNumber } from '@/lib/utils';
import { BulkActionBar } from '@/components/data/BulkActionBar';
import { Button } from '@/components/ui/button';
import { downloadCsv, stamp } from '@/lib/csv';

// Small building blocks shared by the owner bookings/complaints/escalations views.

export function RecordBulkActions({ selectedIds, rows, statusOptions, pending, onApply, onClear, exportName, exportColumns }) {
  const [nextStatus, setNextStatus] = useState('');
  const selectedRows = rows.filter((row) => selectedIds.includes(row.id));
  return (
    <BulkActionBar count={selectedIds.length} onClear={onClear}>
      <select value={nextStatus} onChange={(event) => setNextStatus(event.target.value)} className="bg-background h-8 rounded-lg border px-2 text-xs" aria-label="Choose status for selected records">
        <option value="">Choose status…</option>
        {Object.entries(statusOptions).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}
      </select>
      <Button size="sm" disabled={!nextStatus || pending} onClick={() => onApply(nextStatus)}>{pending ? 'Updating…' : 'Apply'}</Button>
      <Button variant="outline" size="sm" onClick={() => downloadCsv(stamp(exportName), selectedRows, exportColumns)}><Download /> Export</Button>
    </BulkActionBar>
  );
}

export function QueueMetric({ label, value, tone = 'info' }) {
  const tones = {
    info: 'border-info/20 bg-info/7 text-info',
    warning: 'border-warning/25 bg-warning/8 text-warning',
    success: 'border-success/20 bg-success/7 text-success',
  };

  return (
    <div className={`rounded-2xl border p-4 ${tones[tone] ?? tones.info}`}>
      <div className="text-xs font-medium opacity-80">{label}</div>
      <div className="tabular mt-1 text-2xl font-semibold">{formatNumber(value)}</div>
    </div>
  );
}
