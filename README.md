# PyForge — Python IDE trên trình duyệt

PyForge là chương trình lập trình Python kiểu IDE: editor, tab file, project,
console, notebook, package manager, biến, biểu đồ, bảng dữ liệu và trace.
Ứng dụng là frontend tĩnh, đưa lên GitHub Pages được, không cần backend cho
chế độ Browser. Giao diện tiếng Việt, sáng/tối, dùng được ở desktop và mobile.

## 1. Chạy nhanh bằng GitHub Pages — không cần cài Python

1. Giải nén ZIP vào một thư mục. Trong ZIP, `index.html`, `styles.css`, `src/`
   nằm ngay ở gốc; không có bản project thứ hai lồng bên trong.
2. Tạo repository GitHub, ví dụ `pyforge`.
3. Upload **nội dung** thư mục đã giải nén vào repository. Kiểm tra
   `index.html` nằm ở gốc repository, cùng cấp với `src/` và `assets/`.
4. Vào **Settings → Pages → Build and deployment → Source → Deploy from a
   branch**. Chọn **main**, thư mục **/(root)**, rồi **Save**.
5. Đợi GitHub báo deploy thành công, mở URL Pages được GitHub cung cấp.
6. Trong IDE, chọn `main.py`, nhấn **Run / F5**. Lần đầu kernel tải Python
   WebAssembly; cần Internet. Những lần tiếp theo trình duyệt có thể tận dụng
   cache mạng. Editor vẫn dùng được khi kernel chưa tải.

Không cần `npm install`, `npm run build`, Visual Studio hay server Python khi
chạy Browser mode trên GitHub Pages.

Cách GitHub Actions: upload cả `.github/workflows/pages.yml`, vào Settings →
Pages chọn **GitHub Actions**. Workflow sẽ tạo `dist/` và deploy khi push vào
`main`. Chọn một trong hai cách xuất bản trên.

GitHub hosting chứa mã nguồn **IDE**. File/project bạn soạn trong IDE được lưu
trên trình duyệt của bạn, không tự commit vào repository.

## 2. Chạy ở máy tính

Không mở `index.html` bằng double-click/file://: ES modules và worker cần HTTP.

**VS Code:** mở thư mục có `index.html` → cài extension **Live Server** →
nhấp phải `index.html` → **Open with Live Server**.

**Windows có Python:** double-click `START_WINDOWS.bat`. Hoặc mở Terminal ở
thư mục có `index.html`:

```powershell
py -3 -m http.server 8000
```

**macOS/Linux:**

```bash
python3 -m http.server 8000
```

Mở http://localhost:8000. Nếu máy không có Python, dùng Live Server hoặc
GitHub Pages. Python phía người dùng do Pyodide chạy trong trình duyệt;
Python ở lệnh trên chỉ phục vụ file HTML/JS.

## 3. Các chức năng IDE

| Nhóm | Chức năng |
| --- | --- |
| Editor | Monaco: tô màu, undo/redo, nhiều tab, folding, bracket matching, find/replace, completion cơ bản, snippets, minimap, word wrap. Có editor tích hợp khi CDN Monaco lỗi. |
| Project | Nhiều workspace độc lập; file/thư mục; tạo, đổi tên, xóa; mở thư mục từ máy; drag/drop; nhập/xuất ZIP; backup/restore mọi project. |
| Run | Chạy file, selection và console; top-level await ở Browser; stdin điền trước; sys.argv; stdout/stderr/traceback; giới hạn thời gian; dừng vòng lặp vô hạn bằng kết thúc worker. |
| Thư viện | Catalog gói Pyodide thật; tự nạp import; micropip cho wheel phù hợp; cài tên==version; cài requirements.txt; hiển thị gói đã nạp; lưu yêu cầu cài gói theo project. |
| Notebook | Nhập/xuất .ipynb v4, code/Markdown cells, run từng cell hoặc tất cả, di chuyển/xóa cell, kernel dùng chung, lưu output chuẩn Jupyter. |
| Data | Xem CSV/TSV, JSON/JSONL, Excel, Parquet; SQLite query đọc/ghi; data nằm trong project; xuất bảng xem trước ra CSV. |
| Output | DataFrame qua display(df), Matplotlib PNG qua plt.show(), ảnh PIL qua display(image), Jupyter rich output. HTML output được cách ly và không chạy script. |
| Variables | Tên, kiểu, shape, repr của biến sau lần chạy. |
| Trace | sys.settrace ghi tối đa 2.000 bước thật; xem từng dòng, locals/call stack, nhảy đến breakpoint đã đánh dấu. Đây là xem lại sau khi chạy, không phải debugger tạm dừng trực tiếp. |
| Code tools | Format autopep8, phân tích Pyflakes, syntax diagnostics từ AST, completion sâu với Jedi khi cài gói jedi. |

