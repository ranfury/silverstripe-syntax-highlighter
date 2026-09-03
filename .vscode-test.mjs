import { defineConfig } from '@vscode/test-cli';
import os from 'node:os';
import path from 'node:path';

// VS Code opens a Unix socket inside the user-data dir, and macOS caps socket paths at
// 103 characters — the default location under the repo exceeds that.
const userDataDir = process.env.VSCODE_TEST_USER_DATA_DIR
	?? path.join(os.homedir(), '.vscode-test-silverstripe');

export default defineConfig({
	files: 'test/integration/**/*.test.js',
	workspaceFolder: './test/fixtures/project',
	launchArgs: ['--user-data-dir', userDataDir, '--disable-extensions', '--disable-gpu'],
	mocha: { timeout: 120000, ui: 'tdd' },
});
