import { emptyAssistant, type AssistantState } from './assistant-model';
import { useSyncExternalStore } from 'react';
import { Subject, scan, shareReplay, startWith } from 'rxjs';
import type { Session, Task } from './contracts';
import type { UnifiedTask } from './unified-tasks';
import type { ScheduleSnapshot } from './schedules-model';
import { eggProfileSchema, type EggProfile } from './bom-eggs';
import { defaultReportFilters, type ReportFilters, type ReportSnapshot } from './delivery-report';
function loadEggProfile(): EggProfile {
  try {
    return eggProfileSchema.parse(JSON.parse(localStorage.getItem('bom-egg-profile-v1') ?? '{}'));
  } catch {
    return eggProfileSchema.parse({});
  }
}
function loadDeliveryListWidth(): number {
  try {
    const value = Number(localStorage.getItem('delivery-list-width-v1'));
    if (Number.isFinite(value) && value >= 30 && value <= 70) return value;
  } catch {
    /* Use the default width when local storage is unavailable. */
  }
  return 45;
}
export interface AppState {
  assistant: AssistantState;
  deliveryListWidth: number;
  deliveryReportFilters: ReportFilters;
  deliveryReportSnapshot: ReportSnapshot | null;
  eggProfile: EggProfile;
  scheduleMonth: string;
  scheduleDepartment: string;
  scheduleSnapshot: ScheduleSnapshot | null;
  session: Session | null;
  unifiedRows: UnifiedTask[];
  unifiedMonth: string;
  revenueFilters: {
    period: 'month' | 'year' | 'all' | 'custom';
    start: string;
    end: string;
    source: 'all' | 'retail' | 'supply';
    customers: string[];
    channels: string[];
  };
  tasks: Task[];
  taskTotal: number;
  taskPage: number;
  taskFilters: Record<string, string>;
  taskLoading: boolean;
  taskError: string;
  taskBoard: boolean;
}
export type Action =
  | { type: 'assistant'; value: AssistantState }
  | { type: 'deliveryListWidth'; percent: number; remember?: boolean }
  | { type: 'deliveryReportFilters'; filters: ReportFilters }
  | { type: 'deliveryReportSnapshot'; snapshot: ReportSnapshot | null }
  | { type: 'eggProfile'; profile: EggProfile }
  | { type: 'scheduleMonth'; month: string }
  | { type: 'scheduleDepartment'; department: string }
  | { type: 'scheduleSnapshot'; snapshot: ScheduleSnapshot }
  | { type: 'revenueFilters'; filters: AppState['revenueFilters'] }
  | { type: 'unifiedRows'; rows: UnifiedTask[] }
  | { type: 'unifiedMonth'; month: string }
  | { type: 'session'; session: Session | null }
  | { type: 'tasks'; tasks: Task[] }
  | { type: 'total'; total: number }
  | { type: 'page'; page: number }
  | { type: 'filters'; filters: Record<string, string> }
  | { type: 'loading'; loading: boolean }
  | { type: 'error'; error: string }
  | { type: 'board'; board: boolean }
  | { type: 'init' };
export function initialState(): AppState {
  return {
    assistant: emptyAssistant(),
    deliveryListWidth: loadDeliveryListWidth(),
    deliveryReportFilters: defaultReportFilters(),
    deliveryReportSnapshot: null,
    eggProfile: loadEggProfile(),
    scheduleMonth: new Date()
      .toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
      .slice(0, 7),
    scheduleDepartment: '',
    scheduleSnapshot: null,
    session: null,
    revenueFilters: {
      period: 'month',
      start: new Date().toLocaleDateString('sv-SE').slice(0, 7) + '-01',
      end: new Date().toLocaleDateString('sv-SE'),
      source: 'all',
      customers: [],
      channels: [],
    },
    unifiedRows: [],
    unifiedMonth: new Date().toLocaleDateString('sv-SE').slice(0, 7),
    tasks: [],
    taskTotal: 0,
    taskPage: 1,
    taskFilters: { month: new Date().toLocaleDateString('sv-SE').slice(0, 7) },
    taskLoading: false,
    taskError: '',
    taskBoard: false,
  };
}
export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'assistant':
      return { ...state, assistant: action.value };
    case 'deliveryListWidth':
      return Number.isFinite(action.percent)
        ? { ...state, deliveryListWidth: Math.min(70, Math.max(30, action.percent)) }
        : state;
    case 'deliveryReportFilters':
      return { ...state, deliveryReportFilters: action.filters };
    case 'deliveryReportSnapshot':
      return { ...state, deliveryReportSnapshot: action.snapshot };
    case 'eggProfile':
      return { ...state, eggProfile: eggProfileSchema.parse(action.profile) };
    case 'scheduleMonth':
      return { ...state, scheduleMonth: action.month, scheduleSnapshot: null };
    case 'scheduleDepartment':
      return { ...state, scheduleDepartment: action.department };
    case 'scheduleSnapshot':
      return { ...state, scheduleSnapshot: action.snapshot };
    case 'revenueFilters':
      return { ...state, revenueFilters: action.filters };
    case 'unifiedRows':
      return { ...state, unifiedRows: action.rows };
    case 'unifiedMonth':
      return { ...state, unifiedMonth: action.month, unifiedRows: [] };
    case 'init':
      return state;
    case 'session': {
      const same =
        action.session !== null &&
        state.session?.user.company_id === action.session?.user.company_id &&
        state.session?.user.id === action.session?.user.id &&
        state.session?.user.role === action.session?.user.role;
      return { ...(same ? state : initialState()), session: action.session };
    }
    case 'tasks':
      return { ...state, tasks: action.tasks };
    case 'total':
      return { ...state, taskTotal: action.total };
    case 'page':
      return { ...state, taskPage: action.page };
    case 'filters':
      return { ...state, taskFilters: action.filters, taskPage: 1 };
    case 'loading':
      return { ...state, taskLoading: action.loading };
    case 'error':
      return { ...state, taskError: action.error };
    case 'board':
      return { ...state, taskBoard: action.board };
  }
}
const actions = new Subject<Action>();
const seed = initialState();
export const state$ = actions.pipe(
  startWith<Action>({ type: 'init' }),
  scan(reducer, seed),
  shareReplay({ bufferSize: 1, refCount: false }),
);
let snapshot = seed;
const listeners = new Set<() => void>();
state$.subscribe((state) => {
  snapshot = state;
  listeners.forEach((listener) => listener());
});
export function dispatch(action: Action) {
  if (action.type === 'deliveryListWidth' && action.remember && Number.isFinite(action.percent)) {
    try {
      localStorage.setItem(
        'delivery-list-width-v1',
        String(Math.min(70, Math.max(30, action.percent))),
      );
    } catch {
      /* Resizing still works when local storage is unavailable. */
    }
  }
  if (action.type === 'eggProfile') {
    const profile = eggProfileSchema.parse(action.profile);
    // A blocked local storage must not prevent this recipe from being calculated.
    try {
      localStorage.setItem('bom-egg-profile-v1', JSON.stringify(profile));
    } catch {
      /* Keep the confirmed profile in memory for this session. */
    }
  }
  actions.next(action);
}
export function getState() {
  return snapshot;
}
export function useAppState() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState,
    getState,
  );
}
