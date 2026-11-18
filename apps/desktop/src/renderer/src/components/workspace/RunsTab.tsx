import type { RunSummary } from '@shared/api';
import { LayoutList, Settings2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatClock, formatDateTime } from '../../lib/format';
import { useApp } from '../../store/app';
import { useMonitor } from '../../store/monitor';
import { usePipeline } from '../../store/pipeline';
import { Button, EmptyState, Label, Skeleton, StatusChip, Table, Td, Th, Tr, type StepStatus } from '../../ui';

const statusOf = (r: RunSummary): StepStatus =>
  r.status === 'completed' ? 'done' : r.status === 'failed' ? 'error' : r.status === 'cancelled' ? 'cancelled' : r.status === 'running' ? 'running' : 'idle';

export function RunsTab() {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const runId = usePipeline((s) => s.runId);
  const running = usePipeline((s) => s.running);
  const runStartedAt = usePipeline((s) => s.runStartedAt);
  const runEndedAt = usePipeline((s) => s.runEndedAt);
  const selectRun = useMonitor((s) => s.selectRun);
  const selected = useMonitor((s) => s.selectedRun);
  const setTab = useApp((s) => s.setTab);
  const setToolsOpen = useApp((s) => s.setToolsOpen);

  useEffect(() => {
    void window.splatcraft.pipeline.runs().then(setRuns);
  }, [runId, running]);

  return (
    <div className="scroll-stable absolute inset-0 bg-bg px-5 py-4" style={{ animation: 'sc-fade-in var(--sc-duration-base) var(--sc-ease-out)' }}>
      <div className="mx-auto flex max-w-[1000px] flex-col gap-3">
        <div className="flex h-7 items-center">
          <Label>Runs</Label>
          <Button size="sm" variant="subtle" icon={Settings2} className="ml-auto" onClick={() => setToolsOpen(true)}>
            Tools & Add-ons
          </Button>
        </div>
        <div className="overflow-hidden rounded-lg border border-line bg-surface-1">
          {runs === null ? (
            <div className="flex flex-col gap-2 p-3">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} height={28} />
              ))}
            </div>
          ) : !runs.length ? (
            <EmptyState icon={LayoutList} title="No Runs Yet" className="py-12" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th width={96}>Status</Th>
                  <Th width={160}>Started</Th>
                  <Th width={96} align="right">
                    Duration
                  </Th>
                  <Th>Run</Th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const live = r.runId === runId;
                  const dur = live && runStartedAt ? (running ? Date.now() : (runEndedAt ?? Date.now())) - runStartedAt : undefined;
                  return (
                    <Tr
                      key={r.runId}
                      selected={selected === r.runId || (live && selected === 'live')}
                      onClick={() => {
                        void selectRun(live ? 'live' : r.runId);
                        setTab('monitor');
                      }}
                    >
                      <Td>
                        <StatusChip status={live && running ? 'running' : statusOf(r)} />
                      </Td>
                      <Td className="tnum">{formatDateTime(r.startedAt)}</Td>
                      <Td align="right" className="tnum" muted>
                        {dur !== undefined ? formatClock(dur) : '—'}
                      </Td>
                      <Td mono muted>
                        {r.runId}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </div>
      </div>
    </div>
  );
}
