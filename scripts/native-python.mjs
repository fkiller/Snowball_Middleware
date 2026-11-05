import path from 'node:path';

// macOS ships python3, not python. Pass the owning Node runtime to the native
// read-only SQLite fallback instead of depending on an unrelated PATH node.
export const nativePython = () => {
  const override = process.env.SNOWBALL_PYTHON_EXECUTABLE;
  if (override && !path.isAbsolute(override)) throw Error('Native Python override must be absolute');
  return override || (process.platform === 'win32' ? 'python' : 'python3');
};
export const nativePythonEnvironment = () => ({ ...process.env, PYTHONIOENCODING: 'utf-8', SNOWBALL_NODE_EXECUTABLE: process.execPath });
