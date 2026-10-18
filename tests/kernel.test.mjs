import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {PythonEngine} from '../src/kernel-engine.js';
import {newFile} from '../src/core.js';
const runtime=process.env.PYFORGE_RUNTIME_DIR;
test('actual CPython WebAssembly kernel integration',{skip:!runtime,timeout:180000},async t=>{
 const base=path.resolve(runtime)+'/';const {loadPyodide}=await import(pathToFileURL(base+'pyodide.mjs'));const lock=JSON.parse(await readFile(base+'pyodide-lock.json','utf8'));
 const py=await loadPyodide({indexURL:base});const events=[];const engine=new PythonEngine(py,e=>events.push(e),lock.packages);await engine.init();
 const run=async(code,files=[],extra={})=>{events.length=0;return engine.run({code,filename:'main.py',files,autoPip:false,...extra});};
 const output=()=>events.filter(e=>['stdout','result'].includes(e.kind)).map(e=>e.text).join('');
 await t.test('local imports immediately reflect same-length edits',async()=>{
  let files=[newFile('main.py','from utils import value\nprint(value)'),newFile('utils.py','value = 1')];let r=await run(files[0].content,files);assert.equal(r.success,true,r.error);assert.match(output(),/1/);
  files=files.map(f=>f.path==='utils.py'?newFile('utils.py','value = 2'):f);r=await run(files[0].content,files);assert.equal(r.success,true,r.error);assert.match(output(),/2/);
 });
 await t.test('nested scripts import sibling modules',async()=>{
  const files=[newFile('src/main.py','from helper import value\nprint(value)'),newFile('src/helper.py','value = 7')];const r=await run(files[0].content,files,{filename:'src/main.py'});assert.equal(r.success,true,r.error);assert.match(output(),/7/);
 });
 await t.test('scientific imports inside local modules are automatically loaded',async()=>{
  const files=[newFile('main.py','from pkg.model import total\nprint(total)'),newFile('pkg/__init__.py',''),newFile('pkg/model.py','import numpy as np\ntotal = int(np.arange(10).sum())')];const r=await run(files[0].content,files);assert.equal(r.success,true,r.error);assert.match(output(),/45/);
 });
 await t.test('stdin, argv and UTF-8 file writes are real',async()=>{
  const r=await run('import sys\nfrom pathlib import Path\nprint(sys.argv[1])\nname = input("Tên: ")\nPath("result.txt").write_text(name, encoding="utf-8")',[],{argv:['--test'],stdin:['Nguyễn An']});assert.equal(r.success,true,r.error);assert.equal(r.files.find(f=>f.path==='result.txt').content,'Nguyễn An');assert.match(output(),/--test/);
 });
 await t.test('notebook and REPL preserve variables; different notebooks isolate state',async()=>{
  await run('x = 41',[],{mode:'notebook',filename:'a.ipynb'});let r=await run('x + 1',[],{mode:'notebook',filename:'a.ipynb'});assert.equal(r.success,true,r.error);assert.match(output(),/42/);
  r=await run('x',[],{mode:'notebook',filename:'b.ipynb'});assert.equal(r.success,false);assert.match(r.error,/NameError/);
 });
 await t.test('__main__ supports custom-class pickle and unittest discovery',async()=>{
  let r=await run('import pickle\nclass Item:\n    def __init__(self, value):\n        self.value = value\nobj = pickle.loads(pickle.dumps(Item(42)))\nprint(obj.value)');assert.equal(r.success,true,r.error);assert.match(output(),/42/);
  r=await run('import unittest\nclass TestExample(unittest.TestCase):\n    def test_value(self):\n        self.assertEqual(2 + 2, 4)\nunittest.main(argv=["main.py"], exit=False)');assert.equal(r.success,true,r.error);assert.ok(events.some(e=>e.kind==='stderr'&&e.text.includes('Ran 1 test')));
 });
 await t.test('trace records actual local state and file lines',async()=>{
  const files=[newFile('main.py','total = 0\nfor i in range(3):\n    total += i\nprint(total)')];const r=await run(files[0].content,files,{trace:true});assert.equal(r.success,true,r.error);assert.ok(r.trace.rows.length>6);assert.ok(r.trace.rows.some(row=>row.locals.some(v=>v.name==='total'&&v.value==='3')));assert.equal(r.trace.rows[0].file,'main.py');
 });
 await t.test('SystemExit and unittest.main() return process status without killing kernel',async()=>{
  let r=await run('import sys\nprint("before exit")\nsys.exit(0)');assert.equal(r.success,true,r.error);
  r=await run('import sys\nsys.exit(2)');assert.equal(r.success,false);assert.match(r.error,/status 2/);
  r=await run('import unittest\nclass TestExit(unittest.TestCase):\n    def test_value(self):\n        self.assertEqual(3 + 3, 6)\nunittest.main()');assert.equal(r.success,true,r.error);assert.ok(events.some(e=>e.kind==='stderr'&&e.text.includes('Ran 1 test')));
  r=await run('print("kernel still alive")');assert.equal(r.success,true,r.error);assert.match(output(),/kernel still alive/);
 });
 await t.test('variable inspector tolerates user objects with raising properties/repr',async()=>{
  const r=await run('class Difficult:\n    @property\n    def shape(self):\n        raise RuntimeError("shape")\n    def __repr__(self):\n        raise RuntimeError("repr")\nvalue = Difficult()');assert.equal(r.success,true,r.error);assert.ok(r.variables.some(v=>v.name==='value'&&v.shape==='?'&&v.value==='<repr unavailable>'));
 });
 await t.test('top-level await and syntax diagnostics',async()=>{
  const r=await run('import asyncio\nawait asyncio.sleep(0)\nprint("async works")');assert.equal(r.success,true,r.error);assert.match(output(),/async works/);assert.equal(engine.validate('def broken(', 'main.py')[0].severity,'error');
 });
 await t.test('Pandas tables preserve NaN as null; Matplotlib renders PNG',async()=>{
  const r=await run('import pandas as pd\nimport matplotlib.pyplot as plt\ndf = pd.DataFrame({"x":[1,2], "y":[3,float("nan")]})\ndisplay(df)\nplt.plot([1,2],[3,4])\nplt.show()');assert.equal(r.success,true,r.error);const table=events.find(e=>e.kind==='table');assert.deepEqual(table.columns,['x','y']);assert.equal(table.rows[1][1],null);assert.ok(events.find(e=>e.kind==='image').data.length>1000);
 });
 await t.test('CSV data inspector and SQLite query update project files',async()=>{
  const csv=newFile('data.csv','name,value\nA,2\nB,5\n');const data=await engine.data({path:'data.csv',files:[csv]});assert.deepEqual(data.result.rows,[['A',2],['B',5]]);
  const r=await run('import sqlite3\nwith sqlite3.connect("test.db") as c:\n    c.execute("CREATE TABLE values_table (value INTEGER)")\n    c.execute("INSERT INTO values_table VALUES (42)")');assert.equal(r.success,true,r.error);
  const query=await engine.data({path:'test.db',sql:'SELECT * FROM values_table',files:r.files});assert.deepEqual(query.result.rows,[[42]]);
 });
 await t.test('scikit-learn fits real model and NLTK tokenizes without corpus',async()=>{
  const r=await run('from sklearn.datasets import load_iris\nfrom sklearn.ensemble import RandomForestClassifier\nfrom nltk.tokenize import TreebankWordTokenizer\nX, y = load_iris(return_X_y=True)\nmodel = RandomForestClassifier(n_estimators=10,random_state=42,n_jobs=1).fit(X,y)\nprint(model.score(X,y))\nprint(TreebankWordTokenizer().tokenize("Python is great!"))');assert.equal(r.success,true,r.error);assert.match(output(),/1\.0/);assert.match(output(),/Python/);
 });
 await t.test('Jedi resolves module members',async()=>{
  await engine.install(['jedi']);const completions=engine.complete('import math\nmath.sq',2,7,'/workspace/main.py');assert.ok(completions.some(c=>c.label==='sqrt'));
 });
 if(process.env.PYFORGE_WHEEL_DIR){
  const folder=process.env.PYFORGE_WHEEL_DIR;const names=(await readdir(folder)).filter(n=>n.endsWith('.whl'));const pip=py.pyimport('micropip');
  for(const name of names){py.FS.writeFile('/tmp/'+name,new Uint8Array(await readFile(path.join(folder,name))));}
  await pip.install(names.map(name=>'emfs:/tmp/'+name));pip.destroy();
  await t.test('pure-Python package installation, Excel preview, formatter and lint',async()=>{
   const r=await run('import pandas as pd\nimport openpyxl\npd.DataFrame({"x":[4,8]}).to_excel("data.xlsx",index=False)');assert.equal(r.success,true,r.error);const data=await engine.data({path:'data.xlsx',files:r.files});assert.deepEqual(data.result.rows,[[4],[8]]);
   const formatted=await engine.format('x=1\nprint( x )');assert.match(formatted,/x = 1/);const lint=await engine.lint('import os\nprint(missing)', 'main.py');assert.ok(lint.some(m=>m.message.includes('undefined name')));
  });
 }
});
