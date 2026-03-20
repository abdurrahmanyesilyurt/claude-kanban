/**
 * Deploy Service — SSH-based deployment automation
 * Supports .NET (dotnet publish + scp + systemd) and Node.js (git pull + npm + pm2)
 * Includes deployment history tracking and rollback support.
 */
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import { v4 as uuidv4 } from "uuid";
import {
  createDeploymentHistory,
  updateDeploymentHistory,
  getDeploymentHistory,
  getDeploymentById,
  getLastSuccessfulDeployment,
  type DeploymentHistory,
} from "./db";

export type { DeploymentHistory };
export { getDeploymentHistory, getDeploymentById };

// ─── Project Configurations ───────────────────────────────────────────────

export interface HealthCheckConfig {
  /** Deploy sonrası HTTP GET ile kontrol edilecek URL (2xx beklenir) */
  url: string;
  /** Kaç kez deneneceği (default: 3) */
  retries?: number;
  /** Denemeler arası bekleme süresi ms (default: 5000) */
  intervalMs?: number;
}

export interface DeployConfig {
  name: string;
  type: "dotnet" | "dotnet-fdd" | "nestjs" | "unknown";
  server: string;
  user: string;
  sshKey: string;
  localDir: string;
  remotePath: string;
  // .NET specific
  projectFile?: string;
  publishDir?: string;
  serviceName?: string;
  executableName?: string;
  selfContained?: boolean; // default true for dotnet, false for dotnet-fdd
  fileOwner?: string; // default www-data
  // Node.js specific
  pm2Name?: string;
  backendSubdir?: string;
  // Backup
  backup_dir?: string; // e.g. /var/backups/karbon — sunucuda yedek dizini
  // HTTP Health Check (deploy sonrası otomatik)
  healthCheck?: HealthCheckConfig;
  // Status
  enabled: boolean;
}

export const DEPLOY_CONFIGS: Record<string, DeployConfig> = {
  karbon: {
    name: "Karbon",
    type: "dotnet",
    server: "13.62.69.38",
    user: "ubuntu",
    sshKey: "C:/Users/HP/Downloads/karbon.pem",
    localDir: "C:/Users/HP/source/repos/Karbon",
    remotePath: "/var/www/karbon",
    projectFile: "Karbon.csproj",
    publishDir: "publish",
    serviceName: "karbon",
    executableName: "Karbon",
    backup_dir: "/var/backups/karbon",
    enabled: true,
  },
  nakliyekoop: {
    name: "NakliyeKoop",
    type: "nestjs",
    server: "18.156.125.48",
    user: "ubuntu",
    sshKey: "C:/Users/HP/Downloads/LightsailDefaultKey-eu-central-1.pem",
    localDir: "C:/Users/HP/source/repos/nakliyekoop-monorepo",
    remotePath: "~/nakliyekoop-monorepo",
    pm2Name: "nakliyekoop-api",
    backendSubdir: "apps/nakliyekoop-backend",
    backup_dir: "/var/backups/nakliyekoop",
    enabled: true,
  },
  kadikoy: {
    name: "Kadikoy",
    type: "dotnet",
    server: "51.21.141.250",
    user: "ubuntu",
    sshKey: "C:/Users/HP/Downloads/sayglobal.pem",
    localDir: "C:/Users/HP/source/repos/Kadikoy",
    remotePath: "/var/www/kadikoy",
    projectFile: "Kadikoy.csproj",
    publishDir: "publish",
    serviceName: "kadikoy",
    executableName: "Kadikoy",
    backup_dir: "/var/backups/kadikoy",
    enabled: false, // SSH erişimi başarısız — key/user bilinmiyor
  },
  sayvera: {
    name: "SayveraGlobal",
    type: "dotnet-fdd",
    server: "18.156.32.110",
    user: "ubuntu",
    sshKey: "C:/Users/HP/Downloads/sayglobal.pem",
    localDir: "C:/Users/HP/Desktop/sayglobal.Web/sayglobal.Web/sayglobal.Web",
    remotePath: "/home/ubuntu/sayglobal-api",
    projectFile: "sayglobal.Web.csproj",
    publishDir: "publish",
    serviceName: "sayglobal-api",
    executableName: "sayglobal.Web.dll",
    selfContained: false,
    fileOwner: "ubuntu",
    backup_dir: "/var/backups/sayvera",
    enabled: true,
  },
};

// ─── Deploy State ────────────────────────────────────────────────────────

export interface DeployLog {
  timestamp: number;
  step: string;
  message: string;
  type: "info" | "success" | "error" | "warn";
}

export interface DeployState {
  project: string;
  status: "idle" | "running" | "success" | "failed";
  startedAt: number | null;
  finishedAt: number | null;
  logs: DeployLog[];
  currentStep: string;
  backup_path?: string;        // Bu deploy için alınan yedek dizini
  rollback_available?: boolean; // Rollback yapılabilir mi
}

