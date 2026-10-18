# Kiểm thử bản bàn giao

Ngày: 12/10/2026. Runtime Browser pin Pyodide 0.29.4.

Các kiểm tra tự động đã chạy thành công:

- File/project UTF-8 và nhị phân, đường dẫn, cấu trúc notebook, requirements.
- ZIP nhiều file, STORE/DEFLATE, CRC, kích thước; nhập ZIP tạo bằng Python zipfile.
- IndexedDB: snapshot khi lưu, mở lại dữ liệu, hàng đợi sửa/xóa.
- Chạy **CPython WebAssembly thật**: import file local/nested, module vừa sửa,
  import scientific bên trong module local, stdin/argv, ghi file Unicode.
- Notebook giữ biến, đổi notebook tách namespace; custom class pickle;
  unittest thực sự phát hiện/chạy test; SystemExit và kernel tiếp tục dùng được.
- Trace ghi locals/call stack; top-level await; AST diagnostics; repr/shape
  của object có lỗi không làm hỏng variable inspector.
- Pandas, NaN/table, Matplotlib PNG, CSV, SQLite, scikit-learn fit model,
  NLTK tokenizer, Jedi completion, Openpyxl, autopep8 và Pyflakes.
- Worker batching/giới hạn output; kết thúc worker trong vòng lặp vô hạn.
- Luồng IDE bằng DOM integration + kernel thật: sửa/lưu, Run, Search,
  tạo file, notebook output và đổi project.
- Giao thức Jupyter: execute_reply/idle khác thứ tự, rich output, stdin reply,
  frame nhị phân legacy. Đây là protocol tests, không thay thế kernel native.
- JavaScript syntax, CSS parser, ID/asset/import của HTML, build website tĩnh.

Giới hạn xác minh:

- Chưa kiểm tra render trực quan/Monaco trong trình duyệt thật vì môi trường
  không cung cấp browser QA theo quy trình đang dùng. DOM tests dùng editor
  dự phòng; không phải kiểm thử hình ảnh hoặc layout thực.
- Đã thử Jupyter Server thật với TCP và IPC. HTTP/API hoạt động, nhưng môi
  trường kiểm thử chặn socket ZeroMQ (`Operation not permitted`), khiến
  ipykernel không khởi động. Vì vậy thực thi Python **native qua Jupyter chưa
  được xác minh đầu-cuối** ở đây. Cần kiểm tra trên server/máy có socket và
  quyền hoạt động bình thường. Browser/Pyodide không cần Jupyter hoặc ZeroMQ.
- Chưa chạy model LLM native/GPU. Khả năng này phụ thuộc server, thư viện,
  model, RAM/VRAM và phần cứng của người dùng.
- Mã nguồn đã sẵn sàng cho GitHub Pages; chưa deploy vào repository của bạn.

Các suite ở `tests/` có thể chạy lại theo README. Kernel tests dùng runtime
tải bằng `tools/download-runtime.py`. Để bật phần pure-Python wheels của
kernel tests, tải wheels Openpyxl/autopep8/Pyflakes bằng pip download vào một
thư mục và đặt biến `PYFORGE_WHEEL_DIR` đến đường dẫn tuyệt đối của thư mục đó.
