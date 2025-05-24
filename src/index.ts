import * as path from 'path';
import * as cp from 'child_process';
import { createRequire } from 'node:module';

import fs from 'fs-extra';

const LOCAL_MODULE_PATTERN = /^\.{0,2}(\/.*)+$/;

const ALLIAGE_MODULES_FILE_NAME = 'alliage-modules.json';
const ALLIAGE_SCRIPT_NAME = 'alliage-scripts';

const NODE_MODULES_PATH = 'node_modules';
const BINS_PATH = `${NODE_MODULES_PATH}/.bin`;

const DEFAULT_SANDBOX_PATH = './.alliage-sandboxes';
const DEFAULT_PROJECT_PATH = './';

enum PLACEHOLDERS {
  PROJECT_ROOT = 'projectRoot',
  SCENARIO_ROOT = 'scenarioRoot',
}

interface Config {
  command: string;
  copyFiles: string[];
  linkModules: { [moduleName: string]: string };
  alliageModules: string[];
}

export type CommandOptions = {
  env?: { [name: string]: string };
};

export interface Params {
  scenarioPath: string;
  projectPath?: string;
  sandboxPath?: string;
  sandboxConfig?: string;
  moduleResolver?: (moduleName: string, options: NodeJS.RequireResolveOptions) => string;
}

const require = createRequire(import.meta.url);

export const CONFIG_FILE_NAME = 'alliage-sandbox-config.json';

export enum COMMAND {
  INSTALL = 'install',
  BUILD = 'build',
  RUN = 'run',
}

export class Sandbox {
  private scenarioPath: string;
  private sandboxPath: string;
  private projectPath: string;
  private config: Config;
  private moduleResolver: (moduleName: string, options: NodeJS.RequireResolveOptions) => string;
  private configFileName: string;
  private isInitialized: boolean;
  private linkedModulesSymlinks: string[];

  private sandboxDirectory: string;

  private placeholdersMapping = {
    [PLACEHOLDERS.PROJECT_ROOT]: () => this.projectPath,
    [PLACEHOLDERS.SCENARIO_ROOT]: () => this.scenarioPath,
  };

  constructor({
    scenarioPath,
    projectPath = DEFAULT_PROJECT_PATH,
    sandboxPath = DEFAULT_SANDBOX_PATH,
    sandboxConfig = CONFIG_FILE_NAME,
    moduleResolver = require.resolve,
  }: Params) {
    this.scenarioPath = path.resolve(scenarioPath);
    this.projectPath = path.resolve(projectPath);
    this.sandboxDirectory = Math.random().toString(36).slice(2);
    this.sandboxPath = path.resolve(sandboxPath, this.sandboxDirectory);
    this.configFileName = sandboxConfig;
    this.moduleResolver = moduleResolver;
    this.config = {
      command: process.env.NODE || 'node',
      copyFiles: [],
      linkModules: {},
      alliageModules: [],
    };
    this.isInitialized = false;
    this.linkedModulesSymlinks = [];
  }

  getPath() {
    return this.sandboxPath;
  }

  getProjectPath() {
    return this.projectPath;
  }

  getScenarioPath() {
    return this.scenarioPath;
  }

  getConfig() {
    this.throwIfNotInitialized();
    return this.config;
  }

  async init() {
    await this.clear();
    await fs.mkdirp(this.sandboxPath);

    await this.loadConfig();
    // We link the node_modules directory of the project to the sandbox
    await fs
      .ensureSymlink(
        path.resolve(this.projectPath, NODE_MODULES_PATH),
        path.resolve(this.sandboxPath, NODE_MODULES_PATH),
      )
      .catch(() => {});
    await Promise.all([
      // We copy the files configured in the config file
      ...this.config.copyFiles.map((filePath) =>
        fs.copy(filePath, path.resolve(this.sandboxPath, path.basename(filePath))),
      ),
      // We link the modules configured in the config file
      ...Object.entries(this.config.linkModules).map(async ([moduleName, modulePath]) => {
        const symlinkPath = path.resolve(this.sandboxPath, NODE_MODULES_PATH, moduleName);
        if (await fs.pathExists(symlinkPath)) {
          return;
        }
        await fs.ensureSymlink(modulePath, symlinkPath);
        // We store the symlink path to be able to unlink it when the sandbox is cleared
        this.linkedModulesSymlinks.push(symlinkPath);
      }),
    ]);
    // We generate the alliage modules definition file
    await this.generateModulesDefinition();
    this.isInitialized = true;
  }