const g = globalThis as unknown as {
  __deployStates: Record<string, DeployState>;
};
if (!g.__deployStates) g.__deployStates = {};

function getState(project: string): DeployState {
  if (!g.__deployStates[project]) {
    g.__deployStates[project] = {
      project,
      status: "idle",
      startedAt: null,
      finishedAt: null,
      logs: [],
      currentStep: "",
    };
  }
  return g.__deployStates[project];
}

export function getDeployStatus(project: string): DeployState {
  return getState(project);
}

export function getAllDeployStatuses(): Record<string, DeployState> {
  const result: Record<string, DeployState> = {};
  for (const key of Object.keys(DEPLOY_CONFIGS)) {
    result[key] = getState(key);
  }
  return result;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Yerel git repo'sunun HEAD commit hash'ini döner (kısa format, 8 karakter) */
async function getLocalGitCommit(dir: string): Promise<string> {
  const result = await runCommand("git", ["-C", dir, "rev-parse", "HEAD"], { timeout: 10000 });
  return result.code === 0 ? result.stdout.trim().substring(0, 8) : "";
}

function log(state: DeployState, step: string, message: string, type: DeployLog["type"] = "info") {
  state.currentStep = step;
  state.logs.push({ timestamp: Date.now(), step, message, type });
  console.log(`[Deploy:${state.project}] [${type}] ${step}: ${message}`);
}

/** Convert Windows path to MSYS/Git-Bash path: C:\foo → /c/foo */
function toMsysPath(p: string): string {
  const normalized = p.replace(/\\/g, "/");
  return normalized.replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`);
}

function runCommand(
  command: string,
  args: string[],
  options?: { cwd?: string; timeout?: number }
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd: options?.cwd,
      shell: true,
      timeout: options?.timeout || 300000, // 5 min default
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (d) => (stdout += d.toString()));
    proc.stderr?.on("data", (d) => (stderr += d.toString()));

    proc.on("close", (code) => {
      resolve({ code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() });
    });

    proc.on("error", (err) => {
      resolve({ code: 1, stdout: "", stderr: err.message });
    });
  });
}

function sshCmd(config: DeployConfig, command: string): Promise<{ code: number; stdout: string; stderr: string }> {
  // Wrap remote command in single quotes to prevent local shell from interpreting && ; etc.
  // Escape any single quotes inside the command: ' → '\''
  const escaped = command.replace(/'/g, "'\\''");
  const fullCmd = `ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no -i "${toMsysPath(config.sshKey)}" ${config.user}@${config.server} '${escaped}'`;
  return runCommandRaw(fullCmd);
}

/** Run a raw shell command string (for complex quoting scenarios) */
function runCommandRaw(
  cmd: string,
  options?: { cwd?: string; timeout?: number }
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn("bash", ["-c", cmd], {
      cwd: options?.cwd,
      timeout: options?.timeout || 300000,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (d) => (stdout += d.toString()));
    proc.stderr?.on("data", (d) => (stderr += d.toString()));

    proc.on("close", (code) => {
      resolve({ code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() });
    });

    proc.on("error", (err) => {
      resolve({ code: 1, stdout: "", stderr: err.message });
    });
  });
}

// ─── HTTP Health Check ────────────────────────────────────────────────────

/**
 * Deploy edilen servise HTTP GET atar, 2xx yanıt beklenir.
 * Tüm retry'lar tükendikten sonra başarısız olursa { ok: false } döner.
 *
 * @param url       - Kontrol edilecek endpoint
 * @param retries   - Toplam deneme sayısı (default: 3)
 * @param intervalMs - Denemeler arası bekleme ms (default: 5000)
 */
export async function performHealthCheck(
  url: string,
  retries = 3,
  intervalMs = 5000
): Promise<{ ok: boolean; status?: number; error?: string }> {
  let lastError = "bilinmeyen hata";

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000); // 10s timeout/deneme
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);

      if (res.status >= 200 && res.status < 300) {
        return { ok: true, status: res.status };
      }

      lastError = `HTTP ${res.status} ${res.statusText}`;
      console.log(`[HealthCheck] Deneme ${attempt}/${retries}: ${lastError}`);
    } catch (e: unknown) {
      lastError = e instanceof Error ? e.message : String(e);
      console.log(`[HealthCheck] Deneme ${attempt}/${retries} hata: ${lastError}`);
    }

    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  return {
    ok: false,
    error: `Health check basarisiz — ${lastError} (${retries} deneme sonrasi)`,
  };
}

// ─── Auto-Rollback Notification ───────────────────────────────────────────

/**
 * Otomatik rollback tetiklendiğinde WhatsApp bildirimi gönderir.
 * DEPLOY_NOTIFY_NUMBER env değişkeni tanımlıysa ve WhatsApp bağlıysa çalışır.
 * Hata olursa sessizce geçer — deploy akışını bozmaz.
 */
async function sendAutoRollbackNotification(
  projectName: string,
  healthCheckUrl: string,
  historyId?: string
): Promise<void> {
  const notifyTarget = process.env.DEPLOY_NOTIFY_NUMBER;
  if (!notifyTarget) return;

  try {
    // Dynamic import — circular dependency'yi önler
    const { sendMessage, getStatus } = await import("./whatsapp-service");
    const status = getStatus();
    if (!status.connected) return; // WhatsApp bağlı değil, sessizce geç

    const lines = [
      `🚨 *Auto-Rollback Tetiklendi*`,
      ``,
      `*Proje:* ${projectName}`,
      `*Health Check URL:* ${healthCheckUrl}`,
      historyId ? `*Deploy ID:* \`${historyId.slice(0, 8)}\`` : "",
      `*Zaman:* ${new Date().toLocaleString("tr-TR")}`,
      ``,
      `Deploy sonrası HTTP health check tüm denemeler tükendikten sonra başarısız oldu.`,
      `Önceki sürüme otomatik rollback uygulandı.`,
    ].filter(Boolean);

    await sendMessage(notifyTarget, lines.join("\n"));
    console.log(`[Deploy] Auto-rollback WhatsApp bildirimi gönderildi → ${notifyTarget}`);
  } catch (e) {
    console.error("[Deploy] WhatsApp bildirim gönderilemedi:", e);
    // Hata durumunda sessizce geç
  }
}

