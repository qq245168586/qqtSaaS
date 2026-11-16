import { Todos, useTodoReminders } from './Todos';
import { useAppState } from './store';
import { Accounts, Backup } from './Admin';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  ConfigProvider,
  Form,
  Input,
  Layout,
  Menu,
  Select,
  Space,
  message,
} from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { z } from 'zod';
import { api, errorText, http, ipc, isOffline, refresh, setSession } from './api';
import {
  deliverySchema,
  pageSchema,
  sessionSchema,
  type Delivery,
  type Session,
} from './contracts';
import { Tasks, Overview } from './Tasks';
import { GlobalAssistant } from './GlobalAssistant';
import { Catalog } from './Catalog';
import { Deliveries, Summary } from './Deliveries';
import { PrintTemplateProvider } from './PrintTemplateContext';
import { PrintTemplateEditor } from './PrintTemplateEditor';
import { printModel } from './delivery-model';
import { WindowsUpdate } from './WindowsUpdate';
import { AiSettings } from './AiSettings';
import { BomManagement } from './Bom';
import { CostingManagement } from './Costing';
import { Revenue } from './Revenue';
import { Compliance, useComplianceReminders } from './Compliance';
import { Schedules } from './Schedules';
import { UnifiedTasks } from './UnifiedTasks';
import { Confluence } from './Confluence';
import {
  moduleLabels,
  navigationPreferenceKey,
  navigationSessionKey,
  pageModules,
  parseNavigationPreference,
  preferredModule,
  preferredPage,
  recordPageVisit,
  workspaceModules,
  type WorkspaceModule,
  type WorkspacePage,
} from './navigation-preference';

interface NavigationItem {
  key: WorkspacePage;
  label: string;
}

