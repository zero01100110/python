// Có thể trỏ indexURL vào bản Pyodide tự host. Luôn giữ cùng phiên bản JS/WASM/packages.
export const CONFIG = Object.freeze({
  pyodideVersion: '0.29.4',
  indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.29.4/full/',
  monacoURL: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs',
  maxFileBytes: 25 * 1024 * 1024,
  maxWorkspaceBytes: 80 * 1024 * 1024,
  maxOutputChars: 250000,
  defaultTimeout: 60,
});