function scpCmd(config: DeployConfig, localPath: string, remotePath: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const fullCmd = `scp -o ConnectTimeout=10 -o StrictHostKeyChecking=no -i "${toMsysPath(config.sshKey)}" "${toMsysPath(localPath)}" ${config.user}@${config.server}:${remotePath}`;
  return runCommandRaw(fullCmd);
}

// ─── Backup & Rollback ───────────────────────────────────────────────────

/**
 * Deploy başlamadan önce sunucudaki mevcut versiyonu yedekler.
 * Sunucuda: /var/backups/{project}/{timestamp}/ dizinine kopyalar.
 * Returns: backup path ya da null (backup_dir yoksa / hata olursa)
 */
async function backupCurrentVersion(config: DeployConfig, state: DeployState): Promise<string | null> {
  if (!config.backup_dir) {
    log(state, "backup", "backup_dir tanimlanmamis, yedekleme atlaniyor", "warn");
    return null;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19); // 2024-01-15T12-30-00
  const backupPath = `${config.backup_dir}/${timestamp}`;

  log(state, "backup", `Mevcut surum yedekleniyor: ${backupPath}`);

  // bash -c ile Windows uyumlu — && zinciri tek SSH oturumunda
  const result = await sshCmd(config,
    `bash -c 'sudo mkdir -p ${backupPath} && sudo cp -rp ${config.remotePath}/. ${backupPath}/'`
  );

  if (result.code !== 0) {
    log(state, "backup", `Yedekleme basarisiz (deploy devam ediyor): ${result.stderr}`, "warn");
    return null;
  }

  log(state, "backup", `Yedekleme tamamlandi: ${backupPath}`, "success");
  return backupPath;
}

/**
 * Belirtilen backup dizininden geri yükler ve servisi restart eder.
 * Hem dotnet hem dotnet-fdd için çalışır.
 */
async function performRollback(config: DeployConfig, state: DeployState, backupPath: string): Promise<boolean> {
  log(state, "rollback", `Rollback baslatiliyor: ${backupPath}`, "warn");

  if (config.type === "dotnet" || config.type === "dotnet-fdd") {
    if (!config.serviceName) {
      log(state, "rollback", "serviceName tanimlanmamis, rollback yapilamiyor", "error");
      return false;
    }

    const result = await sshCmd(config,
      `bash -c 'sudo systemctl stop ${config.serviceName} && sudo rm -rf ${config.remotePath}/* && sudo cp -rp ${backupPath}/. ${config.remotePath}/ && sudo systemctl start ${config.serviceName}'`
    );

    if (result.code !== 0) {
      log(state, "rollback", `Rollback basarisiz: ${result.stderr}`, "error");
      return false;
    }

    log(state, "rollback", `Rollback tamamlandi — ${backupPath} geri yuklendi`, "success");
    return true;

  } else if (config.type === "nestjs") {
    if (!config.pm2Name) {
      log(state, "rollback", "pm2Name tanimlanmamis, rollback yapilamiyor", "error");
      return false;
    }
    // NestJS: dosyaları geri yükle, sonra PM2 restart
    const result = await sshCmd(config,
      `bash -c 'sudo cp -rp ${backupPath}/. ${config.remotePath}/ && pm2 restart ${config.pm2Name}'`
    );

    if (result.code !== 0) {
      log(state, "rollback", `Rollback basarisiz: ${result.stderr}`, "error");
      return false;
    }

    log(state, "rollback", `Rollback tamamlandi — PM2 yeniden baslatildi`, "success");
    return true;
  }

  log(state, "rollback", `Desteklenmeyen proje tipi rollback icin: ${config.type}`, "error");
  return false;
}