Editor dự phòng hỗ trợ tô màu Python, Tab/Shift Tab, auto-indent, comment,
find, completion từ khóa và chạy code. Những tính năng đặc thù Monaco như
folding/minimap/undo history nhiều model cần tải Monaco thành công.

**Console là Python console**, không phải PowerShell/Bash. Browser kernel
không thể chạy `git`, shell command hoặc `pip` qua subprocess. Dùng panel
Packages để cài gói. Với Jupyter native có thể dùng các khả năng của IPython
và môi trường server.

## 4. Import thư viện: phạm vi thực tế

Không có cách đưa toàn bộ PyPI, mọi thư viện native và CUDA vào frontend thuần.
PyForge cung cấp hai môi trường để chọn theo project:

| | Browser / Pyodide | Jupyter / Python native |
| --- | --- | --- |
| Python | CPython WebAssembly, Pyodide 0.29.4 | Python của kernel trên máy chủ bạn chọn |
| NumPy, Pandas, SciPy, Matplotlib, scikit-learn, NLTK | Có gói WebAssembly | Cài bằng pip vào server |
| Pure Python | Cài khi có wheel tương thích, dependencies cũng phải tương thích | Cài bằng pip theo môi trường server |
| Openpyxl, autopep8, Pyflakes | Wheel pure Python qua micropip | pip |
| PyTorch, TensorFlow, transformers native, CUDA | Cần chuyển sang native kernel | Có nếu server cài được và có phần cứng/driver cần thiết |
| Tkinter, subprocess, raw socket, multiprocessing | Không hoạt động như Python trên hệ điều hành | Theo môi trường server; GUI cần màn hình/server phù hợp |
| Model LLM lớn | Không cung cấp runtime/GPU cho model native | Theo RAM/VRAM và thư viện của server |
| Network | Tuân theo CORS/trình duyệt | Theo server |

Catalog tải từ `pyodide-lock.json` của runtime. Không tải hàng trăm gói vào
RAM ngay lúc mở IDE; gói được tải khi bạn import hoặc chọn cài. Gói chỉ có
wheel native Windows/Linux thường không cài bằng micropip được. Console
hiển thị lỗi thật; hãy chọn kernel Jupyter khi project cần gói native.

Ví dụ Browser:

```python
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from nltk.tokenize import TreebankWordTokenizer
```

Với thư viện được dùng gián tiếp (ví dụ Pandas gọi openpyxl khi xuất Excel),
cài `openpyxl` trong Packages hoặc thêm `import openpyxl` vào file.
NLTK corpus không tự đóng gói sẵn: dùng tokenizer không cần corpus, nhập
corpus vào project hoặc tải bằng nltk.download khi mạng/CORS cho phép.

Các project mẫu nằm trong File → Project mới: Python nhiều file, data,
scikit-learn, NLTK, SQLite, RAG retrieval và native LLM. RAG mẫu thực hiện
retrieval/prompt; muốn sinh câu trả lời cần model hoặc API của bạn.

## 5. Dùng kernel Jupyter để code Python native

Frontend vẫn chạy trên GitHub Pages. Kernel phải chạy trên máy bạn hoặc một
server bạn có quyền sử dụng. Frontend không tạo GPU, máy chủ hay tài khoản
dịch vụ AI.

### Trên máy của bạn

