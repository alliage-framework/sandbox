import path from 'path';
import cp from 'child_process';

import fs from 'fs-extra';

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
}

export const CONFIG_FILE_NAME = 'alliage-sandbox-config.json';
const LOCAL_MODULE_PATTERN = /^\.{0,2}(\/.*)+$/;

export enum COMMAND {
  INSTALL = 'install',
  BUILD = 'build',
  RUN = 'run',
}

enum PLACEHOLDERS {
  PROJECT_ROOT = 'projectRoot',
  SCENARIO_ROOT = 'scenarioRoot',
}

export class Sandbox {
  private scenarioPath: string;

  private sandboxPath: string;

  private projectPath: string;

  private configFileName: string;

  private isInitialized: boolean;

  private config: Config;

  private sandboxDirectory: string;

  private placeholdersMapping = {
    [PLACEHOLDERS.PROJECT_ROOT]: () => this.projectPath,
    [PLACEHOLDERS.SCENARIO_ROOT]: () => this.scenarioPath,
  };

  constructor({
    scenarioPath,
    projectPath = '.',
    sandboxPath = './.alliage-sandboxes',
    sandboxConfig = CONFIG_FILE_NAME,
  }: Params) {
    this.scenarioPath = path.resolve(scenarioPath);
    this.projectPath = path.resolve(projectPath);
    this.sandboxDirectory = Math.random().toString(36).slice(2);
    this.sandboxPath = path.resolve(sandboxPath, this.sandboxDirectory);
    this.configFileName = sandboxConfig;
    this.config = {
      command: process.env.NODE || 'node',
      copyFiles: [],
      linkModules: {},
      alliageModules: [],
    };
    this.isInitialized = false;
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
    await Promise.all([
      ...this.config.copyFiles.map((filePath) =>
        fs.copy(filePath, path.resolve(this.sandboxPath, path.basename(filePath))),
      ),
      ...Object.entries(this.config.linkModules).map(([moduleName, modulePath]) =>
        fs.ensureSymlink(modulePath, path.resolve(this.sandboxPath, 'linked_modules', moduleName)),
      ),
      fs.ensureSymlink(
        path.resolve(this.projectPath, 'node_modules'),
        path.resolve(this.sandboxPath, 'node_modules'),
      ),
    ]);
    await this.generateModulesDefinition();
    this.isInitialized = true;
  }

  private async generateModulesDefinition() {
    const loadedModules: any = {};
    const [modulesDef] = await Promise.all([
      this.loadModulesDefinition(),
      await Promise.all(
        this.config.alliageModules.map(async (moduleName) => {
          const resolver = LOCAL_MODULE_PATTERN.test(moduleName) ? path.resolve : require.resolve;
          const packageJsonPath = resolver(`${moduleName}/package.json`).toString();

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
    await fs.writeJson(path.resolve(this.sandboxPath, 'alliage-modules.json'), {
      ...modulesDef,
      ...loadedModules,
    });
  }

  private async loadModulesDefinition() {
    const defPath = path.resolve(this.sandboxPath, 'alliage-modules.json');
    if (await fs.pathExists(defPath)) {
      return fs.readJson(defPath);
    }
    return {};
  }

  async clear() {
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
    const nodePath = [
      path.resolve(this.sandboxPath, 'linked_modules'),
      ...(process.env.NODE_PATH?.split(':') || []),
    ].join(':');
    const systemPath = [
      ...(process.env.PATH?.split(':') || []),
      path.resolve(this.sandboxPath, 'node_modules/.bin'),
    ].join(':');
    const script = path.resolve(this.sandboxPath, 'node_modules/.bin/alliage-scripts');

    const childProcess = cp.exec(`${this.config.command} ${script} ${command} ${args.join(' ')}`, {
      env: {
        ...process.env,
        ...env,
        NODE_PATH: nodePath,
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