/**
 * PUBLIC: Belirtilen proje için en son backup dizininden rollback yapar.
 */
export async function rollbackDeploy(projectKey: string): Promise<{
  success: boolean;
  backup_path?: string;
  message: string;
}> {
  const config = DEPLOY_CONFIGS[projectKey];
  if (!config) return { success: false, message: `Bilinmeyen proje: ${projectKey}` };
  if (!config.enabled) return { success: false, message: `${config.name} projesi aktif degil` };
  if (!config.backup_dir) return { success: false, message: "backup_dir tanimlanmamis" };

  // Sunucudaki en son backup klasörünü bul
  const listResult = await sshCmd(config,
    `bash -c 'sudo ls -1t ${config.backup_dir} 2>/dev/null | head -1'`
  );

  if (listResult.code !== 0 || !listResult.stdout.trim()) {
    return { success: false, message: "Hicbir yedek bulunamadi" };
  }

  const latestDir = listResult.stdout.trim();
  const backupPath = `${config.backup_dir}/${latestDir}`;

  // Geçici state ile rollback logu tut
  const state = getState(projectKey);

  const ok = await performRollback(config, state, backupPath);
  if (ok) {
    return { success: true, backup_path: backupPath, message: `Rollback basarili: ${backupPath}` };
  } else {
    return { success: false, backup_path: backupPath, message: "Rollback sirasinda hata olustu, loglara bakin" };
  }
}

/**
 * PUBLIC: Sunucudaki backup listesini döndürür (en yeniden eskiye).
 */
export async function listBackups(projectKey: string): Promise<{
  success: boolean;
  backups: string[];
  error?: string;
}> {
  const config = DEPLOY_CONFIGS[projectKey];
  if (!config) return { success: false, backups: [], error: `Bilinmeyen proje: ${projectKey}` };
  if (!config.backup_dir) return { success: false, backups: [], error: "backup_dir tanimlanmamis" };

  const result = await sshCmd(config,
    `bash -c 'sudo ls -1t ${config.backup_dir} 2>/dev/null || true'`
  );

  if (result.code !== 0) {
    return { success: false, backups: [], error: result.stderr };
  }

  const backups = result.stdout
    .split("\n")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => `${config.backup_dir}/${d}`);

  return { success: true, backups };
}

// ─── .NET Deploy ─────────────────────────────────────────────────────────

