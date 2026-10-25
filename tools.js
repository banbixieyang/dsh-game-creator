// 「游戏制作模式」 project bootstrap tools.
//
// The Godot MCP surface only drives a project that is already open in an
// editor: `session_manage` lists editors and `project_manage` edits a live
// one. These two tools cover the missing step — scaffolding a project on disk
// and getting an editor attached to the shared Godot AI backend.
import { execFile, spawn } from 'node:child_process';
import { access, cp, mkdir, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

/** Stable Loader identity. */
export const name = 'game-creator-tools';

/** Services used by the project tools. */
export const inject = ['tools', 'workingDirectory'];

const here = path.dirname(fileURLToPath(import.meta.url));
const BUNDLED_ADDON = path.join(here, 'vendor', 'godot_ai');

const DEFAULTS = {
  // Empty means: GODOT_BIN, then PATH lookup. Set it in the preset config when
  // Godot lives somewhere PATH cannot see.
  godotExe: '',
  // A bare command resolves through PATH; an absolute path is checked first.
  uvxPath: 'uvx',
  addonSource: BUNDLED_ADDON,
  godotAiVersion: '4.2.3',
  httpPort: 8000,
  wsPort: 9500,
};

/** First PATH hit for one of the given command names, or ''. */
async function findOnPath(names) {
  const finder = process.platform === 'win32' ? 'where.exe' : 'which';
  for (const candidate of names) {
    try {
      const { stdout } = await execFileAsync(finder, [candidate], { windowsHide: true });
      const first = stdout
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .find((line) => line.length > 0);
      if (first) return first;
    } catch {
      /* try the next name */
    }
  }
  return '';
}

/** Resolve the editor executable from config, GODOT_BIN, or PATH. */
async function resolveGodotExe(config) {
  if (config.godotExe && (await exists(config.godotExe))) return config.godotExe;
  const fromEnv = process.env.GODOT_BIN?.trim();
  if (fromEnv && (await exists(fromEnv))) return fromEnv;
  const found = await findOnPath(
    process.platform === 'win32'
      ? ['godot.exe', 'godot4.exe', 'Godot.exe']
      : ['godot', 'godot4', 'Godot'],
  );
  if (found) return found;
  throw new Error(
    'No Godot executable found. Set godotExe in the game-creator-tools config (the preset patch), point GODOT_BIN at the executable, or put Godot 4.7+ on PATH, then retry.',
  );
}


async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function portOpen(port, timeoutMs = 700) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (value) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function waitForPort(port, totalMs) {
  const deadline = Date.now() + totalMs;
  while (Date.now() < deadline) {
    if (await portOpen(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return portOpen(port);
}

/** The backend is a detached process: it must outlive this call and this turn. */
function spawnDetached(command, args, options = {}) {
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    ...options,
  });
  child.unref();
  return child.pid;
}

async function ensureBackend(config) {
  if (await portOpen(config.httpPort)) return { status: 'already-running' };
  const absolute = path.isAbsolute(config.uvxPath);
  if (absolute && !(await exists(config.uvxPath))) {
    throw new Error(
      `Godot AI backend is not running and uvx was not found at ${config.uvxPath}. Install uv, or start the backend manually and retry.`,
    );
  }
  const pid = spawnDetached(config.uvxPath, [
    '--from',
    `godot-ai==${config.godotAiVersion}`,
    'godot-ai',
    '--transport',
    'streamable-http',
    '--port',
    String(config.httpPort),
    '--ws-port',
    String(config.wsPort),
  ]);
  const ready = await waitForPort(config.httpPort, 30_000);
  if (!ready) {
    throw new Error(
      `Started the Godot AI backend (pid ${pid}) but nothing is listening on 127.0.0.1:${config.httpPort} after 30s. Check that the port is free and that "uvx --from godot-ai==${config.godotAiVersion} godot-ai --version" works.`,
    );
  }
  return { status: 'started', pid };
}

function launchEditor(godotExe, projectPath) {
  return spawnDetached(godotExe, ['--path', projectPath, '--editor'], { cwd: projectPath });
}

function projectFileContents(projectName, width, height) {
  const escaped = String(projectName).replaceAll('"', '\\"');
  return `; Engine configuration file.
config_version=5

[application]

config/name="${escaped}"
config/features=PackedStringArray("4.7", "Forward Plus")

[display]

window/size/viewport_width=${width}
window/size/viewport_height=${height}

[editor_plugins]

enabled=PackedStringArray("res://addons/godot_ai/plugin.cfg")
`;
}

async function resolveProjectDir(ctx, exec, rawPath) {
  if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
    throw new Error('path must be a non-empty project directory');
  }
  const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal);
  return path.resolve(cwd, rawPath);
}

