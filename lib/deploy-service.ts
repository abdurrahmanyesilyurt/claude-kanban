/**
 * Deploy Service — SSH-based deployment automation
 * Supports .NET (dotnet publish + scp + systemd) and Node.js (git pull + npm + pm2)
 */
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";

// ─── Project Configurations ───────────────────────────────────────────────

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
  return runCommand("ssh", [
    "-o", "ConnectTimeout=10",
    "-o", "StrictHostKeyChecking=no",
    "-i", toMsysPath(config.sshKey),
    `${config.user}@${config.server}`,
    command,
  ]);
}

function scpCmd(config: DeployConfig, localPath: string, remotePath: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return runCommand("scp", [
    "-o", "ConnectTimeout=10",
    "-o", "StrictHostKeyChecking=no",
    "-i", toMsysPath(config.sshKey),
    toMsysPath(localPath),
    `${config.user}@${config.server}:${remotePath}`,
  ]);
}

// ─── .NET Deploy ─────────────────────────────────────────────────────────

async function deployDotnet(config: DeployConfig): Promise<boolean> {
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

  const tarResult = await runCommand("tar", [
    "czf", toMsysPath(tarFile),
    "-C", toMsysPath(publishPath),
    ".",
  ]);

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

  // Step 10: Health check
  log(state, "health-check", "Uygulama kontrol ediliyor...");
  await new Promise((r) => setTimeout(r, 3000));
  const healthResult = await sshCmd(config, `sudo systemctl is-active ${config.serviceName}`);
  if (healthResult.stdout.trim() === "active") {
    log(state, "health-check", "Service calisiyor!", "success");
  } else {
    log(state, "health-check", `Service durumu: ${healthResult.stdout}`, "error");

    // Get last logs for debugging
    const logsResult = await sshCmd(config, `sudo journalctl -u ${config.serviceName} -n 20 --no-pager`);
    log(state, "health-check", `Son loglar:\n${logsResult.stdout}`, "error");
    return false;
  }

  // Cleanup local tar
  if (fs.existsSync(tarFile)) fs.unlinkSync(tarFile);

  return true;
}

// ─── NestJS/Node.js Deploy ───────────────────────────────────────────────

async function deployNestjs(config: DeployConfig): Promise<boolean> {
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

  // Step 6: Health check
  log(state, "health-check", "Uygulama kontrol ediliyor...");
  await new Promise((r) => setTimeout(r, 3000));
  const healthResult = await sshCmd(config, `pm2 show ${config.pm2Name} --no-color | grep status`);
  if (healthResult.stdout.includes("online")) {
    log(state, "health-check", "Uygulama calisiyor!", "success");
  } else {
    log(state, "health-check", `PM2 durumu: ${healthResult.stdout}`, "error");
    const logsResult = await sshCmd(config, `pm2 logs ${config.pm2Name} --lines 15 --nostream`);
    log(state, "health-check", `Son loglar:\n${logsResult.stdout}`, "error");
    return false;
  }

  return true;
}

// ─── Main Deploy Function ────────────────────────────────────────────────

export async function deploy(projectKey: string): Promise<DeployState> {
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

  log(state, "start", `${config.name} deploy baslatiliyor...`);

  try {
    let success = false;

    switch (config.type) {
      case "dotnet":
      case "dotnet-fdd":
        success = await deployDotnet(config);
        break;
      case "nestjs":
        success = await deployNestjs(config);
        break;
      default:
        log(state, "error", `Desteklenmeyen proje tipi: ${config.type}`, "error");
        success = false;
    }

    state.status = success ? "success" : "failed";
    state.finishedAt = Date.now();
    const duration = ((state.finishedAt - state.startedAt!) / 1000).toFixed(1);
    log(state, "done", `Deploy ${success ? "basarili" : "basarisiz"} (${duration}s)`, success ? "success" : "error");
  } catch (e) {
    state.status = "failed";
    state.finishedAt = Date.now();
    log(state, "error", `Beklenmeyen hata: ${e}`, "error");
  }

  return state;
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
