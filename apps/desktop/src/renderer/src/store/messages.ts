/**
 * Messages = pipeline notices (per step) + app-level messages (tool install
 * failures, failed IPC calls …). Read/dismissed state is per project and kept
 * in localStorage (best-effort).
 */
import type { StageNotice } from '@shared/api';
import { useMemo } from 'react';
import { create } from 'zustand';
import { useApp } from './app';
import { usePipeline, type NoticeItem } from './pipeline';

export type MessageLevel = StageNotice['level'];

export interface Message {
  id: string;
  level: MessageLevel;
  title: string;
  detail?: string;
  hint?: string;
  code?: string;
  /** Pipeline step key, for pipeline notices. */
  key?: string;
  stageId?: string;
  /** ISO time; empty for notices of cached results. */
  at: string;
  source: 'pipeline' | 'app';
}

interface MessagesState {
  app: Message[];
  read: Set<string>;
  dismissed: Set<string>;
  scope?: string;
  pushMessage(m: Omit<Message, 'id' | 'at' | 'source'> & { at?: string }): void;
  markRead(ids: string[]): void;
  dismiss(ids: string[]): void;
  /** Load read/dismissed state for a project (dir). */
  setScope(scope: string | undefined): void;
}

let seq = 0;
const storageKey = (scope: string) => `sc.messages.${scope}`;

function loadState(scope: string | undefined): { read: Set<string>; dismissed: Set<string> } {
  if (!scope) return { read: new Set(), dismissed: new Set() };
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(scope)) ?? '{}');
    return { read: new Set(raw.read ?? []), dismissed: new Set(raw.dismissed ?? []) };
  } catch {
    return { read: new Set(), dismissed: new Set() };
  }
}

function saveState(scope: string | undefined, read: Set<string>, dismissed: Set<string>) {
  if (!scope) return;
  try {
    // Keep the newest few hundred ids only.
    localStorage.setItem(storageKey(scope), JSON.stringify({ read: [...read].slice(-400), dismissed: [...dismissed].slice(-400) }));
  } catch {
    /* storage unavailable */
  }
}

export const useMessages = create<MessagesState>()((set, get) => ({
  app: [],
  read: new Set(),
  dismissed: new Set(),
  pushMessage(m) {
    const msg: Message = { ...m, id: `app|${++seq}|${m.title}`, at: m.at ?? new Date().toISOString(), source: 'app' };
    set((s) => ({ app: [...s.app.slice(-99), msg] }));
  },
  markRead(ids) {
    const read = new Set(get().read);
    ids.forEach((i) => read.add(i));
    saveState(get().scope, read, get().dismissed);
    set({ read });
  },
  dismiss(ids) {
    const dismissed = new Set(get().dismissed);
    const read = new Set(get().read);
    ids.forEach((i) => {
      dismissed.add(i);
      read.add(i);
    });
    saveState(get().scope, read, dismissed);
    set({ dismissed, read });
  },
  setScope(scope) {
    if (scope === get().scope) return;
    set({ scope, ...loadState(scope) });
  },
}));

export function pushMessage(m: Parameters<MessagesState['pushMessage']>[0]) {
  useMessages.getState().pushMessage(m);
}

export const fromNotice = (n: NoticeItem): Message => ({
  id: n.id,
  level: n.notice.level,
  title: n.notice.title,
  detail: n.notice.detail,
  hint: n.notice.hint,
  code: n.notice.code,
  key: n.key,
  stageId: n.stageId,
  at: n.at,
  source: 'pipeline',
});

const rank = { error: 0, warning: 1, info: 2 } as const;

/** All visible messages of the current project, newest first. */
export function useAllMessages(): Message[] {
  const notices = usePipeline((s) => s.notices);
  const app = useMessages((s) => s.app);
  const dismissed = useMessages((s) => s.dismissed);
  const projectDir = useApp((s) => s.project?.dir);
  return useMemo(() => {
    void projectDir;
    const all = [...Object.values(notices).flat().map(fromNotice), ...app].filter((m) => !dismissed.has(m.id));
    return all.sort((a, b) => (b.at || '0').localeCompare(a.at || '0') || rank[a.level] - rank[b.level]);
  }, [notices, app, dismissed, projectDir]);
}

/** Unread warnings/errors (info never raises the badge). */
export function useUnreadCount(): number {
  const all = useAllMessages();
  const read = useMessages((s) => s.read);
  return all.filter((m) => m.level !== 'info' && !read.has(m.id)).length;
}

/** Worst level of a step's notices. */
export function worstLevel(items: NoticeItem[] | undefined): MessageLevel | undefined {
  if (!items?.length) return undefined;
  return items.reduce<MessageLevel>((w, x) => (rank[x.notice.level] < rank[w] ? x.notice.level : w), 'info');
}
