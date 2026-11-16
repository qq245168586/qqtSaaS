export const workspaceModules = [
  'home',
  'orders',
  'delivery',
  'bom',
  'costing',
  'staff',
  'compliance',
  'confluence',
  'settings',
] as const;
export type WorkspaceModule = (typeof workspaceModules)[number];

export const workspacePages = [
  'task-list',
  'todos',
  'revenue',
  'overview',
  'compliance',
  'confluence',
  'ai-settings',
  'tasks',
  'categories',
  'delivery',
  'summary',
  'catalog',
  'templates',
  'bom',
  'costing',
  'departments',
  'employees',
  'schedules',
  'users',
  'backup',
  'settings',
] as const;
export type WorkspacePage = (typeof workspacePages)[number];

export const moduleLabels: Record<WorkspaceModule, string> = {
  home: '总览',
  orders: '零售',
  delivery: '供应链',
  bom: 'BOM 管理',
  costing: '成本核算',
  staff: '员工管理',
  compliance: '合规管理',
  confluence: 'Confluence',
  settings: '设置',
};

export const pageModules: Record<WorkspacePage, WorkspaceModule> = {
  'task-list': 'home',
  todos: 'home',
  revenue: 'home',
  overview: 'home',
  'ai-settings': 'settings',
  tasks: 'orders',
  categories: 'orders',
  delivery: 'delivery',
  summary: 'delivery',
  catalog: 'delivery',
  templates: 'delivery',
  bom: 'bom',
  costing: 'costing',
  departments: 'settings',
  employees: 'staff',
  schedules: 'staff',
  users: 'settings',
  backup: 'settings',
  compliance: 'compliance',
  confluence: 'confluence',
  settings: 'settings',
};

export interface NavigationPreference {
  counts: Partial<Record<WorkspaceModule, number>>;
  lastModule?: WorkspaceModule;
  lastPages: Partial<Record<WorkspaceModule, WorkspacePage>>;
}

export function emptyNavigationPreference(): NavigationPreference {
  return { counts: {}, lastPages: {} };
}

function isModule(value: unknown): value is WorkspaceModule {
  return typeof value === 'string' && workspaceModules.includes(value as WorkspaceModule);
}

function isPage(value: unknown): value is WorkspacePage {
  return typeof value === 'string' && workspacePages.includes(value as WorkspacePage);
}

export function parseNavigationPreference(raw: string | null): NavigationPreference {
  if (!raw) return emptyNavigationPreference();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return emptyNavigationPreference();
    const source = parsed as Record<string, unknown>;
    const counts: NavigationPreference['counts'] = {};
    const rawCounts = source.counts;
    if (rawCounts && typeof rawCounts === 'object') {
      for (const module of workspaceModules) {
        const count = (rawCounts as Record<string, unknown>)[module];
        if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0)
          counts[module] = count;
      }
    }
    const lastPages: NavigationPreference['lastPages'] = {};
    const rawPages = source.lastPages;
    if (rawPages && typeof rawPages === 'object') {
      for (const module of workspaceModules) {
        const storedPage = (rawPages as Record<string, unknown>)[module];
        const page = storedPage === 'ai' ? 'tasks' : storedPage;
        if (isPage(page) && pageModules[page] === module) lastPages[module] = page;
        else if (isPage(page) && !lastPages[pageModules[page]]) lastPages[pageModules[page]] = page;
      }
    }
    return {
      counts,
      lastPages,
      ...(isModule(source.lastModule) ? { lastModule: source.lastModule } : {}),
    };
  } catch {
    return emptyNavigationPreference();
  }
}

export function recordPageVisit(
  preference: NavigationPreference,
  page: WorkspacePage,
): NavigationPreference {
  const module = pageModules[page];
  return {
    counts: {
      ...preference.counts,
      [module]: (preference.counts[module] ?? 0) + 1,
    },
    lastModule: module,
    lastPages: { ...preference.lastPages, [module]: page },
  };
}

export function preferredModule(
  preference: NavigationPreference,
  allowed: readonly WorkspaceModule[],
): WorkspaceModule {
  if (!allowed.length) return 'home';
  let best = allowed[0];
  let bestCount = preference.counts[best] ?? 0;
  for (const module of allowed.slice(1)) {
    const count = preference.counts[module] ?? 0;
    if (count > bestCount) {
      best = module;
      bestCount = count;
    }
  }
  if (
    preference.lastModule &&
    allowed.includes(preference.lastModule) &&
    (preference.counts[preference.lastModule] ?? 0) === bestCount
  )
    return preference.lastModule;
  return best;
}

export function preferredPage(
  preference: NavigationPreference,
  module: WorkspaceModule,
  allowedPages: readonly WorkspacePage[],
): WorkspacePage {
  const saved = preference.lastPages[module];
  if (saved && pageModules[saved] === module && allowedPages.includes(saved)) return saved;
  return allowedPages[0] ?? 'tasks';
}

export function navigationPreferenceKey(server: string, userId: string): string {
  return `tmytri-navigation-v1:${server}:${userId}`;
}
import type { Session } from './contracts';

export function navigationSessionKey(server: string, session: Session): string {
  const { id, company_id, role, public_access, must_change_password } = session.user;
  return JSON.stringify([server, id, company_id, role, !!public_access, !!must_change_password]);
}