async function deployDotnet(
  config: DeployConfig,
  backupPath?: string | null,
  historyId?: string,
  healthCheckCfg?: HealthCheckConfig
): Promise<boolean> {
  const state = getState(config.name.toLowerCase().replace(/\s/g, ""));

  // Step 1: SSH connectivity check
  log(state, "ssh-check", "SSH baglantisi kontrol ediliyor...");
  const sshTest = await sshCmd(config, "echo ok");
  if (sshTest.stdout !== "ok") {
    log(state, "ssh-check", `SSH baglantisi basarisiz: ${sshTest.stderr}`, "error");
    return false;
  }
  log(state, "ssh-check", "SSH baglantisi basarili", "success");

  // Step 2: Clean publish directory (prevents accumulation issue)
  const publishPath = path.join(config.localDir, config.publishDir || "publish");
  log(state, "clean", `Publish klasoru temizleniyor: ${publishPath}`);
  if (fs.existsSync(publishPath)) {
    fs.rmSync(publishPath, { recursive: true, force: true });
    log(state, "clean", "Eski publish dosyalari silindi", "success");
  }

  // Step 3: Build
  const isSelfContained = config.selfContained !== false && config.type !== "dotnet-fdd";
  const buildLabel = isSelfContained ? "Release, linux-x64, self-contained" : "Release, framework-dependent";
  log(state, "build", `Proje derleniyor (${buildLabel})...`);

  const buildArgs = [
    "publish", config.projectFile!,
    "-c", "Release",
    "-o", publishPath,
  ];
  if (isSelfContained) {
    buildArgs.push("-r", "linux-x64", "--self-contained", "true");
  }

  const buildResult = await runCommand("dotnet", buildArgs, { cwd: config.localDir, timeout: 300000 });

  if (buildResult.code !== 0) {
    log(state, "build", `Build basarisiz: ${buildResult.stderr}`, "error");
    return false;
  }
  log(state, "build", "Build tamamlandi", "success");

  // Step 4: Compress
  log(state, "compress", "Dosyalar sikistiriliyor...");
  const tarFile = path.join(os.tmpdir(), `${config.name.toLowerCase()}-deploy.tar.gz`);
  if (fs.existsSync(tarFile)) fs.unlinkSync(tarFile);

  const tarResult = await runCommandRaw(
    `tar czf "${toMsysPath(tarFile)}" -C "${toMsysPath(publishPath)}" .`
  );

  if (tarResult.code !== 0) {
    log(state, "compress", `Sikistirma basarisiz: ${tarResult.stderr}`, "error");
    return false;
  }

  const tarSize = (fs.statSync(tarFile).size / 1024 / 1024).toFixed(1);
  log(state, "compress", `Arsiv: ${tarSize} MB`, "success");

  // Step 5: Stop service
  log(state, "stop-service", `${config.serviceName} servisi durduruluyor...`);
  await sshCmd(config, `sudo systemctl stop ${config.serviceName}`);
  log(state, "stop-service", "Service durduruldu", "success");

  // Step 6: Upload
  log(state, "upload", "Dosyalar sunucuya gonderiliyor...");
  const scpResult = await scpCmd(config, tarFile, `/tmp/${config.name.toLowerCase()}-deploy.tar.gz`);
  if (scpResult.code !== 0) {
    log(state, "upload", `Transfer basarisiz: ${scpResult.stderr}`, "error");
    await sshCmd(config, `sudo systemctl start ${config.serviceName}`);
    return false;
  }
  log(state, "upload", "Transfer tamamlandi", "success");

  // Step 7: Extract on server
  log(state, "extract", "Sunucuda dosyalar aciliyor...");
  const extractResult = await sshCmd(config, [
    `sudo rm -rf ${config.remotePath}/*`,
    `sudo tar xzf /tmp/${config.name.toLowerCase()}-deploy.tar.gz -C ${config.remotePath}`,
    `rm /tmp/${config.name.toLowerCase()}-deploy.tar.gz`,
  ].join(" && "));

  if (extractResult.code !== 0) {
    log(state, "extract", `Dosya acma basarisiz: ${extractResult.stderr}`, "error");
    return false;
  }
  log(state, "extract", "Dosyalar yerlestirildi", "success");

  // Step 8: Set permissions
  log(state, "permissions", "Dosya izinleri ayarlaniyor...");
  const owner = config.fileOwner || "www-data";
  const chmodCmd = isSelfContained
    ? `sudo chmod +x ${config.remotePath}/${config.executableName}`
    : `echo "framework-dependent, chmod skip"`;
  await sshCmd(config, `sudo chown -R ${owner}:${owner} ${config.remotePath} && ${chmodCmd}`);
  log(state, "permissions", "Izinler ayarlandi", "success");

  // Step 9: Start service
  log(state, "start-service", `${config.serviceName} servisi baslatiliyor...`);
  const startResult = await sshCmd(config, `sudo systemctl start ${config.serviceName}`);
  if (startResult.code !== 0) {
    log(state, "start-service", `Service baslatilamadi: ${startResult.stderr}`, "error");
    return false;
  }
  log(state, "start-service", "Service baslatildi", "success");

  // Step 10: Service durumu kontrolü
  log(state, "health-check", "Servis durumu kontrol ediliyor...");
  await new Promise((r) => setTimeout(r, 3000));
  const svcResult = await sshCmd(config, `sudo systemctl is-active ${config.serviceName}`);
  if (svcResult.stdout.trim() !== "active") {
    log(state, "health-check", `Servis aktif degil: ${svcResult.stdout}`, "error");

    // Son loglar
    const logsResult = await sshCmd(config, `sudo journalctl -u ${config.serviceName} -n 20 --no-pager`);
    log(state, "health-check", `Son loglar:\n${logsResult.stdout}`, "error");

    // Otomatik rollback
    if (backupPath) {
      log(state, "health-check", "Auto-rollback triggered due to health check failure", "warn");
      await performRollback(config, state, backupPath);
      await sendAutoRollbackNotification(config.name, `systemctl:${config.serviceName}`, historyId);
    } else {
      log(state, "health-check", "Health check basarisiz — yedek yok, rollback atlanıyor", "warn");
    }

    if (fs.existsSync(tarFile)) fs.unlinkSync(tarFile);
    return false;
  }
  log(state, "health-check", "Servis aktif!", "success");

  // Step 11: HTTP Health Check (config veya override ile tanımlıysa)
  const hcCfg = healthCheckCfg ?? config.healthCheck;
  if (hcCfg) {
    const retries = hcCfg.retries ?? 3;
    const intervalMs = hcCfg.intervalMs ?? 5000;
    log(state, "health-check", `HTTP health check baslatiliyor: ${hcCfg.url} (${retries} deneme, ${intervalMs}ms aralik)`);

    // Servis ayağa kalkması için kısa bekleme
    await new Promise((r) => setTimeout(r, intervalMs));

    const hcResult = await performHealthCheck(hcCfg.url, retries, intervalMs);
    if (!hcResult.ok) {
      log(state, "health-check", `HTTP health check basarisiz: ${hcResult.error}`, "error");

      if (backupPath) {
        log(state, "health-check", "Auto-rollback triggered due to health check failure", "warn");
        await performRollback(config, state, backupPath);
        await sendAutoRollbackNotification(config.name, hcCfg.url, historyId);
      } else {
        log(state, "health-check", "HTTP health check basarisiz — yedek yok, rollback atlanıyor", "warn");
      }

      if (fs.existsSync(tarFile)) fs.unlinkSync(tarFile);
      return false;
    }
    log(state, "health-check", `HTTP health check basarili (HTTP ${hcResult.status})`, "success");
  }

  // Cleanup local tar
  if (fs.existsSync(tarFile)) fs.unlinkSync(tarFile);

  return true;
}

