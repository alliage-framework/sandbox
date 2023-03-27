import path from 'path';
import cp from 'child_process';
import { EventEmitter } from 'events';
import { promisify } from 'util';
import fs from 'fs-extra';
import 'jest-extended';

import { Sandbox } from '..';

jest.mock('fs-extra');

const waitForNextTick = promisify(process.nextTick);

describe('Sandbox', () => {
  const removeMock = fs.remove as jest.Mock;
  const mkdirpMock = fs.mkdirp as jest.Mock;
  const readJsonMock = fs.readJson as jest.Mock;
  const copyMock = fs.copy as jest.Mock;
  const ensureSymlinkMock = fs.ensureSymlink as jest.Mock;
  const pathExistsMock = fs.pathExists as jest.Mock;
  const writeJSONMock = fs.writeJson as jest.Mock;

  delete process.env.NODE;
  process.env.PATH = 'test-path1:test-path2';
  process.env.NODE_PATH = 'test-node-path1:test-node-path2';

  describe('Common use case', () => {
    const sandbox = new Sandbox({
      scenarioPath: 'path/to/scenario',
      projectPath: 'path/to/project',
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
      pathExistsMock.mockResolvedValue(true);
    });

    afterAll(() => {
      jest.resetAllMocks();
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
        const execSpy = jest.spyOn(cp, 'exec').mockReturnValue(fakeProcess);

        const res = sandbox.install(['test-arg1', 'test-arg2']);

        expect(execSpy).toHaveBeenCalledTimes(1);
        expect(execSpy).toHaveBeenCalledWith(
          `node ${path.resolve(
            sandbox.getPath(),
            'node_modules/.bin/alliage-scripts',
          )} install test-arg1 test-arg2`,
          {
            env: {
              ...process.env,
              PATH: `test-path1:test-path2:${path.resolve(sandbox.getPath(), 'node_modules/.bin')}`,
              NODE_PATH: `${path.resolve(
                sandbox.getPath(),
                'linked_modules',
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
        expect(isCompleted).toBeFalse();

        res.process.emit('exit');
        await waitForNextTick();
        expect(isCompleted).toBeTrue();

        execSpy.mockRestore();
      });
    });

    describe('#run', () => {
      it('should call the run script and return the process', async () => {
        const fakeProcess = new EventEmitter() as cp.ChildProcess;
        const execSpy = jest.spyOn(cp, 'exec').mockReturnValue(fakeProcess);

        const res = sandbox.run(['test-arg1', 'test-arg2']);

        expect(execSpy).toHaveBeenCalledTimes(1);
        expect(execSpy).toHaveBeenCalledWith(
          `node ${path.resolve(
            sandbox.getPath(),
            'node_modules/.bin/alliage-scripts',
          )} run test-arg1 test-arg2`,
          {
            env: {
              ...process.env,
              PATH: `test-path1:test-path2:${path.resolve(sandbox.getPath(), 'node_modules/.bin')}`,
              NODE_PATH: `${path.resolve(
                sandbox.getPath(),
                'linked_modules',
              )}:test-node-path1:test-node-path2`,
            },
            cwd: sandbox.getPath(),
          },
        );

        expect(res).toEqual({
          process: fakeProcess,
          waitCompletion: expect.any(Function),
        });

        execSpy.mockRestore();
      });
    });

    describe('#build', () => {
      it('should call the build script and return the process', async () => {
        const fakeProcess = new EventEmitter() as cp.ChildProcess;
        const execSpy = jest.spyOn(cp, 'exec').mockReturnValue(fakeProcess);

        const res = sandbox.build(['test-arg1', 'test-arg2']);

        expect(execSpy).toHaveBeenCalledTimes(1);
        expect(execSpy).toHaveBeenCalledWith(
          `node ${path.resolve(
            sandbox.getPath(),
            'node_modules/.bin/alliage-scripts',
          )} build test-arg1 test-arg2`,
          {
            env: {
              ...process.env,
              PATH: `test-path1:test-path2:${path.resolve(sandbox.getPath(), 'node_modules/.bin')}`,
              NODE_PATH: `${path.resolve(
                sandbox.getPath(),
                'linked_modules',
              )}:test-node-path1:test-node-path2`,
            },
            cwd: sandbox.getPath(),
          },
        );

        expect(res).toEqual({
          process: fakeProcess,
          waitCompletion: expect.any(Function),
        });

        execSpy.mockRestore();
      });
    });
  });

  describe('Not initialized', () => {
    const sandbox = new Sandbox({
      scenarioPath: 'path/to/scenario',
      projectPath: 'path/to/project',
    });

    describe('#getConfig', () => {
      it('should throw an error if the sandbox is not initialized', () => {
        expect(() => sandbox.getConfig()).toThrowWithMessage(
          Error,
          'The sandbox must be initialized by calling the "init()" method',
        );
      });
    });

    describe('#install', () => {
      it('should throw an error if the sandbox is not initialized', () => {
        expect(() => sandbox.install([])).toThrowWithMessage(
          Error,
          'The sandbox must be initialized by calling the "init()" method',
        );
      });
    });

    describe('#run', () => {
      it('should throw an error if the sandbox is not initialized', () => {
        expect(() => sandbox.run([])).toThrowWithMessage(
          Error,
          'The sandbox must be initialized by calling the "init()" method',
        );
      });
    });

    describe('#build', () => {
      it('should throw an error if the sandbox is not initialized', () => {
        expect(() => sandbox.build([])).toThrowWithMessage(
          Error,
          'The sandbox must be initialized by calling the "init()" method',
        );
      });
    });
  });

  describe('Edge cases', () => {
    const sandbox = new Sandbox({
      scenarioPath: 'path/to/scenario',
    });

    beforeAll(() => {
      delete process.env.PATH;
      delete process.env.NODE_PATH;

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
      jest.resetAllMocks();
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
        const execSpy = jest.spyOn(cp, 'exec').mockImplementation(() => ({} as any));

        sandbox.install(['test-arg1', 'test-arg2'], {
          env: { DUMMY_ENV_VARIABLE: 'dummy_env_variable' },
        });

        expect(execSpy).toHaveBeenCalledWith(expect.anything(), {
          env: {
            ...process.env,
            DUMMY_ENV_VARIABLE: 'dummy_env_variable',
            PATH: path.resolve(sandbox.getPath(), 'node_modules/.bin'),
            NODE_PATH: path.resolve(sandbox.getPath(), 'linked_modules'),
          },
          cwd: sandbox.getPath(),
        });

        execSpy.mockRestore();
      });
    });

    describe('#build', () => {
      it('should allow to define env variables', async () => {
        const execSpy = jest.spyOn(cp, 'exec').mockImplementation(() => ({} as any));

        sandbox.build(['test-arg1', 'test-arg2'], {
          env: { DUMMY_ENV_VARIABLE: 'dummy_env_variable' },
        });

        expect(execSpy).toHaveBeenCalledWith(expect.anything(), {
          env: {
            ...process.env,
            DUMMY_ENV_VARIABLE: 'dummy_env_variable',
            PATH: path.resolve(sandbox.getPath(), 'node_modules/.bin'),
            NODE_PATH: path.resolve(sandbox.getPath(), 'linked_modules'),
          },
          cwd: sandbox.getPath(),
        });

        execSpy.mockRestore();
      });
    });

    describe('#run', () => {
      it('should handle undefined PATH and NODE_PATH correctly', async () => {
        const execSpy = jest.spyOn(cp, 'exec').mockImplementation(() => ({} as any));

        sandbox.run(['test-arg1', 'test-arg2']);

        expect(execSpy).toHaveBeenCalledWith(expect.anything(), {
          env: {
            ...process.env,
            PATH: path.resolve(sandbox.getPath(), 'node_modules/.bin'),
            NODE_PATH: path.resolve(sandbox.getPath(), 'linked_modules'),
          },
          cwd: sandbox.getPath(),
        });

        execSpy.mockRestore();
      });

      it('should allow to define env variables', async () => {
        const execSpy = jest.spyOn(cp, 'exec').mockImplementation(() => ({} as any));

        sandbox.run(['test-arg1', 'test-arg2'], {
          env: { DUMMY_ENV_VARIABLE: 'dummy_env_variable' },
        });

        expect(execSpy).toHaveBeenCalledWith(expect.anything(), {
          env: {
            ...process.env,
            DUMMY_ENV_VARIABLE: 'dummy_env_variable',
            PATH: path.resolve(sandbox.getPath(), 'node_modules/.bin'),
            NODE_PATH: path.resolve(sandbox.getPath(), 'linked_modules'),
          },
          cwd: sandbox.getPath(),
        });

        execSpy.mockRestore();
      });
    });
  });
});
