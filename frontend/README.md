# Lumi — bộ giao diện để nghiên cứu

Bản xuất từ giao diện Lumi đã duyệt ngày 17/10/2026. Đây là prototype tương tác, chưa có backend.

## Bắt đầu
1. Giải nén toàn bộ ZIP.
2. Mở `START-HERE.html` để xem trang tham chiếu trực quan và chọn màn hình.
3. Mở `Lumi.html` để xem trang giới thiệu. Muốn thử app mobile: chọn App mobile, hoặc mở `Lumi.html?screen=mobile`; đi qua màn chào rồi Đăng nhập / Đăng ký. Bấm Đăng nhập rồi chọn Dùng thông tin mẫu để thử, sau đó bấm Đăng nhập. File này tự chứa CSS và JavaScript, không cần cài thư viện.
4. Chọn Máy tính / Điện thoại và Sáng / Tối / Dịu mắt ở thanh trên cùng.
5. Vào Chức năng để thử tất cả nhóm chính.

Nếu trình duyệt hạn chế lưu dữ liệu hoặc tải file khi mở trực tiếp, dùng máy chủ cục bộ:
- Cần Python 3 đã được cài.
- Mở terminal tại thư mục đã giải nén, chạy `python -m http.server 8000 --bind 127.0.0.1` (hoặc `python3 ...`).
- Mở http://127.0.0.1:8000/START-HERE.html
- Ctrl+C để dừng. Đây chỉ là máy chủ file tĩnh, không phải backend nghiệp vụ.

Màu mặc định khi chưa có lựa chọn là Sáng. Lựa chọn Sáng / Tối / Dịu mắt được ghi nhớ và dùng xuyên suốt trang giới thiệu, màn chào mobile, tài khoản và không gian học. Chuyển màu khi đang nhập biểu mẫu không xóa nội dung đã nhập.

## Nội dung gói
- `Lumi.html`: bản bấm thử một file, chạy offline.
- `START-HERE.html`: trang tham chiếu trực quan, chọn thiết bị, màu và màn hình.
- `source/index.html`: mã HTML đã tách để đọc và sửa.
- `source/app.css`: CSS chính, gồm nhiều lớp điều chỉnh theo quá trình duyệt.
- `source/core.js`: trạng thái, màn hình và các hàm tương tác gốc.
- `source/features.css`: bố cục của các chức năng bổ sung và nút Giao diện.
- `source/features.js`: các luồng người dùng, lưu cục bộ và bổ sung menu.
- `source/account.css` và `source/account.js`: tài khoản web/mobile mới và lối vào app mobile với 3 màn chào.
- `source/identity.css`: thiết kế tài khoản, khối bắt đầu cuối trang và ghi công TriThuc, điều chỉnh màu nhất quán và bộ chọn giao diện trước đăng nhập. File CSS này được nạp cuối.
- `source/notebook.css`: nền vở ô ly xoay chéo chỉ ở trang giới thiệu web và màn chào app mobile. Đăng nhập và không gian học dùng nền trơn.
- `source/introduction.css` và `source/introduction.js`: nội dung giới thiệu chi tiết, nền lưới ô ly chéo và 4 màn hình app điện thoại × 3 giao diện.
- `source/refine.css` và `source/refine.js`: nền nhạt hơn, thẻ vuông xen kẽ, chữ rõ và chuyển động có chế độ giảm chuyển động.
- `source/welcome.css` và `source/welcome.js`: trang giới thiệu, phiên đăng nhập mẫu và trang chủ cá nhân.
- `source/polish.css` và `source/polish.js`: thiết kế chi tiết mới cho công cụ, tài khoản, ghi chú, flashcard, kế hoạch, học liệu và hội thoại.
- `design-tokens.json`: giá trị màu và quy ước trích từ giao diện hiện tại.
- `screen-map.json`: 21 màn hình và cách mở.
- `ARCHITECTURE.md`: bản đồ mã, dữ liệu, luồng và giới hạn.
- `CHECKSUMS.sha256`: dấu vân tay các file khi xuất.

## Cách nghiên cứu
- Muốn chỉnh màu: tìm `html[data-theme="light"]`, `dark`, `comfort` trong `source/app.css` và `source/identity.css`.
- Muốn chỉnh bố cục điện thoại: tìm `.mobile` và `@media(max-width:600px)` trong CSS.
- Muốn chỉnh một màn hình: tìm tên hàm trong `core.js` hoặc `features.js`.
- `features.js` được nạp sau `core.js`; `polish.js` hoàn thiện cách trình bày; `welcome.js` thiết lập trang giới thiệu và phiên mẫu; `refine.js` thêm thẻ vuông và chuyển động; `introduction.js` bổ sung câu chuyện sản phẩm; `account.js` được nạp cuối để dựng tài khoản web/mobile và màn chào app riêng. Các file mới mở rộng hoặc thay thế một số hàm; bản chạy cuối cùng ưu tiên hàm mới.
- Sửa bản `source/` rồi mở `source/index.html` để xem thay đổi. `Lumi.html` là bản snapshot riêng, không tự cập nhật theo source.

## Phạm vi chính xác
- Có bố cục màn hình máy tính và điện thoại, 3 giao diện và 21 màn hình bấm thử.
- HTML/CSS/JavaScript thuần; không phải dự án React Native/Expo, React hay file thiết kế Figma.
- Desktop hiện là bố cục cho máy tính, chưa có trình cài Windows/macOS.
- PDF, video, AI, đăng nhập, quota, xử lý nguồn, nhắc học và đồng bộ đều là mô phỏng giao diện.
- Không phân tích file thật; không gửi email, thông báo hoặc gọi API AI.
- Mật khẩu thử không được lưu. Không nhập mật khẩu thật vào bản mẫu.
- Ghi chú, lịch, thẻ và lịch sử do bạn tạo lưu trong localStorage của trình duyệt; các bản file/local server có thể có vùng lưu khác nhau.
- Font dùng font hệ thống nếu máy không có Inter; không bao gồm file font thương mại hay yêu cầu tải font ngoài.
- Chưa kiểm tra trực quan trên trình duyệt/thiết bị thật. Logic các màn hình và luồng đã được kiểm tra bằng mô phỏng DOM.
- Gói không chứa .env, khóa API, thông tin xác thực hoặc cấu hình triển khai riêng.

Bản này là mốc tham chiếu giao diện đã duyệt. Khi chuyển sang frontend chính thức, nên chia component/module và chuẩn hóa lại các lớp CSS kế thừa.