Tạo môi trường Python riêng, cài Jupyter và ipykernel:

```powershell
py -m venv .venv
.venv\Scripts\activate
python -m pip install jupyter_server ipykernel
```

Ví dụ khi IDE chạy ở `http://localhost:8000`:

```powershell
python -m jupyter_server --ServerApp.open_browser=False --ServerApp.port=8888 --ServerApp.allow_origin="http://localhost:8000" --ServerApp.allow_headers="Authorization,Content-Type"
```

Server sẽ in URL có token. Trong PyForge, nhấn nút **Python · Browser** →
**Native · Jupyter**, nhập URL gốc `http://localhost:8888/` và token →
**Kết nối kernel**. Dùng Packages để cài thư viện vào kernel native, hoặc cài
bằng pip ở terminal môi trường server. Gói có GPU cần bản/driver thích hợp.

Đối với GitHub Pages, `allow_origin` là origin `https://TEN.github.io` (không
gồm `/repo/`). Website HTTPS cần Jupyter endpoint HTTPS/WSS phù hợp; kết nối
localhost còn phụ thuộc chính sách mixed content/local network của trình
duyệt. Cách dễ thử tại máy là IDE và Jupyter cùng chạy qua HTTP ở localhost.
Nếu dùng server từ xa, cấu hình HTTPS/reverse proxy hỗ trợ WebSocket và giữ
token Jupyter. Không tắt xác thực để kết nối.

PyForge tạo kernel riêng và đồng bộ file vào `pyforge/<project-id>/` dưới
root của Jupyter Server. Khi đổi/disconnect kernel, chỉ kernel do PyForge
tạo được đóng; file trong thư mục đó vẫn còn. Mỗi lần Run dùng snapshot file
trước khi chạy, rồi kéo file tạo/sửa trở lại project. Token chỉ nằm trong RAM
và phải nhập lại sau reload. Project/backup không chứa token kết nối.

Notebook native hỗ trợ cú pháp IPython (ví dụ `%pip`); Browser chỉ dùng Python
thuần. Completion native dùng complete_request của Jupyter.

## 6. Lưu file, dữ liệu và backup

- IndexedDB tự lưu nội dung file, notebook/output, cấu trúc thư mục, tab,
  breakpoint và yêu cầu thư viện sau khi sửa. Thanh trạng thái báo kết quả
  lưu, có thông báo riêng khi quota/quyền trình duyệt không cho lưu.
- Mở lại **cùng URL/origin, cùng browser profile** để tiếp tục. Thay máy,
  profile, URL hosting hoặc xóa dữ liệu trình duyệt sẽ không thấy project cũ.
- **File → Xuất project ZIP** xuất source/data của project hiện tại, kèm
  metadata `.pyforge-project.json`. **Backup mọi project** xuất JSON đầy đủ.
  Nhập backup tạo bản sao, không ghi đè project hiện có.
- Mở thư mục từ máy là nhập một bản sao vào IDE. File trên ổ đĩa chưa thay đổi
  cho đến khi bạn tải/xuất kết quả và lưu lại bằng hệ điều hành.
- File do Python ghi trong thư mục workspace xuất hiện trong Explorer sau khi
  chạy. File nằm ngoài workspace và symlink không được tự lưu vào project.
- Khi bạn sửa code trong lúc Python đang chạy, bản bạn đang sửa được giữ khi
  đồng bộ kết quả. File cũ đã được gửi cho kernel là snapshot tại thời điểm Run.
- Giới hạn mặc định: 25 MB/file, 80 MB/project, 2.500 file nhập ZIP,
  250.000 ký tự console, 100 rich outputs/lần chạy, trace 2.000 bước.
  Data preview chỉ đọc để hiển thị tối đa 200 dòng/60 cột; SQLite fetch giới
  hạn. Dữ liệu gốc giữ nguyên. CSV export của bảng output chỉ xuất phần xem
  trước; để xuất đầy đủ, dùng Python ghi file rồi tải file đó.
- Dừng Browser kết thúc worker: biến/kernel RAM và thay đổi chưa đồng bộ của
  lần chạy bị mất. File đã lưu trước Run vẫn còn. Có thể khởi động lại kernel.

