# 🌿 Lumi AI — Nền tảng Trợ lý Học tập Thông minh Đa nền tảng (Web & Mobile)

> **Đồ án / Khóa luận tốt nghiệp Ngành Công nghệ Thông tin — Trường Đại học Tài chính - Ngân hàng Hà Nội (FBU)**  
> **Tên đề tài:** Xây dựng ứng dụng hỗ trợ học tập và ôn tập cá nhân hóa từ học liệu đa nguồn kết hợp công nghệ RAG và Trí tuệ nhân tạo.

---

## 📌 1. Giới thiệu tổng quan

**Lumi AI** là giải pháp hệ sinh thái học tập thông minh toàn diện, giúp sinh viên và người tự học giải quyết bài toán học liệu rời rạc (PDF, slide bài giảng, giáo trình). Hệ thống tự động phân tích cấu trúc, lập chỉ mục ngữ nghĩa và cung cấp trợ giảng AI đồng hành giải thích kiến thức với **trích dẫn số trang chính xác**.

### Các tính năng cốt lõi:
1. **Trình đọc học liệu thông minh & Bóc tách PDF theo trang:** Tự động sửa lỗi tiếng Việt bóc tách từ PDF, hiển thị trang sách thực tế.
2. **Trợ giảng AI Hybrid RAG:** Hỏi đáp trực tiếp trên nội dung tài liệu tải lên, giải thích cặn kẽ và dẫn nguồn tới từng trang.
3. **Sinh đề cương & Khóa học tự động:** Phân tích giáo trình để tạo lộ trình các bài học có tính liên kết.
4. **Luyện tập trắc nghiệm khách quan AI:** Tự động sinh đề kiểm tra 4 phương án, chấm điểm tức thì và phân tích đáp án đúng/sai.
5. **Thẻ nhớ thông minh (Flashcards) theo thuật toán SM-2:** Lặp lại ngắt quãng (Spaced Repetition) giúp tối ưu hóa khả năng ghi nhớ dài hạn.
6. **Sổ tay ghi chú & Quản lý tiến độ:** Lưu lại kiến thức quan trọng, đặt mục tiêu tuần và theo dõi hạn mức sử dụng.
7. **Giao diện đa thiết bị đồng nhất:** Hỗ trợ 3 chế độ màu (*Sáng ☀*, *Tối ☾*, *Dịu mắt ◉*) cùng khả năng thích ứng linh hoạt trên cả Máy tính và Điện thoại di động.

---

## 🏗️ 2. Kiến trúc hệ thống

```
Lumi Platform
├── backend/                  # Máy chủ API viết bằng FastAPI (Python 3.12)
│   ├── app/
│   │   ├── api/v1/           # Các endpoints: auth, sources, rag, quizzes, flashcards...
│   │   ├── core/             # Cấu hình hệ thống, bảo mật JWT, database connection pool
│   │   ├── models/           # SQLAlchemy ORM ánh xạ bảng dữ liệu PostgreSQL
│   │   ├── schemas/          # Pydantic schemas kiểm thực dữ liệu đầu vào/ra
│   │   └── services/         # Dịch vụ AI (RAG, Gemini Flash, Embedding, PDF Parser, SM-2)
│   ├── tests/                # Bộ kiểm thử tích hợp tự động (pytest)
│   └── main.py               # Điểm khởi chạy FastAPI, cấu hình CORS & Static Files
│
├── frontend/                 # Giao diện người dùng Web & Mobile (Đã duyệt 17/10/2026)
│   ├── source/
│   │   ├── index.html        # Trang chính của ứng dụng
│   │   ├── app.css, core.js  # Hệ thống khung bố cục và điều hướng màn hình
│   │   ├── welcome.*         # Trang giới thiệu ngoài và quản lý phiên
│   │   ├── account.*         # Màn hình chào Onboarding Mobile & Đăng nhập/Đăng ký
│   │   ├── polish.*          # Giao diện chi tiết các công cụ học tập
│   │   ├── api.js            # Tích hợp kết nối trực tiếp với backend FastAPI
│   │   ├── device.css/js     # Lớp tối ưu màn hình cảm ứng & tỷ lệ điện thoại thật
│   │   ├── manifest.json     # Cấu hình PWA để cài đặt toàn màn hình lên điện thoại
│   │   └── icon.svg          # Biểu tượng ứng dụng Lumi
│   └── START-HERE.html       # Bản tham chiếu trực quan và tài liệu thiết kế
│
├── supabase/                 # Cơ sở dữ liệu đám mây Supabase PostgreSQL
│   ├── migrations/           # Các script di chuyển dữ liệu từ 001 đến 008 (RLS enabled)
│   └── full_setup.sql        # Script tạo toàn bộ cơ sở dữ liệu và hàm tính toán
│
├── docs/                     # Tài liệu thiết kế & biểu mẫu tốt nghiệp
│   ├── Dac_ta_do_an_App_hoc_tap_AI_React_Native.txt   # Bản đặc tả kỹ thuật 60 Use Case
│   └── fbu_guidelines/       # Quy định và biểu mẫu khóa luận tốt nghiệp FBU
│
└── Lumi-UI-Design-Package/   # Gói thiết kế giao diện gốc đã duyệt làm chuẩn đối chiếu
```