// ─── NestJS/Node.js Deploy ───────────────────────────────────────────────

async function deployNestjs(
  config: DeployConfig,
  backupPath?: string | null,
  historyId?: string,
  healthCheckCfg?: HealthCheckConfig
): Promise<boolean> {
  const state = getState(config.name.toLowerCase().replace(/\s/g, ""));

  // Step 1: SSH check
  log(state, "ssh-check", "SSH baglantisi kontrol ediliyor...");
  const sshTest = await sshCmd(config, "echo ok");
  if (sshTest.stdout !== "ok") {
    log(state, "ssh-check", `SSH baglantisi basarisiz: ${sshTest.stderr}`, "error");
    return false;
  }
  log(state, "ssh-check", "SSH baglantisi basarili", "success");

  // Step 2: Git pull on server
  log(state, "git-pull", "Git pull yapiliyor...");
  const pullResult = await sshCmd(config, `cd ${config.remotePath} && git pull`);
  if (pullResult.code !== 0) {
    log(state, "git-pull", `Git pull basarisiz: ${pullResult.stderr}`, "error");
    return false;
  }
  log(state, "git-pull", `Git pull tamamlandi: ${pullResult.stdout.split("\n").pop()}`, "success");

  // Step 3: npm install
  const backendPath = config.backendSubdir
    ? `${config.remotePath}/${config.backendSubdir}`
    : config.remotePath;

  log(state, "npm-install", "npm install yapiliyor...");
  const npmResult = await sshCmd(config, `cd ${backendPath} && npm install --silent`);
  if (npmResult.code !== 0) {
    log(state, "npm-install", `npm install basarisiz: ${npmResult.stderr}`, "error");
    return false;
  }
  log(state, "npm-install", "Paketler yuklendi", "success");

  // Step 4: Build
  log(state, "build", "Build yapiliyor...");
  const buildResult = await sshCmd(config, `cd ${backendPath} && npm run build 2>&1`);
  if (buildResult.code !== 0) {
    log(state, "build", `Build basarisiz: ${buildResult.stderr || buildResult.stdout}`, "error");
    return false;
  }
  log(state, "build", "Build tamamlandi", "success");

  // Step 5: PM2 restart
  log(state, "restart", `PM2 restart: ${config.pm2Name}...`);
  const restartResult = await sshCmd(config, `pm2 restart ${config.pm2Name}`);
  if (restartResult.code !== 0) {
    log(state, "restart", `PM2 restart basarisiz: ${restartResult.stderr}`, "error");
    return false;
  }
  log(state, "restart", "PM2 restart tamamlandi", "success");

  // Step 6: PM2 durum kontrolü
  log(state, "health-check", "PM2 durumu kontrol ediliyor...");
  await new Promise((r) => setTimeout(r, 3000));
  const pm2Result = await sshCmd(config, `pm2 show ${config.pm2Name} --no-color | grep status`);
  if (!pm2Result.stdout.includes("online")) {
    log(state, "health-check", `PM2 durumu: ${pm2Result.stdout}`, "error");
    const logsResult = await sshCmd(config, `pm2 logs ${config.pm2Name} --lines 15 --nostream`);
    log(state, "health-check", `Son loglar:\n${logsResult.stdout}`, "error");

    if (backupPath) {
      log(state, "health-check", "Auto-rollback triggered due to health check failure", "warn");
      await performRollback(config, state, backupPath);
      await sendAutoRollbackNotification(config.name, `pm2:${config.pm2Name}`, historyId);
    } else {
      log(state, "health-check", "Health check basarisiz — yedek yok, rollback atlanıyor", "warn");
    }

    return false;
  }
  log(state, "health-check", "PM2 online!", "success");

  // Step 7: HTTP Health Check (config veya override ile tanımlıysa)
  const hcCfg = healthCheckCfg ?? config.healthCheck;
  if (hcCfg) {
    const retries = hcCfg.retries ?? 3;
    const intervalMs = hcCfg.intervalMs ?? 5000;
    log(state, "health-check", `HTTP health check baslatiliyor: ${hcCfg.url} (${retries} deneme, ${intervalMs}ms aralik)`);

    await new Promise((r) => setTimeout(r, intervalMs));

    const hcResult = await performHealthCheck(hcCfg.url, retries, intervalMs);
    if (!hcResult.ok) {
      log(state, "health-check", `HTTP health check basarisiz: ${hcResult.error}`, "error");

      if (backupPath) {
        log(state, "health-check", "Auto-rollback triggered due to health check failure", "warn");
        await performRollback(config, state, backupPath);
        await sendAutoRollbackNotification(config.name, hcCfg.url, historyId);
      } else {
        log(state, "health-check", "HTTP health check basarisiz — yedek yok, rollback atlanıyor", "warn");
      }

      return false;
    }
    log(state, "health-check", `HTTP health check basarili (HTTP ${hcResult.status})`, "success");
  }

  return true;
}