## 7. Phím tắt

| Phím | Lệnh |
| --- | --- |
| F5 | Chạy file hoặc notebook |
| Ctrl/Cmd Enter | Chạy selection; trong notebook chạy cell hiện tại |
| Ctrl/Cmd S | Lưu workspace |
| Ctrl/Cmd N | File mới |
| Ctrl/Cmd P | Mở nhanh file |
| Ctrl/Cmd Shift P hoặc Ctrl/Cmd K | Command palette |
| Ctrl/Cmd Shift F | Tìm/thay trong project |
| Ctrl/Cmd F | Tìm trong editor |
| Ctrl/Cmd B | Ẩn/hiện sidebar |
| Alt Shift F | Format Python |
| Ctrl/Cmd / | Comment code |
| Ctrl Space | Completion |

## 8. Tự host Pyodide, kiểm thử và cấu trúc source

`src/config.js` pin URL/version Pyodide và Monaco. Có thể tự host runtime:

```bash
python tools/download-runtime.py --destination vendor/pyodide --packages micropip,numpy,pandas,matplotlib,scikit-learn,nltk,sqlite3,jedi
```

Đổi `indexURL` thành `./vendor/pyodide/`. Worker sẽ nhận URL đã resolve theo
gốc IDE. Nếu dùng GitHub Actions, commit thư mục vendor (mặc định bị gitignore;
có thể dùng `git add -f vendor`). Build helper có copy vendor khi thư mục tồn
tại. Thêm package artifact khác vào thư mục khi cần; không trộn version
JS/WASM/lockfile. PyPI wheels vẫn cần mạng khi chưa tự đóng gói. Runtime và
Monaco CDN không nằm trong ZIP source. Service worker cache shell IDE; không
cam kết chạy Python offline hoàn toàn.

Kiểm thử cơ bản với Node 22+:

```bash
npm install
npm test
```

Npm chỉ dùng cho development tests, không cần để chạy/deploy IDE. Kernel tests
bật khi có runtime tải sẵn (đường dẫn tuyệt đối):

```bash
PYFORGE_RUNTIME_DIR=/absolute/path/vendor/pyodide npm test
```

Trên PowerShell đặt `$env:PYFORGE_RUNTIME_DIR` rồi `npm test`. Native tests
bật bằng `PYFORGE_JUPYTER_URL` và `PYFORGE_JUPYTER_TOKEN` trỏ vào server test
của bạn; test tạo kernel và thư mục `pyforge/integration-test/`.

Cấu trúc:

```text
index.html               Shell giao diện
styles.css               Responsive và sáng/tối
src/app.js               Workspace và các lệnh IDE
src/editor.js            Monaco + editor dự phòng
src/storage.js           IndexedDB
src/core.js, zip.js      File, notebook, validation, ZIP
src/kernel.worker.js     Worker Python, batching và output limits
src/kernel-engine.js     Pyodide runtime, import, file, code tools
src/kernel-python.js     Python helpers, data, variables, trace
src/jupyter-kernel.js    Jupyter REST/WebSocket adapter
src/templates.js         Project scaffolds
tools/build.mjs          Copy website tĩnh sang dist
tests/                   Kiểm thử chức năng và runtime
```

## 9. Nguồn kỹ thuật

- Pyodide worker: https://pyodide.org/en/0.29.4/usage/webworker.html
- Gói built-in: https://pyodide.org/en/0.29.4/usage/packages-in-pyodide.html
- Hạn chế WebAssembly: https://pyodide.org/en/0.29.4/usage/wasm-constraints.html
- Micropip: https://micropip.pyodide.org/en/stable/project/usage.html
- Jupyter API: https://jupyter-server.readthedocs.io/en/latest/developers/rest-api.html
- Jupyter messages: https://jupyter-client.readthedocs.io/en/stable/messaging.html
- GitHub Pages: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

Source PyForge dùng MIT. Xem THIRD_PARTY_NOTICES.md cho runtime/editor bên ngoài.
