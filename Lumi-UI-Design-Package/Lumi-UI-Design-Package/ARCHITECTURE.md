# Bản đồ giao diện Lumi

## Luồng nạp giao diện
`index.html` → khôi phục màu → `app.css`, `features.css` và `polish.css` → `core.js` → `features.js` → `polish.js` → `welcome.js` → `refine.js` → `introduction.js` → `account.js` → render màn hình theo phiên mẫu.
`Lumi.html` gộp đúng thứ tự đó trong một file.

## Vai trò các thành phần
| Thành phần | Trách nhiệm |
|---|---|
| app / sidebar / topbar / bottomnav | Khung ứng dụng, điều hướng và chọn bố cục |
| go(page) | Chuyển màn hình |
| render() | Chọn hàm màn hình và cập nhật vùng main |
| home(), library(), reader(), ... | Sinh HTML cho từng màn hình |
| showModal(), modalForm() | Hộp thoại và biểu mẫu |
| setMode() | Chuyển bản xem Máy tính / Điện thoại |
| setTheme() | Đổi giao diện Sáng / Tối / Dịu mắt |
| saved(), persist() | Đọc/ghi dữ liệu mẫu trong localStorage |
| icon() | Icon SVG nét mảnh, nhúng trực tiếp |

## Điều hướng
Trang chủ → học nhanh hoặc học tiếp.
Góc học tập → khóa học / học liệu / ghi chú / bài luyện.
Chức năng → công cụ học, ôn tập và tổ chức.
Cài đặt → tài khoản, giao diện, công cụ tùy chọn và dữ liệu.

## Các luồng để nghiên cứu
1. Thêm nguồn → trạng thái xử lý mẫu → mở nguồn → hỏi AI → bấm trích dẫn → lưu ghi chú.
2. Tạo khóa → liên kết nguồn → sửa đề cương → mở bài → đánh dấu hoàn thành.
3. Tạo bài luyện → chọn chế độ → làm 3 câu → kết quả → lưu để ôn → luyện lại.
4. Ghi chú → tạo flashcard → lật → đánh giá mức nhớ.
5. Mục tiêu tuần → việc học → nhắc học → tập trung → lưu phiên → tiến độ.
6. Hồ sơ → giao diện → xuất dữ liệu mẫu hoặc xóa với xác nhận.

## Bố cục
- Máy tính: thanh bên trái, nội dung rộng, tài liệu và trợ giảng cạnh nhau.
- Điện thoại: thanh dưới 4 mục, nội dung gọn, chuyển tab giữa tài liệu và AI; biểu mẫu mở dạng hộp thoại/bảng dưới.
- Ngưỡng compact thực tế của bản xuất: 600 px; nút Điện thoại ép bản xem rộng 414 px.
- Các breakpoint trung gian giúp thu gọn cột. Desktop không phải một ứng dụng native độc lập.

## Trạng thái dữ liệu
welcome.js điều hướng bằng URL hash. Người chưa có phiên trong sessionStorage được chuyển sang Đăng nhập; phiên mẫu tồn tại tối đa 8 giờ, không phải bảo mật máy chủ. Mật khẩu không được lưu. Các biến global ở core và features là trạng thái prototype. Mỗi lần render thay HTML vùng main.
Dữ liệu mới được lưu bằng khóa `lumi-*`; một số khóa `sf-*` được giữ để tương thích dữ liệu đã tạo trong bản cũ.
Các số quota là mẫu. Số hoạt động như bài luyện đã làm, thẻ đã ôn và phiên đã lưu lấy từ thao tác trong bản prototype.

## Cách chuyển thành dự án chính thức sau này
Dùng bố cục và hành vi ở đây làm chuẩn đối chiếu. Tách AppShell, Navigation, Button, Card, Modal, FormField, SourceRow, ThemeProvider và các feature module.
Frontend web/desktop có thể chia theo module; mobile cần dựng lại bằng component React Native theo cùng token và luồng. Gói hiện tại chưa thực hiện chuyển đổi đó.

## Kiểm tra
Đã kiểm tra cú pháp JS, sinh các màn hình, handler biểu mẫu, các luồng dữ liệu chính, 3 theme và tính toàn vẹn gói ZIP. Chưa xác nhận trực quan layout, cuộn, vùng chạm hoặc khả năng truy cập trên thiết bị thật.