// ─── Main Deploy Function ────────────────────────────────────────────────

export async function deploy(
  projectKey: string,
  healthCheckOverride?: HealthCheckConfig
): Promise<DeployState> {
  const config = DEPLOY_CONFIGS[projectKey];
  if (!config) throw new Error(`Unknown project: ${projectKey}`);
  if (!config.enabled) throw new Error(`Project ${config.name} is not enabled for deployment`);

  const state = getState(projectKey);
  if (state.status === "running") {
    throw new Error(`Deploy already running for ${config.name}`);
  }

  // Reset state
  state.status = "running";
  state.startedAt = Date.now();
  state.finishedAt = null;
  state.logs = [];
  state.currentStep = "starting";
  state.backup_path = undefined;
  state.rollback_available = false;

  // ─── DB: deployment history kaydı oluştur ───────────────────────────
  const historyId = uuidv4();
  createDeploymentHistory({
    id: historyId,
    project_key: projectKey,
    deploy_type: config.type,
    triggered_by: "deploy",
    rollback_of: "",
  });

  log(state, "start", `${config.name} deploy baslatiliyor... [history: ${historyId.slice(0, 8)}]`);

  try {
    // Yerel git commit hash'ini al
    const commitHash = await getLocalGitCommit(config.localDir);
    if (commitHash) {
      log(state, "git-info", `Yerel commit: ${commitHash}`);
    }

    // Backup: deploy başlamadan önce mevcut sürümü yedekle
    const backupPath = await backupCurrentVersion(config, state);
    state.backup_path = backupPath ?? undefined;
    state.rollback_available = backupPath !== null;

    // DB'yi backup path ve commit hash ile güncelle
    updateDeploymentHistory(historyId, {
      commit_hash: commitHash,
      backup_path: backupPath ?? "",
    });

    let success = false;

    switch (config.type) {
      case "dotnet":
      case "dotnet-fdd":
        success = await deployDotnet(config, backupPath, historyId, healthCheckOverride);
        break;
      case "nestjs":
        success = await deployNestjs(config, backupPath, historyId, healthCheckOverride);
        break;
      default:
        log(state, "error", `Desteklenmeyen proje tipi: ${config.type}`, "error");
        success = false;
    }

    state.status = success ? "success" : "failed";
    state.finishedAt = Date.now();
    const durationMs = state.finishedAt - state.startedAt!;
    const duration = (durationMs / 1000).toFixed(1);

    if (success) {
      const backupInfo = state.backup_path ? ` | Yedek: ${state.backup_path}` : "";
      log(state, "done", `Deploy basarili (${duration}s)${backupInfo}`, "success");
    } else {
      const rollbackInfo = state.rollback_available
        ? ` | Rollback icin /api/deployments/${projectKey}/rollback endpoint'ini kullanin`
        : "";
      log(state, "done", `Deploy basarisiz (${duration}s)${rollbackInfo}`, "error");
    }

    // ─── DB: sonuç kaydını güncelle ─────────────────────────────────
    updateDeploymentHistory(historyId, {
      status: success ? "success" : "failed",
      finished_at: new Date().toISOString(),
      duration_ms: durationMs,
      logs: JSON.stringify(state.logs),
    });
  } catch (e) {
    state.status = "failed";
    state.finishedAt = Date.now();
    log(state, "error", `Beklenmeyen hata: ${e}`, "error");

    updateDeploymentHistory(historyId, {
      status: "failed",
      finished_at: new Date().toISOString(),
      duration_ms: state.finishedAt - state.startedAt!,
      logs: JSON.stringify(state.logs),
    });
  }

  return state;
}

// ─── Rollback by Deployment ID (DB-driven) ───────────────────────────────

/**
 * Belirtilen deploymentId kaydına ait backup_path kullanarak rollback yapar.
 * - deploymentId: geri dönülecek deployment history kaydının ID'si
 *   (o kaydın backup_path'ı, bu deploy öncesindeki versiyona işaret eder)
 */
