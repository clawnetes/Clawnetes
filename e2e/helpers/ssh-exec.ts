/**
 * SSH execution helpers for remote E2E tests.
 *
 * Uses the system `ssh` CLI (no extra npm deps) to execute commands
 * on a remote host.
 */
import { execSync, spawn, ChildProcess } from "child_process";

export interface RemoteConfig {
  ip: string;
  user: string;
  password?: string;
  sshKey?: string;
}

function buildSshArgs(config: RemoteConfig): string[] {
  const args = [
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null",
    "-o", "ConnectTimeout=10",
    "-o", "LogLevel=ERROR",
  ];
  if (config.sshKey) {
    args.push("-i", config.sshKey);
  }
  return args;
}

function buildSshPrefix(config: RemoteConfig): string {
  const args = buildSshArgs(config);
  const sshCmd = `ssh ${args.join(" ")} ${config.user}@${config.ip}`;
  if (config.password && !config.sshKey) {
    return `sshpass -p '${config.password}' ${sshCmd}`;
  }
  return sshCmd;
}

/**
 * Execute a command on the remote host via SSH.
 * Throws on non-zero exit code.
 */
export function sshExec(config: RemoteConfig, cmd: string, timeoutMs = 60_000): string {
  const prefix = buildSshPrefix(config);
  // Escape single quotes in the command
  const escapedCmd = cmd.replace(/'/g, "'\\''");
  return execSync(`${prefix} '${escapedCmd}'`, {
    shell: "/bin/zsh",
    timeout: timeoutMs,
    encoding: "utf-8",
    env: { ...process.env },
  }).trim();
}

/**
 * Execute a command on the remote host, returning null on failure.
 */
export function sshExecSafe(config: RemoteConfig, cmd: string, timeoutMs = 60_000): string | null {
  try {
    return sshExec(config, cmd, timeoutMs);
  } catch {
    return null;
  }
}

/**
 * Write content to a remote file via SSH heredoc.
 */
export function scpWrite(config: RemoteConfig, remotePath: string, content: string): void {
  const prefix = buildSshPrefix(config);
  const escapedContent = content.replace(/\\/g, "\\\\").replace(/'/g, "'\\''");
  execSync(`${prefix} "mkdir -p $(dirname '${remotePath}') && cat > '${remotePath}'" <<'SSHEOF'\n${escapedContent}\nSSHEOF`, {
    shell: "/bin/zsh",
    timeout: 30_000,
    encoding: "utf-8",
    env: { ...process.env },
  });
}

/**
 * Start an SSH tunnel in the background.
 * Returns the child process so it can be killed later.
 */
export function startSshTunnel(
  config: RemoteConfig,
  localPort: number,
  remotePort: number
): ChildProcess {
  const args = [
    ...buildSshArgs(config),
    "-N", // No remote command
    "-L", `${localPort}:127.0.0.1:${remotePort}`,
    `${config.user}@${config.ip}`,
  ];

  const child = spawn("ssh", args, {
    detached: true,
    stdio: "ignore",
  });

  child.unref();
  return child;
}
