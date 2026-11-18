import { VoiceTodos } from "./voice/VoiceTodos";
import { VoiceInput } from "./voice/VoiceInput";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
} from "react";
import {
  Button,
  Card,
  Dialog,
  ImageViewer,
  NavBar,
  NoticeBar,
  PullToRefresh,
  SpinLoading,
  TabBar,
  Tag,
  Toast,
} from "antd-mobile";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { z } from "zod";
import { appStore } from "./store";
import { useAppStore } from "./use-app-store";
import { LinkedDeliveries } from "./LinkedDeliveries";
import { allResources, type Catalog } from "./catalog";
import { loadTaskCounts, type TaskCounts } from "./task-counts";
import { matchingBusinessEmployees, employeeAvailableOn } from "./assignment";
import {
  accessMode,
  enterCompany,
  clearSession,
  errorMessage,
  login,
  logout,
  refreshSession,
  request,
  upload,
} from "./api";
import {
  companyMatchSchema,
  draftSchema,
  emptyTask,
  imageSchema,
  nextStatuses,
  pageSchema,
  priorities,
  priorityLabels,
  resourceSchema,
  statuses,
  statusLabels,
  taskFields,
  taskSchema,
  type Draft,
  type Resource,
  type Task,
  type TaskInput,
  type User,
} from "./models";
function fail(error: unknown) {
  Toast.show({ content: errorMessage(error), duration: 3000 });
}
function useOnline() {
  const { online } = useAppStore();
  const setOnline = (online: boolean) =>
    appStore.dispatch({ type: "online", online });
  useEffect(() => {
    let active = true;
    let checking = false;
    const check = async () => {
      if (checking) return;
      if (!navigator.onLine) {
        setOnline(false);
        return;
      }
      checking = true;
      try {
        const response = await fetch("/api/health", {
          cache: "no-store",
          signal: AbortSignal.timeout(5000),
        });
        if (active) setOnline(response.ok);
      } catch {
        if (active) setOnline(false);
      } finally {
        checking = false;
      }
    };
    const change = () => {
      if (!navigator.onLine) setOnline(false);
      else void check();
    };
    window.addEventListener("online", change);
    window.addEventListener("offline", change);
    const timer = window.setInterval(() => void check(), 30000);
    void check();
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("online", change);
      window.removeEventListener("offline", change);
    };
  }, []);
  return online;
}
function useCatalog(enabled = true) {
  const { catalog } = useAppStore();
  const refresh = useCallback(async () => {
    if (!enabled) return;
    const owner = appStore.getSnapshot().user;
    const [departments, employees, categories, companies] = await Promise.all([
      allResources("departments"),
      allResources("employees"),
      allResources("categories"),
      owner?.public_access ? allResources("companies") : Promise.resolve([]),
    ]);
    const current = appStore.getSnapshot().user;
    if (owner?.id === current?.id && owner?.company_id === current?.company_id)
      appStore.dispatch({
        type: "catalog",
        catalog: { departments, employees, categories, companies },
      });
  }, [enabled]);
  useEffect(() => {
    void refresh().catch(fail);
  }, [refresh]);
  return { catalog, refresh };
}
interface Choice {
  value: string;
  label: string;
  disabled?: boolean;
}
function Select({
  label,
  value,
  onChange,
  options,
  placeholder = "请选择",
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Choice[];
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <label className="field">
      {label}
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
const resourceOptions = (items: Resource[]) =>
  items.map((item) => ({ value: item.id, label: item.name }));
function PasswordEntry() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await enterCompany(password);
    } catch (error) {
      fail(error);
    } finally {
      setPassword("");
      setBusy(false);
    }
  };
  return (
    <main className="login">
      <div className="brand">TMY / TRI · CLOUD</div>
      <h1>共享任务工作台</h1>
      <p className="muted">天美意 · 趣趣特</p>
      <form onSubmit={(event) => void submit(event)}>
        <label className="field">
          访问密码
          <input
            type="password"
            required
            autoComplete="current-password"
            maxLength={256}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <Button block color="primary" type="submit" loading={busy}>
          进入工作台
        </Button>
      </form>
    </main>
  );
}
function Login({ publicAccess }: { publicAccess: boolean }) {
  const [company, setCompany] = useState("tri");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      if (publicAccess) await enterCompany();
      else await login(company, username.trim(), password);
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="login">
      <div className="brand">TMY / TRI · CLOUD</div>
      <h1>
        随时掌握
        <br />
        每一份订单
      </h1>
      <p className="muted">天美意 · 趣趣特协作工作台</p>
      <form onSubmit={(e) => void submit(e)}>
        <Select
          label="所属公司"
          value={company}
          onChange={setCompany}
          options={[
            { value: "tri", label: "趣趣特" },
            { value: "tmy", label: "天美意" },
          ]}
        />
        {!publicAccess && (
          <>
            <label className="field">
              账号
              <input
                required
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                maxLength={50}
              />
            </label>
            <label className="field">
              密码
              <input
                required
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                maxLength={128}
              />
            </label>
          </>
        )}
        <Button block color="primary" type="submit" loading={busy}>
          {publicAccess ? "进入工作台" : "登录工作台"}
        </Button>
      </form>
      <p className="hint">
        {publicAccess
          ? "选择公司即可进入工作台。"
          : "请选择账号所属公司。账号由管理员开通。"}
      </p>
    </main>
  );
}
type TaskFormInitial = (Task | TaskInput) & {
  company_match?: Draft["company_match"];
};
function TaskForm({
  initial,
  catalog,
  onSave,
  onSaved,
  onCancel,
  disabled = false,
  requireExpectedDelivery = false,
}: {
  initial: TaskFormInitial;
  catalog: Catalog;
  onSave: (value: TaskInput, taskId?: string) => Promise<Task>;
  onSaved: (task: Task) => void | Promise<void>;
  onCancel?: () => void;
  disabled?: boolean;
  requireExpectedDelivery?: boolean;
}) {
  const { user } = useAppStore();
  const publicAccess = !!user?.public_access;
  const [value, setValue] = useState<TaskInput>(() => ({
    ...initial,
    ...(publicAccess ? { company_code: initial.company_code ?? "tmy" } : {}),
  }));
  const editing = "id" in initial;
  const companyChosen = useRef(!!initial.company_code);
  const assigneeChosen = useRef(editing || !!initial.assignee_employee_id);
  const [companyHint, setCompanyHint] = useState(
    initial.company_match?.reason ?? "",
  );
  const [assigneeHint, setAssigneeHint] = useState("");
  const [suggestingCompany, setSuggestingCompany] = useState(false);
  const [busy, setBusy] = useState(false);
  const [taskId, setTaskId] = useState(
    "id" in initial ? initial.id : undefined,
  );
  const [images, setImages] = useState<z.infer<typeof imageSchema>[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [processing, setProcessing] = useState(0);
  const [imageError, setImageError] = useState("");
  const [previewFiles, setPreviewFiles] = useState<
    Array<{ file: File; url: string }>
  >([]);
  const change = <K extends keyof TaskInput>(key: K, next: TaskInput[K]) =>
    setValue((previous) => ({ ...previous, [key]: next }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!value.department_id) {
      Toast.show("请选择部门");
      return;
    }
    if (!value.assignee_employee_id) {
      Toast.show("请选择执行人");
      return;
    }
    if (requireExpectedDelivery && !value.expected_delivery_at) {
      Toast.show("AI任务必须填写预计交付日期和时间");
      return;
    }
    const checked = taskFields.safeParse({
      ...value,
      category_id: value.category_id || null,
      expected_delivery_at: value.expected_delivery_at || null,
    });
    if (!checked.success) {
      Toast.show(checked.error.issues[0]?.message ?? "请检查任务字段");
      return;
    }
    setBusy(true);
    try {
      const saved = await onSave(checked.data, taskId);
      setTaskId(saved.id);
      const failed: File[] = [];
      for (const file of files) {
        const data = new FormData();
        data.append("file", file);
        try {
          await upload(`/tasks/${saved.id}/images`, z.unknown(), data);
        } catch {
          failed.push(file);
        }
      }
      setFiles(failed);
      if (failed.length) {
        Toast.show(
          `任务已保存，${failed.length} 张图片上传失败；图片已保留，可再次保存重试`,
        );
        return;
      }
      Toast.show("任务已保存");
      await onSaved(saved);
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };
  const refreshImages = useCallback(async () => {
    if (!taskId) return;
    try {
      const result = await request(
        `/tasks/${taskId}/images?page_size=100`,
        pageSchema(imageSchema),
      );
      setImages(result.items);
      setImageError("");
    } catch (error) {
      setImageError(errorMessage(error));
    }
  }, [taskId]);
  useEffect(() => {
    void refreshImages();
  }, [refreshImages]);
  useEffect(() => {
    const previews = files.map((file) => ({
      file,
      url: URL.createObjectURL(file),
    }));
    setPreviewFiles(previews);
    return () => previews.forEach((item) => URL.revokeObjectURL(item.url));
  }, [files]);
  const addFile = async (file: File) => {
    setProcessing((count) => count + 1);
    try {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
        Toast.show("仅支持 PNG、JPG、WebP 图片");
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        Toast.show("单张图片不能超过 10 MiB");
        return;
      }
      if (typeof createImageBitmap === "function") {
        const bitmap = await createImageBitmap(file);
        const pixels = bitmap.width * bitmap.height;
        bitmap.close();
        if (pixels > 24_000_000) {
          Toast.show("图片不能超过 2400 万像素");
          return;
        }
      }
      setFiles((current) => {
        if (current.length + images.length >= 12) {
          Toast.show("每个任务最多 12 张图片");
          return current;
        }
        return [...current, file];
      });
    } finally {
      setProcessing((count) => Math.max(0, count - 1));
    }
  };
  const pasteImages = (event: ClipboardEvent<HTMLFormElement>) => {
    const incoming = Array.from(event.clipboardData.items)
      .filter((item) => item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => !!file);
    if (!incoming.length) return;
    event.preventDefault();
    incoming.forEach((file) => void addFile(file).catch(fail));
  };
  const cancel = () => {
    if (!onCancel) return;
    if (!files.length) {
      onCancel();
      return;
    }
    void Dialog.confirm({
      content: "尚未上传的图片和表单修改将丢失，确认关闭？",
    }).then((confirmed) => {
      if (confirmed) onCancel();
    });
  };
  const company = value.company_code ?? initial.company_code ?? "tmy";
  const companyCatalog = (items: Resource[]) =>
    items.filter(
      (item) =>
        !publicAccess || !item.company_code || item.company_code === company,
    );
  const assignmentEmployees = matchingBusinessEmployees(
    catalog.departments,
    catalog.employees,
    value.department_id,
    (
      value.expected_delivery_at ||
      (editing ? initial.created_at : null) ||
      new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" })
    ).slice(0, 10),
  );
  useEffect(() => {
    const selected = catalog.employees.find(
      (e) => e.id === value.assignee_employee_id,
    );
    const date = (
      value.expected_delivery_at ||
      (editing ? initial.created_at : null) ||
      new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" })
    ).slice(0, 10);
    if (selected && !employeeAvailableOn(selected, date)) {
      assigneeChosen.current = false;
      change("assignee_employee_id", "");
    }
  }, [
    value.expected_delivery_at,
    value.assignee_employee_id,
    catalog.employees,
  ]);
  const text = [value.title, value.content, value.source_text]
    .filter(Boolean)
    .join(" ");
  const suggestCompany = useCallback(
    async (automatic = false) => {
      if (!publicAccess || !text.trim() || (automatic && companyChosen.current))
        return;
      setSuggestingCompany(true);
      const snapshot = text;
      try {
        const result = await request(
          "/company-suggestions",
          z.object({
            company_code: z.enum(["tri", "tmy"]),
            company_match: companyMatchSchema,
          }),
          "POST",
          { text: snapshot },
        );
        if (automatic && (companyChosen.current || snapshot !== text)) return;
        setCompanyHint(result.company_match.reason);
        if (result.company_code !== value.company_code) {
          setValue((previous) => ({
            ...previous,
            company_code: result.company_code,
            category_id: null,
          }));
        }
      } catch (error) {
        if (!automatic) fail(error);
      } finally {
        setSuggestingCompany(false);
      }
    },
    [publicAccess, text, value.company_code],
  );
  useEffect(() => {
    if (editing || companyChosen.current || !text.trim()) return;
    const timer = window.setTimeout(() => void suggestCompany(true), 700);
    return () => window.clearTimeout(timer);
  }, [editing, suggestCompany, text]);
  useEffect(() => {
    if (
      !value.department_id ||
      assigneeChosen.current ||
      !catalog.departments.length ||
      !catalog.employees.length
    )
      return;
    const expectedDepartment = value.department_id;
    const expectedText = text;
    const timer = window.setTimeout(() => {
      void request(
        "/assignee-suggestions",
        z.object({
          employee_id: z.string().nullable(),
          reason: z.string(),
          source: z.enum(["history", "business", "manual"]),
          sample_count: z.number(),
        }),
        "POST",
        {
          department_id: expectedDepartment,
          text: expectedText,
          document_date: (
            value.expected_delivery_at ||
            (editing ? initial.created_at : null) ||
            new Date().toLocaleDateString("sv-SE", {
              timeZone: "Asia/Shanghai",
            })
          ).slice(0, 10),
        },
      )
        .then((result) => {
          if (
            assigneeChosen.current ||
            value.department_id !== expectedDepartment
          )
            return;
          setAssigneeHint(result.reason);
          if (
            result.employee_id &&
            assignmentEmployees.some(
              (employee) => employee.id === result.employee_id,
            )
          ) {
            assigneeChosen.current = true;
            change("assignee_employee_id", result.employee_id);
          }
        })
        .catch(fail);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [
    value.department_id,
    text,
    company,
    catalog.departments,
    catalog.employees,
    assignmentEmployees,
  ]);
  const historicalOptions = (
    items: Resource[],
    field: "category_id" | "department_id" | "assignee_employee_id",
    label: "category_name" | "department_name" | "assignee_name",
  ): Choice[] => {
    const options: Choice[] = resourceOptions(items);
    const oldId = initial[field];
    if (
      editing &&
      oldId &&
      company === (initial.company_code ?? "tmy") &&
      !options.some((item) => item.value === oldId)
    )
      options.push({
        value: oldId,
        label: `${"id" in initial ? (initial[label] ?? "历史记录") : "历史记录"}（历史关联）`,
        disabled: true,
      });
    return options;
  };
  return (
    <form
      onSubmit={(e) => void submit(e)}
      onPaste={pasteImages}
      className="task-form"
    >
      <fieldset disabled={disabled || busy || processing > 0}>
        {publicAccess && (
          <Select
            label="订单所属公司"
            value={value.company_code ?? "tmy"}
            disabled={"id" in initial}
            onChange={(code) => {
              companyChosen.current = true;
              setCompanyHint("");
              setValue((previous) => ({
                ...previous,
                company_code: z.enum(["tri", "tmy"]).parse(code),
                category_id: null,
              }));
            }}
            options={(catalog.companies ?? []).map((item) => ({
              value: item.code ?? "",
              label: item.name,
            }))}
          />
        )}
        {publicAccess && (
          <>
            <p className="hint">
              {companyHint ||
                "系统会根据主营规则和历史人工选择匹配公司，操作人员仍可修改。"}
            </p>
            <Button
              size="small"
              loading={suggestingCompany}
              disabled={!text.trim()}
              onClick={() => void suggestCompany()}
            >
              根据订单匹配公司
            </Button>
          </>
        )}
        <label className="field">
          任务标题
          <input
            required
            maxLength={200}
            value={value.title}
            onChange={(e) => change("title", e.target.value)}
          />
        </label>
        <label className="field">
          任务详情
          <textarea
            rows={4}
            value={value.content}
            maxLength={20000}
            onChange={(e) => change("content", e.target.value)}
          />
        </label>
        <Select
          label="业务分类"
          value={value.category_id ?? ""}
          onChange={(v) => change("category_id", v || null)}
          placeholder="未分类"
          options={historicalOptions(
            companyCatalog(catalog.categories),
            "category_id",
            "category_name",
          )}
        />
        <Select
          label="部门"
          value={value.department_id}
          onChange={(department_id) => {
            assigneeChosen.current = false;
            setAssigneeHint("");
            setValue((previous) => ({
              ...previous,
              department_id,
              assignee_employee_id: "",
            }));
          }}
          options={historicalOptions(
            companyCatalog(catalog.departments),
            "department_id",
            "department_name",
          )}
        />
        <Select
          label="执行人"
          value={value.assignee_employee_id}
          onChange={(v) => {
            assigneeChosen.current = true;
            change("assignee_employee_id", v);
          }}
          options={historicalOptions(
            assignmentEmployees,
            "assignee_employee_id",
            "assignee_name",
          )}
        />
        {assigneeHint && <p className="hint">{assigneeHint}</p>}
        <div className="row">
          <Select
            label="状态"
            value={value.status}
            onChange={(v) => change("status", z.enum(statuses).parse(v))}
            options={(editing
              ? Array.from(
                  new Set([value.status, ...nextStatuses(value.status)]),
                )
              : [...statuses]
            ).map((v) => ({ value: v, label: statusLabels[v] }))}
          />
          <Select
            label="优先级"
            value={value.priority}
            onChange={(v) => change("priority", z.enum(priorities).parse(v))}
            options={priorities.map((v) => ({
              value: v,
              label: priorityLabels[v],
            }))}
          />
          <Select
            label="任务类型"
            value={value.task_type}
            onChange={(v) =>
              change("task_type", taskFields.shape.task_type.parse(v))
            }
            options={[
              { value: "order", label: "订单" },
              { value: "production", label: "生产" },
              { value: "shipping", label: "发货" },
              { value: "change", label: "变更" },
            ]}
          />
        </div>
        <label className="field">
          {requireExpectedDelivery
            ? "预计交付时间（必填，精确到分钟）"
            : "预计交付时间（精确到分钟，可留空）"}
          <input
            type="datetime-local"
            step={60}
            value={value.expected_delivery_at?.replace(" ", "T") ?? ""}
            onChange={(e) =>
              change(
                "expected_delivery_at",
                e.target.value ? e.target.value.replace("T", " ") : null,
              )
            }
          />
        </label>
        <label className="field">
          备注
          <textarea
            rows={2}
            value={value.note}
            maxLength={10000}
            onChange={(e) => change("note", e.target.value)}
          />
        </label>
        <section className="attachment-editor">
          <h3>图片附件</h3>
          <p className="hint">可选择图片，也可直接在表单内粘贴剪贴板图片。</p>
          <label className="attachment-picker">
            添加图片
            <input
              aria-label="添加图片附件"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              onChange={(event) => {
                Array.from(event.currentTarget.files ?? []).forEach(
                  (file) => void addFile(file).catch(fail),
                );
                event.currentTarget.value = "";
              }}
            />
          </label>
          {processing > 0 && <p className="hint">正在检查图片，请稍候…</p>}
          {imageError && (
            <NoticeBar color="alert" content={`附件读取失败：${imageError}`} />
          )}
          <div className="gallery editable-gallery">
            {images.map((image, index) => (
              <div className="attachment-item" key={image.id}>
                <button
                  type="button"
                  aria-label={`放大图片 ${image.file_name}`}
                  onClick={() =>
                    ImageViewer.Multi.show({
                      images: images.map((item) => item.url),
                      defaultIndex: index,
                    })
                  }
                >
                  <img src={image.thumbnail_url} alt={image.file_name} />
                </button>
                <Button
                  size="mini"
                  color="danger"
                  type="button"
                  onClick={() =>
                    void Dialog.confirm({ content: "确认删除这张图片？" }).then(
                      async (confirmed) => {
                        if (!confirmed) return;
                        try {
                          await request(
                            `/tasks/${taskId}/images/${image.id}`,
                            z.unknown(),
                            "DELETE",
                          );
                          await refreshImages();
                        } catch (error) {
                          fail(error);
                        }
                      },
                    )
                  }
                >
                  删除
                </Button>
              </div>
            ))}
            {previewFiles.map(({ file, url }) => (
              <div
                className="attachment-item"
                key={`${file.name}-${file.size}`}
              >
                <img src={url} alt={file.name} />
                <Button
                  size="mini"
                  color="danger"
                  type="button"
                  onClick={() =>
                    setFiles((current) =>
                      current.filter((candidate) => candidate !== file),
                    )
                  }
                >
                  移除
                </Button>
              </div>
            ))}
          </div>
        </section>
        <Button block type="submit" color="primary" loading={busy}>
          确认并保存
        </Button>
        {onCancel && (
          <Button block fill="none" onClick={cancel}>
            取消
          </Button>
        )}
      </fieldset>
    </form>
  );
}
function Tasks({ user, online }: { user: User; online: boolean }) {
  const { catalog } = useCatalog(user.role !== "employee");
  const { filters: filter } = useAppStore();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<Task | null>(null);
  const [editing, setEditing] = useState<TaskInput | null>(null);
  const [board, setBoard] = useState(false);
  const [counts, setCounts] = useState<TaskCounts | null>(null);
  const [countError, setCountError] = useState("");
  const generation = useRef(0);
  const filterKey = JSON.stringify(filter);
  const load = useCallback(
    async (nextPage = 1) => {
      const generationId = ++generation.current;
      setBusy(true);
      try {
        const query = new URLSearchParams({
          page: String(nextPage),
          page_size: "20",
        });
        const parsed: unknown = JSON.parse(filterKey);
        const filters = z.record(z.string(), z.string()).parse(parsed);
        for (const [key, value] of Object.entries(filters))
          if (value) query.set(key, value);
        const data = await request(`/tasks?${query}`, pageSchema(taskSchema));
        if (generationId === generation.current) {
          setTasks((previous) =>
            nextPage === 1 ? data.items : [...previous, ...data.items],
          );
          setPage(nextPage);
          setTotal(data.total);
        }
      } catch (error) {
        fail(error);
      } finally {
        if (generationId === generation.current) setBusy(false);
      }
    },
    [filterKey],
  );
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [load]);
  useEffect(() => {
    if (!board) return;
    let current = true;
    setCounts(null);
    setCountError("");
    const filters = z
      .record(z.string(), z.string())
      .parse(JSON.parse(filterKey) as unknown);
    void loadTaskCounts(filters)
      .then((value) => {
        if (current) setCounts(value);
      })
      .catch((error) => {
        if (current) setCountError(errorMessage(error));
      });
    return () => {
      current = false;
    };
  }, [board, filterKey, tasks]);
  const change = (key: keyof typeof filter, value: string) =>
    appStore.dispatch({ type: "filter", key, value });
  const transition = async (task: Task, status: Task["status"]) => {
    if (
      !(await Dialog.confirm({
        content: `将「${task.title}」改为${statusLabels[status]}？`,
      }))
    )
      return;
    try {
      await request(`/tasks/${task.id}/status`, taskSchema, "PATCH", {
        status,
      });
      setDetail(null);
      await load();
    } catch (error) {
      fail(error);
    }
  };
  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">TASK WORKSPACE</span>
          <h1>任务汇总</h1>
        </div>
        {user.role !== "employee" && (
          <Button
            size="small"
            color="primary"
            disabled={!online}
            onClick={() => setEditing(emptyTask())}
          >
            ＋ 新建
          </Button>
        )}
      </div>
      <Card>
        <div className="row">
          <label className="field">
            月份
            <input
              type="month"
              value={filter.month}
              onChange={(e) => change("month", e.target.value)}
            />
          </label>
          <Select
            label="业务分类"
            value={filter.category_id}
            onChange={(v) => change("category_id", v)}
            placeholder="全部"
            options={resourceOptions(catalog.categories)}
          />
        </div>
        <details>
          <summary>更多筛选</summary>
          <div className="row">
            <Select
              label="部门"
              value={filter.department_id}
              onChange={(v) => change("department_id", v)}
              placeholder="全部"
              options={resourceOptions(catalog.departments)}
            />
            <Select
              label="执行人"
              value={filter.assignee_employee_id}
              onChange={(v) => change("assignee_employee_id", v)}
              placeholder="全部"
              options={resourceOptions(
                filter.department_id
                  ? matchingBusinessEmployees(
                      catalog.departments,
                      catalog.employees,
                      filter.department_id,
                    )
                  : catalog.employees,
              )}
            />
          </div>
          <div className="row">
            <Select
              label="状态"
              value={filter.status}
              onChange={(v) => change("status", v)}
              placeholder="全部"
              options={statuses.map((v) => ({
                value: v,
                label: statusLabels[v],
              }))}
            />
            <Select
              label="优先级"
              value={filter.priority}
              onChange={(v) => change("priority", v)}
              placeholder="全部"
              options={priorities.map((v) => ({
                value: v,
                label: priorityLabels[v],
              }))}
            />
          </div>
        </details>
        <label className="field">
          搜索任务
          <input
            type="search"
            placeholder="标题或关键词"
            value={filter.keyword}
            onChange={(e) => change("keyword", e.target.value)}
          />
        </label>
        <div className="row">
          <span className="muted">共 {total} 项任务</span>
          <Button size="mini" onClick={() => setBoard(!board)}>
            {board ? "切换列表" : "切换看板"}
          </Button>
        </div>
      </Card>
      {board && (
        <p className="hint">
          每列总数来自当前筛选的全部任务；卡片按分页加载。已加载 {tasks.length}{" "}
          / {total} 项。
        </p>
      )}
      {board && countError && (
        <NoticeBar color="alert" content={`统计暂不可用：${countError}`} />
      )}
      <PullToRefresh onRefresh={() => load()}>
        <div className={board ? "board" : "task-list"}>
          {(board ? statuses : (["all"] as const)).map((status) => (
            <section key={status}>
              {board && (
                <>
                  <h3>
                    {statusLabels[status as Task["status"]]} ·{" "}
                    {counts?.[status as Task["status"]] ?? "—"}
                  </h3>
                  <p className="hint">
                    已加载{" "}
                    {tasks.filter((task) => task.status === status).length} 项
                  </p>
                </>
              )}
              {tasks
                .filter((task) => status === "all" || task.status === status)
                .map((task) => (
                  <Card
                    key={task.id}
                    className="task-card"
                    onClick={() => setDetail(task)}
                  >
                    <div className="row">
                      <Tag
                        color={
                          task.status === "delivered" ? "success" : "default"
                        }
                      >
                        {statusLabels[task.status]}
                      </Tag>
                      <span className="muted">
                        {priorityLabels[task.priority]}
                      </span>
                    </div>
                    <h3>{task.title}</h3>
                    {task.company_code && (
                      <Tag>
                        {task.company_code === "tri" ? "趣趣特" : "天美意"}
                      </Tag>
                    )}
                    <LinkedDeliveries task={task} />
                    <p className="truncate">{task.content || "暂无详情"}</p>
                    <div className="tags">
                      <Tag color="primary" fill="outline">
                        {task.category_name || "未分类"}
                      </Tag>
                      <span>
                        {task.department_name} · {task.assignee_name}
                      </span>
                    </div>
                    <p className="due">
                      预计交付 {task.expected_delivery_at || "时间待补充"}
                    </p>
                  </Card>
                ))}
            </section>
          ))}
        </div>
      </PullToRefresh>
      {busy && (
        <div className="center">
          <SpinLoading />
        </div>
      )}
      {!busy && !tasks.length && <p className="empty">没有符合条件的任务</p>}
      {tasks.length < total && (
        <Button block loading={busy} onClick={() => void load(page + 1)}>
          加载更多
        </Button>
      )}
      {detail && (
        <TaskDetail
          task={detail}
          online={online}
          manager={user.role !== "employee"}
          onClose={() => setDetail(null)}
          onEdit={() => {
            setEditing(detail);
            setDetail(null);
          }}
          onTransition={(status) => transition(detail, status)}
          onDelete={async () => {
            if (
              await Dialog.confirm({
                content: "确认删除此任务？删除后无法恢复。",
              })
            ) {
              await request(`/tasks/${detail.id}`, z.unknown(), "DELETE");
              setDetail(null);
              await load();
            }
          }}
        />
      )}{" "}
      {editing && (
        <div className="sheet">
          <NavBar onBack={() => setEditing(null)}>
            {"id" in editing ? "编辑任务" : "新建任务"}
          </NavBar>
          <TaskForm
            key={"id" in editing ? String(editing.id) : "new"}
            initial={editing}
            catalog={catalog}
            disabled={!online}
            onCancel={() => setEditing(null)}
            onSave={(value, persistedId) =>
              request(
                persistedId ? `/tasks/${persistedId}` : "/tasks",
                taskSchema,
                persistedId ? "PUT" : "POST",
                value,
              )
            }
            onSaved={async () => {
              setEditing(null);
              await load();
            }}
          />
        </div>
      )}
    </>
  );
}
function TaskDetail({
  task,
  online,
  manager,
  onClose,
  onEdit,
  onTransition,
  onDelete,
}: {
  task: Task;
  online: boolean;
  manager: boolean;
  onClose: () => void;
  onEdit: () => void;
  onTransition: (status: Task["status"]) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [images, setImages] = useState<z.infer<typeof imageSchema>[]>([]);
  const [imageError, setImageError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void request(`/tasks/${task.id}/images`, pageSchema(imageSchema))
      .then((data) => {
        if (active) setImages(data.items);
      })
      .catch((error) => {
        if (active) setImageError(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [task.id]);
  const action = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="sheet">
      <NavBar onBack={onClose}>任务详情</NavBar>
      <article>
        <Tag color="primary">{statusLabels[task.status]}</Tag>
        <h1>{task.title}</h1>
        {task.company_code && (
          <Tag>{task.company_code === "tri" ? "趣趣特" : "天美意"}</Tag>
        )}
        <LinkedDeliveries task={task} />
        <p className="preserve">{task.content}</p>
        <dl>
          <dt>业务分类</dt>
          <dd>{task.category_name || "未分类"}</dd>
          <dt>部门 / 执行人</dt>
          <dd>
            {task.department_name} / {task.assignee_name}
          </dd>
          <dt>预计交付</dt>
          <dd>{task.expected_delivery_at || "时间待补充"}</dd>
          <dt>优先级</dt>
          <dd>{priorityLabels[task.priority]}</dd>
          <dt>备注</dt>
          <dd className="preserve">{task.note || "—"}</dd>
        </dl>
        <h3>图片附件</h3>
        {imageError && <NoticeBar content={imageError} color="alert" />}
        <div className="gallery">
          {images.map((image, index) => (
            <button
              key={image.id}
              aria-label={`放大图片 ${image.file_name}`}
              onClick={() =>
                ImageViewer.Multi.show({
                  images: images.map((v) => v.url),
                  defaultIndex: index,
                })
              }
            >
              <img alt={image.file_name} src={image.thumbnail_url} />
            </button>
          ))}
        </div>
        {!images.length && !imageError && <p className="muted">暂无图片附件</p>}
        <p className="hint">可在任务编辑页添加、粘贴或删除图片附件。</p>
        <div className="actions">
          {nextStatuses(task.status).map((status) => (
            <Button
              key={status}
              disabled={!online || busy}
              color={status === "canceled" ? "danger" : "primary"}
              fill="outline"
              onClick={() => void action(() => onTransition(status))}
            >
              {statusLabels[status]}
            </Button>
          ))}
          {manager && (
            <>
              <Button disabled={!online || busy} onClick={onEdit}>
                编辑
              </Button>
              <Button
                color="danger"
                disabled={!online || busy}
                onClick={() => void action(onDelete)}
              >
                删除
              </Button>
            </>
          )}
        </div>
      </article>
    </div>
  );
}
function Ai({ online }: { online: boolean }) {
  const { catalog } = useCatalog();
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<{ key: string; draft: Draft }[]>([]);
  const [busy, setBusy] = useState(false);
  const parse = async () => {
    if (
      drafts.length &&
      !(await Dialog.confirm({
        content: "重新识别将替换当前尚未保存的草稿，是否继续？",
      }))
    )
      return;
    setBusy(true);
    try {
      const data = await request(
        "/ai/parse",
        z.object({ items: z.array(draftSchema) }),
        "POST",
        { text },
      );
      setDrafts(
        data.items.map((draft) => ({ key: crypto.randomUUID(), draft })),
      );
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <span className="eyebrow">SMART INBOX</span>
      <h1>AI 助手</h1>
      <VoiceTodos />
      <h2>零售订单</h2>
      <p className="muted">粘贴群消息，逐项确认后安排给同事。</p>
      <Card>
        <VoiceInput
          disabled={busy || !online}
          onText={(value) =>
            setText((current) => [current, value].filter(Boolean).join("\n"))
          }
        />
        <textarea
          aria-label="微信群订单文本"
          rows={8}
          maxLength={50000}
          placeholder="例如：明天下午3点送一个6寸抹茶巴斯克蛋糕，送到南山区某某大厦一楼，收货人王女士。备注：少糖，附生日蜡烛，提前半小时联系。"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Button
          block
          color="primary"
          disabled={!online || !text.trim()}
          loading={busy}
          onClick={() => void parse()}
        >
          识别订单
        </Button>
      </Card>
      {drafts.map(({ key, draft }, index) => (
        <Card
          key={key}
          className="task-card"
          title={`待确认 ${index + 1}`}
          extra={
            <Button
              size="mini"
              fill="none"
              onClick={() =>
                setDrafts((previous) => previous.filter((d) => d.key !== key))
              }
            >
              移除
            </Button>
          }
        >
          {draft.company_match && (
            <p className="hint" role="note">
              公司建议：{draft.company_code === "tri" ? "趣趣特" : "天美意"} ·{" "}
              {draft.company_match.reason}
            </p>
          )}
          <TaskForm
            initial={{
              ...emptyTask(),
              ...draft,
              department_id: draft.department_id ?? "",
              assignee_employee_id: draft.assignee_employee_id ?? "",
              status: "todo",
            }}
            catalog={catalog}
            disabled={!online}
            requireExpectedDelivery
            onSave={(value, persistedId) =>
              request(
                persistedId ? `/tasks/${persistedId}` : "/tasks",
                taskSchema,
                persistedId ? "PUT" : "POST",
                value,
              )
            }
            onSaved={() => {
              setDrafts((previous) => previous.filter((d) => d.key !== key));
            }}
          />
        </Card>
      ))}
    </>
  );
}
function Masters({ online }: { online: boolean }) {
  const { catalog, refresh } = useCatalog();
  const [kind, setKind] =
    useState<Exclude<keyof Catalog, "companies">>("departments");
  const [editing, setEditing] = useState<Resource | null>(null);
  const [name, setName] = useState("");
  const [department, setDepartment] = useState("");
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState("active");
  const [busy, setBusy] = useState(false);
  const reset = () => {
    setEditing(null);
    setName("");
    setDepartment("");
    setPhone("");
    setStatus("active");
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || (kind === "employees" && !department)) {
      Toast.show("请填写名称和所属部门");
      return;
    }
    setBusy(true);
    try {
      await request(
        `/${kind}${editing ? `/${editing.id}` : ""}`,
        resourceSchema,
        editing ? "PUT" : "POST",
        {
          name: name.trim(),
          ...(kind === "employees"
            ? { department_id: department, phone, status }
            : { sort: editing?.sort ?? 0 }),
        },
      );
      reset();
      await refresh();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <span className="eyebrow">TEAM & CATEGORIES</span>
      <h1>基础资料</h1>
      <Select
        label="管理内容"
        value={kind}
        onChange={(v) => {
          setKind(z.enum(["departments", "employees", "categories"]).parse(v));
          reset();
        }}
        options={[
          { value: "departments", label: "部门管理" },
          { value: "employees", label: "员工管理" },
          { value: "categories", label: "业务分类" },
        ]}
      />
      <Card>
        <form onSubmit={(e) => void save(e)}>
          <h3>{editing ? "编辑资料" : "新增资料"}</h3>
          <label className="field">
            名称
            <input
              required
              maxLength={50}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!online}
            />
          </label>
          {kind === "employees" && (
            <>
              <Select
                label="所属部门"
                value={department}
                onChange={setDepartment}
                options={resourceOptions(catalog.departments)}
              />
              <label className="field">
                联系电话
                <input
                  type="tel"
                  value={phone}
                  maxLength={30}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </label>
              <Select
                label="员工状态"
                value={status}
                onChange={setStatus}
                options={[
                  { value: "active", label: "在职" },
                  { value: "left", label: "离职" },
                ]}
              />
            </>
          )}
          <Button
            type="submit"
            block
            color="primary"
            disabled={!online}
            loading={busy}
          >
            保存
          </Button>
          {editing && (
            <Button block fill="none" onClick={reset}>
              取消编辑
            </Button>
          )}
        </form>
      </Card>
      {catalog[kind].map((item) => (
        <Card key={item.id} className="task-card">
          <div className="row">
            <div>
              <strong>{item.name}</strong>
              {kind === "employees" && (
                <p className="muted">
                  {
                    catalog.departments.find((v) => v.id === item.department_id)
                      ?.name
                  }{" "}
                  · {item.status === "left" ? "离职" : "在职"}
                </p>
              )}
            </div>
            <div className="actions">
              <Button
                size="mini"
                disabled={!online}
                onClick={() => {
                  setEditing(item);
                  setName(item.name);
                  setDepartment(item.department_id ?? "");
                  setPhone(item.phone ?? "");
                  setStatus(item.status ?? "active");
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              >
                编辑
              </Button>
              <Button
                size="mini"
                color="danger"
                fill="none"
                disabled={!online}
                onClick={() =>
                  void (async () => {
                    if (
                      await Dialog.confirm({
                        content: `确认删除「${item.name}」？有关联任务的部门或员工可能无法删除。`,
                      })
                    ) {
                      try {
                        await request(
                          `/${kind}/${item.id}`,
                          z.unknown(),
                          "DELETE",
                        );
                        await refresh();
                      } catch (error) {
                        fail(error);
                      }
                    }
                  })()
                }
              >
                删除
              </Button>
            </div>
          </div>
        </Card>
      ))}
    </>
  );
}
function Settings({
  user,
  online,
  onChanged,
}: {
  user: User;
  online: boolean;
  onChanged: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      Toast.show("两次新密码不一致");
      return;
    }
    setBusy(true);
    try {
      await request("/auth/change-password", z.unknown(), "POST", {
        current_password: current,
        new_password: password,
      });
      setCurrent("");
      setPassword("");
      setConfirm("");
      Toast.show("密码修改成功，请重新登录");
      clearSession();
      onChanged();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <h1>我的账号</h1>
      <Card>
        <h3>{user.real_name}</h3>
        <p>
          {user.company_code === "tri" ? "趣趣特" : "天美意"} · {user.username}
        </p>
      </Card>
      {user.must_change_password && (
        <NoticeBar color="alert" content="首次登录，请先修改初始密码。" />
      )}
      <Card className="task-card">
        <form onSubmit={(e) => void submit(e)}>
          <h3>修改密码</h3>
          <label className="field">
            原密码
            <input
              type="password"
              required
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </label>
          <label className="field">
            新密码（至少 8 位）
            <input
              type="password"
              required
              minLength={8}
              maxLength={128}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label className="field">
            确认新密码
            <input
              type="password"
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
          <Button
            block
            color="primary"
            type="submit"
            disabled={!online}
            loading={busy}
          >
            修改密码
          </Button>
        </form>
      </Card>
      <Button
        block
        color="danger"
        fill="outline"
        disabled={!online}
        onClick={() => void logout().catch(fail)}
      >
        退出登录
      </Button>
    </>
  );
}
function Workspace({ user }: { user: User }) {
  const online = useOnline();
  const navigate = useNavigate();
  const location = useLocation();
  const manager = user.role !== "employee";
  return (
    <>
      <header>
        <strong>
          {user.public_access
            ? "天美意 · 趣趣特"
            : user.company_code === "tri"
              ? "趣趣特"
              : "天美意"}
        </strong>
        <span>共享任务工作台</span>
      </header>
      {!online && (
        <NoticeBar
          color="alert"
          content="网络连接失败，请检查网络后刷新页面。当前已显示内容只读，不保存离线修改。"
        />
      )}
      <main>
        <Routes>
          <Route
            path="/"
            element={
              user.must_change_password ? (
                <Navigate to="/settings" replace />
              ) : (
                <Tasks user={user} online={online} />
              )
            }
          />
          <Route
            path="/ai"
            element={
              manager && !user.must_change_password ? (
                <Ai online={online} />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/masters"
            element={
              manager && !user.must_change_password ? (
                <Masters online={online} />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/settings"
            element={
              user.public_access ? (
                <Navigate to="/" replace />
              ) : (
                <Settings
                  user={user}
                  online={online}
                  onChanged={() => navigate("/")}
                />
              )
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <nav>
        <TabBar activeKey={location.pathname} onChange={(key) => navigate(key)}>
          <TabBar.Item key="/" title="任务" icon={<span>▦</span>} />
          {manager && (
            <TabBar.Item key="/ai" title="AI 录入" icon={<span>✦</span>} />
          )}{" "}
          {manager && (
            <TabBar.Item key="/masters" title="资料" icon={<span>☷</span>} />
          )}
          {!user.public_access && (
            <TabBar.Item key="/settings" title="我的" icon={<span>○</span>} />
          )}
        </TabBar>
      </nav>
    </>
  );
}
export default function App() {
  const { user } = useAppStore();
  const [starting, setStarting] = useState(true);
  const [publicAccess, setPublicAccess] = useState(false);
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [modeError, setModeError] = useState("");
  useEffect(() => {
    if (!user?.public_access) return;
    const timer = window.setTimeout(
      () => {
        if (passwordRequired) clearSession();
        else void enterCompany().catch(() => clearSession());
      },
      2 * 60 * 60 * 1000,
    );
    return () => window.clearTimeout(timer);
  }, [user, passwordRequired]);
  useEffect(() => {
    void accessMode()
      .then(async (mode) => {
        setPublicAccess(mode.public_access);
        setPasswordRequired(mode.web_password_required);
        if (mode.public_access) {
          if (mode.web_password_required) clearSession();
          else await enterCompany();
        } else await refreshSession().catch(() => undefined);
      })
      .catch((error) => setModeError(errorMessage(error)))
      .finally(() => setStarting(false));
  }, []);
  return starting ? (
    <div className="starting">
      <SpinLoading />
      <p>正在连接工作台…</p>
    </div>
  ) : (
    <BrowserRouter basename="/h5">
      {user ? (
        <Workspace key={user.id + user.company_id} user={user} />
      ) : modeError ? (
        <main>
          <NoticeBar color="alert" content={modeError} />
          <Button onClick={() => window.location.reload()}>重新连接</Button>
        </main>
      ) : publicAccess && passwordRequired ? (
        <PasswordEntry />
      ) : publicAccess ? (
        <main>
          <Button
            block
            color="primary"
            onClick={() => void enterCompany().catch(fail)}
          >
            重新进入工作台
          </Button>
        </main>
      ) : (
        <Login publicAccess={false} />
      )}
    </BrowserRouter>
  );
}
