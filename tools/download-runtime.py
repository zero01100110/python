"""Download pinned Pyodide for self-hosting or Node kernel integration tests.

python tools/download-runtime.py --destination vendor/pyodide \
  --packages micropip,numpy,pandas,matplotlib,scikit-learn,nltk,sqlite3,jedi
"""
import argparse
import concurrent.futures
import hashlib
import json
import pathlib
import urllib.request

VERSION = '0.29.4'
BASE = f'https://cdn.jsdelivr.net/pyodide/v{VERSION}/full/'
CORE = ['pyodide.mjs', 'pyodide.js', 'pyodide.asm.js', 'pyodide.asm.wasm',
        'python_stdlib.zip', 'pyodide-lock.json']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--destination', default='vendor/pyodide')
    parser.add_argument('--packages', default='micropip')
    args = parser.parse_args()
    target = pathlib.Path(args.destination).resolve()
    target.mkdir(parents=True, exist_ok=True)

    def download(filename, digest=None):
        output = target / filename
        if output.is_file() and (not digest or hashlib.sha256(output.read_bytes()).hexdigest() == digest):
            return filename + ' (cached)'
        last = None
        for _ in range(3):
            try:
                with urllib.request.urlopen(BASE + filename, timeout=60) as response:
                    data = response.read()
                if digest and hashlib.sha256(data).hexdigest() != digest:
                    raise ValueError(f'Checksum mismatch: {filename}')
                output.write_bytes(data)
                return f'{filename}: {len(data):,} bytes'
            except Exception as error:
                last = error
        raise last

    print(download('pyodide-lock.json'), flush=True)
    lock = json.loads((target / 'pyodide-lock.json').read_text())['packages']
    selected = set()

    def include(name):
        if name in selected:
            return
        if name not in lock:
            raise ValueError(f'{name} is not built into Pyodide {VERSION}. Use compatible PyPI wheels through the IDE.')
        selected.add(name)
        for dependency in lock[name].get('depends', []):
            include(dependency)

    for package in args.packages.split(','):
        if package.strip():
            include(package.strip())
    jobs = [(name, None) for name in CORE if name != 'pyodide-lock.json']
    jobs += [(lock[name]['file_name'], lock[name].get('sha256')) for name in sorted(selected)]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(download, filename, digest) for filename, digest in jobs]
        for future in concurrent.futures.as_completed(futures):
            print(future.result(), flush=True)
    print('Done. For self-hosting, set src/config.js indexURL to ./vendor/pyodide/ (absolute URL resolved in worker).')


if __name__ == '__main__':
    main()
