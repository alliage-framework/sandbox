import * as path from 'path';
import * as cp from 'child_process';
import { EventEmitter } from 'events';
import { promisify } from 'util';
import fs from 'fs-extra';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Mock } from 'vitest';

import { Sandbox } from '../index.js';

vi.mock('fs-extra');
vi.mock('child_process');

const DUMMY_MODULES_RESOLUTION: Record<string, string> = {
  'alliage-fake-module': '/path/to/alliage-fake-module/index.js',
  'alliage-fake-module/package.json': '/path/to/alliage-fake-module/package.json',
};
const CUSTOM_MODULE_RESOLVER = (moduleName: string) => {
  const modulePath = DUMMY_MODULES_RESOLUTION[moduleName];
  if (!modulePath) {
    throw new Error(`Module ${moduleName} not found`);
  }
  return modulePath;
};

const waitForNextTick = promisify(process.nextTick);

describe('Sandbox', () => {
  const removeMock = fs.remove as unknown as Mock<typeof fs.remove>;
  const mkdirpMock = fs.mkdirp as unknown as Mock<typeof fs.mkdirp>;
  const readJsonMock = fs.readJson as unknown as Mock<typeof fs.readJson>;
  const copyMock = fs.copy as unknown as Mock<typeof fs.copy>;
  const ensureSymlinkMock = fs.ensureSymlink as unknown as Mock<typeof fs.ensureSymlink>;
  const pathExistsMock = fs.pathExists as unknown as Mock<typeof fs.pathExists>;
  const writeJSONMock = fs.writeJson as unknown as Mock<typeof fs.writeJson>;
  const execMock = cp.exec as unknown as Mock<typeof cp.exec>;

  delete process.env.NODE;
  process.env.PATH = 'test-path1:test-path2';
  process.env.NODE_PATH = 'test-node-path1:test-node-path2';

  describe('Common use case', () => {
    const sandbox = new Sandbox({
      scenarioPath: 'path/to/scenario',
      projectPath: 'path/to/project',
      moduleResolver: CUSTOM_MODULE_RESOLVER,
    });

    beforeAll(() => {
      readJsonMock
        // Load config file
        .mockResolvedValueOnce({
          copyFiles: ['<scenarioRoot>/src', '<projectRoot>/config', '<unknownPlaceholder>/test'],
          linkModules: {
            'alliage-fake-module': '<projectRoot>/packages/alliage-fake-module/dist',
          },
          alliageModules: ['alliage-fake-module', '../alliage-other-fake-module'],
        })
        // Load the "alliage-fake-module" package.json
        .mockResolvedValueOnce({
          name: 'alliage-fake-module',
          alliageManifest: {
            type: 'module',
            dependencies: ['alliage-dummy-module'],
          },
        })
        // Load the "alliage-other-fake-module" package.json
        .mockResolvedValueOnce({
          name: 'alliage-other-fake-module',
          alliageManifest: {
            type: 'compound',
            dependencies: ['alliage-dummy-module'],
          },
        })
        // Load existing alliage-module.json
        .mockResolvedValueOnce({
          'alliage-dummy-module': {
            module: 'alliage-dummy-module',
            deps: [],
          },
        });

      // The "alliage-modules.json" file exists
      pathExistsMock.mockResolvedValueOnce(true);
    });

    afterAll(() => {
      vi.resetAllMocks();
    });

    describe('#init', () => {
      it('should clear the sandbox directory if it already exists', async () => {
        await sandbox.init();

        expect(removeMock).toHaveBeenNthCalledWith(1, sandbox.getPath());
      });

      it('should create the sandbox directory', () => {
        expect(mkdirpMock).toHaveBeenCalledAfter(removeMock);
        expect(mkdirpMock).toHaveBeenNthCalledWith(1, sandbox.getPath());
      });

      it('should load the config file', () => {
        expect(readJsonMock).toHaveBeenNthCalledWith(
          1,
          path.resolve('path/to/scenario', 'alliage-sandbox-config.json'),
        );
      });

      it('should copy the files listed in the config file', () => {
        expect(copyMock).toHaveBeenNthCalledWith(
          1,
          path.resolve('path/to/scenario/src'),
          path.resolve(sandbox.getPath(), 'src'),
        );
        expect(copyMock).toHaveBeenNthCalledWith(
          2,
          path.resolve('path/to/project/config'),
          path.resolve(sandbox.getPath(), 'config'),
        );
        expect(copyMock).toHaveBeenNthCalledWith(
          3,
          '<unknownPlaceholder>/test',
          path.resolve(sandbox.getPath(), 'test'),
        );
      });

      it('should link the modules listed in the config file and the project node_modules', () => {
        expect(ensureSymlinkMock).toHaveBeenNthCalledWith(
          1,
          path.resolve('path/to/project/packages/alliage-fake-module/dist'),
          path.resolve(
            sandbox.getPath(),
            path.resolve(sandbox.getPath(), 'linked_modules', 'alliage-fake-module'),
          ),
        );
        expect(ensureSymlinkMock).toHaveBeenNthCalledWith(
          2,
          path.resolve('path/to/project/node_modules'),
          path.resolve(sandbox.getPath(), 'node_modules'),
        );
      });

      it('should generate the alliage-modules.json file', () => {
        expect(readJsonMock).toHaveBeenNthCalledWith(
          2,
          '/path/to/alliage-fake-module/package.json',
        );
        expect(readJsonMock).toHaveBeenNthCalledWith(
          3,
          path.resolve('../alliage-other-fake-module/package.json'),
        );
        expect(writeJSONMock).toHaveBeenNthCalledWith(
          1,
          path.resolve(sandbox.getPath(), 'alliage-modules.json'),
          {
            'alliage-dummy-module': {
              module: 'alliage-dummy-module',
              deps: [],
            },
            'alliage-fake-module': {
              module: 'alliage-fake-module',
              deps: ['alliage-dummy-module'],
            },
          },
        );
      });
    });

    describe('#getProjectPath', () => {
      it('should return the project absolute path', () => {
        expect(sandbox.getProjectPath()).toEqual(path.resolve('path/to/project'));
      });
    });

    describe('#getScenarioPath', () => {
      it('should return the scenario absolute path', () => {
        expect(sandbox.getScenarioPath()).toEqual(path.resolve('path/to/scenario'));
      });
    });

    describe('#getConfig', () => {
      it('should return the config', () => {
        expect(sandbox.getConfig()).toEqual({
          command: 'node',
          copyFiles: [
            path.resolve('path/to/scenario/src'),
            path.resolve('path/to/project/config'),
            '<unknownPlaceholder>/test',
          ],
          linkModules: {
            'alliage-fake-module': path.resolve(
              'path/to/project/packages/alliage-fake-module/dist',
            ),
          },
          alliageModules: ['alliage-fake-module', '../alliage-other-fake-module'],
        });
      });
    });

    describe('#install', () => {
      it('should call the installation script and return the process', async () => {
        const fakeProcess = new EventEmitter() as cp.ChildProcess;
        execMock.mockReturnValue(fakeProcess);

        const res = sandbox.install(['test-arg1', 'test-arg2']);

        expect(execMock).toHaveBeenCalledTimes(1);
        expect(execMock).toHaveBeenCalledWith(
          `node ${path.resolve(
            sandbox.getPath(),
            'node_modules/.bin/alliage-scripts',
          )} install test-arg1 test-arg2`,
          {
            env: {
              ...process.env,
              PATH: `test-path1:test-path2:${path.resolve(sandbox.getPath(), 'node_modules/.bin')}`,
              NODE_PATH: `${path.resolve(sandbox.getPath(), 'linked_modules')}:${path.resolve(
                sandbox.getPath(),
                'node_modules',
              )}:test-node-path1:test-node-path2`,
            },
            cwd: sandbox.getPath(),
          },
        );

        expect(res).toEqual({
          process: fakeProcess,
          waitCompletion: expect.any(Function),
        });

        let isCompleted = false;
        res.waitCompletion().then(() => {
          isCompleted = true;
        });
        await waitForNextTick();
        expect(isCompleted).toBe(false);

        res.process.emit('exit');
        await waitForNextTick();
        expect(isCompleted).toBe(true);
      });
    });

    describe('#run', () => {
      it('should call the run script and return the process', async () => {
        const fakeProcess = new EventEmitter() as cp.ChildProcess;
        execMock.mockClear();
        execMock.mockReturnValue(fakeProcess);

        const res = sandbox.run(['test-arg1', 'test-arg2']);

        expect(execMock).toHaveBeenCalledTimes(1);
        expect(execMock).toHaveBeenCalledWith(
          `node ${path.resolve(
            sandbox.getPath(),
            'node_modules/.bin/alliage-scripts',
          )} run test-arg1 test-arg2`,
          {
            env: {
              ...process.env,
              PATH: `test-path1:test-path2:${path.resolve(sandbox.getPath(), 'node_modules/.bin')}`,
              NODE_PATH: `${path.resolve(sandbox.getPath(), 'linked_modules')}:${path.resolve(
                sandbox.getPath(),
                'node_modules',
              )}:test-node-path1:test-node-path2`,
            },
            cwd: sandbox.getPath(),
          },
        );

        expect(res).toEqual({
          process: fakeProcess,
          waitCompletion: expect.any(Function),
        });
      });
    });

    describe('#build', () => {
      it('should call the build script and return the process', async () => {
        const fakeProcess = new EventEmitter() as cp.ChildProcess;
        execMock.mockClear();
        execMock.mockReturnValue(fakeProcess);

        const res = sandbox.build(['test-arg1', 'test-arg2']);

        expect(execMock).toHaveBeenCalledTimes(1);
        expect(execMock).toHaveBeenCalledWith(
          `node ${path.resolve(
            sandbox.getPath(),
            'node_modules/.bin/alliage-scripts',
          )} build test-arg1 test-arg2`,
          {
            env: {
              ...process.env,
              PATH: `test-path1:test-path2:${path.resolve(sandbox.getPath(), 'node_modules/.bin')}`,
              NODE_PATH: `${path.resolve(sandbox.getPath(), 'linked_modules')}:${path.resolve(
                sandbox.getPath(),
                'node_modules',
              )}:test-node-path1:test-node-path2`,
            },
            cwd: sandbox.getPath(),
          },
        );

        expect(res).toEqual({
          process: fakeProcess,
          waitCompletion: expect.any(Function),
        });
      });
    });
  });

  describe('Not initialized', () => {
    const sandbox = new Sandbox({
      scenarioPath: 'path/to/scenario',
      projectPath: 'path/to/project',
      moduleResolver: CUSTOM_MODULE_RESOLVER,
    });

    describe('#getConfig', () => {
      it('should throw an error if the sandbox is not initialized', () => {
        expect(() => sandbox.getConfig()).toThrow(
          'The sandbox must be initialized by calling the "init()" method',
        );
      });
    });

    describe('#install', () => {
      it('should throw an error if the sandbox is not initialized', () => {
        expect(() => sandbox.install([])).toThrow(
          'The sandbox must be initialized by calling the "init()" method',
        );
      });
    });

    describe('#run', () => {
      it('should throw an error if the sandbox is not initialized', () => {
        expect(() => sandbox.run([])).toThrow(
          'The sandbox must be initialized by calling the "init()" method',
        );
      });
    });

    describe('#build', () => {
      it('should throw an error if the sandbox is not initialized', () => {
        expect(() => sandbox.build([])).toThrow(
          'The sandbox must be initialized by calling the "init()" method',
        );
      });
    });
  });

  describe('Edge cases', () => {
    const sandbox = new Sandbox({
      scenarioPath: 'path/to/scenario',
      moduleResolver: CUSTOM_MODULE_RESOLVER,
    });

    beforeAll(() => {
      readJsonMock
        // Load config file
        .mockResolvedValueOnce({
          command: 'ts-node',
          copyFiles: ['<scenarioRoot>/src', '<projectRoot>/config'],
          linkModules: {
            'alliage-fake-module': '<projectRoot>/packages/alliage-fake-module/dist',
          },
          alliageModules: ['alliage-fake-module'],
        })
        // Load the "alliage-fake-module" package.json
        .mockResolvedValueOnce({
          name: 'alliage-fake-module',
          alliageManifest: {
            type: 'module',
            dependencies: ['alliage-dummy-module'],
          },
        });

      // The "alliage-modules.json" does not file exist
      pathExistsMock.mockResolvedValue(false);
    });

    afterAll(() => {
      vi.resetAllMocks();
    });

    describe('#init', () => {
      it("should start from an empty modules definition if there's no existing alliage-modules.json file", async () => {
        await sandbox.init();

        expect(writeJSONMock).toHaveBeenNthCalledWith(
          1,
          path.resolve(sandbox.getPath(), 'alliage-modules.json'),
          {
            'alliage-fake-module': {
              module: 'alliage-fake-module',
              deps: ['alliage-dummy-module'],
            },
          },
        );
      });
    });

    describe('#getProjectPath', () => {
      it('should default on the current directory if not defined', () => {
        expect(sandbox.getProjectPath()).toEqual(path.resolve('.'));
      });
    });

    describe('#getConfig', () => {
      it('should use the command specified in the config file', () => {
        expect(sandbox.getConfig()).toEqual(
          expect.objectContaining({
            command: 'ts-node',
          }),
        );
      });
    });

    describe('#install', () => {
      it('should allow to define env variables', async () => {
        execMock.mockImplementation(() => ({}) as cp.ChildProcess);

        sandbox.install(['test-arg1', 'test-arg2'], {
          env: { DUMMY_ENV_VARIABLE: 'dummy_env_variable' },
        });

        expect(execMock).toHaveBeenCalledWith(expect.anything(), {
          env: {
            ...process.env,
            DUMMY_ENV_VARIABLE: 'dummy_env_variable',
            PATH: `test-path1:test-path2:${path.resolve(sandbox.getPath(), 'node_modules/.bin')}`,
            NODE_PATH: `${path.resolve(sandbox.getPath(), 'linked_modules')}:${path.resolve(
              sandbox.getPath(),
              'node_modules',
            )}:test-node-path1:test-node-path2`,
          },
          cwd: sandbox.getPath(),
        });
      });
    });

    describe('#build', () => {
      it('should allow to define env variables', async () => {
        execMock.mockImplementation(() => ({}) as cp.ChildProcess);

        sandbox.build(['test-arg1', 'test-arg2'], {
          env: { DUMMY_ENV_VARIABLE: 'dummy_env_variable' },
        });

        expect(execMock).toHaveBeenCalledWith(expect.anything(), {
          env: {
            ...process.env,
            DUMMY_ENV_VARIABLE: 'dummy_env_variable',
            PATH: `test-path1:test-path2:${path.resolve(sandbox.getPath(), 'node_modules/.bin')}`,
            NODE_PATH: `${path.resolve(sandbox.getPath(), 'linked_modules')}:${path.resolve(
              sandbox.getPath(),
              'node_modules',
            )}:test-node-path1:test-node-path2`,
          },
          cwd: sandbox.getPath(),
        });
      });
    });

    describe('#run', () => {
      it('should handle undefined PATH and NODE_PATH correctly', async () => {
        const prevNodePath = process.env.NODE_PATH;
        delete process.env.NODE_PATH;

        const prevPath = process.env.PATH;
        delete process.env.PATH;

        execMock.mockImplementation(() => ({}) as cp.ChildProcess);

        sandbox.run(['test-arg1', 'test-arg2']);

        expect(execMock).toHaveBeenCalledWith(expect.anything(), {
          env: {
            ...process.env,
            PATH: path.resolve(sandbox.getPath(), 'node_modules/.bin'),
            NODE_PATH: `${path.resolve(sandbox.getPath(), 'linked_modules')}:${path.resolve(
              sandbox.getPath(),
              'node_modules',
            )}`,
          },
          cwd: sandbox.getPath(),
        });

        process.env.NODE_PATH = prevNodePath;
        process.env.PATH = prevPath;
      });

      it('should allow to define env variables', async () => {
        execMock.mockImplementation(() => ({}) as cp.ChildProcess);

        sandbox.run(['test-arg1', 'test-arg2'], {
          env: { DUMMY_ENV_VARIABLE: 'dummy_env_variable' },
        });

        expect(execMock).toHaveBeenCalledWith(expect.anything(), {
          env: {
            ...process.env,
            DUMMY_ENV_VARIABLE: 'dummy_env_variable',
            PATH: `test-path1:test-path2:${path.resolve(sandbox.getPath(), 'node_modules/.bin')}`,
            NODE_PATH: `${path.resolve(sandbox.getPath(), 'linked_modules')}:${path.resolve(
              sandbox.getPath(),
              'node_modules',
            )}:test-node-path1:test-node-path2`,
          },
          cwd: sandbox.getPath(),
        });
      });
    });
  });
});
