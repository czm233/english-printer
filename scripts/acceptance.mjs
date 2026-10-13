import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const address = 'http://127.0.0.1:10290';
const socket = 'english-printer';
const session = 'preview';
const action = process.argv[2] || 'status';
function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function optional(command, args) {
  try { return run(command, args); } catch { return ''; }
}
function tmux(...args) { return run('tmux', ['-L', socket, ...args]); }
function managed() {
  return optional('tmux', ['-L', socket, 'display-message', '-p', '-t', session, '#{pane_current_path}']) === root;
}
async function inspect() {
  const pids = [...new Set(optional('lsof', ['-nP', '-t', '-iTCP:10290', '-sTCP:LISTEN']).split('\n').filter(Boolean))];
  if (!pids.length) return null;
  if (pids.length !== 1) throw Error('10290 端口归属不明确，未操作现有进程。');
  const cwd = run('lsof', ['-a', '-p', pids[0], '-d', 'cwd', '-Fn']).split('\n').find(s => s.startsWith('n'))?.slice(1);
  if (cwd !== root) throw Error('10290 被其他工作区占用，未操作现有进程。');
  const r = await fetch(address + '/api/health', { signal: AbortSignal.timeout(1500) });
  const health = await r.json();
  if (!r.ok || health.project !== 'english-printer' || health.root !== root || !health.ok) {
    throw Error('10290 健康检查与当前工作区不匹配。');
  }
  return pids[0];
}

try {
  if (!['up', 'status', 'down'].includes(action)) throw Error('用法：node scripts/acceptance.mjs up|status|down');
  const registry = await readFile(resolve(homedir(), '.config/local-deploy/ports.yaml'), 'utf8');
  const entry = registry.match(/^ {2}english-printer:\n(?:^ {4,}.*\n|^\s*\n)*/m)?.[0] || '';
  if (!entry.includes(root) || !entry.includes('assigned_block: 10290-10299') || !entry.includes('port: 10290')) {
    throw Error('端口登记与当前工作区不一致，请先核对 ports.yaml。');
  }
  let pid = await inspect();
  if (action === 'status') {
    if (!pid) throw Error('本机服务未运行。');
    console.log(`服务健康，PID ${pid}，工作区 ${root}\n${address}/`);
  } else if (action === 'up') {
    if (pid) {
      console.log(`复用当前工作区服务，PID ${pid}\n${address}/`);
    } else {
      // Dedicated tmux session outlives the terminal/tool call. Never take over an existing session.
      if (optional('tmux', ['-L', socket, 'list-sessions', '-F', '#{session_name}']).split('\n').includes(session)) {
        throw Error('已有验收会话但服务未就绪，请检查该会话，未自动停止。');
      }
      tmux('new-session', '-d', '-s', session, '-c', root, process.execPath, resolve(root, 'server/server.mjs'));
      for (let i = 0; i < 20; i++) {
        await delay(150);
        pid = await inspect();
        if (pid) break;
      }
      if (!pid || !managed()) throw Error('后台服务未通过健康检查，请检查验收会话。');
      console.log(`后台服务已启动，PID ${pid}\n${address}/`);
    }
  } else {
    if (!pid) { console.log('服务已停止。'); }
    else {
      const panePid = optional('tmux', ['-L', socket, 'display-message', '-p', '-t', session, '#{pane_pid}']);
      if (!managed() || panePid !== pid) throw Error('服务不是本脚本启动的验收会话，未停止。');
      tmux('kill-session', '-t', session);
      for (let i = 0; i < 20; i++) {
        await delay(100);
        if (!optional('lsof', ['-nP', '-t', '-iTCP:10290', '-sTCP:LISTEN'])) break;
      }
      if (optional('lsof', ['-nP', '-t', '-iTCP:10290', '-sTCP:LISTEN'])) throw Error('端口尚未释放，请检查。');
      console.log('验收服务已停止，10290 端口已释放。');
    }
  }
} catch (error) {
  // Report operational errors only; this script never reads model credentials.
  console.error(error.message);
  process.exitCode = 1;
}
