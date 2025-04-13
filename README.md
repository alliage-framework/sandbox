# @alliage/sandbox

Tool to perform integration tests on an Alliage application.

[![NPM version](https://img.shields.io/npm/v/@alliage/sandbox.svg)](https://www.npmjs.com/package/@alliage/sandbox)

## Description

`@alliage/sandbox` provides a sandbox environment for testing Alliage applications. It allows you to create isolated environments for running integration tests, with the ability to:

- Copy specific files to the sandbox
- Link modules to the sandbox
- Define Alliage modules to be loaded
- Run Alliage commands in the isolated environment

## Installation

```bash
npm install --save-dev @alliage/sandbox
# or
yarn add -D @alliage/sandbox
```

## Usage

### Basic Example

```typescript
import { Sandbox } from '@alliage/sandbox';

async function run() {
  // Create a new sandbox instance
  const sandbox = new Sandbox({
    scenarioPath: './path/to/test/scenario',
  });

  // Initialize the sandbox
  await sandbox.initialize();

  try {
    // Run commands in the sandbox
    const { process, waitCompletion } = sandbox.run(['--argument', 'value']);
    
    // Wait for the command to complete
    await waitCompletion();
  } finally {
    // Clean up the sandbox
    await sandbox.clear();
  }
}
```

### Using with Vitest/Jest

Here's an example of using the sandbox with Vitest for integration testing:

```typescript
import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { Sandbox } from '@alliage/sandbox';
import fs from 'fs-extra';
import path from 'path';

describe('Alliage Application', () => {
  let sandbox: Sandbox;

  beforeEach(async () => {
    // Create sandbox for each test
    sandbox = new Sandbox({
      scenarioPath: path.resolve(__dirname, './fixtures/basic-scenario'),
      projectPath: path.resolve(__dirname, '..'),
    });
    
    // Initialize the sandbox environment
    await sandbox.init();
  });

  afterEach(async () => {
    // Clean up sandbox after each test
    await sandbox.clear();
  });

  it('should install dependencies', async () => {
    // Run the install command
    const { process, waitCompletion } = sandbox.install([]);
    
    // Set up output collection
    let output = '';
    process.stdout?.on('data', (data) => {
      output += data.toString();
    });
    
    // Wait for command to complete
    await waitCompletion();
    
    // Verify expected outcome
    expect(output).toContain('Installed dependencies');
  });

  it('should build the application', async () => {
    // First install, then build
    await sandbox.install([]).waitCompletion();
    
    const { process, waitCompletion } = sandbox.build([]);
    
    let output = '';
    process.stdout?.on('data', (data) => {
      output += data.toString();
    });
    
    await waitCompletion();
    
    // Verify the build succeeded
    expect(output).toContain('Build completed');
    expect(fs.existsSync(path.join(sandbox.getPath(), 'dist'))).toBe(true);
  });

  it('should run the application with custom arguments', async () => {
    // Install and build before running
    await sandbox.install([]).waitCompletion();
    await sandbox.build([]).waitCompletion();
    
    // Run application with specific arguments
    const { process, waitCompletion } = sandbox.run(['--env', 'test', '--custom-flag']);
    
    let output = '';
    process.stdout?.on('data', (data) => {
      output += data.toString();
    });
    
    await waitCompletion();
    
    // Verify expected application behavior
    expect(output).toContain('Running in test environment');
    expect(output).toContain('Custom flag enabled');
  });
});
```

### Configuration

Create an `alliage-sandbox-config.json` file in your scenario directory:

```json
{
  "command": "node",
  "copyFiles": [
    "<scenarioRoot>/fixtures/config.js",
    "<projectRoot>/package.json"
  ],
  "linkModules": {
    "local-module": "./path/to/local/module"
  },
  "alliageModules": [
    "@alliage/core",
    "@alliage/service-provider",
    "./local-module"
  ]
}
```

### Placeholders

In the configuration, you can use the following placeholders:
- `<scenarioRoot>`: The absolute path to the scenario directory
- `<projectRoot>`: The absolute path to the project directory

### API

#### Constructor

```typescript
new Sandbox({
  scenarioPath: string,
  projectPath?: string,
  sandboxPath?: string,
  sandboxConfig?: string,
})
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| scenarioPath | string | - | Path to the scenario directory containing the configuration file |
| projectPath | string | './' | Path to the project directory |
| sandboxPath | string | './.alliage-sandboxes' | Path where sandboxes will be created |
| sandboxConfig | string | 'alliage-sandbox-config.json' | Name of the configuration file |

#### Methods

- `init()`: Initializes the sandbox
- `clear()`: Cleans up the sandbox
- `getPath()`: Returns the path to the sandbox
- `getProjectPath()`: Returns the path to the project
- `getScenarioPath()`: Returns the path to the scenario
- `getConfig()`: Returns the sandbox configuration
- `install(args: string[], options?: CommandOptions)`: Runs the install command
- `build(args: string[], options?: CommandOptions)`: Runs the build command
- `run(args: string[], options?: CommandOptions)`: Runs the run command

## License

ISC © [Boris LEBON](https://github.com/bolebon)


