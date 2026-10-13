import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = 10293;
const address = `http://127.0.0.1:${port}`;
const entryUrl = `${address}/english-printer/`;
const socket = 'english-printer-site';
const session = 'preview';
const action = process.argv[2] || 'status';
function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function optional(command, args) {
  try { return run(command, args); } catch { return ''; }
}
function tmux(...args) { return run('tmux', ['-L', socket, ...args]); }
function listeners() {
  return [...new Set(optional('lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN']).split('\n').filter(Boolean))];
}
function managed(pid) {
  const cwd = optional('tmux', ['-L', socket, 'display-message', '-p', '-t', session, '#{pane_current_path}']);
  const panePid = optional('tmux', ['-L', socket, 'display-message', '-p', '-t', session, '#{pane_pid}']);
  return cwd === root && panePid === pid;
}
async function inspect() {
  const pids = listeners();
  if (!pids.length) return null;
  if (pids.length !== 1) throw Error(`${port} 端口归属不明确，未操作现有进程。`);
  const cwd = run('lsof', ['-a', '-p', pids[0], '-d', 'cwd', '-Fn']).split('\n').find(line => line.startsWith('n'))?.slice(1);
  if (cwd !== root) throw Error(`${port} 被其他工作区占用，未操作现有进程。`);
  let response;
  let health;
  try {
    response = await fetch(`${address}/__site_health`, { signal: AbortSignal.timeout(1500) });
    health = await response.json();
  } catch {
    throw Error(`${port} 健康检查失败，未操作现有进程。`);
  }
  if (!response.ok || !health.ok || health.project !== 'english-printer-site' || health.root !== root || health.siteRoot !== resolve(root, 'docs') || health.basePath !== '/english-printer/' || health.port !== port) {
    throw Error(`${port} 健康检查与当前宣传页工作区不匹配。`);
  }
  if (!managed(pids[0])) throw Error(`${port} 服务不属于本脚本的独立 tmux 会话，未操作现有进程。`);
  return pids[0];
}

try {
  if (!['up', 'status', 'down'].includes(action)) throw Error('用法：node scripts/site-acceptance.mjs up|status|down');
  if (Number(process.versions.node.split('.')[0]) < 22) throw Error('宣传页验收需要 Node.js 22 或更新版本。');
  const registry = await readFile(resolve(homedir(), '.config/local-deploy/ports.yaml'), 'utf8');
  const entry = registry.match(/^ {2}english-printer:\n(?:^ {4,}.*\n|^\s*\n)*/m)?.[0] || '';
  if (!entry.includes(root) || !entry.includes('assigned_block: 10290-10299') || !entry.includes(`port: ${port}`)) {
    throw Error('宣传页端口登记与当前工作区不一致，请先核对 ports.yaml。');
  }
  let pid = await inspect();
  if (action === 'status') {
    if (!pid) throw Error('宣传页验收服务未运行。');
    console.log(`宣传页服务健康，独立 tmux 会话，PID ${pid}，工作区 ${root}\n${entryUrl}`);
  } else if (action === 'up') {
    if (pid) {
      console.log(`复用当前工作区宣传页服务，PID ${pid}\n${entryUrl}`);
    } else {
      if (!(await stat(resolve(root, 'docs/index.html'))).isFile()) throw Error('docs/index.html 尚未就绪。');
      if (optional('tmux', ['-L', socket, 'list-sessions', '-F', '#{session_name}']).split('\n').includes(session)) {
        throw Error('已有宣传页验收会话但服务未就绪，未自动停止。');
      }
      tmux('new-session', '-d', '-s', session, '-c', root, process.execPath, resolve(root, 'scripts/site-server.mjs'));
      for (let i = 0; i < 20; i++) {
        await delay(150);
        pid = await inspect();
        if (pid) break;
      }
      if (!pid) throw Error('宣传页后台服务未通过健康检查，请检查验收会话。');
      console.log(`宣传页后台服务已启动，PID ${pid}\n${entryUrl}`);
    }
  } else if (!pid) {
    console.log('宣传页服务已停止。');
  } else {
    tmux('kill-session', '-t', session);
    for (let i = 0; i < 20; i++) {
      await delay(100);
      if (!listeners().length) break;
    }
    if (listeners().length) throw Error(`${port} 端口尚未释放，请检查。`);
    console.log(`宣传页验收服务已停止，${port} 端口已释放。`);
  }
} catch (error) {
  // No model configuration, history, device state, or private local files are read.
  console.error(error.message);
  process.exitCode = 1;
}