const output = {
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['projectPath', 'projectName', 'createdProjectFile', 'installedAddon', 'backend', 'editorPid'],
    properties: {
      projectPath: { type: 'string' },
      projectName: { type: 'string' },
      createdProjectFile: { type: 'boolean' },
      installedAddon: { type: 'boolean' },
      backend: { type: 'string' },
      editorPid: { type: 'integer' },
    },
  },
  render: (_args, value) =>
    [
      {
        type: 'text',
        text: [
          `${value.createdProjectFile ? 'Created' : 'Reused'} project ${value.projectName} at ${value.projectPath}`,
          `${value.installedAddon ? 'Installed' : 'Kept'} addons/godot_ai`,
          `Godot AI backend: ${value.backend}`,
          `Editor pid: ${value.editorPid}`,
        ].join('\n'),
      },
    ],
};

export function apply(ctx, rawConfig) {
  const config = { ...DEFAULTS, ...(rawConfig ?? {}) };
  try {
    register(ctx, config);
  } catch (error) {
    try {
      writeFileSync(path.join(here, 'apply-error.log'), `${new Date().toISOString()}\n${error?.stack ?? error}\n`);
    } catch {
      /* diagnostics only */
    }
    throw error;
  }
}

function register(ctx, config) {
  ctx.tools.register({
    name: 'godot_new_project',
    description:
      'Create a Godot 4.7 project on disk with the Godot AI addon installed, start the Godot AI backend when it is not running, and open the project in the Godot editor. Use when the user wants a new game or project and no editor session for it exists yet. After it returns, confirm the editor attached with mcp__godot__session_manage before building anything.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: {
        path: {
          type: 'string',
          description:
            'Project directory. Relative paths resolve against the Session working directory. Keep it inside the workspace so the file tools can reach it too.',
        },
        name: {
          type: 'string',
          description: 'Project display name. Defaults to the directory name.',
        },
        width: {
          type: 'integer',
          description: 'Initial viewport width. Defaults to 1152.',
        },
        height: {
          type: 'integer',
          description: 'Initial viewport height. Defaults to 648.',
        },
      },
    },
    output,
    async execute(args, exec) {
      const projectPath = await resolveProjectDir(ctx, exec, args.path);
      const godotExe = await resolveGodotExe(config);
      const projectName = args.name?.trim() || path.basename(projectPath);
      const width = Number.isSafeInteger(args.width) && args.width > 0 ? args.width : 1152;
      const height = Number.isSafeInteger(args.height) && args.height > 0 ? args.height : 648;

      await mkdir(projectPath, { recursive: true });
      const projectFile = path.join(projectPath, 'project.godot');
      const createdProjectFile = !(await exists(projectFile));
      if (createdProjectFile) {
        await writeFile(projectFile, projectFileContents(projectName, width, height), 'utf8');
      }

      const addonTarget = path.join(projectPath, 'addons', 'godot_ai');
      const installedAddon = !(await exists(path.join(addonTarget, 'plugin.cfg')));
      if (installedAddon) {
        if (!(await exists(path.join(config.addonSource, 'plugin.cfg')))) {
          throw new Error(`Bundled Godot AI addon is missing at ${config.addonSource}`);
        }
        await mkdir(path.dirname(addonTarget), { recursive: true });
        await cp(config.addonSource, addonTarget, { recursive: true, force: false });
      }

      exec.signal.throwIfAborted();
      const backend = await ensureBackend(config);
      const editorPid = launchEditor(godotExe, projectPath);

      return {
        projectPath,
        projectName,
        createdProjectFile,
        installedAddon,
        backend: backend.status,
        editorPid,
      };
    },
  });

  ctx.tools.register({
    name: 'godot_open_project',
    description:
      'Open an existing Godot project in the Godot editor and make sure the Godot AI backend is running, so the editor can register a session. Use when the project already exists but no editor has it open. Confirm with mcp__godot__session_manage afterwards.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: {
        path: {
          type: 'string',
          description:
            'Project directory containing project.godot. Relative paths resolve against the Session working directory.',
        },
      },
    },
    output,
    async execute(args, exec) {
      const projectPath = await resolveProjectDir(ctx, exec, args.path);
      const godotExe = await resolveGodotExe(config);
      const projectFile = path.join(projectPath, 'project.godot');
      if (!(await exists(projectFile))) {
        throw new Error(`No project.godot in ${projectPath}. Use godot_new_project to create one.`);
      }
      if (!(await exists(path.join(projectPath, 'addons', 'godot_ai', 'plugin.cfg')))) {
        throw new Error(
          `${projectPath} has no addons/godot_ai. Create the project with godot_new_project, or install the Godot AI addon and enable it in Project Settings > Plugins.`,
        );
      }

      exec.signal.throwIfAborted();
      const backend = await ensureBackend(config);
      const editorPid = launchEditor(godotExe, projectPath);

      return {
        projectPath,
        projectName: path.basename(projectPath),
        createdProjectFile: false,
        installedAddon: false,
        backend: backend.status,
        editorPid,
      };
    },
  });
}