  private async generateModulesDefinition() {
    const loadedModules: Record<string, unknown> = {};
    const [modulesDef] = await Promise.all([
      this.loadModulesDefinition(),
      await Promise.all(
        this.config.alliageModules.map(async (moduleName) => {
          const resolver = LOCAL_MODULE_PATTERN.test(moduleName)
            ? path.resolve
            : (m: string) => this.moduleResolver(m, { paths: this.computeNodePath() });
          const packageJsonPath = resolver(`${moduleName}/package.json`);

          const packageInfo = await fs.readJson(packageJsonPath);
          if (packageInfo.alliageManifest && packageInfo.alliageManifest.type === 'module') {
            loadedModules[packageInfo.name] = {
              module: moduleName,
              deps: packageInfo.alliageManifest.dependencies,
            };
          }
        }),
      ),
    ]);
    await fs.writeJson(path.resolve(this.sandboxPath, ALLIAGE_MODULES_FILE_NAME), {
      ...modulesDef,
      ...loadedModules,
    });
  }

  private async loadModulesDefinition() {
    const defPath = path.resolve(this.sandboxPath, ALLIAGE_MODULES_FILE_NAME);
    if (await fs.pathExists(defPath)) {
      return fs.readJson(defPath);
    }
    return {};
  }

  async clear() {
    // We unlink the linked modules
    await Promise.all(this.linkedModulesSymlinks.map((symlinkPath) => fs.remove(symlinkPath)));
    await this.removeSandboxDirectory();
    this.isInitialized = false;
  }

  private async removeSandboxDirectory() {
    fs.remove(this.sandboxPath);
  }

  install(args: string[], options: CommandOptions = {}) {
    return this.runCommand(COMMAND.INSTALL, args, options);
  }

  run(args: string[], options: CommandOptions = {}) {
    return this.runCommand(COMMAND.RUN, args, options);
  }

  build(args: string[], options: CommandOptions = {}) {
    return this.runCommand(COMMAND.BUILD, args, options);
  }

  private runCommand(command: COMMAND, args: string[], { env = {} }: CommandOptions) {
    this.throwIfNotInitialized();
    const systemPath = [
      ...(process.env.PATH?.split(':') || []),
      path.resolve(this.sandboxPath, BINS_PATH),
    ].join(':');
    const script = path.resolve(this.sandboxPath, `${BINS_PATH}/${ALLIAGE_SCRIPT_NAME}`);

    const childProcess = cp.exec(`${this.config.command} ${script} ${command} ${args.join(' ')}`, {
      env: {
        ...process.env,
        ...env,
        PATH: systemPath,
      },
      cwd: this.sandboxPath,
    });
    const completionPromise = new Promise<void>((resolve) => {
      if (!childProcess.on) {
        resolve();
        return;
      }
      childProcess.on('exit', resolve);
      childProcess.on('close', resolve);
      childProcess.on('error', resolve);
    });

    return {
      waitCompletion: () => completionPromise,
      process: childProcess,
    };
  }

  private computeNodePath() {
    return [
      path.resolve(this.sandboxPath, NODE_MODULES_PATH),
      /* v8 ignore next */
      ...(process.env.NODE_PATH?.split(':') || []),
    ];
  }

  private throwIfNotInitialized() {
    if (!this.isInitialized) {
      throw new Error('The sandbox must be initialized by calling the "init()" method');
    }
  }

  private replacePlaceholder(str: string) {
    return str.replace(/<([a-zA-Z]+)>/g, (placeholder: string, placeholderName: string) => {
      const mapper = this.placeholdersMapping[placeholderName as PLACEHOLDERS];
      return mapper ? mapper() : placeholder;
    });
  }

  private async loadConfig() {
    const configPath = path.resolve(this.scenarioPath, this.configFileName);
    this.config = { ...this.config, ...((await fs.readJson(configPath)) as Config) };
    this.config.copyFiles = this.config.copyFiles.map((filePath) =>
      this.replacePlaceholder(filePath),
    );
    this.config.alliageModules = this.config.alliageModules.map((modulePath) =>
      this.replacePlaceholder(modulePath),
    );
    Object.entries(this.config.linkModules).forEach(([module, modulePath]) => {
      this.config.linkModules[module] = this.replacePlaceholder(modulePath);
    });
    this.config.command = this.replacePlaceholder(this.config.command);
  }
}
