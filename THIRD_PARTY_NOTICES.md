# Third-party components

Source code created for PyForge is licensed under MIT (see LICENSE).

The browser loads these pinned external components; their binaries are not
bundled in this source archive:

- Monaco Editor 0.52.2, Microsoft: MIT. https://github.com/microsoft/monaco-editor
- Pyodide 0.29.4: Mozilla Public License 2.0; CPython and individual scientific
  packages retain their own licenses. https://github.com/pyodide/pyodide

Installing optional Python packages or self-hosting runtime assets requires
retaining their license notices. Tests can use fake-indexeddb and linkedom,
installed separately as development dependencies; their package license files
are authoritative.

No third-party fonts or bitmap illustrations are bundled.