export async function rollbackDeployment(deploymentId: string): Promise<{
  success: boolean;
  message: string;
  rollbackHistoryId?: string;
}> {
  // 1. Hedef deployment kaydını DB'den al
  const target = getDeploymentById(deploymentId);
  if (!target) {
    return { success: false, message: `Deployment bulunamadi: ${deploymentId}` };
  }

  if (target.status === "running") {
    return { success: false, message: "Deploy hala calisiyor, rollback yapilamiyor" };
  }

  const config = DEPLOY_CONFIGS[target.project_key];
  if (!config) {
    return { success: false, message: `Proje konfigurasyon bulunamadi: ${target.project_key}` };
  }
  if (!config.enabled) {
    return { success: false, message: `${config.name} projesi aktif degil` };
  }

  // 2. Rollback için backup path'i belirle
  //    target.backup_path = bu deployment'tan ÖNCE alınan yedek (önceki versiyon)
  const backupPath = target.backup_path;
  if (!backupPath) {
    return {
      success: false,
      message: `Bu deployment icin yedek yok (backup_path bos). Manuel rollback gerekiyor.`,
    };
  }

  // 3. Rollback için yeni history kaydı oluştur
  const rollbackHistoryId = uuidv4();
  createDeploymentHistory({
    id: rollbackHistoryId,
    project_key: target.project_key,
    deploy_type: config.type,
    triggered_by: "rollback",
    rollback_of: deploymentId,
  });

  // 4. State hazırla (loglama için)
  const state = getState(target.project_key);
  const rollbackStartedAt = Date.now();

  log(state, "rollback-start", `Rollback baslatiliyor — hedef deployment: ${deploymentId.slice(0, 8)}`, "warn");
  log(state, "rollback-start", `Yedek: ${backupPath}`, "info");

  // 5. Rollback işlemi
  const ok = await performRollback(config, state, backupPath);

  const durationMs = Date.now() - rollbackStartedAt;
  const rollbackStatus = ok ? "success" : "failed";

  if (ok) {
    log(state, "rollback-done", `Rollback basarili (${(durationMs / 1000).toFixed(1)}s)`, "success");
    // Önceki başarılı deployment'ı "rolled_back" olarak işaretle
    updateDeploymentHistory(deploymentId, { status: "rolled_back" });
  } else {
    log(state, "rollback-done", `Rollback basarisiz (${(durationMs / 1000).toFixed(1)}s)`, "error");
  }

  // 6. Rollback history kaydını güncelle
  updateDeploymentHistory(rollbackHistoryId, {
    status: rollbackStatus,
    finished_at: new Date().toISOString(),
    duration_ms: durationMs,
    logs: JSON.stringify(state.logs),
    backup_path: backupPath,
    commit_hash: target.commit_hash, // hangi versiyona döndük
  });

  return {
    success: ok,
    message: ok
      ? `Rollback basarili — ${target.project_key} onceki versiyona dondu`
      : "Rollback basarisiz, loglara bakin",
    rollbackHistoryId,
  };
}

// ─── Quick Server Check ──────────────────────────────────────────────────

export async function checkServer(projectKey: string): Promise<{
  ok: boolean;
  hostname?: string;
  service?: string;
  error?: string;
}> {
  const config = DEPLOY_CONFIGS[projectKey];
  if (!config || !config.enabled) return { ok: false, error: "Project not configured" };

  try {
    const result = await sshCmd(config, "hostname");
    if (result.code !== 0) return { ok: false, error: result.stderr };

    let serviceStatus = "";
    if ((config.type === "dotnet" || config.type === "dotnet-fdd") && config.serviceName) {
      const svc = await sshCmd(config, `sudo systemctl is-active ${config.serviceName}`);
      serviceStatus = svc.stdout.trim();
    } else if (config.type === "nestjs" && config.pm2Name) {
      const pm2 = await sshCmd(config, `pm2 show ${config.pm2Name} --no-color 2>/dev/null | grep status || echo 'not found'`);
      serviceStatus = pm2.stdout.trim();
    }

    return { ok: true, hostname: result.stdout.trim(), service: serviceStatus };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ─── Get Server Logs ─────────────────────────────────────────────────────

export async function getServerLogs(projectKey: string, lines = 30): Promise<string> {
  const config = DEPLOY_CONFIGS[projectKey];
  if (!config || !config.enabled) return "Project not configured";

  if ((config.type === "dotnet" || config.type === "dotnet-fdd") && config.serviceName) {
    const result = await sshCmd(config, `sudo journalctl -u ${config.serviceName} -n ${lines} --no-pager`);
    return result.stdout || result.stderr;
  } else if (config.type === "nestjs" && config.pm2Name) {
    const result = await sshCmd(config, `pm2 logs ${config.pm2Name} --lines ${lines} --nostream`);
    return result.stdout || result.stderr;
  }

  return "Unknown project type";
}