---

## 🚀 3. Hướng dẫn cài đặt và khởi chạy

### Yêu cầu môi trường:
- **Python:** 3.11 hoặc 3.12
- **Trình duyệt:** Chrome, Edge hoặc Cốc Cốc
- **Cơ sở dữ liệu:** Supabase PostgreSQL (đã cấu hình vector pgvector)

### Bước 1: Thiết lập môi trường Backend
1. Mở terminal tại thư mục `backend/`:
   ```bash
   cd backend
   ```
2. Cài đặt các thư viện cần thiết:
   ```bash
   pip install -r requirements.txt
   ```
3. Khởi tạo file `.env` từ file mẫu `.env.example`:
   ```bash
   copy .env.example .env
   ```
   *(Điền các thông tin `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` và `GEMINI_API_KEY`)*

### Bước 2: Khởi động hệ thống
Chạy lệnh khởi động máy chủ FastAPI:
```bash
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```
Khi máy chủ khởi động thành công:
- **Web App:** Mở trình duyệt truy cập: [http://localhost:8000/app/](http://localhost:8000/app/)
- **Swagger API Docs:** [http://localhost:8000/docs](http://localhost:8000/docs)
- **Tài liệu giao diện thiết kế:** [http://localhost:8000/design/START-HERE.html](http://localhost:8000/design/START-HERE.html)

---

## 📱 4. Hướng dẫn Test trực tiếp trên Điện thoại Android (OPPO A92)

Máy tính xách tay cấu hình vừa phải không cần cài đặt các bộ giả lập Android nặng nề (như Android Studio Emulator). Bạn có thể test trực tiếp trên điện thoại **OPPO A92** theo 2 cách dưới đây:

### Cách 1: Kết nối chung mạng Wi-Fi (Đơn giản nhất — Không cần cáp)
1. Đảm bảo laptop và điện thoại **OPPO A92** đang kết nối vào **cùng một mạng Wi-Fi**.
2. Trên laptop, kiểm tra địa chỉ IP mạng nội bộ (LAN):
   - Mở terminal gõ: `ipconfig`
   - Tìm dòng **IPv4 Address** của card Wi-Fi (ví dụ: `192.168.39.17`).
3. Đảm bảo Backend đang chạy với tham số `--host 0.0.0.0` (mặc định đã cấu hình sẵn).
4. Trên điện thoại OPPO A92, mở trình duyệt **Chrome** hoặc **Cốc Cốc** và nhập địa chỉ:
   ```
   http://192.168.39.17:8000/app/
   ```
   *(Thay `192.168.39.17` bằng IP máy tính của bạn)*

### Cách 2: Cắm cáp USB sử dụng ADB Reverse (Cực nhanh và không phụ thuộc Wi-Fi)
Cách này giúp điện thoại kết nối thẳng qua cáp sạc USB, ổn định 100% kể cả khi Wi-Fi phòng trọ/trường học chặn kết nối giữa các máy:
1. Bật **Tùy chọn cho nhà phát triển** trên OPPO A92:
   - Vào *Cài đặt* -> *Giới thiệu về điện thoại* -> Bấm liên tục 7 lần vào *Số bản dựng (Build number)*.
   - Quay lại *Cài đặt bổ sung* -> Mở *Tùy chọn nhà phát triển* -> Bật **Gỡ lỗi USB (USB Debugging)**.
2. Cắm cáp kết nối OPPO A92 với laptop.
3. Trên terminal máy tính, chạy lệnh cầu nối cổng:
   ```bash
   adb reverse tcp:8000 tcp:8000
   ```
4. Mở trình duyệt trên điện thoại và truy cập thẳng:
   ```
   http://localhost:8000/app/
   ```

### 📲 Cài đặt thành App Mobile toàn màn hình (PWA)
Để giao diện hiển thị 100% toàn màn hình, biến mất thanh địa chỉ URL của trình duyệt như một ứng dụng Native thực thụ:
1. Khi đang mở trang Lumi trên Chrome điện thoại, bấm vào biểu tượng **ba dấu chấm (⋮)** ở góc trên bên phải.
2. Chọn **"Thêm vào Màn hình chính"** (hoặc *"Cài đặt ứng dụng"*).
3. Bấm **Thêm**. Biểu tượng chiếc lá **Lumi** sẽ xuất hiện trên màn hình chính của OPPO A92.
4. Chạm vào icon Lumi ngoài màn hình chính để mở app ở chế độ **Standalone Full-screen**.

---

## 📄 5. Bản quyền và Đóng góp
Dự án được xây dựng phục vụ nghiên cứu và thực hiện Khóa luận tốt nghiệp Đại học. Mọi hành vi sao chép phục vụ mục đích thương mại cần có sự đồng ý của tác giả.