function navigationGroups(session: Session): Record<WorkspaceModule, NavigationItem[]> {
  const manage = session.user.role !== 'employee';
  return {
    home: [
      { key: 'task-list', label: '任务列表' },
      { key: 'todos', label: '待办事项' },
      { key: 'revenue', label: '收入汇总' },
      { key: 'overview', label: '订单概览' },
    ],
    orders: [
      ...(manage
        ? [
            { key: 'tasks' as const, label: '任务汇总' },
            { key: 'categories' as const, label: '业务分类' },
          ]
        : [{ key: 'tasks' as const, label: '任务汇总' }]),
    ],
    delivery: manage
      ? [
          { key: 'delivery', label: '送货单' },
          { key: 'summary', label: '送货汇总' },
          { key: 'catalog', label: '送货基础资料' },
          { key: 'templates', label: '打印模板' },
        ]
      : [],
    bom: manage ? [{ key: 'bom', label: 'BOM 管理' }] : [],
    costing: manage ? [{ key: 'costing', label: '成本核算' }] : [],
    staff: manage
      ? [
          { key: 'employees', label: '员工资料' },
          { key: 'schedules', label: '排班管理' },
        ]
      : [],
    compliance: [{ key: 'compliance', label: '周期合规与留底' }],
    confluence: manage ? [{ key: 'confluence', label: 'Confluence' }] : [],
    settings: [
      ...(manage
        ? [
            { key: 'ai-settings' as const, label: 'AI 模型设置' },
            { key: 'departments' as const, label: '部门管理' },
          ]
        : []),
      ...(session.user.role === 'boss' && !session.user.public_access
        ? [
            { key: 'users' as const, label: '账号管理' },
            { key: 'backup' as const, label: '备份与恢复' },
          ]
        : []),
      ...(!session.user.public_access ? [{ key: 'settings' as const, label: '账户设置' }] : []),
    ],
  };
}
function ModuleIcon({ module }: { module: WorkspaceModule }) {
  const paths: Record<WorkspaceModule, string> = {
    home: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    orders: 'M5 7h14l1 14H4L5 7Z M8 7V5a4 4 0 0 1 8 0v2',
    delivery: 'M2 5h12v13H2z M14 10h4l4 4v4h-8 M5 18a2 2 0 1 0 4 0 M16 18a2 2 0 1 0 4 0',
    bom: 'M12 2l9 5-9 5-9-5 9-5Z M3 12l9 5 9-5 M3 17l9 5 9-5',
    costing: 'M4 5h16v14H4z M7 9h10 M7 13h4 M15 13h2 M7 16h4 M15 16h2',
    staff:
      'M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M1 21v-3a7 7 0 0 1 14 0v3 M17 4a4 4 0 0 1 0 8 M18 15a5 5 0 0 1 5 5',
    compliance: 'M12 2l8 4v6c0 5-8 10-8 10S4 17 4 12V6z M8 12l3 3 5-6',
    confluence: 'M5 3h10l4 4v14H5z M15 3v5h5 M8 12h8 M8 16h8',
    settings: 'M4 3v18 M12 3v18 M20 3v18 M1 8h6 M9 16h6 M17 9h6',
  };
  return (
    <svg
      className="module-icon ant-menu-item-icon"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d={paths[module]} />
    </svg>
  );
}
function Login() {
  const [busy, setBusy] = useState(false);
  async function login(value: { company_code: 'tri' | 'tmy'; username: string; password: string }) {
    setBusy(true);
    try {
      const session = await ipc(
        window.desktop.login({
          company_code: value.company_code,
          username: value.username,
          password: value.password,
        }),
        sessionSchema,
      );
      setSession(session);
    } catch (e) {
      void message.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login">
      <div>
        <div className="brand-mark">TMY / TRI</div>
        <h1>云端订单与送货管理</h1>
        <p>统一任务、生产协同与送货单工作台</p>
        <Form
          layout="vertical"
          onFinish={(value) => void login(value)}
          initialValues={{ company_code: 'tri', username: '' }}
        >
          <Form.Item label="公司" name="company_code">
            <Select
              options={[
                { value: 'tri', label: '趣趣特' },
                { value: 'tmy', label: '天美意' },
              ]}
            />
          </Form.Item>
          {
            <>
              <Form.Item label="账户" name="username" rules={[{ required: true }]}>
                <Input autoComplete="username" />
              </Form.Item>
              <Form.Item label="密码" name="password" rules={[{ required: true }]}>
                <Input.Password autoComplete="current-password" />
              </Form.Item>
            </>
          }
          <Button type="primary" htmlType="submit" loading={busy} block>
            登录
          </Button>
        </Form>
        <p className="secondary">公司数据独立隔离。账号由管理员分配。</p>
      </div>
    </main>
  );
}
function Password({ required, onChanged }: { required: boolean; onChanged: () => void }) {
  async function save(value: { current_password: string; new_password: string }) {
    try {
      await api('POST', '/auth/change-password', z.unknown(), value);
      void message.success('密码已修改，请使用新密码重新登录');
      await ipc(window.desktop.logout(), z.null()).catch(() => undefined);
      setSession(null);
      onChanged();
    } catch (e) {
      void message.error(errorText(e));
    }
  }
  return (
    <div style={{ maxWidth: 500 }}>
      <h1>{required ? '首次登录，请修改密码' : '修改密码'}</h1>
      <Form layout="vertical" onFinish={(value) => void save(value)}>
        <Form.Item label="当前密码" name="current_password" rules={[{ required: true }]}>
          <Input.Password />
        </Form.Item>
        <Form.Item
          label="新密码"
          name="new_password"
          rules={[{ required: true, min: 12, max: 128 }]}
        >
          <Input.Password />
        </Form.Item>
        <Button type="primary" htmlType="submit">
          保存密码
        </Button>
      </Form>
    </div>
  );
}
export default function App() {
  const { session } = useAppState();
  const todoReminder = useTodoReminders(!!session);
  const [server, setServer] = useState('');
  const compliance = useComplianceReminders(server);
  const [publicAccess, setPublicAccess] = useState(false);
  const [startupError, setStartupError] = useState('');
  const [initializing, setInitializing] = useState(true);
  const [offline, setOffline] = useState(isOffline());
  const [reconnecting, setReconnecting] = useState(false);
  useEffect(() => {
    const listener = () => setOffline(isOffline());
    window.addEventListener('api-connection', listener);
    // A child page can finish its first request before this parent effect subscribes.
    // Read the current connection state once so that successful startup requests are not missed.
    listener();
    return () => window.removeEventListener('api-connection', listener);
  }, []);
  const [page, setPage] = useState<WorkspacePage>('task-list');
  const [businessRevision, setBusinessRevision] = useState(0);
  const [requestedTaskId, setRequestedTaskId] = useState<string | null>(null);
  const [requestedId, setRequestedId] = useState<string | null>(null);
  const [templateDirty, setTemplateDirty] = useState(false);
  const [templateNotes, setTemplateNotes] = useState<Delivery[]>([]);
  const manage = session?.user.role !== 'employee';
  const groups = session ? navigationGroups(session) : null;
  const availableModules = groups
    ? workspaceModules.filter((module) => groups[module].length > 0)
    : (['home'] as WorkspaceModule[]);
  const currentModule = pageModules[page];
  const initializedNavigation = useRef<string | null>(null);
  useEffect(() => {
    if (!session) {
      initializedNavigation.current = null;
      return;
    }
    const identity = navigationSessionKey(server, session);
    // Token renewal must not reopen the preferred module or discard an active editor.
    if (initializedNavigation.current === identity) return;
    initializedNavigation.current = identity;
    const nextGroups = navigationGroups(session);
    const allowedModules = workspaceModules.filter((module) => nextGroups[module].length > 0);
    const key = navigationPreferenceKey(server, session.user.id);
    const preference = parseNavigationPreference(window.localStorage.getItem(key));
    const module = preferredModule(preference, allowedModules);
    setPage(
      preferredPage(
        preference,
        module,
        nextGroups[module].map((item) => item.key),
      ),
    );
    setRequestedId(null);
    setRequestedTaskId(null);
    setTemplateDirty(false);
  }, [server, session]);
  const clearRequest = useCallback(() => setRequestedId(null), []);
  useEffect(() => {
    void ipc(window.desktop.getServer(), z.string())
      .then(async (value) => {
        setServer(value);
        http.defaults.baseURL = value;
        const mode = await ipc(
          window.desktop.accessMode(),
          z.object({ public_access: z.boolean() }),
        );
        setPublicAccess(mode.public_access);
        if (mode.public_access) setSession(await ipc(window.desktop.enter(), sessionSchema));
        else if (value) await refresh().catch(() => undefined);
      })
      .catch((error: unknown) => setStartupError(errorText(error)))
      .finally(() => setInitializing(false));
  }, []);
  useEffect(() => {
    if (!session || page !== 'templates' || !manage) return;
    let active = true;
    void (async () => {
      const notes: Delivery[] = [];
      for (let current = 1; ; current += 1) {
        const result = await api(
          'GET',
          `/delivery-notes?page=${current}&page_size=200&start_date=2000-01-01&end_date=2099-12-31`,
          pageSchema(deliverySchema),
        );
        if (!active) return;
        notes.push(...result.items);
        if (!result.items.length || notes.length >= result.total) break;
      }
      setTemplateNotes(notes);
    })().catch((error) => message.error(errorText(error)));
    return () => {
      active = false;
    };
  }, [manage, page, session]);
  const navigate = (key: WorkspacePage) => {
    if (templateDirty && !window.confirm('打印模板尚未保存，确定离开？')) return;
    setTemplateDirty(false);
    setPage(key);
    if (!session) return;
    try {
      const preferenceKey = navigationPreferenceKey(server, session.user.id);
      const preference = parseNavigationPreference(window.localStorage.getItem(preferenceKey));
      window.localStorage.setItem(preferenceKey, JSON.stringify(recordPageVisit(preference, key)));
    } catch {
      // Navigation still works when the local preference store is unavailable.
    }
  };
  const openModule = (module: WorkspaceModule) => {
    if (!groups || !groups[module].length || module === currentModule) return;
    let preference = parseNavigationPreference(null);
    if (session) {
      try {
        preference = parseNavigationPreference(
          window.localStorage.getItem(navigationPreferenceKey(server, session.user.id)),
        );
      } catch {
        /* Use the first page in this module. */
      }
    }
    navigate(
      preferredPage(
        preference,
        module,
        groups[module].map((item) => item.key),
      ),
    );
  };
  const reconnect = async () => {
    setReconnecting(true);
    try {
      await http.get('/health', { timeout: 10000 });
      window.location.reload();
    } catch (error) {
      void message.error(`仍无法连接服务器：${errorText(error)}`);
      setReconnecting(false);
    }
  };
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#285e4b',
          borderRadius: 9,
          fontFamily: '-apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif',
        },
        components: {
          Select: { borderRadius: 0, borderRadiusSM: 0, borderRadiusLG: 0 },
          Input: { borderRadius: 0, borderRadiusSM: 0, borderRadiusLG: 0 },
          InputNumber: { borderRadius: 0, borderRadiusSM: 0, borderRadiusLG: 0 },
          DatePicker: { borderRadius: 0, borderRadiusSM: 0, borderRadiusLG: 0 },
          Button: { borderRadius: 2, borderRadiusSM: 2, borderRadiusLG: 2 },
        },
      }}
    >
      {initializing ? (
        <main className="login">正在连接服务器…</main>
      ) : !session ? (
        startupError ? (
          <main className="login">
            <div>
              <Alert type="error" message={startupError} />
              <Button onClick={() => window.location.reload()}>重新连接</Button>
            </div>
          </main>
        ) : publicAccess ? (
          <main className="login">
            <div>
              <p>正在进入共享工作台</p>
              <Button onClick={() => window.location.reload()}>重新进入</Button>
            </div>
          </main>
        ) : (
          <Login />
        )
      ) : (
        <PrintTemplateProvider key={session.user.company_id} enabled={manage}>
          <Layout className="app-layout app-shell">
            <Layout.Sider width={225} theme="dark" className="app-sidebar">
              <div className="brand">
                <span className="brand-symbol">趣</span>
                <div>
                  <strong>意趣订单</strong>
                  <span>任务与送货工作台</span>
                </div>
              </div>
              <div className="sidebar-caption">工作空间</div>
              <Menu
                theme="dark"
                mode="inline"
                aria-label="一级导航"
                selectedKeys={[currentModule]}
                onClick={(event) => {
                  if (availableModules.includes(event.key as WorkspaceModule))
                    openModule(event.key as WorkspaceModule);
                }}
                items={availableModules.map((module) => ({
                  key: module,
                  icon: <ModuleIcon module={module} />,
                  label:
                    module === 'home' ? (
                      <Badge
                        dot={todoReminder.count > 0}
                        offset={[8, 0]}
                        title={`${todoReminder.count} 项待办需要处理`}
                      >
                        <span>{moduleLabels[module]}</span>
                      </Badge>
                    ) : module === 'compliance' ? (
                      <Badge
                        dot={compliance.reminder?.hasReminder ?? false}
                        offset={[8, 0]}
                        title={
                          compliance.reminder
                            ? `到期待办 ${compliance.reminder.dueCount} 期，待打印 ${compliance.reminder.unprintedCount} 份`
                            : '正在读取合规提醒'
                        }
                      >
                        <span>{moduleLabels[module]}</span>
                      </Badge>
                    ) : (
                      moduleLabels[module]
                    ),
                }))}
              />
              {session.user.public_access && (
                <div className="sidebar-bottom">
                  <div className="local-status">
                    <i /> 云端数据 · 共享工作台
                  </div>
                  <p>做好每一份，交付每一单。</p>
                </div>
              )}
              {!session.user.public_access && (
                <div className="account">
                  <strong>{session.user.real_name || session.user.username}</strong>
                  <Button
                    type="link"
                    onClick={() => {
                      void ipc(window.desktop.logout(), z.null())
                        .catch((e) => message.warning(errorText(e)))
                        .finally(() => {
                          setSession(null);
                          setTemplateDirty(false);
                        });
                    }}
                  >
                    {session.user.public_access ? '切换公司' : '退出登录'}
                  </Button>
                </div>
              )}
            </Layout.Sider>
            <Layout className="main-layout">
              <header className="topbar">
                <div className="topbar-navigation">
                  <span className="topbar-context">
                    工作空间 <span className="topbar-divider">/</span>
                    <strong>{moduleLabels[currentModule]}</strong>
                  </span>
                </div>
                <Space size="middle">
                  {manage && (
                    <GlobalAssistant onCreated={() => setBusinessRevision((v) => v + 1)} />
                  )}
                  <WindowsUpdate />
                  <span className="workspace-company">
                    <span className="admin-avatar">管</span>
                    {session.user.public_access
                      ? '天美意 · 趣趣特共享数据'
                      : session.user.company_code === 'tri'
                        ? '趣趣特'
                        : '天美意'}
                  </span>
                </Space>
              </header>
              <nav
                className="workspace-subnav"
                aria-label={`${moduleLabels[currentModule]}二级导航`}
              >
                <Menu
                  mode="horizontal"
                  selectedKeys={[page]}
                  onClick={({ key }) => {
                    if (groups?.[currentModule].some((item) => item.key === key))
                      navigate(key as WorkspacePage);
                  }}
                  items={(groups?.[currentModule] ?? []).map(({ key, label }) => ({
                    key,
                    label:
                      key === 'todos' ? (
                        <Badge dot={todoReminder.count > 0} offset={[6, 0]}>
                          <span>
                            {label}
                            {todoReminder.count > 0 ? ` · ${todoReminder.count}` : ''}
                          </span>
                        </Badge>
                      ) : (
                        label
                      ),
                  }))}
                />
              </nav>
              <Layout.Content className="workspace page-content">
                {offline && (
                  <Alert
                    type="warning"
                    showIcon
                    message="当前离线：仅可查看已缓存的数据（最长七天），无法保存修改或打印。重新联网后请刷新页面。"
                    action={
                      <Button size="small" loading={reconnecting} onClick={() => void reconnect()}>
                        刷新
                      </Button>
                    }
                  />
                )}
                {session.user.must_change_password && !session.user.public_access ? (
                  <Password required onChanged={() => navigate('tasks')} />
                ) : (
                  <>
                    {page === 'revenue' && (
                      <Revenue
                        key={businessRevision}
                        canManage={manage}
                        onTask={(id) => {
                          setRequestedTaskId(id);
                          navigate('tasks');
                        }}
                        onDelivery={(id) => {
                          setRequestedId(id);
                          navigate('delivery');
                        }}
                      />
                    )}
                    {page === 'todos' && (
                      <Todos canManage={manage} reminderError={todoReminder.error} />
                    )}
                    {page === 'task-list' && (
                      <UnifiedTasks
                        key={businessRevision}
                        canManage={manage}
                        onTask={(id) => {
                          setRequestedTaskId(id);
                          navigate('tasks');
                        }}
                        onDelivery={(id) => {
                          setRequestedId(id);
                          navigate('delivery');
                        }}
                      />
                    )}
                    {page === 'compliance' && (
                      <Compliance server={server} error={compliance.error} />
                    )}
                    {page === 'confluence' && manage && <Confluence />}
                    {page === 'overview' && <Overview key={businessRevision} />}
                    {page === 'tasks' && (
                      <Tasks
                        key={businessRevision}
                        requestedId={requestedTaskId}
                        clearRequest={() => setRequestedTaskId(null)}
                        canManage={manage}
                        onCategoryManage={() => navigate('categories')}
                        onDelivery={(id) => {
                          setRequestedId(id);
                          navigate('delivery');
                        }}
                      />
                    )}
                    {page === 'ai-settings' && manage && <AiSettings />}
                    {page === 'delivery' && manage && (
                      <Deliveries
                        key={businessRevision}
                        onTask={(id) => {
                          setRequestedTaskId(id);
                          navigate('tasks');
                        }}
                        companyId={session.user.company_code}
                        requestedId={requestedId}
                        clearRequest={clearRequest}
                      />
                    )}{' '}
                    {page === 'summary' && manage && <Summary key={businessRevision} />}
                    {page === 'bom' && manage && <BomManagement />}
                    {page === 'costing' && manage && <CostingManagement />}
                    {page === 'categories' && manage && (
                      <Catalog initialKind="categories" allowedKinds={['categories']} />
                    )}
                    {page === 'departments' && manage && (
                      <Catalog initialKind="departments" allowedKinds={['departments']} />
                    )}
                    {page === 'schedules' && <Schedules key={businessRevision} />}
                    {page === 'employees' && manage && (
                      <Catalog initialKind="employees" allowedKinds={['employees']} />
                    )}
                    {page === 'catalog' && manage && <Catalog />}
                    {page === 'templates' && manage && (
                      <PrintTemplateEditor
                        notes={templateNotes.map((note) =>
                          printModel(note, note.company_code ?? session.user.company_code),
                        )}
                        onDirtyChange={setTemplateDirty}
                      />
                    )}
                    {page === 'users' &&
                      session.user.role === 'boss' &&
                      !session.user.public_access && <Accounts />}
                    {page === 'backup' &&
                      session.user.role === 'boss' &&
                      !session.user.public_access && (
                        <Backup
                          companyId={session.user.company_id}
                          companyCode={session.user.company_code}
                          userId={session.user.id}
                          allowRestore={!session.user.public_access}
                        />
                      )}
                    {page === 'settings' && !session.user.public_access && (
                      <>
                        <Password required={false} onChanged={() => undefined} />
                        <Space direction="vertical">
                          <Alert message="业务数据保存在服务器；本机仅保存服务器地址与系统加密的刷新凭据。" />
                          <p>当前服务器：{server}</p>
                          <p>离线时不能新增、修改或打印未加载的单据。</p>
                        </Space>
                      </>
                    )}
                  </>
                )}
                <footer className="page-footer">意趣订单 · 每一份用心，都井井有条</footer>
              </Layout.Content>
            </Layout>
          </Layout>
        </PrintTemplateProvider>
      )}
    </ConfigProvider>
  );
}
