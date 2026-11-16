import { BehaviorSubject, Subject, scan } from "rxjs";
import type { Resource, User } from "./models";
export interface Filters {
  month: string;
  category_id: string;
  department_id: string;
  assignee_employee_id: string;
  status: string;
  priority: string;
  keyword: string;
}
export interface CatalogState {
  companies?: Resource[];
  departments: Resource[];
  employees: Resource[];
  categories: Resource[];
}
export interface AppState {
  user: User | null;
  accessToken: string | null;
  filters: Filters;
  catalog: CatalogState;
  online: boolean;
}
export function initialState(): AppState {
  return {
    user: null,
    accessToken: null,
    filters: {
      month: new Date().toLocaleDateString("sv-SE").slice(0, 7),
      category_id: "",
      department_id: "",
      assignee_employee_id: "",
      status: "",
      priority: "",
      keyword: "",
    },
    catalog: { departments: [], employees: [], categories: [] },
    online: typeof navigator === "undefined" || navigator.onLine,
  };
}
export type Action =
  | { type: "session"; user: User; accessToken: string }
  | { type: "logout" }
  | { type: "filter"; key: keyof Filters; value: string }
  | { type: "catalog"; catalog: CatalogState }
  | { type: "online"; online: boolean };
export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "session": {
      const same =
        state.user?.id === action.user.id &&
        state.user?.company_id === action.user.company_id;
      return {
        ...(same ? state : initialState()),
        online: state.online,
        user: action.user,
        accessToken: action.accessToken,
      };
    }
    case "logout":
      return { ...initialState(), online: state.online };
    case "filter":
      return {
        ...state,
        filters: {
          ...state.filters,
          [action.key]: action.value,
          ...(action.key === "department_id"
            ? { assignee_employee_id: "" }
            : {}),
        },
      };
    case "catalog":
      return { ...state, catalog: action.catalog };
    case "online":
      return state.online === action.online
        ? state
        : { ...state, online: action.online };
  }
}
export function createAppStore(seed = initialState()) {
  const actions = new Subject<Action>();
  const snapshot = new BehaviorSubject(seed);
  const subscription = actions.pipe(scan(reducer, seed)).subscribe(snapshot);
  return {
    dispatch: (action: Action) => actions.next(action),
    getSnapshot: () => snapshot.value,
    subscribe: (listener: () => void) => {
      const observer = snapshot.subscribe(() => listener());
      return () => observer.unsubscribe();
    },
    destroy: () => {
      subscription.unsubscribe();
      actions.complete();
      snapshot.complete();
    },
  };
}
export const appStore = createAppStore();
