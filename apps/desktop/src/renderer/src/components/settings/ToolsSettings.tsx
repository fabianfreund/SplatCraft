import type { PluginInfo, ToolStatus } from '@shared/api';
import { Download, Puzzle, RefreshCw, Wrench } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { pushMessage } from '../../store/messages';
import { Badge, Button, HelpTip, IconButton, Label, ProgressBar, Skeleton, Text, Tooltip } from '../../ui';

/** Settings → Tools & Add-ons: external programs and installed plugins. */
export function ToolsSettings() {
  const [tools, setTools] = useState<ToolStatus[] | null>(null);
  const [plugins, setPlugins] = useState<PluginInfo[] | null>(null);
  const [progress, setProgress] = useState<Record<string, { fraction: number; message: string }>>({});

  const refresh = useCallback(async (force = false) => {
    setTools(null);
    setTools(await window.splatcraft.tools.status(force));
  }, []);

  useEffect(() => {
    void refresh();
    void window.splatcraft.plugins.list().then(setPlugins);
    return window.splatcraft.tools.onInstallProgress((p) => setProgress((s) => ({ ...s, [p.id]: { fraction: p.fraction, message: p.message } })));
  }, [refresh]);

  const install = async (id: string) => {
    setProgress((s) => ({ ...s, [id]: { fraction: 0, message: '' } }));
    try {
      const st = await window.splatcraft.tools.install(id);
      setTools((ts) => ts?.map((t) => (t.id === id ? st : t)) ?? null);
    } catch (e) {
      const name = tools?.find((t) => t.id === id)?.name ?? id;
      pushMessage({ level: 'error', title: `${name} could not be installed`, detail: String((e as Error).message ?? e), hint: tools?.find((t) => t.id === id)?.installHint });
    } finally {
      setProgress((s) => {
        const { [id]: _, ...rest } = s;
        return rest;
      });
    }
  };

  return (
    <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-2">
          <div className="flex h-6 items-center gap-1.5">
            <Label>Tools</Label>
            <HelpTip text="External programs used by the pipeline. Source: env = environment variable, managed = installed by SplatCraft, bundled = shipped with the app, path = found on PATH." />
            <div className="ml-auto">
              <IconButton icon={RefreshCw} label="Re-detect" size="xs" onClick={() => void refresh(true)} />
            </div>
          </div>
          <div className="overflow-hidden rounded-lg border border-line">
            {tools === null
              ? Array.from({ length: 4 }, (_, i) => (
                  <div key={i} className="flex h-[52px] items-center border-b border-line px-3 last:border-b-0">
                    <Skeleton width="60%" height={12} />
                  </div>
                ))
              : tools.map((t) => {
                  const p = progress[t.id];
                  return (
                    <div key={t.id} className="flex h-[52px] items-center gap-3 border-b border-line bg-surface-1 px-3 last:border-b-0">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-3 text-fg-muted">
                        <Wrench size={14} />
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <div className="flex items-center gap-1.5">
                          <Text weight="semibold">{t.name}</Text>
                          {t.version && (
                            <Text size="xs" tone="subtle" num>
                              {t.version}
                            </Text>
                          )}
                          <HelpTip text={t.error ?? t.installHint} />
                        </div>
                        <div className="flex h-4 items-center">
                          {p ? (
                            <div className="flex w-full items-center gap-2">
                              <ProgressBar value={p.fraction} height={3} active />
                              <Text size="2xs" tone="subtle" num className="w-[150px] shrink-0 ellipsis">
                                {p.message}
                              </Text>
                            </div>
                          ) : (
                            <Tooltip content={t.path} className="min-w-0">
                              <Text size="xs" tone="faint" mono truncate>
                                {t.path ?? '—'}
                              </Text>
                            </Tooltip>
                          )}
                        </div>
                      </div>
                      <div className="flex w-[160px] shrink-0 items-center justify-end gap-1.5">
                        {t.source && <Badge width={64}>{t.source}</Badge>}
                        {t.available ? (
                          <Badge tone="success" width={76}>
                            Ready
                          </Badge>
                        ) : t.installable ? (
                          <Button size="sm" variant="primary" icon={Download} minWidth={76} loading={!!p} onClick={() => void install(t.id)}>
                            Install
                          </Button>
                        ) : (
                          <Badge tone="danger" width={76}>
                            Missing
                          </Badge>
                        )}
                      </div>
                    </div>
                  );
                })}
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <div className="flex h-6 items-center gap-1.5">
            <Label>Plugins</Label>
          </div>
          <div className="overflow-hidden rounded-lg border border-line">
            {(plugins ?? []).map((p) => (
              <div key={p.id} className="flex min-h-[52px] items-center gap-3 border-b border-line bg-surface-1 px-3 py-2 last:border-b-0">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
                  <Puzzle size={14} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-center gap-1.5">
                    <Text weight="semibold">{p.name}</Text>
                    <Text size="xs" tone="subtle" num>
                      {p.version}
                    </Text>
                    <HelpTip text={p.description} />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {p.stages.map((s) => (
                      <Badge key={s} tone="accent">
                        {s}
                      </Badge>
                    ))}
                    {p.tools.map((s) => (
                      <Badge key={s} tone="info">
                        {s}
                      </Badge>
                    ))}
                    {p.monitors.map((s) => (
                      <Badge key={s}>{s}</Badge>
                    ))}
                  </div>
                </div>
                <div className="tnum flex w-[150px] shrink-0 justify-end gap-2 text-2xs text-fg-subtle">
                  <span>{p.stages.length} stages</span>
                  <span>{p.tools.length} tools</span>
                </div>
              </div>
            ))}
            {plugins === null && (
              <div className="flex h-[52px] items-center px-3">
                <Skeleton width="50%" height={12} />
              </div>
            )}
          </div>
        </section>
    </div>
  );
}
