/** Root-only, standalone host snapshot. Never runs when imported. */
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  realpath,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

interface Options {
  output: string;
  database: string;
  mysqlDefaults?: string;
  attachments: string;
}
interface CommandOptions {
  outputFd?: number;
  capture?: boolean;
  timeoutMs?: number;
}
const services = ["tmy-api.service"] as const;
const children = new Set<ChildProcess>();
let abortRequested = false;
const stopRequested = () => {
  abortRequested = true;
  for (const child of children) child.kill("SIGTERM");
};
const childEnvironment = {
  PATH: "/usr/sbin:/usr/bin:/sbin:/bin",
  LANG: "C.UTF-8",
  HOME: "/root",
};

function command(
  program: string,
  args: string[],
  options: CommandOptions = {},
): Promise<string> {
  return new Promise((resolveCommand, reject) => {
    if (
      abortRequested &&
      !(program === "systemctl" && ["start", "show"].includes(args[0] ?? ""))
    ) {
      reject(new Error("备份被中止，正在恢复服务"));
      return;
    }
    const child = spawn(program, args, {
      env: childEnvironment,
      stdio: ["ignore", options.outputFd ?? "pipe", "pipe"],
    });
    children.add(child);
    let stdout = "";
    let overflow = false;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    }, options.timeoutMs ?? 120000);
    if (child.stdout)
      child.stdout.on("data", (chunk: Buffer) => {
        if (options.capture) {
          if (stdout.length + chunk.length <= 65536)
            stdout += chunk.toString("utf8");
          else overflow = true;
        }
      });
    child.stderr?.on("data", () => {
      /* Suppress diagnostics that might contain credential-file contents. */
    });
    child.once("error", () => {
      clearTimeout(timer);
      reject(new Error(`${program} 无法启动；未输出命令参数或凭据`));
    });
    child.once("close", (code, signal) => {
      children.delete(child);
      clearTimeout(timer);
      if (code !== 0 || overflow)
        reject(
          new Error(
            `${program} 执行失败（状态 ${code ?? signal ?? "unknown"}）；请通过受限管理员终端排查`,
          ),
        );
      else resolveCommand(stdout.trim());
    });
  });
}
async function privateDirectory(path: string): Promise<string> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const information = await lstat(path);
  if (
    !information.isDirectory() ||
    information.isSymbolicLink() ||
    information.uid !== 0
  )
    throw new Error("备份目录必须是root拥有的真实目录");
  await chmod(path, 0o700);
  return realpath(path);
}
async function sourceDirectory(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error("源目录必须为绝对路径");
  const information = await lstat(path);
  if (!information.isDirectory() || information.isSymbolicLink())
    throw new Error("源目录不存在或为软链接");
  return realpath(path);
}
async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path))
    hash.update(chunk as Buffer);
  return hash.digest("hex");
}
function safeOptions(options: Options): void {
  const parent = resolve(dirname(options.output));
  const parts = parent.split(sep).filter(Boolean);
  if (
    parts.length < 3 ||
    ["etc", "usr", "bin", "sbin", "boot", "dev", "proc", "sys", "run"].includes(
      parts[0] ?? "",
    )
  )
    throw new Error("必须使用专用备份子目录，例如/var/backups/tmy-phase2");
  if (!isAbsolute(options.output) || !options.output.endsWith(".tar.gz"))
    throw new Error("--output 必须是绝对路径且以.tar.gz结尾");
  if (!/^[A-Za-z0-9_]{1,64}$/.test(options.database))
    throw new Error("数据库名称不合法");
}

