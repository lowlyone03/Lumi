import re

with open('kltn/frontend/source/api.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add chunks cache for source-db
source_db_chunks = '''
// Pre-cached tri thức chuẩn cho học liệu "Bài giảng Cơ sở dữ liệu.pdf"
lumiChunksCache['source-db'] = [
  {
    page_number: 1,
    heading: 'Chương 1: Tổng quan về Hệ cơ sở dữ liệu quan hệ',
    content: 'Cơ sở dữ liệu (Database) là một tập hợp các dữ liệu có liên quan logic với nhau, được lưu trữ trên các thiết bị nhớ để phục vụ nhu cầu khai thác thông tin của nhiều người dùng và nhiều ứng dụng đồng thời.\\nHệ quản trị cơ sở dữ liệu (DBMS - Database Management System) cung cấp môi trường thuận tiện và hiệu quả để định nghĩa, xây dựng, thao tác và chia sẻ dữ liệu an toàn, bảo đảm tính toàn vẹn và độc lập dữ liệu.'
  },
  {
    page_number: 10,
    heading: 'Chương 2: Mô hình Dữ liệu Quan hệ (Relational Model)',
    content: 'Trong mô hình quan hệ do E.F. Codd đề xuất, dữ liệu được tổ chức dưới dạng các bảng hai chiều (Relations) gồm:\\n- Cột đại diện cho các thuộc tính (Attributes)\\n- Hàng đại diện cho các bộ dữ liệu hoặc bản ghi (Tuples / Records)\\nMỗi quan hệ có một tên duy nhất trong lược đồ cơ sở dữ liệu. Miền giá trị (Domain) là tập hợp tất cả các giá trị nguyên tố mà thuộc tính có thể nhận.'
  },
  {
    page_number: 12,
    heading: 'Chương 2: Khóa chính (Primary Key)',
    content: 'Khóa chính (Primary Key - PK) là một thuộc tính hoặc một tập hợp tối thiểu các thuộc tính được chọn để xác định duy nhất mỗi bộ (bản ghi) trong bảng quan hệ.\\nQuy tắc bắt buộc của Khóa chính (Thực thể toàn vẹn - Entity Integrity):\\n1. Giá trị của khóa chính phải là DUY NHẤT cho mỗi dòng trong toàn bộ bảng, không được phép trùng lặp.\\n2. Giá trị của bất kỳ thuộc tính nào thuộc khóa chính TUYỆT ĐỐI KHÔNG ĐƯỢC CHỨA NULL (rỗng).\\nVí dụ: Cột MaSV trong bảng SinhVien là khóa chính, bảo đảm mỗi sinh viên có một mã định danh duy nhất.'
  },
  {
    page_number: 13,
    heading: 'Chương 2: Khóa ngoại (Foreign Key)',
    content: 'Khóa ngoại (Foreign Key - FK) là một hoặc một tập thuộc tính trong bảng này tham chiếu trực tiếp đến khóa chính của một bảng khác (hoặc chính bảng đó).\\nKhóa ngoại đóng vai trò tạo liên kết logic giữa các bảng trong cơ sở dữ liệu quan hệ, ngăn chặn việc nhập dữ liệu mồ côi hoặc không hợp lệ.\\nVí dụ: Cột MaKhoa trong bảng SinhVien là khóa ngoại tham chiếu đến khóa chính MaKhoa của bảng Khoa.'
  },
  {
    page_number: 14,
    heading: 'Chương 2: Ràng buộc Toàn vẹn tham chiếu (Referential Integrity)',
    content: 'Ràng buộc toàn vẹn tham chiếu bảo đảm rằng liên kết giữa các bảng luôn giữ được tính nhất quán và hợp lệ.\\nQuy tắc toàn vẹn tham chiếu:\\n1. Mọi giá trị khác NULL của khóa ngoại FK phải trùng khớp với một giá trị khóa chính PK đang tồn tại trong bảng được tham chiếu.\\n2. Khi xóa hoặc cập nhật bản ghi chứa khóa chính (ví dụ xóa một Khoa), hệ thống DBMS áp dụng các hành vi: CASCADE (xóa dây chuyền), RESTRICT / NO ACTION (chặn thao tác nếu còn bản ghi tham chiếu), SET NULL (đặt khóa ngoại về NULL).'
  },
  {
    page_number: 20,
    heading: 'Chương 3: Ngôn ngữ Truy vấn Có Cấu trúc SQL',
    content: 'SQL là ngôn ngữ chuẩn dùng để tương tác với cơ sở dữ liệu quan hệ, bao gồm các nhóm lệnh DDL (Data Definition Language) như CREATE TABLE, ALTER TABLE; và DML (Data Manipulation Language) như SELECT, INSERT, UPDATE, DELETE.\\nVí dụ câu lệnh tạo bảng có khóa chính và khóa ngoại:\\nCREATE TABLE SinhVien (\\n  MaSV VARCHAR(10) PRIMARY KEY,\\n  HoTen NVARCHAR(50) NOT NULL,\\n  MaKhoa VARCHAR(10),\\n  CONSTRAINT FK_SinhVien_Khoa FOREIGN KEY (MaKhoa) REFERENCES Khoa(MaKhoa)\\n);'
  }
];
'''

if "lumiChunksCache['source-db'] =" not in content:
    content = content.replace("const lumiChunksCache = {};", "const lumiChunksCache = {};\n" + source_db_chunks, 1)

# 2. Update loadSourceChunks to return source-db chunks immediately
old_load_chunks = '''async function loadSourceChunks(sourceId, force = false) {
  if (!sourceId || !/^[0-9a-f-]{36}$/i.test(sourceId)) return [];'''
new_load_chunks = '''async function loadSourceChunks(sourceId, force = false) {
  if (!sourceId) return [];
  if (sourceId === 'source-db') return lumiChunksCache['source-db'] || [];
  if (!/^[0-9a-f-]{36}$/i.test(sourceId)) return lumiChunksCache[sourceId] || [];'''
assert old_load_chunks in content, 'old_load_chunks not found'
content = content.replace(old_load_chunks, new_load_chunks, 1)

# 3. Update ensureBackendDefaultSource to merge core sources
old_ensure = '''      const mapped = serverSources.map(s => ({
        id: s.id,
        backendId: s.id,
        title: cleanVietText(s.title),
        type: (s.kind || 'pdf').toUpperCase(),
        pageCount: s.active_version?.page_count || 1,
        meta: `${s.active_version?.page_count || 1} trang · Đã đồng bộ đám mây`,
        status: s.status === 'ready' ? 'ready' : 'processing',
        version: s.active_version?.version_no || 1,
        tags: ['Đã lập chỉ mục AI', 'Trích dẫn theo trang', 'Sẵn sàng hỏi đáp']
      }));
      const fbuIdx = mapped.findIndex(m => m.id === 'dfed7ff0-c965-45d4-a24a-7b1277176256' || m.title.toLowerCase().includes('thực tập tốt nghiệp'));
      if (fbuIdx > 0) {
        const fbu = mapped.splice(fbuIdx, 1)[0];
        mapped.unshift(fbu);
      }
      records.splice(0, records.length, ...mapped);
      saveRecords();
      chatSourceIds = [mapped[0].id];
      return mapped[0].id;'''

new_ensure = '''      const mapped = serverSources.map(s => ({
        id: s.id,
        backendId: s.id,
        title: cleanVietText(s.title),
        type: (s.kind || 'pdf').toUpperCase(),
        pageCount: s.active_version?.page_count || 1,
        meta: `${s.active_version?.page_count || 1} trang · Đã đồng bộ đám mây`,
        status: s.status === 'ready' ? 'ready' : 'processing',
        version: s.active_version?.version_no || 1,
        tags: ['Đã lập chỉ mục AI', 'Trích dẫn theo trang', 'Sẵn sàng hỏi đáp']
      }));

      // Luôn bảo toàn các học liệu cốt lõi (FBU, Cơ sở dữ liệu, Video OSI)
      const coreSources = [
        {
          id: 'dfed7ff0-c965-45d4-a24a-7b1277176256',
          backendId: 'dfed7ff0-c965-45d4-a24a-7b1277176256',
          title: '03. Tài liệu hướng dẫn thực tập tốt nghiệp ĐH_FBU.pdf',
          meta: 'PDF · 9 trang · Học phần tốt nghiệp FBU',
          type: 'PDF',
          status: 'ready',
          pageCount: 9,
          version: 1,
          tags: ['FBU', 'Thực tập', 'Tốt nghiệp']
        },
        {
          id: 'source-db',
          backendId: 'source-db',
          title: 'Bài giảng Cơ sở dữ liệu.pdf',
          meta: 'PDF · 42 trang · Cơ sở dữ liệu & Ràng buộc toàn vẹn',
          type: 'PDF',
          status: 'ready',
          pageCount: 42,
          version: 1,
          tags: ['Cơ sở dữ liệu', 'SQL', 'Khóa chính']
        },
        {
          id: 'default-video',
          backendId: 'default-video',
          title: 'Mô hình OSI - Bài giảng video',
          meta: 'Video · 18 phút · Có transcript phân tầng',
          type: 'VIDEO',
          status: 'ready',
          pageCount: 1,
          version: 1,
          tags: ['Mạng máy tính', 'OSI', 'Video']
        }
      ];

      const allSources = [...coreSources];
      mapped.forEach(s => {
        if (!allSources.some(x => x.id === s.id || x.backendId === s.id)) {
          allSources.push(s);
        }
      });

      records.splice(0, records.length, ...allSources);
      saveRecords();
      chatSourceIds = [allSources[0].id];
      return allSources[0].id;'''

assert old_ensure in content, 'old_ensure not found'
content = content.replace(old_ensure, new_ensure, 1)

# 4. Update renderPdfDocumentViaPdfJs: workerSrc and timeout
old_worker = '''    if (typeof pdfjsLib === 'undefined') {
      throw new Error('PDF.js library not loaded');
    }
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.js';

    const loadingTask = pdfjsLib.getDocument({
      url: pdfUrl,
      disableWorker: window.location.protocol === 'file:'
    });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('PDF_TIMEOUT')), 2500)
    );'''

new_worker = '''    if (typeof pdfjsLib === 'undefined') {
      throw new Error('PDF.js library not loaded');
    }
    const isFile = window.location.protocol === 'file:';
    pdfjsLib.GlobalWorkerOptions.workerSrc = isFile ? 'pdf.worker.min.js' : '/pdf.worker.min.js';

    const loadingTask = pdfjsLib.getDocument({
      url: pdfUrl,
      disableWorker: isFile
    });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('PDF_TIMEOUT')), 30000)
    );'''

assert old_worker in content, 'old_worker not found'
content = content.replace(old_worker, new_worker, 1)

# 5. Update PDF.js render fallback catch
old_catch = '''  } catch (err) {
    console.warn('PDF.js render fallback:', err);
    switchDocMode('text');
    toast('Đang hiển thị bản đọc văn bản AI tối ưu tốc độ và độ sắc nét.');
  }'''

new_catch = '''  } catch (err) {
    console.warn('PDF.js render fallback:', err);
    const viewport = document.getElementById('pdfScrollViewport');
    if (viewport && lumiDocMode === 'pdf') {
      viewport.innerHTML = `
        <div style="padding:40px 20px;text-align:center">
          <div style="font-size:32px;margin-bottom:10px">⚠️</div>
          <h3 style="margin:8px 0;font-size:16px;color:var(--text)">Chưa thể hiển thị bản PDF trực tiếp</h3>
          <p style="color:var(--muted);font-size:13px;max-width:420px;margin:8px auto 16px">Tài liệu đang được đồng bộ hoặc kết nối mạng bị chậm. Bạn có thể bấm thử lại hoặc đọc bản trích xuất văn bản AI.</p>
          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
            <button class="btn" style="padding:8px 16px;font-size:13px" onclick="renderPdfDocumentViaPdfJs('${pdfUrl}', ${initialPage})">🔄 Thử tải lại PDF</button>
            <button class="btn secondary" style="padding:8px 16px;font-size:13px" onclick="switchDocMode('text')">${icon('note')} Xem bản đọc văn bản AI</button>
          </div>
        </div>
      `;
    }
  }'''

assert old_catch in content, 'old_catch not found'
content = content.replace(old_catch, new_catch, 1)

# 6. Update openCitation
old_citation = '''openCitation = function (targetPage, ordinal = 1, targetSourceId = null) {
  let targetSrc = null;
  if (targetSourceId) {
    const idx = records.findIndex(r => !r.deleted && (r.id === targetSourceId || r.backendId === targetSourceId || r.title === targetSourceId));
    if (idx >= 0) {
      sourceIndex = idx;
      targetSrc = records[idx];
    }
  }
  targetSrc = targetSrc || records[sourceIndex] || records[0];
  const isVideo = targetSrc?.type === 'VIDEO';
  const isSlide = targetSrc?.type === 'SLIDE' || targetSrc?.type === 'PPTX' || targetSrc?.title?.toLowerCase().endsWith('.pptx');
  const unitName = isVideo ? 'giây' : (isSlide ? 'Slide' : 'Trang');

  const p = targetPage || (isVideo ? (videoTime || 0) : (readerPage || 1)) || 1;

  if (isVideo) {
    videoTime = p;
    currentVideoSource = targetSrc;
    go('video');
    toast(`🔍 Đang hiển thị mốc thời gian ${formatVideoTime(p)} trên bài giảng video "${targetSrc.title}".`);
    return;
  }

  readerTab = 'chat';
  readingView = 'document';
  jumpToPdfPage(p);

  document.querySelectorAll('.citation-ref-btn').forEach(btn => {
    if (btn.textContent.trim() === `[${ordinal}]`) {
      btn.classList.add('citation-active-pulse');
      setTimeout(() => btn.classList.remove('citation-active-pulse'), 2500);
    }
  });

  if (page !== 'reader') go('reader');
  toast(`🔍 Đang hiển thị nguồn trích dẫn [${ordinal}] tại ${unitName} ${p} của "${targetSrc.title}".`);
};'''

new_citation = '''openCitation = function (targetPage, ordinal = 1, targetSourceId = null) {
  let targetSrc = null;
  if (targetSourceId) {
    let idx = records.findIndex(r => !r.deleted && (
      r.id === targetSourceId || 
      r.backendId === targetSourceId || 
      r.title === targetSourceId ||
      r.title.toLowerCase().includes(targetSourceId.toLowerCase())
    ));
    if (idx >= 0) {
      sourceIndex = idx;
      targetSrc = records[idx];
    }
  }
  if (!targetSrc) {
    targetSrc = records[sourceIndex] || records[0];
  }
  const isVideo = targetSrc?.type === 'VIDEO';
  const isSlide = targetSrc?.type === 'SLIDE' || targetSrc?.type === 'PPTX' || targetSrc?.title?.toLowerCase().endsWith('.pptx');
  const unitName = isVideo ? 'giây' : (isSlide ? 'Slide' : 'Trang');

  const p = targetPage || (isVideo ? (videoTime || 0) : (readerPage || 1)) || 1;

  if (isVideo) {
    videoTime = p;
    currentVideoSource = targetSrc;
    go('video');
    toast(`🔍 Đang mở mốc thời gian ${formatVideoTime(p)} trên bài giảng video "${targetSrc.title}".`);
    return;
  }

  readerTab = 'chat';
  readingView = 'document';
  readerPage = p;
  lumiActiveBackendSourceId = targetSrc?.backendId || targetSrc?.id;
  try { localStorage.setItem('lumi-backend-source-id', lumiActiveBackendSourceId); } catch(e) {}
  chatSourceIds = [targetSrc.id];
  persist('lumi-source-page-' + targetSrc.id, p);

  if (page !== 'reader') {
    go('reader');
  } else {
    render();
  }

  setTimeout(() => {
    jumpToPdfPage(p);
    const pageCard = document.getElementById(`doc-page-${p}`);
    if (pageCard) pageCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 100);

  document.querySelectorAll('.citation-ref-btn').forEach(btn => {
    if (btn.textContent.trim() === `[${ordinal}]`) {
      btn.classList.add('citation-active-pulse');
      setTimeout(() => btn.classList.remove('citation-active-pulse'), 2500);
    }
  });

  toast(`🔍 Đang mở ${unitName} ${p} của tài liệu "${targetSrc.title}".`);
};'''

assert old_citation in content, 'old_citation not found'
content = content.replace(old_citation, new_citation, 1)

with open('kltn/frontend/source/api.js', 'w', encoding='utf-8', newline='\r\n') as f:
    f.write(content)

print('Successfully updated api.js!')
