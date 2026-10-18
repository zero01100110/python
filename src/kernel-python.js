// Helpers được chạy trong namespace riêng, không chèn mã người dùng vào template Python.
export const PY_HELPERS = String.raw`
import ast, base64, builtins, importlib, importlib.util, io, json, linecache, math, os, sys, traceback, types

_forge_inputs = []
_forge_trace_rows = []
_forge_trace_limit = 2000
_forge_workspace = '/workspace'
_forge_exit_code = None

def _forge_emit(payload):
    _forge_emit_js(json.dumps(payload, ensure_ascii=False, default=str, allow_nan=False))

def _forge_safe(value):
    if value is None or isinstance(value, (bool, str, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, (list, tuple)):
        return [_forge_safe(v) for v in value]
    if isinstance(value, dict):
        return {str(k): _forge_safe(v) for k,v in value.items()}
    if hasattr(value, 'item'):
        try:
            return _forge_safe(value.item())
        except Exception:
            pass
    try:
        return str(value)
    except Exception:
        return '<unrepresentable value>'

def _forge_repr(value, limit=240):
    try:
        text = repr(value)
        return text[:limit] + ('…' if len(text) > limit else '')
    except Exception:
        return '<repr unavailable>'

def _forge_input(prompt=''):
    if not _forge_inputs:
        raise EOFError('Hết stdin. Điền dữ liệu ở tab Stdin trước khi chạy; mỗi input() lấy một dòng.')
    value = _forge_inputs.pop(0)
    print(str(prompt) + value)
    return value

def _forge_new_context():
    module = types.ModuleType('__main__')
    sys.modules['__main__'] = module
    return module.__dict__

async def _forge_execute(code, namespace, filename):
    # Catch SystemExit in Python before it crosses the JS/WASM boundary.
    global _forge_exit_code
    from pyodide.code import eval_code_async
    _forge_exit_code = None
    try:
        return await eval_code_async(code, globals=namespace, filename=filename)
    except SystemExit as error:
        status = error.code
        _forge_exit_code = 0 if status is None else int(status) if isinstance(status, int) else 1
        if status is not None and not isinstance(status, int):
            print(str(status), file=sys.stderr)
        _forge_emit({'kind':'system', 'text':f'Python exited with status {_forge_exit_code}.\n'})
        return None

def _forge_exit_status():
    return json.dumps(_forge_exit_code)

def _forge_prepare(stdin, argv, filename, reload_local=True):
    global _forge_inputs
    _forge_inputs = json.loads(stdin)
    sys.argv = [filename] + json.loads(argv)
    os.chdir('/workspace')
    if '/workspace' not in sys.path:
        sys.path.insert(0, '/workspace')
    directory = os.path.dirname('/workspace/' + filename)
    sys.path[:] = [p for p in sys.path if not p.startswith('/workspace/')]
    if directory != '/workspace':
        sys.path.insert(0, directory)
    importlib.invalidate_caches()
    # Xóa cache các module local để lần Run sau thấy code vừa sửa.
    for name, module in list(sys.modules.items()):
        if reload_local and name != '__main__' and str(getattr(module, '__file__', '')).startswith('/workspace/'):
            sys.modules.pop(name, None)

def _forge_missing(code):
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return '[]'
    roots = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            roots.update(n.name.split('.')[0] for n in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            roots.add(node.module.split('.')[0])
    missing = []
    for name in sorted(roots):
        try:
            if name not in sys.modules and importlib.util.find_spec(name) is None:
                missing.append(name)
        except (ValueError, ImportError):
            missing.append(name)
    return json.dumps(missing)

def _forge_sources(code, filename):
    sources = []
    visited = set()
    def visit(source, current):
        if current in visited or len(visited) >= 200:
            return
        visited.add(current)
        sources.append(source)
        try:
            tree = ast.parse(source)
        except SyntaxError:
            return
        for node in ast.walk(tree):
            modules = []
            roots = [_forge_workspace, os.path.dirname(current)]
            if isinstance(node, ast.Import):
                modules = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom):
                module = node.module or ''
                modules = [module] + [module + ('.' if module else '') + alias.name for alias in node.names if alias.name != '*']
                if node.level:
                    parent = os.path.dirname(current)
                    for _ in range(node.level - 1):
                        parent = os.path.dirname(parent)
                    roots = [parent]
            for module in modules:
                for root in roots:
                    base = os.path.join(root, module.replace('.', '/'))
                    for candidate in (base + '.py', os.path.join(base, '__init__.py')):
                        if candidate in visited or not os.path.realpath(candidate).startswith(_forge_workspace + '/'):
                            continue
                        if os.path.isfile(candidate):
                            try:
                                with open(candidate, encoding='utf-8-sig') as file:
                                    visit(file.read(), candidate)
                            except (OSError, UnicodeError):
                                pass
    visit(code, filename)
    return json.dumps(sources)

def _forge_table(frame):
    limited = frame.iloc[:200, :60]
    return {'kind':'table', 'columns':[str(c) for c in limited.columns],
            'rows':_forge_safe(limited.values.tolist()),
            'index':[str(i) for i in limited.index], 'indexName':str(frame.index.name or '#'),
            'totalRows':int(frame.shape[0]), 'totalColumns':int(frame.shape[1]),
            'dtypes':[str(x) for x in limited.dtypes]}

def _forge_display(*objects):
    for obj in objects:
        if hasattr(obj, 'columns') and hasattr(obj, 'iloc') and hasattr(obj, 'dtypes'):
            _forge_emit(_forge_table(obj))
        elif hasattr(obj, 'save') and obj.__class__.__module__.startswith('PIL'):
            buffer = io.BytesIO()
            obj.save(buffer, format='PNG')
            _forge_emit({'kind':'image','data':base64.b64encode(buffer.getvalue()).decode()})
        else:
            _forge_emit({'kind':'result','text':_forge_repr(obj, 16000)})

def _forge_plot_setup():
    import matplotlib
    matplotlib.use('Agg', force=True)
    import matplotlib.pyplot as plt
    def show(*args, **kwargs):
        for number in plt.get_fignums():
            figure = plt.figure(number)
            buffer = io.BytesIO()
            figure.savefig(buffer, format='png', dpi=130, bbox_inches='tight')
            _forge_emit({'kind':'image','data':base64.b64encode(buffer.getvalue()).decode()})
            plt.close(figure)
    plt.show = show

def _forge_plot_flush():
    if 'matplotlib.pyplot' in sys.modules:
        sys.modules['matplotlib.pyplot'].show()

def _forge_variables(namespace):
    result=[]
    for name,value in list(namespace.items()):
        if name.startswith('_') or name in ('display','input') or isinstance(value, types.ModuleType):
            continue
        try:
            shape = str(getattr(value, 'shape', ''))
        except Exception:
            shape = '?'
        result.append({'name':name,'type':type(value).__name__,'value':_forge_repr(value),'shape':shape})
        if len(result) >= 150:
            break
    return json.dumps(result, ensure_ascii=False)

def _forge_trace(frame, event, arg):
    if event != 'line' or not frame.f_code.co_filename.startswith(_forge_workspace + '/'):
        return _forge_trace
    if len(_forge_trace_rows) >= _forge_trace_limit:
        return None
    stack=[]
    current=frame
    while current and len(stack)<12:
        if current.f_code.co_filename.startswith(_forge_workspace + '/'):
            stack.append({'function':current.f_code.co_name,'file':current.f_code.co_filename.replace(_forge_workspace + '/','',1),'line':current.f_lineno})
        current=current.f_back
    _forge_trace_rows.append({'file':frame.f_code.co_filename.replace(_forge_workspace + '/','',1),
        'line':frame.f_lineno,'function':frame.f_code.co_name,
        'locals':[{'name':k,'type':type(v).__name__,'value':_forge_repr(v,140)} for k,v in list(frame.f_locals.items()) if not k.startswith('_') and k not in ('display','input')][:30], 'stack':stack})
    return _forge_trace

def _forge_start_trace():
    global _forge_trace_rows
    _forge_trace_rows=[]
    sys.settrace(_forge_trace)

def _forge_end_trace():
    sys.settrace(None)
    return json.dumps({'rows':_forge_trace_rows, 'truncated':len(_forge_trace_rows)>=_forge_trace_limit}, ensure_ascii=False)

def _forge_validate(code, filename):
    try:
        ast.parse(code, filename=filename)
        return '[]'
    except SyntaxError as error:
        return json.dumps([{'line':error.lineno or 1,'column':error.offset or 1,'message':error.msg,'severity':'error'}])

def _forge_format(code):
    import autopep8
    return autopep8.fix_code(code, options={'max_line_length':100})

def _forge_lint(code, filename):
    from pyflakes.api import check
    class Reporter:
        messages=[]
        def unexpectedError(self, filename, message):
            self.messages.append({'line':1,'column':1,'message':message,'severity':'error'})
        def syntaxError(self, filename, message, lineno, offset, text):
            self.messages.append({'line':lineno,'column':offset or 1,'message':message,'severity':'error'})
        def flake(self, message):
            self.messages.append({'line':message.lineno,'column':message.col+1,'message':message.message % message.message_args,'severity':'warning'})
    reporter=Reporter()
    check(code, filename, reporter=reporter)
    return json.dumps(reporter.messages)

def _forge_complete(code, line, column, path):
    try:
        import jedi
        completions=jedi.Script(code=code,path=path).complete(line,column)
        return json.dumps([{'label':c.name,'insertText':c.name,'detail':c.description,'type':c.type} for c in completions[:80]])
    except Exception:
        return '[]'

def _forge_data(path, sql=''):
    path=os.path.abspath(path)
    if not path.startswith(_forge_workspace + '/'):
        raise ValueError('Data path must be inside workspace')
    ext=os.path.splitext(path)[1].lower()
    import pandas as pd
    if ext in ('.db','.sqlite','.sqlite3'):
        import sqlite3
        connection=sqlite3.connect(path)
        try:
            cursor=connection.execute(sql or "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') ORDER BY name")
            if cursor.description:
                columns=[d[0] for d in cursor.description]
                rows=cursor.fetchmany(201)
                result={'kind':'table','columns':columns,'rows':_forge_safe(rows[:200]),'totalRows':len(rows),'hasMore':len(rows)>200}
            else:
                result={'kind':'result','text':f'Query OK. {cursor.rowcount} rows affected.'}
            connection.commit()
            return json.dumps(result,ensure_ascii=False,allow_nan=False)
        finally:
            connection.close()
    if ext in ('.xlsx','.xls'):
        sheets=pd.ExcelFile(path)
        frame=pd.read_excel(sheets,sheet_name=0)
        result=_forge_table(frame); result['sheets']=sheets.sheet_names
    elif ext == '.parquet':
        result=_forge_table(pd.read_parquet(path, engine='auto' if importlib.util.find_spec('pyarrow') else 'fastparquet'))
    elif ext in ('.json','.jsonl','.ndjson'):
        if ext=='.json':
            with open(path,encoding='utf-8-sig') as f:
                obj=json.load(f)
            if isinstance(obj, dict):
                result=_forge_table(pd.json_normalize(obj))
            elif isinstance(obj,list):
                result=_forge_table(pd.json_normalize(obj) if not obj or isinstance(obj[0],dict) else pd.DataFrame({'value':obj}))
            else:
                result={'kind':'result','text':str(obj)}
        else:
            result=_forge_table(pd.read_json(path,lines=True))
    elif ext=='.tsv':
        result=_forge_table(pd.read_csv(path,sep='\t'))
    else:
        result=_forge_table(pd.read_csv(path))
    return json.dumps(result,ensure_ascii=False,allow_nan=False)

def _forge_installed():
    from importlib.metadata import distributions
    return json.dumps({d.metadata['Name'].lower().replace('_','-'):d.version for d in distributions() if d.metadata.get('Name')})
`;