export async function backupHost(
  options: Options,
): Promise<{ file: string; sha256: string; bytes: number }> {
  safeOptions(options);
  if (process.platform !== "linux" || process.getuid?.() !== 0)
    throw new Error("此工具只允许在目标Linux服务器以root运行");
  process.umask(0o077);
  const outputDirectory = await privateDirectory(dirname(options.output));
  const output = join(outputDirectory, basename(options.output));
  try {
    await lstat(output);
    throw new Error("目标备份已存在，拒绝覆盖");
  } catch (error: unknown) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    )
      throw error;
  }
  const attachments = await sourceDirectory(options.attachments);
  if (["database.sql", "manifest.json"].includes(basename(attachments)))
    throw new Error("归档源目录名称冲突");
  if (outputDirectory === attachments || outputDirectory.startsWith(attachments + sep))
    throw new Error("备份目标不能位于被备份目录内");
  if (options.mysqlDefaults) {
    const info = await lstat(options.mysqlDefaults);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.uid !== 0 ||
      (info.mode & 0o077) !== 0
    )
      throw new Error("MySQL凭据文件必须root拥有且权限0600，不能为软链接");
  }
  for (const program of ["systemctl", "mysqldump", "tar"])
    await command(program, ["--version"]);
  const states = new Map<string, string>();
  for (const service of services) {
    const load = await command(
      "systemctl",
      ["show", service, "--property=LoadState", "--value"],
      { capture: true },
    );
    if (load !== "loaded") throw new Error(`${service} 未安装`);
    const state = await command(
      "systemctl",
      ["show", service, "--property=ActiveState", "--value"],
      { capture: true },
    );
    if (!["active", "inactive", "failed"].includes(state))
      throw new Error(`${service} 正在切换状态，请稍后再备份`);
    states.set(service, state);
  }
  // A single host lock prevents overlap across different output paths; never remove a pre-existing lock.
  const lockPath = "/run/tmy-phase2-backup.lock";
  const lock = await open(lockPath, "wx", 0o600);
  await lock.writeFile(String(process.pid));
  await lock.close();
  abortRequested = false;
  process.on("SIGTERM", stopRequested);
  process.on("SIGINT", stopRequested);
  const work = join(outputDirectory, `.backup-work-${randomUUID()}`);
  const temporaryArchive = join(
    outputDirectory,
    `.backup-${randomUUID()}.partial`,
  );
  const restart = new Set<string>();
  let primaryFailure: unknown;
  let completed = false;
  let checksum = "";
  let bytes = 0;
  try {
    await mkdir(work, { mode: 0o700 });
    for (const service of services)
      if (states.get(service) === "active") {
        restart.add(service);
        await command("systemctl", ["stop", service], { timeoutMs: 180000 });
        const active = await command(
          "systemctl",
          ["show", service, "--property=ActiveState", "--value"],
          { capture: true },
        );
        if (active !== "inactive")
          throw new Error(`${service} 未完全停止，拒绝生成快照`);
      }
    const dumpPath = join(work, "database.sql");
    const dump = await open(dumpPath, "wx", 0o600);
    try {
      const credentials = options.mysqlDefaults
        ? [`--defaults-extra-file=${resolve(options.mysqlDefaults)}`]
        : ["--no-defaults", "--protocol=socket", "--user=root"];
      await command(
        "mysqldump",
        [
          ...credentials,
          "--single-transaction",
          "--quick",
          "--routines",
          "--events",
          "--triggers",
          "--hex-blob",
          "--no-tablespaces",
          "--set-gtid-purged=OFF",
          "--column-statistics=0",
          "--databases",
          options.database,
        ],
        { outputFd: dump.fd, timeoutMs: 1800000 },
      );
      await dump.sync();
    } finally {
      await dump.close();
    }
    if ((await stat(dumpPath)).size === 0) throw new Error("MySQL备份为空");
    await writeFile(
      join(work, "manifest.json"),
      JSON.stringify(
        {
          version: 2,
          created_at: new Date().toISOString(),
          database: options.database,
          attachments_source: attachments,
          source_repository: "git@github.com:qq245168586/qqtSaaS.git",
          services_before: Object.fromEntries(states),
          consistency:
            "API stopped during database and attachment archive; source code hosted on GitHub; no concurrent direct SQL/import jobs permitted",
        },
        null,
        2,
      ),
      { flag: "wx", mode: 0o600 },
    );
    const archive = await open(temporaryArchive, "wx", 0o600);
    try {
      await command(
        "tar",
        [
          "--create",
          "--gzip",
          "--file=-",
          "--directory",
          work,
          "database.sql",
          "manifest.json",
          "--directory",
          dirname(attachments),
          basename(attachments),
        ],
        { outputFd: archive.fd, timeoutMs: 1800000 },
      );
      await archive.sync();
    } finally {
      await archive.close();
    }
    await command("tar", ["--list", "--gzip", "--file", temporaryArchive], {
      timeoutMs: 1800000,
    });
    checksum = await sha256(temporaryArchive);
    if (abortRequested) throw new Error("备份被中止，正在恢复服务");
    bytes = (await stat(temporaryArchive)).size;
    await link(temporaryArchive, output);
    await unlink(temporaryArchive);
    completed = true;
  } catch (error: unknown) {
    primaryFailure = error;
  } finally {
    const failedRestarts: string[] = [];
    for (const service of [...restart].reverse()) {
      try {
        await command("systemctl", ["start", service], { timeoutMs: 180000 });
        const active = await command(
          "systemctl",
          ["show", service, "--property=ActiveState", "--value"],
          { capture: true },
        );
        if (active !== "active") throw new Error("not active");
      } catch {
        failedRestarts.push(service);
      }
    }
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
    if (!completed) await unlink(temporaryArchive).catch(() => undefined);
    await unlink(lockPath).catch(() => undefined);
    process.off("SIGTERM", stopRequested);
    process.off("SIGINT", stopRequested);
    if (failedRestarts.length)
      throw new Error(
        `备份流程结束，但服务恢复失败：${failedRestarts.join(", ")}。${completed ? "完整备份已保留。" : "未发布完整备份。"}请立即人工恢复服务。`,
      );
  }
  if (primaryFailure) throw primaryFailure;
  if (!completed) throw new Error("备份未完成");
  return { file: output, sha256: checksum, bytes };
}

if (process.argv[1] && /backup-host\.(?:ts|js)$/.test(process.argv[1])) {
  const { values } = parseArgs({
    options: {
      output: { type: "string" },
      database: { type: "string", default: "tmy_tri_manager" },
      "mysql-defaults": { type: "string" },
      attachments: {
        type: "string",
        default: "/var/lib/tmy-phase2/attachments",
      },
    },
  });
  if (!values.output) {
    console.error(
      "用法：backup-host --output /var/backups/tmy-phase2/唯一名称.tar.gz [--mysql-defaults /etc/tmy-phase2/backup-mysql.cnf]",
    );
    process.exitCode = 1;
  } else
    void backupHost({
      output: values.output,
      database: values.database ?? "tmy_tri_manager",
      ...(values["mysql-defaults"]
        ? { mysqlDefaults: values["mysql-defaults"] }
        : {}),
      attachments: values.attachments ?? "/var/lib/tmy-phase2/attachments",
    })
      .then((result) => console.log(JSON.stringify(result)))
      .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : "备份失败");
        process.exitCode = 1;
      });
}
