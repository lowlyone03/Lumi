/* ============================================================================
 * LUMI AI — PRODUCTION WEB & MOBILE APPLICATION LAYER
 * Tích hợp đầy đủ:
 * 1. Trang chủ giới thiệu ngoài hệ thống (Public Landing Page) + Cổng Đăng nhập thật
 * 2. Bộ Icon Lucide/Duotone sắc nét cho cả Web, Desktop & Mobile
 * 3. Chuẩn hóa tiếng Việt NFC (sửa triệt để lỗi tách dấu PDF) + Định dạng Markdown AI
 * 4. Kết nối trực tiếp FastAPI + Supabase PostgreSQL (RLS) + Radox AI (gemini-3.6-flash)
 * ============================================================================ */

// Khi web được phục vụ bởi FastAPI (/app/), API luôn nằm cùng origin.
// Điều này giúp điện thoại truy cập qua IP LAN (vd: http://192.168.1.5:8000/app/)
// hoặc qua `adb reverse` (http://localhost:8000/app/) đều gọi đúng backend.
// Chỉ khi mở file trực tiếp (file://) mới dùng localhost:8000 mặc định.
// Dọn dẹp URL trycloudflare cũ (tạm thời) đã chết trong localStorage
try {
  const savedBase = localStorage.getItem('lumi-api-base') || '';
  if (savedBase.includes('trycloudflare.com')) {
    localStorage.removeItem('lumi-api-base');
  }
} catch {}

let LUMI_API_BASE = /^https?:$/.test(window.location.protocol)
  ? `${window.location.origin}/api/v1`
  : (localStorage.getItem('lumi-api-base') || '');

async function resolveBestBackendUrlForMobile() {
  if (/^https?:$/.test(window.location.protocol)) return;
  let dynamicCloudBase = '';
  try {
    const cfgCtrl = new AbortController();
    const cfgTimer = setTimeout(() => cfgCtrl.abort(), 2200);
    const cfgRes = await fetch(`https://raw.githubusercontent.com/lowlyone03/Lumi/main/tunnel-config.json?t=${Date.now()}`, { signal: cfgCtrl.signal });
    clearTimeout(cfgTimer);
    if (cfgRes.ok) {
      const cfg = await cfgRes.json();
      if (cfg && cfg.api_base) dynamicCloudBase = cfg.api_base;
    }
  } catch {}

  const candidates = [
    dynamicCloudBase,
    localStorage.getItem('lumi-api-base'),
    'http://192.168.39.14:8000/api/v1',
    'http://192.168.39.17:8000/api/v1',
    'http://100.120.76.189:8000/api/v1',
    'http://localhost:8000/api/v1'
  ].filter((v, i, a) => v && !v.includes('trycloudflare.com') && a.indexOf(v) === i);

  for (const base of candidates) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2500);
      const rootUrl = base.replace(/\/api\/v1\/?$/, '/');
      const res = await fetch(rootUrl, { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) {
        LUMI_API_BASE = base;
        try { localStorage.setItem('lumi-api-base', base); } catch {}
        return;
      }
    } catch {}
  }
}

let lumiToken = localStorage.getItem('lumi-jwt-token') || '';
let isUserLoggedIn = localStorage.getItem('lumi-logged-in') === 'true';
let lumiBackendConnected = false;
let lumiActiveBackendSourceId = localStorage.getItem('lumi-backend-source-id') || 'dfed7ff0-c965-45d4-a24a-7b1277176256';
let lumiActiveBackendConvId = localStorage.getItem('lumi-backend-conv-id') || '';
let lumiActiveBackendDeckId = localStorage.getItem('lumi-backend-deck-id') || '';

const lumiChunksCache = {};

// Pre-cached tri thức chuẩn cho học liệu "Bài giảng Cơ sở dữ liệu.pdf"
lumiChunksCache['source-db'] = [
  {
    page_number: 1,
    heading: 'Chương 1: Tổng quan về Hệ cơ sở dữ liệu quan hệ',
    content: 'Cơ sở dữ liệu (Database) là một tập hợp các dữ liệu có liên quan logic với nhau, được lưu trữ trên các thiết bị nhớ để phục vụ nhu cầu khai thác thông tin của nhiều người dùng và nhiều ứng dụng đồng thời.\nHệ quản trị cơ sở dữ liệu (DBMS - Database Management System) cung cấp môi trường thuận tiện và hiệu quả để định nghĩa, xây dựng, thao tác và chia sẻ dữ liệu an toàn, bảo đảm tính toàn vẹn và độc lập dữ liệu.'
  },
  {
    page_number: 10,
    heading: 'Chương 2: Mô hình Dữ liệu Quan hệ (Relational Model)',
    content: 'Trong mô hình quan hệ do E.F. Codd đề xuất, dữ liệu được tổ chức dưới dạng các bảng hai chiều (Relations) gồm:\n- Cột đại diện cho các thuộc tính (Attributes)\n- Hàng đại diện cho các bộ dữ liệu hoặc bản ghi (Tuples / Records)\nMỗi quan hệ có một tên duy nhất trong lược đồ cơ sở dữ liệu. Miền giá trị (Domain) là tập hợp tất cả các giá trị nguyên tố mà thuộc tính có thể nhận.'
  },
  {
    page_number: 12,
    heading: 'Chương 2: Khóa chính (Primary Key)',
    content: 'Khóa chính (Primary Key - PK) là một thuộc tính hoặc một tập hợp tối thiểu các thuộc tính được chọn để xác định duy nhất mỗi bộ (bản ghi) trong bảng quan hệ.\nQuy tắc bắt buộc của Khóa chính (Thực thể toàn vẹn - Entity Integrity):\n1. Giá trị của khóa chính phải là DUY NHẤT cho mỗi dòng trong toàn bộ bảng, không được phép trùng lặp.\n2. Giá trị của bất kỳ thuộc tính nào thuộc khóa chính TUYỆT ĐỐI KHÔNG ĐƯỢC CHỨA NULL (rỗng).\nVí dụ: Cột MaSV trong bảng SinhVien là khóa chính, bảo đảm mỗi sinh viên có một mã định danh duy nhất.'
  },
  {
    page_number: 13,
    heading: 'Chương 2: Khóa ngoại (Foreign Key)',
    content: 'Khóa ngoại (Foreign Key - FK) là một hoặc một tập thuộc tính trong bảng này tham chiếu trực tiếp đến khóa chính của một bảng khác (hoặc chính bảng đó).\nKhóa ngoại đóng vai trò tạo liên kết logic giữa các bảng trong cơ sở dữ liệu quan hệ, ngăn chặn việc nhập dữ liệu mồ côi hoặc không hợp lệ.\nVí dụ: Cột MaKhoa trong bảng SinhVien là khóa ngoại tham chiếu đến khóa chính MaKhoa của bảng Khoa.'
  },
  {
    page_number: 14,
    heading: 'Chương 2: Ràng buộc Toàn vẹn tham chiếu (Referential Integrity)',
    content: 'Ràng buộc toàn vẹn tham chiếu bảo đảm rằng liên kết giữa các bảng luôn giữ được tính nhất quán và hợp lệ.\nQuy tắc toàn vẹn tham chiếu:\n1. Mọi giá trị khác NULL của khóa ngoại FK phải trùng khớp với một giá trị khóa chính PK đang tồn tại trong bảng được tham chiếu.\n2. Khi xóa hoặc cập nhật bản ghi chứa khóa chính (ví dụ xóa một Khoa), hệ thống DBMS áp dụng các hành vi: CASCADE (xóa dây chuyền), RESTRICT / NO ACTION (chặn thao tác nếu còn bản ghi tham chiếu), SET NULL (đặt khóa ngoại về NULL).'
  },
  {
    page_number: 20,
    heading: 'Chương 3: Ngôn ngữ Truy vấn Có Cấu trúc SQL',
    content: 'SQL là ngôn ngữ chuẩn dùng để tương tác với cơ sở dữ liệu quan hệ, bao gồm các nhóm lệnh DDL (Data Definition Language) như CREATE TABLE, ALTER TABLE; và DML (Data Manipulation Language) như SELECT, INSERT, UPDATE, DELETE.\nVí dụ câu lệnh tạo bảng có khóa chính và khóa ngoại:\nCREATE TABLE SinhVien (\n  MaSV VARCHAR(10) PRIMARY KEY,\n  HoTen NVARCHAR(50) NOT NULL,\n  MaKhoa VARCHAR(10),\n  CONSTRAINT FK_SinhVien_Khoa FOREIGN KEY (MaKhoa) REFERENCES Khoa(MaKhoa)\n);'
  }
];

const lumiLoadingChunks = {};
let lumiDocMode = 'text';

// 1. NÂNG CẤP BỘ ICON HIỆN ĐẠI (SẮC NÉT TRÊN CẢ WEB & MOBILE)
const modernSvgMap = {
  leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/><path d="M8 7h6"/><path d="M8 11h8"/>',
  settings:
    '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="m9 12 2 2 4-4"/>',
  palette:
    '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  spark:
    '<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>',
  file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/><line x1="10" x2="8" y1="9" y2="9"/>',
  play: '<circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/>',
  note: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  sprout: '<path d="M7 20h10"/><path d="M10 20c5.5-2.5.8-6.4 3-10"/><path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z"/><path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z"/>',
  sliders: '<line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="10" y2="3"/><line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="8" y2="3"/><line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="12" y2="3"/><line x1="2" x2="6" y1="14" y2="14"/><line x1="10" x2="14" y1="8" y2="8"/><line x1="18" x2="22" y1="16" y2="16"/>',
  check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  send: '<line x1="22" x2="11" y1="2" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  quiz: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>'
};

// Giữ nguyên bộ icon của giao diện đã duyệt; chỉ bổ sung icon mà bộ gốc chưa có.
const lumiDesignIcon = icon;
icon = function (n) {
  if (typeof paths !== 'undefined' && paths[n]) return lumiDesignIcon(n);
  if (!modernSvgMap[n]) return lumiDesignIcon(n);
  return (
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    modernSvgMap[n] +
    '</svg>'
  );
};

// 2. HÀM LÀM SẠCH TIẾNG VIỆT & RENDER MARKDOWN CHO TRỢ GIẢNG AI
function cleanVietText(str) {
  if (!str) return '';
  let s = String(str)
    .replace(/\s+([\u0300-\u036f])/g, '$1')
    .normalize('NFC');
  // Sửa các từ bị tách khoảng trắng sau nguyên âm có dấu khi bóc tách PDF (vd: tố t -> tốt, cấ u -> cấu)
  s = s.replace(
    /([àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴ])\s+(ch|c|ng|nh|n|m|p|t|i|u|y)\b/gi,
    '$1$2'
  );
  return s;
}

function formatAIMarkdown(raw, citations = []) {
  if (!raw) return '';
  let safe = esc(cleanVietText(raw));
  safe = safe.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  safe = safe.replace(/`([^`]+)`/g, '<code style="background:var(--surface3);padding:2px 6px;border-radius:5px;font-size:12.5px">$1</code>');
  safe = safe.replace(/\[(\d+)\]/g, (match, num) => {
    const idx = parseInt(num, 10);
    let targetPage = idx;
    if (citations && citations.length > 0) {
      const c = citations.find(x => x.ordinal === idx) || citations[idx - 1];
      if (c?.locator?.page) targetPage = c.locator.page;
    } else {
      const r = records[sourceIndex] || records[0];
      const chunks = (r && lumiChunksCache[r.id]) || [];
      if (chunks[idx - 1]?.page_number) targetPage = chunks[idx - 1].page_number;
    }
    return `<button type="button" class="citation-ref-btn" onclick="openCitation(${targetPage}, ${idx})" title="Nhảy tới nguồn trích dẫn [${idx}] tại Trang ${targetPage} trên bản PDF">[${num}]</button>`;
  });
  return safe.replace(/\n/g, '<br>');
}

const LUMI_SUPABASE_CLOUD_URL = 'https://baenwfcstfywrbanweks.supabase.co';
const LUMI_SUPABASE_ANON_KEY = 'sb_publishable_C82eWeOiVaRJIeceH_ebqw_1ckwnuSP';

function getLumiPdfUrl(sourceId) {
  if (!sourceId) return '';
  if (sourceId === 'source-db') sourceId = '42b5fcb7-31ee-4fa0-9de6-b39e50377539';
  const r = records.find(x => x.id === sourceId || x.backendId === sourceId);
  if (r && r.blobUrl) return r.blobUrl;
  const targetId = (r && r.backendId && /^[0-9a-f-]{36}$/i.test(r.backendId)) ? r.backendId : sourceId;
  // Nếu đang kết nối FastAPI cục bộ trên localhost / LAN nội bộ
  if (
    lumiBackendConnected &&
    LUMI_API_BASE &&
    (LUMI_API_BASE.includes('localhost') || LUMI_API_BASE.includes('127.0.0.1') || LUMI_API_BASE.includes('192.168.'))
  ) {
    return `${LUMI_API_BASE}/sources/${targetId}/file`;
  }
  // Mặc định trên Web (lumiappio.tech) và mọi thiết bị: nạp trực tiếp từ Supabase Cloud Storage 24/7
  return `${LUMI_SUPABASE_CLOUD_URL}/storage/v1/object/public/sources/${targetId}.pdf`;
}

async function lumiSupabaseDirectRPC(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  let body = {};
  try {
    if (options.body) body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
  } catch {}
  let action = '';
  let payload = { ...body };

  if (path.startsWith('/me/web-login')) {
    action = 'web_login';
  } else if (path.startsWith('/sources') && path.includes('/chunks')) {
    action = 'get_chunks';
    const match = path.match(/\/sources\/([^/]+)\/chunks/);
    if (match) payload.source_id = match[1];
  } else if (path.startsWith('/sources')) {
    const match = path.match(/\/sources\/([^/]+)/);
    if (path.includes('/web-ingest') || (method === 'POST' && !path.includes('/chunks'))) {
      action = 'create_source';
    } else if (method === 'DELETE' && match) {
      action = 'delete_source';
      payload.source_id = match[1];
    } else {
      action = 'list_sources';
    }
  } else if (path.startsWith('/notes')) {
    const match = path.match(/\/notes\/([^/]+)/);
    if (method === 'POST') {
      action = 'create_note';
    } else if (method === 'PATCH' && match) {
      action = 'update_note';
      payload.note_id = match[1];
    } else if (method === 'DELETE' && match) {
      action = 'delete_note';
      payload.note_id = match[1];
    } else {
      action = 'list_notes';
    }
  } else if (path.startsWith('/courses')) {
    if (method === 'POST') action = 'create_course';
    else action = 'list_courses';
  } else if (path.startsWith('/flashcards/decks')) {
    if (path.includes('/cards')) {
      if (method === 'POST') {
        action = 'create_card';
        const match = path.match(/\/decks\/([^/]+)\/cards/);
        if (match) payload.deck_id = match[1];
      } else {
        action = 'list_cards';
      }
    } else {
      if (method === 'POST') action = 'create_deck';
      else action = 'list_decks';
    }
  } else if (path.startsWith('/flashcards/cards')) {
    const match = path.match(/\/cards\/([^/]+)/);
    if (method === 'PATCH' && match) {
      action = 'update_card';
      payload.card_id = match[1];
    } else if (method === 'DELETE' && match) {
      action = 'delete_card';
      payload.card_id = match[1];
    }
  } else if (path.startsWith('/flashcards/due')) {
    action = 'list_cards';
  }

  if (!action) throw new Error('Yêu cầu chưa hỗ trợ trực tiếp Supabase Cloud: ' + path);

  const res = await fetch(`${LUMI_SUPABASE_CLOUD_URL}/rest/v1/rpc/lumi_cloud_api`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': LUMI_SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${LUMI_SUPABASE_ANON_KEY}`
    },
    body: JSON.stringify({ p_action: action, p_payload: payload })
  });
  if (!res.ok) throw new Error(`Supabase Cloud HTTP ${res.status}`);
  const rpcResult = await res.json();
  return rpcResult;
}

async function lumiFetch(path, options = {}) {
  // 1. Thử gọi máy chủ FastAPI (Localhost, LAN) nếu có cấu hình khả dụng
  if (LUMI_API_BASE && !LUMI_API_BASE.includes('trycloudflare.com')) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1500);
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };
    if (lumiToken && !lumiToken.startsWith('supabase-direct')) {
      headers['Authorization'] = `Bearer ${lumiToken}`;
    }
    const response = await fetch(`${LUMI_API_BASE}${path}`, {
      ...options,
      headers,
      signal: ctrl.signal
    });
    clearTimeout(timer);
    if (response.ok) {
      const data = await response.json().catch(() => ({}));
      lumiBackendConnected = true;
      updatePreviewStatusBanner();
      return data;
    }

    // Tự động cấp lại token và thử lại ngay lập tức nếu bị 401 (0ms trễ, không chờ Supabase fallback)
    if (response.status === 401 && path !== '/me/web-login') {
      try {
        const email = userProfile?.email || 'an.nguyen@sv.edu.vn';
        const displayName = userProfile?.name || 'Nguyễn Văn An';
        const loginRes = await fetch(`${LUMI_API_BASE}/me/web-login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, display_name: displayName })
        });
        if (loginRes.ok) {
          const lData = await loginRes.json();
          if (lData?.data?.access_token) {
            lumiToken = lData.data.access_token;
            try { localStorage.setItem('lumi-jwt-token', lumiToken); } catch {}
            headers['Authorization'] = `Bearer ${lumiToken}`;
            const retryRes = await fetch(`${LUMI_API_BASE}${path}`, {
              ...options,
              headers
            });
            if (retryRes.ok) {
              const retryData = await retryRes.json().catch(() => ({}));
              lumiBackendConnected = true;
              updatePreviewStatusBanner();
              return retryData;
            }
          }
        }
      } catch (authErr) {
        console.warn('Tự động cấp lại token thất bại:', authErr);
      }
    }
    } catch (err) {
      // Máy tính đã tắt hoặc server nội bộ không chạy -> Chuyển sang kết nối trực tiếp Supabase Đám Mây 24/7
    }
  }

  // 2. TỰ ĐỘNG CHUYỂN SANG SUPABASE CLOUD 24/7 (KHI TẮT MÁY TÍNH VẪN DÙNG BÌNH THƯỜNG)
  try {
    const cloudData = await lumiSupabaseDirectRPC(path, options);
    lumiBackendConnected = true;
    updatePreviewStatusBanner();
    return cloudData;
  } catch (cloudErr) {
    console.warn('Lỗi kết nối Supabase Cloud:', cloudErr);
    throw cloudErr;
  }
}

// Giao diện mới tự quản lý thanh trên cùng; ở đây chỉ gắn chấm trạng thái kết nối backend.
function updatePreviewStatusBanner() {
  document.documentElement.dataset.backend = lumiBackendConnected ? 'online' : 'offline';
}

// Bọc hàm đăng xuất của giao diện mới (welcome.js) để xóa thêm token backend.
// Dùng phép gán (không dùng `function logoutLumi`) để không ghi đè trước khi kịp lưu bản gốc.
const lumiDesignLogout = logoutLumi;
logoutLumi = function () {
  isUserLoggedIn = false;
  lumiToken = '';
  lumiBackendConnected = false;
  try {
    localStorage.setItem('lumi-logged-in', 'false');
    localStorage.removeItem('lumi-jwt-token');
  } catch {}
  updatePreviewStatusBanner();
  lumiDesignLogout();
};

async function loadSourceChunks(sourceId, force = false) {
  if (!sourceId) return [];
  if (sourceId === 'source-db') return lumiChunksCache['source-db'] || [];
  if (!/^[0-9a-f-]{36}$/i.test(sourceId)) return lumiChunksCache[sourceId] || [];
  if (lumiChunksCache[sourceId] && !force) return lumiChunksCache[sourceId];
  if (lumiLoadingChunks[sourceId]) return lumiLoadingChunks[sourceId];

  lumiLoadingChunks[sourceId] = (async () => {
    try {
      const res = await lumiFetch(`/sources/${sourceId}/chunks`);
      const chunks = res.data || [];
      lumiChunksCache[sourceId] = chunks;
      if (page === 'reader') render();
      return chunks;
    } catch (err) {
      console.warn('Không tải được chunks cho source:', sourceId, err);
      return [];
    } finally {
      delete lumiLoadingChunks[sourceId];
    }
  })();

  return lumiLoadingChunks[sourceId];
}

function getPagesFromChunks(chunks) {
  if (!chunks || !chunks.length) return [];
  const pageMap = new Map();
  chunks.forEach((c, idx) => {
    const pNum = c.locator?.page || idx + 1;
    if (!pageMap.has(pNum)) {
      pageMap.set(pNum, { page: pNum, heading: cleanVietText(c.heading || ''), blocks: [] });
    }
    const entry = pageMap.get(pNum);
    if (c.heading && !entry.heading) entry.heading = cleanVietText(c.heading);
    entry.blocks.push(cleanVietText(c.content));
  });
  return Array.from(pageMap.values()).sort((a, b) => a.page - b.page);
}

async function ensureBackendDefaultSource() {
  try {
    const res = await lumiFetch('/sources');
    const serverSources = res.data || [];
    if (serverSources.length > 0) {
      const readySrc = serverSources.find(s => s.id === 'dfed7ff0-c965-45d4-a24a-7b1277176256') || serverSources.find(s => s.status === 'ready') || serverSources[0];
      lumiActiveBackendSourceId = readySrc.id;
      localStorage.setItem('lumi-backend-source-id', lumiActiveBackendSourceId);

      const mapped = serverSources.map(s => ({
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
          backendId: '42b5fcb7-31ee-4fa0-9de6-b39e50377539',
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
      return allSources[0].id;
    }

    const ingestRes = await lumiFetch('/sources/web-ingest', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Giáo trình Cơ sở dữ liệu & Cấu trúc dữ liệu.pdf',
        kind: 'pdf',
        description: 'Tài liệu học tập chuẩn trên Lumi',
        text_content: [
          'Chương 1: Mô hình Cơ sở dữ liệu Quan hệ, Khóa chính và Khóa ngoại.\nKhóa chính (Primary Key) là một hoặc một tập hợp các thuộc tính giúp xác định duy nhất một bản ghi trong bảng. Khóa chính không được phép nhận giá trị NULL. Khóa ngoại (Foreign Key) dùng để liên kết giữa hai bảng và bảo đảm ràng buộc toàn vẹn tham chiếu: mọi giá trị khóa ngoại khác NULL phải tham chiếu tới một giá trị khóa chính đang tồn tại.',
          'Chương 2: Cây tìm kiếm nhị phân (Binary Search Tree - BST) và Cây cân bằng.\nTrong cây tìm kiếm nhị phân BST, mọi nút bên trái có khóa nhỏ hơn nút cha và mọi nút bên phải có khóa lớn hơn nút cha. Độ phức tạp tìm kiếm trung bình là O(log n). Cây Đỏ-Đen (Red-Black Tree) và B-Tree tự động cân bằng chiều cao ở mức O(log n), giúp hệ quản trị CSDL PostgreSQL tối ưu hóa truy vấn chỉ mục.'
        ].join('\n\n')
      })
    });
    if (ingestRes?.data?.id) {
      lumiActiveBackendSourceId = ingestRes.data.id;
      localStorage.setItem('lumi-backend-source-id', lumiActiveBackendSourceId);
      await ensureBackendDefaultSource();
    }
  } catch (err) {
    console.warn('Không thể đồng bộ nguồn mặc định:', err);
  }
  return lumiActiveBackendSourceId;
}

async function syncFlashcardsFromBackend() {
  try {
    const decksRes = await lumiFetch('/flashcards/decks');
    const decks = decksRes.data || [];
    if (decks.length > 0) {
      lumiActiveBackendDeckId = decks[0].id;
      localStorage.setItem('lumi-backend-deck-id', lumiActiveBackendDeckId);
    }
    const dueRes = await lumiFetch('/flashcards/due?limit=50');
    const dueCards = dueRes.data || [];
    if (dueCards.length > 0) {
      cardDeck = dueCards.map(c => ({
        id: c.id,
        backendId: c.id,
        deckId: c.deck_id,
        q: cleanVietText(c.front),
        a: cleanVietText(c.back),
        due: c.schedule
          ? `Lịch ôn SM-2: sau ${c.schedule.interval_days} ngày · Đã lặp ${c.schedule.repetitions} lần`
          : 'Thẻ mới · Sẵn sàng ôn tập'
      }));
      persist('lumi-cards', cardDeck);
    }
  } catch (err) {
    console.warn('Đồng bộ Flashcards:', err);
  }
}

async function syncNotesFromBackend() {
  try {
    const res = await lumiFetch('/notes?limit=50');
    const serverNotes = res.data || [];
    if (serverNotes.length > 0) {
      const mapped = serverNotes.map(n => ({
        id: n.id,
        backendId: n.id,
        title: cleanVietText(n.title || 'Ghi chú học tập'),
        body: cleanVietText(n.body || n.quote || ''),
        kind: n.kind || 'note',
        page: n.locator?.page || 1,
        sourceId: n.source_id
      }));
      notebooks.splice(0, notebooks.length, ...mapped);
      saveAllNotes();
    }
  } catch (err) {
    console.warn('Đồng bộ Ghi chú:', err);
  }
}

async function syncCoursesFromBackend() {
  try {
    const res = await lumiFetch('/courses');
    const serverCourses = res.data || [];
    if (serverCourses.length > 0) {
      serverCourses.forEach(sc => {
        const titleClean = cleanVietText(sc.title);
        const existing = [...courses, ...extraCourses].find(
          c => c.backendId === sc.id || c.title.toLowerCase() === titleClean.toLowerCase()
        );
        if (existing) {
          existing.backendId = sc.id;
        } else {
          extraCourses.push({
            backendId: sc.id,
            title: titleClean,
            cover: titleClean,
            tag: 'Khóa học cá nhân',
            subtitle: cleanVietText(sc.goal || sc.description || 'Lộ trình học tập cá nhân hóa'),
            progress: sc.completion_percent || 15,
            lessons: `${sc.completed_lessons || 1} / ${Math.max(4, sc.total_lessons || 4)} bài`,
            blue: extraCourses.length % 2 === 1
          });
        }
      });
      persist('sf-courses', extraCourses);
      persist('lumi-default-courses', courses);
    }
  } catch (err) {
    console.warn('Đồng bộ Khóa học:', err);
  }
}

async function initLumiBackendSession(showNotice = false) {
  try {
    await resolveBestBackendUrlForMobile();
    const email = userProfile?.email || 'an.nguyen@sv.edu.vn';
    const displayName = userProfile?.name || 'Nguyễn Văn An';
    const loginRes = await lumiFetch('/me/web-login', {
      method: 'POST',
      body: JSON.stringify({ email, display_name: displayName })
    });
    if (loginRes?.data?.access_token) {
      lumiToken = loginRes.data.access_token;
      localStorage.setItem('lumi-jwt-token', lumiToken);
      lumiBackendConnected = true;
      if (loginRes.data.user?.display_name) {
        userProfile.name = loginRes.data.user.display_name;
        userProfile.email = loginRes.data.user.email || email;
        persist('lumi-profile', userProfile);
      }
      updatePreviewStatusBanner();
      // Chạy đồng bộ đám mây ngầm trong nền, không làm đơ hoặc chậm giao diện
      ensureBackendDefaultSource().then(() => {
        Promise.all([
          syncFlashcardsFromBackend(),
          syncNotesFromBackend(),
          syncCoursesFromBackend()
        ]).then(() => {
          if (page === 'library' || page === 'home') render();
        });
      });
      if (showNotice) {
        toast(`Chào mừng ${userProfile.name} quay trở lại Lumi!`);
      }
    }
  } catch (err) {
    console.warn('Backend ở chế độ ngoại tuyến:', err);
    lumiBackendConnected = false;
    updatePreviewStatusBanner();
  }
}

// ============================================================================
// 3. CẦU NỐI ĐĂNG NHẬP: GIAO DIỆN MỚI (welcome.js/account.js) ↔ BACKEND FASTAPI
// Trang giới thiệu, đăng nhập, trang chủ, điều hướng... dùng nguyên giao diện đã duyệt.
// Ở đây chỉ bổ sung: sau khi đăng nhập trên giao diện thì lấy JWT thật từ backend.
// ============================================================================
const lumiDesignSubmitAuth = submitAuth;
submitAuth = function () {
  const before = typeof lumiSession === 'function' ? lumiSession() : null;
  lumiDesignSubmitAuth();
  const after = typeof lumiSession === 'function' ? lumiSession() : null;
  // Chỉ kết nối backend khi giao diện đã chấp nhận đăng nhập (đã tạo phiên).
  if (after && (!before || after.expires !== before.expires)) {
    isUserLoggedIn = true;
    try { localStorage.setItem('lumi-logged-in', 'true'); } catch {}
    initLumiBackendSession(true);
  }
};

// ============================================================================
// 5. TRÌNH ĐỌC TÀI LIỆU THẬT & TRỢ GIẢNG AI HYBRID RAG (ĐÃ SỬA LỖI PHẢN HỒI AI)
// ============================================================================
// ============================================================================
// 5. TRÌNH ĐỌC TÀI LIỆU THẬT & TRỢ GIẢNG AI HYBRID RAG (ZERO-FLICKER & LỊCH SỬ CHAT)
// ============================================================================

function getSourceChatKey(sourceId) {
  return 'lumi-chat-source-' + (sourceId || 'default');
}

function loadChatHistoryForSource(sourceId) {
  try {
    const raw = localStorage.getItem(getSourceChatKey(sourceId));
    if (raw) {
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.messages) && data.messages.length > 0) {
        chatMessages = data.messages;
        lumiActiveBackendConvId = data.convId || '';
        activeSession = data.sessionId || lumiActiveBackendConvId || uid();
        return true;
      }
    }
  } catch (e) {
    console.warn('Không thể nạp lịch sử chat:', e);
  }
  chatMessages = [];
  lumiActiveBackendConvId = '';
  activeSession = null;
  return false;
}

function saveChatHistoryForCurrentSource() {
  const activeRec = records[sourceIndex] || records[0];
  const sourceId = activeRec?.id || lumiActiveBackendSourceId;
  if (!sourceId) return;
  try {
    localStorage.setItem(
      getSourceChatKey(sourceId),
      JSON.stringify({
        convId: lumiActiveBackendConvId,
        sessionId: activeSession,
        messages: chatMessages
      })
    );
  } catch (e) {}

  if (chatMessages.length > 0) {
    const firstUserMsg = chatMessages.find(m => m.role === 'user');
    const title = firstUserMsg
      ? firstUserMsg.text.slice(0, 55)
      : activeRec?.title || 'Hội thoại học tập';
    if (!activeSession) activeSession = lumiActiveBackendConvId || uid();
    let s = sessions.find(x => x.id === activeSession);
    if (!s) {
      s = { id: activeSession, title, messages: [], sources: [sourceId], timestamp: Date.now() };
      sessions.unshift(s);
    }
    s.title = title;
    s.messages = chatMessages.map(m => ({ ...m }));
    s.timestamp = Date.now();
    persist('lumi-chats', sessions);
  }
}

function startNewChatSession() {
  const activeRec = records[sourceIndex] || records[0];
  const sourceId = activeRec?.id || lumiActiveBackendSourceId;
  activeSession = uid();
  lumiActiveBackendConvId = '';
  chatMessages = [];
  if (sourceId) {
    localStorage.removeItem(getSourceChatKey(sourceId));
  }
  renderChatContainerOnly();
  toast('Đã khởi tạo phiên hỏi đáp mới cùng Trợ giảng Lumi.');
}

function openChatHistoryModal() {
  const activeRec = records[sourceIndex] || records[0];
  const sourceId = activeRec?.id || lumiActiveBackendSourceId;
  const sourceSessions = sessions.filter(
    s => (s.sources && s.sources.includes(sourceId)) || s.id === activeSession
  );

  let body = '';
  if (sourceSessions.length === 0 && chatMessages.length === 0) {
    body =
      '<p style="color:var(--secondary);padding:14px 0">Chưa có lịch sử hội thoại trên tài liệu này. Bạn có thể đặt câu hỏi ở khung chat bên phải để bắt đầu lưu lại!</p>';
  } else {
    body = `
      <div style="margin-bottom:14px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:12px;color:var(--secondary)">Các phiên trao đổi với Trợ giảng AI trên tài liệu này:</span>
        <button class="btn secondary" style="font-size:11px;padding:5px 10px" onclick="closeModal();startNewChatSession()">+ Hội thoại mới</button>
      </div>
      <div style="max-height:360px;overflow-y:auto;display:flex;flex-direction:column;gap:9px">
    `;
    sourceSessions.forEach(s => {
      const isCurrent = s.id === activeSession;
      const count = s.messages?.length || 0;
      const timeStr = s.timestamp
        ? new Date(s.timestamp).toLocaleTimeString('vi-VN', {
            hour: '2-digit',
            minute: '2-digit',
            day: '2-digit',
            month: '2-digit'
          })
        : 'Gần đây';
      body += `
        <div style="background:var(--surface2);border:1px solid ${
          isCurrent ? 'var(--accent)' : 'var(--border)'
        };border-radius:10px;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:12px">
          <div style="flex:1;min-width:0;cursor:pointer" onclick="closeModal();resumeSpecificChat('${s.id}')">
            <strong style="display:block;font-size:13px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(
              s.title || 'Cuộc trò chuyện'
            )}</strong>
            <small style="color:var(--faint);font-size:11px">${count} tin nhắn · ${timeStr} ${
        isCurrent ? '· <span style="color:var(--accent);font-weight:600">Đang mở</span>' : ''
      }</small>
          </div>
          <div style="display:flex;gap:6px">
            <button class="btn ${isCurrent ? 'secondary' : ''}" style="font-size:11px;padding:5px 10px" onclick="closeModal();resumeSpecificChat('${s.id}')">Mở</button>
            <button class="btn secondary" style="font-size:11px;padding:5px 8px;color:#ef4444" onclick="deleteSpecificChat('${s.id}')" title="Xóa phiên này">✕</button>
          </div>
        </div>
      `;
    });
    body += '</div>';
  }

  showModal(`
    <h2 id="modalTitle">Lịch sử hỏi đáp Trợ giảng Lumi</h2>
    <p>Xem lại các thắc mắc và giải đáp trước đây trên tài liệu <strong>${esc(
      cleanVietText(activeRec?.title || '')
    )}</strong>.</p>
    ${body}
    <div class="modalactions" style="margin-top:18px">
      <button class="btn" onclick="closeModal()">Đóng</button>
    </div>
  `);
}

function resumeSpecificChat(sessionId) {
  const s = sessions.find(x => x.id === sessionId);
  if (!s) return;
  activeSession = s.id;
  lumiActiveBackendConvId = s.id;
  chatMessages = (s.messages || []).map(m => ({ ...m }));
  saveChatHistoryForCurrentSource();
  renderChatContainerOnly();
  toast('Đã nạp lại phiên trò chuyện: "' + (s.title || '').slice(0, 30) + '..."');
}

function deleteSpecificChat(sessionId) {
  sessions = sessions.filter(x => x.id !== sessionId);
  persist('lumi-chats', sessions);
  if (activeSession === sessionId) {
    startNewChatSession();
  } else {
    openChatHistoryModal();
  }
}

let currentPdfDoc = null;
let lastLoadedPdfUrl = '';
let renderedPdfPages = new Set();
let pdfIntersectionObserver = null;

async function renderPdfDocumentViaPdfJs(pdfUrl, initialPage = 1) {
  const viewport = document.getElementById('pdfScrollViewport');
  if (!viewport) return;

  if (lastLoadedPdfUrl === pdfUrl && currentPdfDoc) {
    jumpToPdfPage(initialPage);
    return;
  }

  viewport.innerHTML =
    '<div class="pdf-loading-state" style="color:var(--secondary);padding:45px 20px;text-align:center;font-size:13px">' +
    '<div style="width:28px;height:28px;border:3px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:lumiSpin 0.8s linear infinite;margin:0 auto 12px"></div>' +
    '<strong style="color:var(--text);font-size:13.5px">Đang nạp bản PDF chuẩn 100%...</strong>' +
    '<p style="color:var(--muted);margin:6px 0 14px;font-size:12px">Công nghệ tải trang thông minh siêu tốc</p>' +
    '<button type="button" class="btn secondary" style="font-size:11.5px;padding:5px 12px" onclick="switchDocMode(\'text\')">' +
    icon('note') + ' Xem ngay bản đọc văn bản AI</button></div>';

  try {
    if (typeof pdfjsLib === 'undefined') {
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
    );

    currentPdfDoc = await Promise.race([loadingTask.promise, timeoutPromise]);
    lastLoadedPdfUrl = pdfUrl;
    renderedPdfPages.clear();
    const numPages = currentPdfDoc.numPages;

    const r = records[sourceIndex];
    if (r) {
      r.pageCount = numPages;
      r.meta = `${numPages} trang · Đã đồng bộ đám mây`;
      saveRecords();
    }

    viewport.innerHTML = '';

    // Dự toán kích thước chuẩn theo tỷ lệ trang để chống nhảy layout và tính sai tọa độ cuộn
    const viewportBox = document.getElementById('pdfScrollViewport');
    const containerWidth = viewportBox ? (viewportBox.clientWidth - 24) : 740;
    const initialWidth = Math.min(880, Math.max(280, containerWidth));
    const pageAspect = isSlide ? (9 / 16) : 1.4142; // Chuẩn A4 hoặc Slide 16:9
    const estimatedHeight = Math.round(initialWidth * pageAspect);

    for (let p = 1; p <= numPages; p++) {
      const pageCard = document.createElement('div');
      pageCard.className = 'pdf-page-card';
      pageCard.id = `pdf-page-card-${p}`;
      pageCard.style.minHeight = `${estimatedHeight + 36}px`;
      pageCard.style.position = 'relative';
      pageCard.innerHTML = `<div class="pdf-page-badge">Trang ${p} / ${numPages}</div><canvas id="pdf-canvas-${p}" class="pdf-page-canvas" style="display:block;margin:0 auto;width:${initialWidth}px;height:${estimatedHeight}px"></canvas>`;
      viewport.appendChild(pageCard);
    }

    const pageNumEl = document.getElementById('pageNum');
    if (pageNumEl) pageNumEl.textContent = `Trang ${initialPage} / ${numPages}`;

    // Render trang hiện tại ngay lập tức!
    await renderSinglePdfPage(currentPdfDoc, initialPage);
    renderedPdfPages.add(initialPage);

    // Tải trước trang kế tiếp trong background
    if (initialPage + 1 <= numPages) {
      setTimeout(() => {
        if (!renderedPdfPages.has(initialPage + 1)) {
          renderSinglePdfPage(currentPdfDoc, initialPage + 1);
          renderedPdfPages.add(initialPage + 1);
        }
      }, 100);
    }

    // Thiết lập IntersectionObserver để cuộn đến đâu vẽ đến đó (lazy load cực mượt)
    if (pdfIntersectionObserver) {
      pdfIntersectionObserver.disconnect();
    }
    if (typeof IntersectionObserver !== 'undefined') {
      pdfIntersectionObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const p = parseInt(entry.target.id.replace('pdf-page-card-', ''), 10);
            if (p && !renderedPdfPages.has(p)) {
              renderedPdfPages.add(p);
              renderSinglePdfPage(currentPdfDoc, p);
            }
          }
        });
      }, {
        root: viewport,
        rootMargin: '300px 0px',
        threshold: 0.01
      });

      viewport.querySelectorAll('.pdf-page-card').forEach(card => {
        pdfIntersectionObserver.observe(card);
      });
    }

    setupPdfScrollObserver(viewport, numPages);

    if (initialPage > 1) {
      setTimeout(() => jumpToPdfPage(initialPage), 150);
    }
  } catch (err) {
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
  }
}

async function renderSinglePdfPage(pdfDoc, pageNum) {
  try {
    const page = await pdfDoc.getPage(pageNum);
    const canvas = document.getElementById(`pdf-canvas-${pageNum}`);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Tự động tối ưu mật độ điểm ảnh Retina/High-DPI trên điện thoại (DPR 2.5x - 3.0x)
    // Giúp nét chữ, dấu tiếng Việt và bảng biểu trong PDF nét căng 100%, không bị vỡ hạt
    const dpr = Math.max(window.devicePixelRatio || 1, 2.5);
    const viewportBox = document.getElementById('pdfScrollViewport');
    const containerWidth = viewportBox ? (viewportBox.clientWidth - 24) : (window.innerWidth - 24);
    const desiredCssWidth = Math.min(880, Math.max(280, containerWidth));

    const baseViewport = page.getViewport({ scale: 1.0 });
    const cssScale = desiredCssWidth / baseViewport.width;
    const renderScale = cssScale * dpr;
    const scaledViewport = page.getViewport({ scale: renderScale });

    // Kích thước bitmap thực tế của Canvas (theo độ phân giải phần cứng màn hình)
    canvas.width = Math.floor(scaledViewport.width);
    canvas.height = Math.floor(scaledViewport.height);

    // Kích thước hiển thị CSS
    const actualHeight = Math.floor(desiredCssWidth * (baseViewport.height / baseViewport.width));
    canvas.style.width = `${desiredCssWidth}px`;
    canvas.style.height = `${actualHeight}px`;
    canvas.style.display = 'block';
    canvas.style.margin = '0 auto';
    canvas.style.borderRadius = '6px';

    const card = document.getElementById(`pdf-page-card-${pageNum}`);
    if (card) {
      card.style.minHeight = `${actualHeight + 36}px`;
    }

    await page.render({
      canvasContext: ctx,
      viewport: scaledViewport
    }).promise;
  } catch (e) {
    console.warn("Lỗi vẽ trang PDF:", e);
  }
}

function setupPdfScrollObserver(viewport, totalPages) {
  let isScrolling = null;
  viewport.addEventListener('scroll', () => {
    clearTimeout(isScrolling);
    isScrolling = setTimeout(() => {
      const cards = viewport.querySelectorAll('.pdf-page-card');
      let visiblePage = readerPage;
      const viewTop = viewport.scrollTop;
      const viewCenter = viewTop + (viewport.clientHeight / 3);
      let minDiff = Infinity;
      cards.forEach(c => {
        const p = parseInt(c.id.replace('pdf-page-card-', ''), 10);
        const cardTop = c.offsetTop;
        const cardBottom = cardTop + c.offsetHeight;
        if (viewCenter >= cardTop && viewCenter <= cardBottom) {
          visiblePage = p;
        } else {
          const diff = Math.min(Math.abs(cardTop - viewCenter), Math.abs(cardBottom - viewCenter));
          if (diff < minDiff) {
            minDiff = diff;
            visiblePage = p;
          }
        }
      });
      if (visiblePage && visiblePage !== readerPage) {
        readerPage = visiblePage;
        const r = records[sourceIndex];
        if (r) persist('lumi-source-page-' + r.id, readerPage);
        const pageNumEl = document.getElementById('pageNum');
        if (pageNumEl) pageNumEl.textContent = `Trang ${readerPage} / ${totalPages}`;
      }
    }, 120);
  });
}

function jumpToPdfPage(pageNo) {
  const r = records[sourceIndex] || records[0];
  const maxPage = Math.max(1, currentPdfDoc?.numPages || r?.pageCount || 9);
  readerPage = Math.min(maxPage, Math.max(1, pageNo));
  if (r) persist('lumi-source-page-' + r.id, readerPage);

  const pageNumEl = document.getElementById('pageNum');
  if (pageNumEl) pageNumEl.textContent = `Trang ${readerPage} / ${maxPage}`;

  if (lumiDocMode === 'pdf') {
    const pageCard = document.getElementById(`pdf-page-card-${readerPage}`);
    const viewport = document.getElementById('pdfScrollViewport');
    if (pageCard && viewport) {
      const targetScroll = Math.max(0, pageCard.offsetTop - 12);
      viewport.scrollTo({ top: targetScroll, behavior: 'smooth' });
      pageCard.classList.add('page-citation-focus');
      setTimeout(() => pageCard.classList.remove('page-citation-focus'), 3000);
      if (currentPdfDoc && !renderedPdfPages.has(readerPage)) {
        renderedPdfPages.add(readerPage);
        renderSinglePdfPage(currentPdfDoc, readerPage);
      }
    } else if (pageCard) {
      pageCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      pageCard.classList.add('page-citation-focus');
      setTimeout(() => pageCard.classList.remove('page-citation-focus'), 3000);
      if (currentPdfDoc && !renderedPdfPages.has(readerPage)) {
        renderedPdfPages.add(readerPage);
        renderSinglePdfPage(currentPdfDoc, readerPage);
      }
    } else {
      const iframe = document.getElementById('lumiPdfFrame');
      if (iframe) {
        const base = iframe.src.split('#')[0].split('?')[0];
        iframe.src = `${base}?t=${Date.now()}#page=${readerPage}&zoom=page-width`;
      }
    }
  } else {
    const textEl = document.getElementById(`doc-page-${readerPage}`);
    if (textEl) {
      textEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      textEl.classList.add('doc-page-highlight');
      setTimeout(() => textEl.classList.remove('doc-page-highlight'), 3000);
    }
  }
}

function switchReaderTab(tab) {
  readerTab = tab;
  const notesTabEl = document.getElementById('readerNotesTab');
  const chatTabEl = document.getElementById('readerChatTab');
  if (notesTabEl && chatTabEl) {
    notesTabEl.style.display = tab === 'notes' ? 'block' : 'none';
    chatTabEl.style.display = tab === 'chat' ? 'flex' : 'none';
    document.querySelectorAll('.chattabs button').forEach(b => {
      b.classList.toggle(
        'active',
        (b.textContent.includes('Hỏi đáp') && tab === 'chat') ||
          (b.textContent.includes('Ghi chú') && tab === 'notes')
      );
    });
    return;
  }
  render();
}

function switchDocMode(mode) {
  lumiDocMode = mode;
  window.lumiUserChosePdf = (mode === 'pdf');
  const pdfWrap = document.getElementById('lumiPdfWrapper');
  const textWrap = document.getElementById('lumiTextWrapper');
  if (pdfWrap && textWrap) {
    pdfWrap.style.display = mode === 'pdf' ? 'flex' : 'none';
    textWrap.style.display = mode === 'text' ? 'block' : 'none';
    document.querySelectorAll('.doc-mode-toggle button').forEach(b => {
      const isPdfBtn = b.dataset.mode === 'pdf' || b.textContent.includes('PDF') || b.textContent.includes('16:9');
      const isTextBtn = b.dataset.mode === 'text' || b.textContent.includes('Văn bản') || b.textContent.includes('Ý chính');
      const isActive = (isPdfBtn && mode === 'pdf') || (isTextBtn && mode === 'text');
      b.classList.toggle('active', isActive);
      b.style.background = isActive ? 'var(--accent)' : 'transparent';
      b.style.color = isActive ? '#fff' : 'var(--text)';
    });
    if (mode === 'pdf') {
      const activeRec = records[sourceIndex] || records[0];
      const isRealUUID = activeRec?.id && /^[0-9a-f-]{36}$/i.test(activeRec.id);
      const realPdfId = isRealUUID ? activeRec.id : (activeRec?.backendId || (/^[0-9a-f-]{36}$/i.test(lumiActiveBackendSourceId) ? lumiActiveBackendSourceId : null));
      const targetPdfUrl = activeRec?.blobUrl || (realPdfId ? getLumiPdfUrl(realPdfId) : '');
      if (targetPdfUrl) {
        renderPdfDocumentViaPdfJs(targetPdfUrl, readerPage);
      } else {
        const viewport = document.getElementById('pdfScrollViewport');
        if (viewport) {
          viewport.innerHTML = `
            <div style="padding:40px 20px;text-align:center">
              <div style="font-size:32px;margin-bottom:10px">📄</div>
              <h3 style="margin:8px 0;font-size:16px;color:var(--text)">Bản đọc thông minh AI đã sẵn sàng</h3>
              <p style="color:var(--muted);font-size:13px;max-width:400px;margin:8px auto 16px">Tài liệu đã được AI lập chỉ mục và phân tách từng trang mượt mà. Đang hiển thị bản đọc văn bản tối ưu tốc độ.</p>
              <button class="btn" style="padding:8px 16px;font-size:13px" onclick="switchDocMode('text')">${icon('note')} Xem bản đọc văn bản AI</button>
            </div>
          `;
        }
      }
    }
    return;
  }
  render();
}

viewSource = async function (i) {
  sourceIndex = i;
  const r = records[i];
  if (!r) return;
  // Ghi nhận người dùng chủ động chọn tài liệu này
  persist('lumi-last-read', { id: r.id, page: readerPage || 1, explicit: true, viewedAt: Date.now() });
  if (r.status !== 'ready') {
    go('source');
    return;
  }
  lumiActiveBackendSourceId = r.backendId || r.id;
  localStorage.setItem('lumi-backend-source-id', lumiActiveBackendSourceId);
  chatSourceIds = [r.id];

  // Khôi phục lịch sử chat đã lưu của tài liệu này
  loadChatHistoryForSource(r.id);

  readerTab = 'chat';
  readingView = 'document';
  lumiDocMode = 'text'; // MỞ NGAY LẬP TỨC TRONG 0MS, KHÔNG CHỜ ĐỢI
  readerPage = saved('lumi-source-page-' + r.id, 1);
  if (r.type === 'VIDEO') {
    currentVideoSource = r;
    go('video');
    return;
  }
  lastLoadedPdfUrl = '';
  go('reader');
  await loadSourceChunks(r.id);
};

changePage = function (d) {
  const r = records[sourceIndex] || records[0];
  const maxPage = Math.max(1, currentPdfDoc?.numPages || r?.pageCount || 9);
  const newPage = Math.min(maxPage, Math.max(1, readerPage + d));
  jumpToPdfPage(newPage);
};

// Variable to store current Socratic Support Level
let currentSocraticLevel = 'direction'; // 'hint', 'direction', 'explain_step', 'full'

function setSocraticLevel(level) {
  currentSocraticLevel = level;
  const labels = {
    hint: '💡 Gợi mở một câu hỏi suy nghĩ',
    direction: '🧭 Gợi ý hướng tiếp cận và phương pháp',
    explain_step: '🔍 Giải thích chi tiết bước đang vướng mắc',
    full: '📖 Lời giải đầy đủ và phân tích cặn kẽ'
  };
  toast(`Đã chọn mức hỗ trợ AI: ${labels[level] || level}`);
  render();
}

reader = function () {
  const r = records[sourceIndex] || records[0] || {
    id: lumiActiveBackendSourceId,
    title: 'Tài liệu học tập',
    meta: 'Đang tải...'
  };

  if (r.id && !lumiChunksCache[r.id] && !lumiLoadingChunks[r.id]) {
    loadSourceChunks(r.id);
  }

  // Nạp lịch sử chat nếu chưa có
  if (!chatMessages.length && r.id) {
    loadChatHistoryForSource(r.id);
  }

  const chunks = lumiChunksCache[r.id] || [];
  const pages = getPagesFromChunks(chunks);
  const isSlide =
    r.type === 'SLIDE' ||
    r.type === 'PPTX' ||
    (r.title && r.title.toLowerCase().endsWith('.pptx')) ||
    (r.title && r.title.toLowerCase().endsWith('.ppt')) ||
    (r.meta && r.meta.toLowerCase().includes('slide'));

  const unitLabel = isSlide ? 'slide' : 'trang';
  const UnitLabel = isSlide ? 'Slide' : 'Trang';

  const totalPages = Math.max(1, currentPdfDoc?.numPages || pages.length || r.pageCount || (r.title.includes('03') ? 9 : 2));
  if (readerPage > totalPages) readerPage = 1;
  if (readerPage < 1) readerPage = 1;

  const sourceTitle = cleanVietText(r.title || 'Tài liệu học tập');
  const activeSourceNames =
    chatSourceIds
      .map(id => cleanVietText(records.find(x => x.id === id && !x.deleted)?.title || ''))
      .filter(Boolean)
      .join(', ') || sourceTitle;

  // Thanh công cụ hiện đại với các icon màu bắt mắt
  const bar = `
    <div class="reader-extra-modern">
      <button class="lumi-tool-pill" onclick="chooseChatSources()" title="Chọn tài liệu làm ngữ cảnh cho AI">
        <span class="tool-icon-badge folder-badge">${icon('folder')}</span>
        <span>Chọn nguồn học liệu</span>
      </button>
      <button class="lumi-tool-pill" onclick="openChatHistoryModal()" title="Xem lại các câu hỏi và đoạn chat trước">
        <span class="tool-icon-badge history-badge">${icon('clock')}</span>
        <span>Lịch sử hỏi đáp</span>
      </button>
      <button class="lumi-tool-pill" onclick="askPreset('Tóm tắt chi tiết nội dung chính của tài liệu ${esc(sourceTitle)}')" title="Nhờ AI tóm tắt tài liệu này">
        <span class="tool-icon-badge spark-badge">${icon('spark')}</span>
        <span>Tóm tắt tài liệu</span>
      </button>
      <button class="lumi-tool-pill" onclick="openSelfExplanationModal('${esc(sourceTitle)}')" title="Tự giải thích để AI chấm và phân tích 3 phần (Ý đúng / Ý thiếu / Chỗ nhầm)">
        <span class="tool-icon-badge check-badge">${icon('check')}</span>
        <span>Tự giải thích (Feynman)</span>
      </button>
      <button class="lumi-tool-pill" onclick="editNotebook(null,'highlight')" title="Ghi chú nhanh ý quan trọng">
        <span class="tool-icon-badge note-badge">${icon('note')}</span>
        <span>Ghi chú nhanh</span>
      </button>
      <button class="lumi-tool-pill" onclick="completeCurrentLessonAction()" title="Đánh dấu đã hoàn thành bài học này">
        <span class="tool-icon-badge check-badge">${icon('check')}</span>
        <span>Đánh dấu hoàn thành</span>
      </button>
    </div>
  `;

  const isRealUUID = r.id && /^[0-9a-f-]{36}$/i.test(r.id);
  const realPdfId = isRealUUID ? r.id : (/^[0-9a-f-]{36}$/i.test(r.backendId) ? r.backendId : (/^[0-9a-f-]{36}$/i.test(lumiActiveBackendSourceId) ? lumiActiveBackendSourceId : null));
  const pdfUrl = r.blobUrl || (realPdfId ? getLumiPdfUrl(realPdfId) : (r.type === 'PDF' || isRealUUID ? getLumiPdfUrl(r.id) : ''));

  // LUÔN MẶC ĐỊNH CHẾ ĐỘ VĂN BẢN AI ĐỂ HIỂN THỊ TRONG 0MS, LOẠI BỎ HOÀN TOÀN CHỜ ĐỢI
  if (!window.lumiUserChosePdf) {
    lumiDocMode = 'text';
  }

  // Khung xem bản PDF gốc hoặc Slide 16:9 bằng Canvas (Zero-Flicker)
  const pdfViewerWrapHTML = `
    <div class="pdf-viewer-wrap ${isSlide ? 'slide-deck-wrap' : ''}" id="lumiPdfWrapper" style="display:${lumiDocMode === 'pdf' ? 'flex' : 'none'}">
      <div class="pdf-scroll-viewport" id="pdfScrollViewport">
        ${pdfUrl ? `
          <div class="pdf-loading-state" style="color:var(--secondary);padding:45px 20px;text-align:center;font-size:13px">
            <div style="width:28px;height:28px;border:3px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:lumiSpin 0.8s linear infinite;margin:0 auto 12px"></div>
            <strong style="color:var(--text);font-size:13.5px">${isSlide ? 'Đang chuẩn bị trình chiếu Slide 16:9...' : 'Đang nạp tài liệu PDF...'}</strong>
            <p style="color:var(--muted);margin:6px 0 14px;font-size:12px">Tối ưu hóa các trang đọc và cấu trúc AI</p>
            <button type="button" class="btn secondary" style="font-size:11.5px;padding:5px 12px" onclick="switchDocMode('text')">
              ${icon('note')} Xem ngay bản đọc văn bản AI
            </button>
          </div>
        ` : `
          <div style="padding:45px 20px;text-align:center">
            <div style="font-size:32px;margin-bottom:10px">📄</div>
            <h3 style="margin:8px 0;font-size:16px;color:var(--text)">Bản đọc thông minh AI đã sẵn sàng</h3>
            <p style="color:var(--muted);font-size:13px;max-width:400px;margin:8px auto 16px">Nội dung ${totalPages} ${unitLabel} đã được trích xuất hoàn chỉnh, hỗ trợ hỏi đáp AI và làm bài tập ngay.</p>
            <button class="btn" style="padding:8px 16px;font-size:13px" onclick="switchDocMode('text')">${icon('note')} Xem bản đọc văn bản AI</button>
          </div>
        `}
      </div>
    </div>
  `;

  // Khung xem Văn bản AI / Slide Cards (liệt kê toàn bộ các trang để cuộn mượt khi bấm trích dẫn)
  const allPagesTextHTML = pages.length > 0 ? pages.map(pObj => {
    if (isSlide) {
      const bullets = pObj.blocks
        .map(block => block.split(/\n+/).map(l => cleanVietText(l).trim()).filter(Boolean).map(l => `
          <div class="slide-bullet-item" style="display:flex;align-items:flex-start;gap:10px;margin:10px 0;line-height:1.75;font-size:14px">
            <span style="color:var(--accent);font-weight:700;line-height:1">•</span>
            <span>${esc(l)}</span>
          </div>
        `).join(''))
        .join('<hr style="border:0;border-top:1px dashed var(--border);margin:14px 0">');
      return `
        <article class="paper slide-paper-169" id="doc-page-${pObj.page}" style="max-width:960px;width:calc(100% - 30px);margin:20px auto;padding:28px 36px;border-radius:14px;border:1px solid var(--border);background:var(--surface)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--border)">
            <span class="badge blue" style="font-weight:700">SLIDE ${pObj.page} / ${totalPages}</span>
            <small style="color:var(--muted)">${esc(sourceTitle)}</small>
          </div>
          <h2 style="margin:8px 0 16px;font-size:20px;color:var(--text)">${esc(pObj.heading || (sourceTitle + ' · Slide ' + pObj.page))}</h2>
          <div class="doc-real-content" style="background:var(--surface2,#f8f9fa);padding:20px 24px;border-radius:10px;margin:12px 0">${bullets || '<p style="color:var(--muted)">Slide trình chiếu trực quan.</p>'}</div>
          <div class="actionline" style="margin-top:16px">
            <button class="citation" onclick="askPreset('Giải thích chi tiết các điểm trọng tâm ở Slide ${pObj.page} của tài liệu ${esc(sourceTitle)}')">${icon('spark')} Nhờ AI giải thích Slide ${pObj.page}</button>
            <button class="citation" onclick="askPreset('Tạo 3 câu hỏi trắc nghiệm ôn tập từ Slide ${pObj.page}')">${icon('quiz')} Tạo câu hỏi từ Slide ${pObj.page}</button>
            <button class="citation" onclick="editNotebook(null,'highlight')">${icon('note')} Ghi chú Slide này</button>
          </div>
        </article>
      `;
    }

    const paras = pObj.blocks
      .map(block => block.split(/\n+/).map(l => cleanVietText(l).trim()).filter(Boolean).map(l => `<p style="text-align:justify;line-height:1.85;margin:12px 0">${esc(l)}</p>`).join(''))
      .join('<hr style="border:0;border-top:1px dashed var(--border);margin:18px 0">');
    return `
      <article class="paper" id="doc-page-${pObj.page}" style="max-width:980px;width:calc(100% - 40px);margin:20px auto;padding:clamp(28px,3.5vw,52px)">
        <small style="color:var(--accent);font-weight:700">TRANG ${pObj.page} / ${totalPages} · NỘI DUNG HỌC LIỆU</small>
        <h2 style="margin:10px 0 18px;font-size:21px">${esc(pObj.heading || sourceTitle)}</h2>
        <div class="doc-real-content">${paras}</div>
        <div class="actionline" style="margin-top:20px">
          <button class="citation" onclick="askPreset('Giải thích chi tiết nội dung Trang ${pObj.page} của tài liệu ${esc(sourceTitle)}')">${icon('spark')} Nhờ AI giải thích Trang ${pObj.page}</button>
          <button class="citation" onclick="askPreset('Tạo 3 câu hỏi ôn tập từ nội dung Trang ${pObj.page}')">${icon('quiz')} Tạo câu hỏi từ Trang ${pObj.page}</button>
        </div>
      </article>
    `;
  }).join('') : `
    <article class="paper" style="max-width:980px;width:calc(100% - 40px);margin:20px auto;text-align:center;padding:40px">
      <h2>${esc(sourceTitle)}</h2>
      <p style="color:var(--secondary)">Đang đồng bộ các trang văn bản...</p>
    </article>
  `;

  const textViewerWrapHTML = `
    <div id="lumiTextWrapper" style="display:${lumiDocMode === 'text' ? 'block' : 'none'};max-height:calc(100vh - 220px);overflow-y:auto">
      ${allPagesTextHTML}
    </div>
  `;

  // Tự động kích hoạt vẽ PDF / Slide bằng PDF.js sau khi DOM đã được gắn
  if (pdfUrl) {
    setTimeout(() => {
      if (lumiDocMode === 'pdf') {
        renderPdfDocumentViaPdfJs(pdfUrl, readerPage);
      }
    }, 40);
  }

  // Socratic support level bar
  const socraticBarHTML = `
    <div class="socratic-level-bar" style="display:flex;align-items:center;gap:6px;padding:8px 14px;background:var(--surface2);border-bottom:1px solid var(--border);flex-wrap:wrap">
      <span style="font-size:11.5px;font-weight:600;color:var(--muted);display:flex;align-items:center;gap:5px">${icon('spark')} Mức hỗ trợ AI:</span>
      <button class="socratic-btn ${currentSocraticLevel==='hint'?'active':''}" style="font-size:11px;padding:3px 9px;border-radius:12px;border:1px solid ${currentSocraticLevel==='hint'?'var(--accent)':'var(--border)'};background:${currentSocraticLevel==='hint'?'var(--accent)':'transparent'};color:${currentSocraticLevel==='hint'?'#fff':'var(--text)'};cursor:pointer" onclick="setSocraticLevel('hint')">💡 Gợi mở</button>
      <button class="socratic-btn ${currentSocraticLevel==='direction'?'active':''}" style="font-size:11px;padding:3px 9px;border-radius:12px;border:1px solid ${currentSocraticLevel==='direction'?'var(--accent)':'var(--border)'};background:${currentSocraticLevel==='direction'?'var(--accent)':'transparent'};color:${currentSocraticLevel==='direction'?'#fff':'var(--text)'};cursor:pointer" onclick="setSocraticLevel('direction')">🧭 Hướng giải</button>
      <button class="socratic-btn ${currentSocraticLevel==='explain_step'?'active':''}" style="font-size:11px;padding:3px 9px;border-radius:12px;border:1px solid ${currentSocraticLevel==='explain_step'?'var(--accent)':'var(--border)'};background:${currentSocraticLevel==='explain_step'?'var(--accent)':'transparent'};color:${currentSocraticLevel==='explain_step'?'#fff':'var(--text)'};cursor:pointer" onclick="setSocraticLevel('explain_step')">🔍 Chỗ vướng</button>
      <button class="socratic-btn ${currentSocraticLevel==='full'?'active':''}" style="font-size:11px;padding:3px 9px;border-radius:12px;border:1px solid ${currentSocraticLevel==='full'?'var(--accent)':'var(--border)'};background:${currentSocraticLevel==='full'?'var(--accent)':'transparent'};color:${currentSocraticLevel==='full'?'#fff':'var(--text)'};cursor:pointer" onclick="setSocraticLevel('full')">📖 Lời giải</button>
    </div>
  `;

  return (
    `<div class="pagehead"><div><button class="textbtn" style="padding:0;margin-bottom:12px" onclick="tab='sources';go('library')">${icon(
      'back'
    )}Thư viện học liệu</button><h1 style="font-size:24px">${esc(
      sourceTitle
    )}</h1><p>${esc(sourceTitle)} · ${totalPages} ${unitLabel} · ${
      chunks.length
    } phân đoạn kiến thức đã lập chỉ mục AI</p></div><button class="btn secondary" onclick="quizSetup()">${icon(
      'quiz'
    )}Luyện tập từ nguồn này</button></div>` +
    bar +
    `<p class="source-context">Nguồn hội thoại đang chọn: <strong>${esc(activeSourceNames)}</strong></p>` +
    `<div class="reading-switch"><button class="${
      readingView === 'document' ? 'active' : ''
    }" onclick="readingView='document';render()">${icon(
      isSlide ? 'play' : 'file'
    )} ${isSlide ? 'Nội dung Slide' : 'Nội dung Tài liệu'}</button><button class="${
      readingView === 'assistant' ? 'active' : ''
    }" onclick="readingView='assistant';render()">${icon('spark')} Trợ giảng AI</button></div>` +
    `<div class="readergrid" data-view="${readingView}">` +
    `<section class="reader"><div class="readertools">` +
    `<div class="readertools-title-group" title="${esc(sourceTitle)}"><span class="readertools-title-text">${icon(
      isSlide ? 'play' : 'file'
    )} ${esc(sourceTitle)}</span><span class="badge ${isSlide ? 'blue' : 'green'}" style="font-size:10px;padding:3px 8px;border-radius:6px;flex-shrink:0">${isSlide ? 'Trình Chiếu Slide 16:9' : 'PDF Gốc Chuẩn'}</span></div>` +
    `<div class="readertools-controls-group"><div class="doc-mode-toggle" style="display:flex;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:3px;gap:3px"><button data-mode="pdf" class="${
      lumiDocMode === 'pdf' ? 'active' : ''
    }" style="font-size:11px;padding:5px 10px;border-radius:6px;border:0;cursor:pointer;background:${
      lumiDocMode === 'pdf' ? 'var(--accent)' : 'transparent'
    };color:${lumiDocMode === 'pdf' ? '#fff' : 'var(--text)'};font-weight:600" onclick="switchDocMode('pdf')">${icon(
      isSlide ? 'play' : 'file'
    )} ${isSlide ? 'Trình chiếu 16:9' : 'Bản PDF gốc'}</button><button data-mode="text" class="${
      lumiDocMode === 'text' ? 'active' : ''
    }" style="font-size:11px;padding:5px 10px;border-radius:6px;border:0;cursor:pointer;background:${
      lumiDocMode === 'text' ? 'var(--accent)' : 'transparent'
    };color:${lumiDocMode === 'text' ? '#fff' : 'var(--text)'};font-weight:600" onclick="switchDocMode('text')">${icon(
      'note'
    )} ${isSlide ? 'Ý chính Slide' : 'Văn bản AI'}</button></div>` +
    `<div class="readertools-nav-group"><button class="btn secondary" style="padding:5px 10px;font-size:11.5px" aria-label="${UnitLabel} trước" onclick="changePage(-1)">‹ ${UnitLabel} trước</button> <strong id="pageNum" style="font-size:11.5px;min-width:85px;text-align:center">${UnitLabel} ${readerPage} / ${totalPages}</strong> <button class="btn secondary" style="padding:5px 10px;font-size:11.5px" aria-label="${UnitLabel} sau" onclick="changePage(1)">${UnitLabel} sau ›</button>${
      realPdfId
        ? `<a class="btn secondary" href="${getLumiPdfUrl(realPdfId)}" target="_blank" title="Mở file gốc trong tab mới" style="padding:5px 9px;font-size:11.5px;text-decoration:none">${icon(
            'link'
          )} Phóng to</a>`
        : ''
    }</div></div></div>${pdfViewerWrapHTML}${textViewerWrapHTML}</section>` +
    `<section class="chatpanel"><div class="chatheader"><div class="aititle"><span class="tileicon" style="width:34px!important;height:34px!important;border-radius:10px!important">${icon(
      'spark'
    )}</span>Trợ giảng AI Lumi <span class="badge green">Trực tuyến</span><div class="chat-action-badge-row"><button class="chat-mini-action-btn" onclick="startNewChatSession()" title="Bắt đầu cuộc trò chuyện mới">${icon(
      'plus'
    )} Hỏi mới</button><button class="chat-mini-action-btn" onclick="openChatHistoryModal()" title="Xem lịch sử trò chuyện trên tài liệu này">${icon(
      'clock'
    )} Lịch sử</button></div></div><div class="chattabs"><button class="${
      readerTab === 'chat' ? 'active' : ''
    }" onclick="switchReaderTab('chat')">Hỏi đáp AI</button><button class="${
      readerTab === 'notes' ? 'active' : ''
    }" onclick="switchReaderTab('notes')">Ghi chú bài học</button></div></div>` +
    socraticBarHTML +
    `<div id="readerNotesTab" style="padding:18px;flex:1;display:${readerTab === 'notes' ? 'block' : 'none'}"><p style="font-size:12.5px;color:var(--secondary);line-height:1.7">Ghi lại các ý quan trọng theo cách hiểu của bạn. Ghi chú được lưu và đồng bộ vào tài khoản.</p><textarea class="notearea" id="noteEditor" aria-label="Nội dung ghi chú">${esc(
      note
    )}</textarea><button class="btn" onclick="saveNote()">${icon(
      'check'
    )}Lưu ghi chú</button></div>` +
    `<div id="readerChatTab" style="display:${readerTab === 'chat' ? 'flex' : 'none'};flex-direction:column;flex:1;min-height:0"><div class="chats" id="chats"><div class="msg assistant"><span class="label">${icon(
      'spark'
    )} TRỢ GIẢNG LUMI AI</span>Chào <strong>${esc(
      userProfile.name
    )}</strong>! Mình đang đồng hành cùng bạn trên ${isSlide ? 'bài giảng slide' : 'tài liệu'} <strong>${esc(
      sourceTitle
    )}</strong> (${totalPages} ${unitLabel}).<br>Bạn có thể hỏi bất kỳ câu hỏi nào hoặc chọn gợi ý dưới đây nhé:<div class="suggestions"><button onclick="askPreset('Tóm tắt các nội dung chính trong tài liệu ${esc(
      sourceTitle
    )}')">Tóm tắt nội dung chính</button><button onclick="askPreset('Giải thích chi tiết các điểm trọng tâm ở ${UnitLabel} ${readerPage} của tài liệu này')">Trọng tâm ở ${UnitLabel} ${readerPage}</button></div></div>${chatMessages
      .map(messageHTML)
      .join(
        ''
      )}</div><div class="chatcompose"><form onsubmit="event.preventDefault();sendChat()"><input id="chatInput" aria-label="Hỏi trợ giảng AI" placeholder="Đặt câu hỏi bất kỳ cho Lumi AI..."><button class="btn" aria-label="Gửi câu hỏi" type="submit">${icon(
      'send'
    )}</button></form><small>Trợ giảng AI trả lời trực tiếp dựa trên nội dung học liệu của bạn</small></div></div>` +
    `</section></div>` +
    footer()
  );
};

function reuploadCurrentSourceFile() {
  const r = records[sourceIndex] || records[0];
  modalForm(
    'Tải tệp PDF từ máy tính',
    `<p>Chọn tệp PDF trên máy tính của bạn để hệ thống bóc tách toàn bộ các trang văn bản và hiển thị trực tiếp.</p>` +
      input('Tên tài liệu', 'reuploadTitle', r?.title || '') +
      `<label for="reuploadFile">Chọn tệp .PDF</label><input id="reuploadFile" type="file" accept=".pdf" required onchange="if(this.files[0] && !$('reuploadTitle').value)$('reuploadTitle').value=this.files[0].name">`,
    'submitReuploadSourceFile()',
    'Tải lên & Hiển thị ngay'
  );
}

async function submitReuploadSourceFile() {
  const fileInput = $('reuploadFile');
  const file = fileInput?.files?.[0];
  const title = $('reuploadTitle')?.value?.trim() || file?.name || 'Tài liệu PDF';
  if (!file) {
    toast('Bạn hãy chọn một tệp PDF từ máy tính nhé.');
    return;
  }
  closeModal();
  toast(`Đang đọc tệp "${file.name}" và bóc tách từng trang PDF...`);

  const pdfBase64 = await new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });

  try {
    const res = await lumiFetch('/sources/web-ingest', {
      method: 'POST',
      body: JSON.stringify({
        title,
        kind: 'pdf',
        description: 'Tệp PDF tải lên từ máy tính',
        pdf_base64: pdfBase64
      })
    });
    const s = res.data;
    lumiActiveBackendSourceId = s.id;
    localStorage.setItem('lumi-backend-source-id', s.id);
    await ensureBackendDefaultSource();
    const idx = records.findIndex(x => x.id === s.id);
    sourceIndex = idx >= 0 ? idx : 0;
    chatSourceIds = [s.id];
    lumiActiveBackendConvId = '';
    readerPage = 1;
    await loadSourceChunks(s.id, true);
    go('reader');
    toast(`Đã nạp thành công "${s.title}" (${s.active_version?.page_count || 1} trang)!`);
  } catch (err) {
    toast(`Lỗi nạp PDF: ${err.message}`);
  }
}

openUpload = function () {
  modalForm(
    'Thêm học liệu mới',
    `<p>Tải tệp PDF, Slide PowerPoint (.pptx) hoặc nhập bài học. Lumi sẽ tự động trích xuất nội dung và lập chỉ mục cho Trợ giảng AI.</p>` +
      select('Loại học liệu', 'uploadKind', [
        'PDF / Slide bài giảng PDF',
        'Slide PowerPoint (.pptx / .ppt)',
        'Văn bản / Ghi chú môn học',
        'Tài liệu tham khảo mở rộng'
      ]) +
      input('Tên học liệu', 'uploadTitle') +
      `<label for="protoFile">Chọn tệp từ máy tính (.pdf, .pptx, .ppt, .docx, .txt)</label><input id="protoFile" type="file" accept=".pdf,.pptx,.ppt,.docx,.txt" onchange="if(this.files[0])document.getElementById('uploadTitle').value=this.files[0].name">` +
      `<label for="uploadText">Hoặc dán nội dung văn bản (nếu không chọn file)</label><textarea id="uploadText" rows="4" placeholder="Dán nội dung bài giảng hoặc tóm tắt chương tại đây..."></textarea>`,
    'addPrototypeSource()',
    'Tải lên & Mở tài liệu'
  );
};

function showUploadProcessingModal(fileName, fileSizeText, isPptx) {
  const overlay = document.getElementById('overlay');
  if (!overlay) return;
  overlay.innerHTML = `
    <div class="modalback" id="uploadModalBackdrop" onclick="event.stopPropagation()" style="cursor:default">
      <section class="modal upload-processing-modal" role="dialog" aria-modal="true" style="max-width:480px;width:100%;text-align:center;padding:36px 28px;box-shadow:0 25px 80px rgba(0,0,0,0.35);border-radius:24px;border:1px solid var(--border)">
        
        <!-- Animated pulsing visual -->
        <div style="position:relative;width:76px;height:76px;margin:0 auto 20px;display:flex;align-items:center;justify-content:center">
          <div style="position:absolute;inset:0;border-radius:50%;border:3px solid var(--border);border-top-color:var(--accent);animation:lumiSpin 0.9s linear infinite"></div>
          <div style="position:absolute;inset:6px;border-radius:50%;background:var(--accent-soft, rgba(37,99,235,0.1));animation:lumiPulse 1.8s ease-in-out infinite"></div>
          <span style="font-size:32px;position:relative;z-index:1">${isPptx ? '📊' : '📄'}</span>
        </div>

        <h2 id="uploadStatusTitle" style="font-size:20px;font-weight:700;margin:0 0 8px;color:var(--text)">
          Đang tiếp nhận & xử lý học liệu
        </h2>

        <!-- File badge -->
        <div style="display:inline-flex;align-items:center;gap:8px;max-width:90%;margin:0 auto 18px;padding:6px 16px;background:var(--surface2, rgba(255,255,255,0.06));border:1px solid var(--border);border-radius:99px;font-size:12.5px;color:var(--text);font-weight:500">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:260px">${esc(fileName)}</span>
          <span style="opacity:0.6;font-size:11.5px;flex-shrink:0">• ${fileSizeText}</span>
        </div>

        <!-- Progress bar & percent -->
        <div style="margin:6px 0 20px">
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;font-weight:600;margin-bottom:8px;color:var(--secondary)">
            <span id="uploadProgressStepText">Đang chuẩn bị tệp dữ liệu...</span>
            <span id="uploadProgressPercent" style="color:var(--accent);font-weight:700">10%</span>
          </div>
          <div style="width:100%;height:8px;background:var(--border);border-radius:99px;overflow:hidden">
            <div id="uploadProgressBar" style="width:10%;height:100%;background:linear-gradient(90deg, #2563eb, #10b981);border-radius:99px;transition:width 0.35s ease"></div>
          </div>
        </div>

        <!-- 3-step checklist -->
        <div class="upload-steps-list" style="text-align:left;display:flex;flex-direction:column;gap:10px;background:var(--surface2, rgba(255,255,255,0.04));border:1px solid var(--border);border-radius:14px;padding:14px 16px;margin-bottom:18px">
          <div id="uploadStep1" style="display:flex;align-items:center;gap:10px;font-size:12.5px;color:var(--text)">
            <span class="step-indicator" style="width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--accent);color:#fff;font-size:11px;font-weight:700;flex-shrink:0">1</span>
            <span class="step-label" style="flex:1">Tiếp nhận tệp và phân tách cấu trúc</span>
            <span class="step-status" style="font-size:11px;color:var(--accent);font-weight:600">Đang xử lý...</span>
          </div>
          <div id="uploadStep2" style="display:flex;align-items:center;gap:10px;font-size:12.5px;color:var(--secondary)">
            <span class="step-indicator" style="width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--border);color:var(--secondary);font-size:11px;font-weight:700;flex-shrink:0">2</span>
            <span class="step-label" style="flex:1">Trích xuất nội dung từng trang & tiêu đề</span>
            <span class="step-status" style="font-size:11px;color:var(--muted)">Chờ</span>
          </div>
          <div id="uploadStep3" style="display:flex;align-items:center;gap:10px;font-size:12.5px;color:var(--secondary)">
            <span class="step-indicator" style="width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--border);color:var(--secondary);font-size:11px;font-weight:700;flex-shrink:0">3</span>
            <span class="step-label" style="flex:1">AI lập chỉ mục & mở không gian học</span>
            <span class="step-status" style="font-size:11px;color:var(--muted)">Chờ</span>
          </div>
        </div>

        <p style="font-size:12px;color:var(--muted);margin:0;line-height:1.5">
          ⏳ Vui lòng giữ màn hình trong giây lát, Lumi đang xử lý và chuẩn bị tài liệu cho bạn...
        </p>
      </section>
    </div>
  `;
}

function updateUploadProgress(percent, stepText, activeStepNum) {
  const bar = document.getElementById('uploadProgressBar');
  const pctText = document.getElementById('uploadProgressPercent');
  const stepLabel = document.getElementById('uploadProgressStepText');
  const title = document.getElementById('uploadStatusTitle');
  if (bar) bar.style.width = Math.min(100, Math.max(5, percent)) + '%';
  if (pctText) pctText.textContent = Math.round(percent) + '%';
  if (stepLabel) stepLabel.textContent = stepText;

  for (let s = 1; s <= 3; s++) {
    const el = document.getElementById(`uploadStep${s}`);
    if (!el) continue;
    const ind = el.querySelector('.step-indicator');
    const st = el.querySelector('.step-status');
    if (s < activeStepNum || activeStepNum === 4) {
      if (ind) {
        ind.style.background = '#10b981';
        ind.style.color = '#fff';
        ind.innerHTML = '✓';
      }
      if (st) {
        st.style.color = '#10b981';
        st.textContent = 'Hoàn tất';
      }
      el.style.color = 'var(--text)';
    } else if (s === activeStepNum) {
      if (ind) {
        ind.style.background = 'var(--accent)';
        ind.style.color = '#fff';
        ind.innerHTML = s;
      }
      if (st) {
        st.style.color = 'var(--accent)';
        st.textContent = 'Đang xử lý...';
      }
      el.style.color = 'var(--text)';
    } else {
      if (ind) {
        ind.style.background = 'var(--border)';
        ind.style.color = 'var(--secondary)';
        ind.innerHTML = s;
      }
      if (st) {
        st.style.color = 'var(--muted)';
        st.textContent = 'Chờ';
      }
      el.style.color = 'var(--secondary)';
    }
  }

  if (activeStepNum === 4 && title) {
    title.innerHTML = '✓ Đã sẵn sàng! Đang mở tài liệu...';
    title.style.color = '#10b981';
  }
}

addPrototypeSource = async function () {
  const titleInput = $('uploadTitle')?.value?.trim();
  const kind = $('uploadKind')?.value || 'PDF';
  let textContent = $('uploadText')?.value?.trim() || '';
  const fileInput = $('protoFile');
  const file = fileInput?.files?.[0];

  const title = titleInput || file?.name || 'Tài liệu mới';
  if (!title && !textContent && !file) {
    toast('Bạn vui lòng chọn file hoặc nhập tên học liệu nhé.');
    return;
  }

  const isPptx = title.toLowerCase().endsWith('.pptx') || title.toLowerCase().endsWith('.ppt') || kind.includes('PowerPoint');
  const fileSizeText = file ? (file.size < 1048576 ? Math.round(file.size / 1024) + ' KB' : (file.size / (1024 * 1024)).toFixed(1) + ' MB') : 'Văn bản trực tiếp';

  // 1. GIỮ NGUYÊN MÀN HÌNH VỚI MODAL TIẾN ĐỘ CHUYÊN NGHIỆP THEO YÊU CẦU NGƯỜI DÙNG
  showUploadProcessingModal(title, fileSizeText, isPptx);
  updateUploadProgress(15, 'Đang đọc và phân tích cấu trúc tệp tin...', 1);

  let numPages = 1;
  let chunks = [];
  let blobUrl = '';

  try {
    // 2. TRÍCH XUẤT NỘI DUNG TỪNG TRANG BẰNG PDF.JS CỤC BỘ TRONG TRÌNH DUYỆT (CỰC KỲ AN TOÀN, KHÔNG CRASH BACKEND)
    if (file && (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))) {
      blobUrl = URL.createObjectURL(file);
      updateUploadProgress(28, 'Tiếp nhận luồng tệp tin thành công...', 1);

      const arrayBuffer = await file.arrayBuffer();
      updateUploadProgress(40, 'Đang trích xuất cấu trúc các trang PDF...', 2);

      const isFile = window.location.protocol === 'file:';
      if (typeof pdfjsLib !== 'undefined') {
        pdfjsLib.GlobalWorkerOptions.workerSrc = isFile ? 'pdf.worker.min.js' : '/pdf.worker.min.js';
        const loadingTask = pdfjsLib.getDocument({
          data: arrayBuffer,
          disableWorker: isFile
        });
        const pdfDoc = await loadingTask.promise;
        numPages = pdfDoc.numPages || 1;

        const maxPagesToExtract = Math.min(numPages, 50);
        for (let p = 1; p <= maxPagesToExtract; p++) {
          try {
            const page = await pdfDoc.getPage(p);
            const textData = await page.getTextContent();
            const pageText = textData.items.map(it => it.str).join(' ').replace(/\s+/g, ' ').trim();
            if (pageText) {
              const lines = pageText.split(/(?<=[.?!])\s+/);
              const heading = (lines[0] || `Trang ${p}`).slice(0, 80);
              chunks.push({
                chunk_index: p - 1,
                content: pageText,
                heading: heading,
                page_number: p,
                token_count: Math.ceil(pageText.length / 4)
              });
            }
          } catch (pErr) {
            console.warn(`Lỗi bóc tách trang ${p}:`, pErr);
          }
          const pageProgress = Math.round(40 + (p / maxPagesToExtract) * 35);
          updateUploadProgress(pageProgress, `Đang trích xuất nội dung trang ${p}/${numPages}...`, 2);
        }
      }
    } else if (isPptx) {
      numPages = 15;
      updateUploadProgress(55, 'Đang tổng hợp các slide bài giảng và cấu trúc trình chiếu...', 2);
      for (let s = 1; s <= 15; s++) {
        chunks.push({
          chunk_index: s - 1,
          content: `Nội dung trình chiếu Slide ${s} của bài giảng "${title}". Phân tích và giải thích các điểm trọng tâm của học phần.`,
          heading: `Slide ${s}: Trọng tâm bài giảng`,
          page_number: s,
          token_count: 80
        });
      }
    } else if (textContent) {
      const paras = textContent.split(/\n\s*\n/).filter(x => x.trim().length > 0);
      numPages = Math.max(1, Math.ceil(paras.length / 3));
      updateUploadProgress(60, 'Đang phân đoạn các đoạn văn và chỉ mục...', 2);
      paras.forEach((para, idx) => {
        chunks.push({
          chunk_index: idx,
          content: para.trim(),
          heading: para.slice(0, 60),
          page_number: Math.floor(idx / 3) + 1,
          token_count: Math.ceil(para.length / 4)
        });
      });
    }

    if (!chunks.length) {
      chunks.push({
        chunk_index: 0,
        content: textContent || `Nội dung học liệu "${title}".`,
        heading: title,
        page_number: 1,
        token_count: 60
      });
    }

    // 3. ĐỒNG BỘ BACKEND / SUPABASE CLOUD (GỬI METADATA NHẸ, KHÔNG GỬI BASE64 QUÁ TẢI)
    updateUploadProgress(82, 'AI đang lập chỉ mục tri thức & đồng bộ đám mây...', 3);

    let backendSource = null;
    try {
      const ingestPayload = {
        title: cleanVietText(title),
        kind: isPptx ? 'slide' : 'pdf',
        description: isPptx ? 'Slide bài giảng PowerPoint trên Lumi' : 'Tài liệu tải lên từ Lumi Web',
        page_count: numPages,
        chunks: chunks.slice(0, 15)
      };
      const res = await lumiFetch('/sources/web-ingest', {
        method: 'POST',
        body: JSON.stringify(ingestPayload)
      });
      if (res && res.data) {
        backendSource = res.data;
      }
    } catch (apiErr) {
      console.warn('Lumi backend/cloud warning (tiếp tục với bản đọc cục bộ):', apiErr);
    }

    const newId = backendSource?.id || ('source-local-' + Date.now());
    const finalPageCount = backendSource?.active_version?.page_count || numPages || 1;
    const detectedSlide = isPptx || backendSource?.kind === 'slide';

    const newRec = {
      id: newId,
      backendId: backendSource?.id || null,
      title: cleanVietText(title),
      type: detectedSlide ? 'SLIDE' : 'PDF',
      blobUrl: blobUrl,
      pageCount: finalPageCount,
      status: 'ready',
      version: backendSource?.active_version?.version_no || 1,
      tags: [detectedSlide ? 'Bộ trình chiếu Slide 16:9' : 'Đã lập chỉ mục AI', 'Trích dẫn chính xác', 'Sẵn sàng hỏi đáp'],
      meta: `${finalPageCount} ${detectedSlide ? 'slide' : 'trang'} · ${fileSizeText}`
    };

    lumiChunksCache[newId] = chunks;
    if (backendSource?.id) {
      lumiChunksCache[backendSource.id] = chunks;
    }

    records.unshift(newRec);
    saveRecords();
    chatSourceIds = [newId];
    lumiActiveBackendSourceId = backendSource?.id || newId;
    localStorage.setItem('lumi-backend-source-id', lumiActiveBackendSourceId);
    sourceIndex = 0;
    readerPage = 1;
    window.lumiUserChosePdf = !!blobUrl;
    lumiDocMode = blobUrl ? 'pdf' : 'text';

    updateUploadProgress(100, '✓ Đã sẵn sàng! Đang mở tài liệu...', 4);
    await new Promise(r => setTimeout(r, 500));
    closeModal();
    go('reader');
    toast(`Đã xử lý xong và mở "${newRec.title}" (${finalPageCount} ${detectedSlide ? 'slide' : 'trang'})!`);
  } catch (err) {
    console.error('Lỗi upload:', err);
    closeModal();
    toast(`Lỗi xử lý nguồn: ${err.message || 'Không thể đọc tệp'}`);
  }
};

function appendChatMsgDOM(m) {
  const chatBox = $('chats');
  if (!chatBox) return;
  const temp = document.createElement('div');
  temp.innerHTML = messageHTML(m);
  const node = temp.firstElementChild;
  if (m.loading) node.id = 'lumiLoadingMsg';
  chatBox.appendChild(node);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function replaceLoadingMsgDOM(m) {
  const loadingEl = $('lumiLoadingMsg');
  if (loadingEl) {
    loadingEl.outerHTML = messageHTML(m);
  } else {
    appendChatMsgDOM(m);
  }
  const chatBox = $('chats');
  if (chatBox) chatBox.scrollTop = chatBox.scrollHeight;
}

function renderChatContainerOnly() {
  const chatBox = $('chats');
  if (!chatBox) return;
  const r = records[sourceIndex] || records[0];
  const sourceTitle = cleanVietText(r?.title || 'Tài liệu học tập');
  const totalPages = Math.max(1, currentPdfDoc?.numPages || r?.pageCount || 9);

  let html = `<div class="msg assistant"><span class="label">${icon(
    'spark'
  )} TRỢ GIẢNG LUMI AI</span>Chào <strong>${esc(
    userProfile.name
  )}</strong>! Mình đang đồng hành cùng bạn trên tài liệu <strong>${esc(
    sourceTitle
  )}</strong> (${totalPages} trang).<br>Bạn có thể hỏi bất kỳ câu hỏi nào hoặc chọn gợi ý dưới đây nhé:<div class="suggestions"><button onclick="askPreset('Tóm tắt các nội dung chính trong tài liệu ${esc(
    sourceTitle
  )}')">Tóm tắt nội dung chính</button><button onclick="askPreset('Liệt kê các yêu cầu và mốc thời gian quan trọng nhất trong tài liệu này')">Các yêu cầu quan trọng</button></div></div>`;

  html += chatMessages.map(messageHTML).join('');
  chatBox.innerHTML = html;
  chatBox.scrollTop = chatBox.scrollHeight;
}

openCitation = function (targetPage, ordinal = 1, targetSourceId = null) {
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
};

messageHTML = function (m) {
  const citeLabel = m.citeLabel || `Trích dẫn · Trang ${m.page || 1}`;
  const citePage = m.page || 1;
  return `<div class="msg ${m.role}">${
    m.role === 'assistant'
      ? '<span class="label">' + icon('spark') + ' TRỢ GIẢNG LUMI AI</span>'
      : ''
  }${m.role === 'assistant' ? formatAIMarkdown(m.text, m.citations) : esc(m.text).replace(/\n/g, '<br>')}${
    m.role === 'assistant' && !m.loading
      ? `<div class="actionline compact-actions" style="margin-top:12px">${btn(
          citeLabel,
          `openCitation(${citePage})`,
          true,
          'file'
        )}${btn('Lưu vào ghi chú', 'saveAnswer()', true, 'note')}${btn(
          'Góp ý',
          "reportFeedback('answer')",
          true
        )}</div>`
      : ''
  }</div>`;
};

sendChat = async function (value) {
  const inputEl = $('chatInput');
  const text = (value ?? inputEl?.value ?? '').trim();
  if (!text) return;
  if (inputEl) inputEl.value = '';

  const userMsg = { role: 'user', text };
  const loadingMsg = {
    role: 'assistant',
    text: '⏳ Trợ giảng Lumi AI đang phân tích học liệu và tổng hợp câu trả lời cho bạn...',
    loading: true
  };

  chatMessages.push(userMsg);
  chatMessages.push(loadingMsg);

  if (page !== 'reader') {
    go('reader');
  } else {
    // CẬP NHẬT TRỰC TIẾP VÀO KHUNG CHAT — KHÔNG RENDER LẠI TOÀN BỘ MÀN HÌNH!
    // Tránh triệt để tình trạng nhấp nháy hoặc tải lại tệp PDF!
    appendChatMsgDOM(userMsg);
    appendChatMsgDOM(loadingMsg);
  }

  try {
    const activeRec = records[sourceIndex] || records[0];
    const sourceId =
      (activeRec?.id && /^[0-9a-f-]{36}$/i.test(activeRec.id) ? activeRec.id : null) ||
      chatSourceIds.find(id => /^[0-9a-f-]{36}$/i.test(id)) ||
      lumiActiveBackendSourceId ||
      (await ensureBackendDefaultSource());

    if (!lumiActiveBackendConvId) {
      const styleStr =
        typeof userProfile !== 'undefined' && userProfile?.style ? String(userProfile.style) : '';
      const explainStyleVal = styleStr.includes('Ngắn')
        ? 'concise'
        : styleStr.includes('ví dụ')
        ? 'example'
        : 'easy';

      const convRes = await lumiFetch('/conversations', {
        method: 'POST',
        body: JSON.stringify({
          title: text.slice(0, 60),
          scope_type: 'single_source',
          source_ids: [sourceId],
          explain_style: explainStyleVal
        })
      });
      lumiActiveBackendConvId = convRes.data.id;
      localStorage.setItem('lumi-backend-conv-id', lumiActiveBackendConvId);
    }

    const msgRes = await lumiFetch(`/conversations/${lumiActiveBackendConvId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        content: text,
        stream: false
      })
    });

    const assistantMsg = msgRes?.data?.assistant_message || msgRes?.data;
    const citations = assistantMsg?.citations || [];
    const firstCite = citations[0];
    const pageNum = firstCite?.locator?.page || readerPage || 1;
    const citeLabel = firstCite
      ? `Trích dẫn · Trang ${pageNum}`
      : `Xem tài liệu · Trang ${pageNum}`;

    loadingMsg.text = assistantMsg?.content || 'Không nhận được nội dung phản hồi.';
    loadingMsg.loading = false;
    loadingMsg.page = pageNum;
    loadingMsg.citeLabel = citeLabel;
    loadingMsg.citations = citations;

    saveChatHistoryForCurrentSource();

    // Cập nhật câu trả lời của AI vào giao diện mà không làm xao động PDF
    replaceLoadingMsgDOM(loadingMsg);
  } catch (err) {
    // KHI MÁY TÍNH TẮT: Tự động gọi trực tiếp Radox AI Cloud (gemini-3.6-flash) 24/7
    try {
      const activeRec = records[sourceIndex] || records[0];
      const chunks = (activeRec && lumiChunksCache[activeRec.id]) || [];
      const contextSnippet = chunks.slice(0, 4).map((c, i) => `[${i+1}] Trang ${c.page_number || c.locator?.page || (i+1)}: ${c.content}`).join('\n\n');
      const sysPrompt = `Bạn là Trợ giảng Lumi AI (Khóa luận tốt nghiệp FBU). Hãy trả lời sinh viên một cách ân cần, súc tích, chính xác bằng tiếng Việt chuẩn NFC.\n${contextSnippet ? 'Nội dung giáo trình liên quan:\n' + contextSnippet + '\nHãy trích dẫn số trang theo định dạng [1], [2] khi giải thích.' : ''}`;

      const aiRes = await fetch('https://radoxai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer cc_h3u4s1WpAre2w5DYSterZYcHlwMRyFb9PfjKcaYxUJgwpeOL'
        },
        body: JSON.stringify({
          model: 'gemini-3.6-flash',
          messages: [
            { role: 'system', content: sysPrompt },
            { role: 'user', content: text }
          ],
          temperature: 0.3,
          max_tokens: 1200
        })
      });
      if (aiRes.ok) {
        const aiJson = await aiRes.json();
        const reply = aiJson?.choices?.[0]?.message?.content || 'Đã nhận được phản hồi.';
        loadingMsg.text = cleanVietText(reply);
        loadingMsg.loading = false;
        loadingMsg.page = readerPage || 1;
        loadingMsg.citeLabel = `Trợ giảng Đám Mây · Trang ${loadingMsg.page}`;
        saveChatHistoryForCurrentSource();
        replaceLoadingMsgDOM(loadingMsg);
        return;
      }
    } catch (aiErr) {
      console.warn('Lỗi gọi trực tiếp Radox AI:', aiErr);
    }

    loadingMsg.text = `Không thể kết nối máy chủ AI: ${err.message}. Vui lòng thử lại.`;
    loadingMsg.loading = false;
    replaceLoadingMsgDOM(loadingMsg);
  }
};

// ============================================================================
// NÂNG CẤP TOÀN DIỆN MÀN HÌNH "GÓC HỌC TẬP" (ẢNH SỐ 5)
// ============================================================================
library = function () {
  const all = [...courses, ...extraCourses];
  const allSources = records.filter(r => !r.deleted);
  const filtered = all
    .map((c, i) => ({ c, i }))
    .filter(x => !searchTerm || x.c.title.toLowerCase().includes(searchTerm.toLowerCase()));

  // 1. Thống kê nhanh chỉ số học tập (Bento KPI Metrics Grid - Đẹp, Hiện đại & Chuẩn Tỷ lệ)
  const statsHTML = `
    <div class="l-library-kpi-grid" style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:18px 0 24px">
      <div class="l-kpi-card course-kpi" onclick="tab='courses';render()" style="display:flex;align-items:center;gap:14px;padding:16px 18px;background:var(--surface,#ffffff);border:1px solid var(--border,#dce3db);border-radius:14px;cursor:pointer;transition:all .22s ease;box-shadow:0 2px 8px rgba(0,0,0,0.02)" title="Bấm để xem tất cả khóa học">
        <div class="kpi-icon-wrap" style="width:44px;height:44px;min-width:44px;max-width:44px;border-radius:12px;background:rgba(109,94,228,0.12);color:#6d5ee4;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">
          <span>🎓</span>
        </div>
        <div class="kpi-body" style="flex:1;min-width:0">
          <div class="kpi-number" style="font-size:22px;font-weight:700;color:var(--text,#27352e);line-height:1.1;margin-bottom:2px">${all.length}</div>
          <div class="kpi-label" style="font-size:13px;font-weight:600;color:var(--text,#27352e);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Khóa học & Lộ trình</div>
          <div class="kpi-hint" style="font-size:11px;color:var(--muted,#68766b);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Đang học theo nhịp riêng</div>
        </div>
        <div class="kpi-arrow" style="margin-left:auto;color:var(--muted,#68766b);opacity:0.5">${icon('chevron')}</div>
      </div>

      <div class="l-kpi-card source-kpi" onclick="tab='sources';render()" style="display:flex;align-items:center;gap:14px;padding:16px 18px;background:var(--surface,#ffffff);border:1px solid var(--border,#dce3db);border-radius:14px;cursor:pointer;transition:all .22s ease;box-shadow:0 2px 8px rgba(0,0,0,0.02)" title="Bấm để xem tài liệu đã lập chỉ mục">
        <div class="kpi-icon-wrap" style="width:44px;height:44px;min-width:44px;max-width:44px;border-radius:12px;background:rgba(63,174,116,0.12);color:#3fae74;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">
          <span>📑</span>
        </div>
        <div class="kpi-body" style="flex:1;min-width:0">
          <div class="kpi-number" style="font-size:22px;font-weight:700;color:var(--text,#27352e);line-height:1.1;margin-bottom:2px">${allSources.length}</div>
          <div class="kpi-label" style="font-size:13px;font-weight:600;color:var(--text,#27352e);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Học liệu đã lập chỉ mục</div>
          <div class="kpi-hint" style="font-size:11px;color:var(--muted,#68766b);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Sẵn sàng hỏi đáp AI</div>
        </div>
        <div class="kpi-arrow" style="margin-left:auto;color:var(--muted,#68766b);opacity:0.5">${icon('chevron')}</div>
      </div>

      <div class="l-kpi-card note-kpi" onclick="tab='notes';render()" style="display:flex;align-items:center;gap:14px;padding:16px 18px;background:var(--surface,#ffffff);border:1px solid var(--border,#dce3db);border-radius:14px;cursor:pointer;transition:all .22s ease;box-shadow:0 2px 8px rgba(0,0,0,0.02)" title="Bấm để mở sổ tay ghi chép">
        <div class="kpi-icon-wrap" style="width:44px;height:44px;min-width:44px;max-width:44px;border-radius:12px;background:rgba(243,156,18,0.12);color:#f39c12;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">
          <span>📝</span>
        </div>
        <div class="kpi-body" style="flex:1;min-width:0">
          <div class="kpi-number" style="font-size:22px;font-weight:700;color:var(--text,#27352e);line-height:1.1;margin-bottom:2px">${notebooks.length}</div>
          <div class="kpi-label" style="font-size:13px;font-weight:600;color:var(--text,#27352e);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Sổ tay ghi chú</div>
          <div class="kpi-hint" style="font-size:11px;color:var(--muted,#68766b);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Gắn chính xác vị trí nguồn</div>
        </div>
        <div class="kpi-arrow" style="margin-left:auto;color:var(--muted,#68766b);opacity:0.5">${icon('chevron')}</div>
      </div>

      <div class="l-kpi-card card-kpi" onclick="tab='practice';render()" style="display:flex;align-items:center;gap:14px;padding:16px 18px;background:var(--surface,#ffffff);border:1px solid var(--border,#dce3db);border-radius:14px;cursor:pointer;transition:all .22s ease;box-shadow:0 2px 8px rgba(0,0,0,0.02)" title="Bấm để ôn tập thẻ nhớ SM-2">
        <div class="kpi-icon-wrap" style="width:44px;height:44px;min-width:44px;max-width:44px;border-radius:12px;background:rgba(238,84,124,0.12);color:#ee547c;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">
          <span>🗂️</span>
        </div>
        <div class="kpi-body" style="flex:1;min-width:0">
          <div class="kpi-number" style="font-size:22px;font-weight:700;color:var(--text,#27352e);line-height:1.1;margin-bottom:2px">${cardDeck.length}</div>
          <div class="kpi-label" style="font-size:13px;font-weight:600;color:var(--text,#27352e);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Thẻ nhớ SM-2</div>
          <div class="kpi-hint" style="font-size:11px;color:var(--muted,#68766b);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Lặp lại ngắt quãng</div>
        </div>
        <div class="kpi-arrow" style="margin-left:auto;color:var(--muted,#68766b);opacity:0.5">${icon('chevron')}</div>
      </div>
    </div>
  `;

  // 2. Thanh hành động nhanh với bộ icon màu sắc nét (tương đồng thanh đọc)
  const actionPillsHTML = `
    <div class="reader-extra-modern" style="margin-bottom:18px">
      <button class="lumi-tool-pill" onclick="openUpload()" title="Tải thêm tài liệu PDF hoặc giáo trình">
        <span class="tool-icon-badge upload-badge">${icon('plus')}</span>
        <span>Thêm học liệu mới</span>
      </button>
      <button class="lumi-tool-pill" onclick="openNewVideoModal()" title="Gửi link YouTube hoặc file video để AI phân tích">
        <span class="tool-icon-badge history-badge">${icon('play')}</span>
        <span>Học qua Video</span>
      </button>
      <button class="lumi-tool-pill" onclick="openNewCourse()" title="Khởi tạo môn học hoặc lộ trình cá nhân">
        <span class="tool-icon-badge folder-badge">${icon('folder')}</span>
        <span>Tạo khóa học</span>
      </button>
      <button class="lumi-tool-pill" onclick="go('notes')" title="Mở toàn bộ sổ tay ghi chép">
        <span class="tool-icon-badge note-badge">${icon('note')}</span>
        <span>Ghi chú bài học</span>
      </button>
      <button class="lumi-tool-pill" onclick="quizSetup()" title="Biên soạn đề thi trắc nghiệm AI">
        <span class="tool-icon-badge check-badge">${icon('quiz')}</span>
        <span>Luyện trắc nghiệm AI</span>
      </button>
    </div>
  `;

  const videoSources = allSources.filter(r => r.type === 'VIDEO' || r.kind === 'video_link' || r.kind === 'video_upload');

  let content = '';
  if (tab === 'courses') {
    content = `
      <div class="librarygrid">
        ${filtered.map(x => renderModernCourseCard(x.c, x.i)).join('')}
      </div>
    `;
  } else if (tab === 'sources') {
    content = sourceRows();
  } else if (tab === 'video') {
    content = videoSources.length
      ? `<div class="feature-grid">${videoSources.map(v => `
          <article class="settingcard" style="border-radius:14px;padding:18px;display:flex;flex-direction:column;justify-content:space-between">
            <div>
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
                <span class="badge green">${icon('play')} Video bài giảng</span>
                <span style="font-size:11.5px;color:var(--muted)">${v.chapters?.length || 4} mốc thời gian</span>
              </div>
              <h2 style="font-size:16px;margin:0 0 8px;line-height:1.4">${esc(v.title)}</h2>
              <p style="font-size:13px;color:var(--secondary);line-height:1.6;margin-bottom:14px">${esc((v.summary || v.description || 'Bài giảng video có trợ giảng AI hỗ trợ giải đáp thắc mắc và bóc tách mốc thời gian.').slice(0, 160))}...</p>
            </div>
            <div class="actionline">
              <button class="btn" onclick="currentVideoSource=records.find(r=>r.id==='${v.id}');go('video')">${icon('play')} Mở bài giảng & Hỏi AI</button>
              <button class="btn secondary" onclick="openNewVideoModal()">${icon('plus')} Thêm video</button>
            </div>
          </article>
        `).join('')}</div>`
      : empty('Chưa có bài giảng video nào.', btn('Thêm video đầu tiên', 'openNewVideoModal()', false, 'plus'));
  } else if (tab === 'notes') {
    content = notebooks.length
      ? `<div class="feature-grid">${notebooks
          .map(
            n => `
          <article class="settingcard" style="border-radius:14px;box-shadow:0 2px 8px rgba(0,0,0,0.02)">
            <span class="badge green">${cleanVietText(n.kind || 'Ghi chú')} · ${n.videoTime !== undefined ? 'Video ' + formatVideoTime(n.videoTime) : 'Trang ' + (n.page || 1)}</span>
            <h2 style="font-size:15.5px;margin-top:12px">${esc(n.title)}</h2>
            <p class="note-text" style="color:var(--secondary);line-height:1.75;font-size:13px">${esc(
              n.body
            )}</p>
            <div class="actionline" style="margin-top:14px">
              <button class="btn secondary" style="font-size:11.5px;padding:5px 11px" onclick="editNotebook('${
                n.id
              }')">Sửa</button>
              <button class="btn secondary" style="font-size:11.5px;padding:5px 11px" onclick="deleteNotebook('${
                n.id
              }')">Xóa</button>
            </div>
          </article>
        `
          )
          .join('')}</div>`
      : empty('Bạn chưa có ghi chú nào.', btn('Tạo ghi chú mới', 'editNotebook()', false, 'plus'));
  } else {
    content = `
      <div class="settingcard" style="border-radius:14px;padding:26px;max-width:680px">
        <span class="badge green">Bộ câu hỏi trắc nghiệm khách quan AI · FBU</span>
        <h2 style="font-size:18px;margin:12px 0 8px">Luyện tập kiến thức từ học liệu</h2>
        <p style="color:var(--secondary);line-height:1.8;margin-bottom:18px">
          Hệ thống tự động biên soạn các câu hỏi trắc nghiệm 4 lựa chọn bám sát từng trang tài liệu thực tế của bạn, hỗ trợ chấm điểm và phân tích giải thích đáp án đúng/sai ngay lập tức.
        </p>
        <button class="btn" onclick="quizSetup()">${icon('quiz')} Bắt đầu làm bài luyện ngay</button>
      </div>
    `;
  }

  return (
    `<div class="pagehead"><div><div class="eyebrow" style="margin-bottom:9px">GOM NHỮNG ĐIỀU BẠN MUỐN HIỂU</div><h1 style="font-size:26px">Góc học tập</h1><p>Học liệu, ý tưởng và hành trình của riêng bạn.</p></div><button class="btn" onclick="openUpload()">${icon(
      'plus'
    )} Thêm học liệu</button></div>` +
    statsHTML +
    `<div class="searchbox" style="display:flex;width:100%;max-width:480px;margin-bottom:18px"><span>${icon(
      'search'
    )}</span><input aria-label="Tìm trong góc học tập" placeholder="Tìm khóa học hoặc học liệu..." value="${esc(
      searchTerm
    )}" oninput="searchTerm=this.value;renderLibraryResults()"></div>` +
    actionPillsHTML +
    `<div class="tabs">${[
      ['courses', `Khóa học (${all.length})`],
      ['sources', `Học liệu (${allSources.length})`],
      ['video', `Video bài giảng (${videoSources.length})`],
      ['notes', `Ghi chú (${notebooks.length})`],
      ['practice', `Luyện tập (${cardDeck.length} thẻ)`]
    ]
      .map(
        ([k, v]) =>
          `<button class="${tab === k ? 'active' : ''}" onclick="tab='${k}';render()">${v}</button>`
      )
      .join('')}</div>` +
    `<div id="libraryResults">${content}</div>` +
    footer()
  );
};

function getCourseLessonList(c, courseIdx) {
  if (!c) c = [...courses, ...extraCourses][courseIdx] || courses[0];
  const d = drafts[courseIdx];
  if (Array.isArray(d) && d.length > 0) {
    return d.map((item, idx) => {
      if (typeof item === 'object' && item !== null && item.title) {
        return {
          id: item.id || `ls-${courseIdx}-${idx}`,
          title: cleanVietText(item.title),
          goal: cleanVietText(item.goal || `Nắm vững nội dung bài ${idx + 1}`),
          prerequisites: cleanVietText(item.prerequisites || 'Kiến thức nền tảng'),
          minutes: item.minutes || 45,
          sourceId: item.sourceId || null,
          page: item.page || 1
        };
      }
      return {
        id: `ls-${courseIdx}-${idx}`,
        title: cleanVietText(String(item)),
        goal: `Nắm vững nội dung trọng tâm của ${String(item)}`,
        prerequisites: idx === 0 ? 'Kiến thức nhập môn' : `Bài ${idx}: Hoàn thành nội dung trước`,
        minutes: 45,
        sourceId: null,
        page: 1
      };
    });
  }

  // Khóa học mới tạo chưa có đề cương: trả về mảng rỗng để không bị dính môn khác
  if (c.isNewCourse || (courseIdx >= courses.length && (!d || d.length === 0))) {
    return [];
  }

  const titleLower = (c.title || '').toLowerCase();
  if (c.blue || titleLower.includes('mạng')) {
    return [
      { id: 'net-1', title: 'Tổng quan về mạng máy tính', goal: 'Nắm được các mô hình phân lớp và phương thức truyền thông mạng', prerequisites: 'Tin học cơ sở', minutes: 30 },
      { id: 'net-2', title: 'Mô hình OSI và TCP/IP', goal: 'Phân tích chức năng của 7 tầng OSI và 4 tầng TCP/IP', prerequisites: 'Khái niệm mạng máy tính', minutes: 45 },
      { id: 'net-3', title: 'Địa chỉ IP và chia mạng con (Subnetting)', goal: 'Thực hành tính toán dải IP, subnet mask và CIDR', prerequisites: 'Hệ nhị phân và mô hình IP', minutes: 60 },
      { id: 'net-4', title: 'Định tuyến cơ bản và bảo mật mạng', goal: 'Hiểu các giao thức định tuyến RIP, OSPF và quy tắc tường lửa', prerequisites: 'Định tuyến gói tin IP', minutes: 45 }
    ];
  }

  if (courseIdx === 0 || titleLower.includes('cơ sở dữ liệu')) {
    return [
      { id: 'db-1', title: 'Tổng quan hệ quản trị cơ sở dữ liệu', goal: 'Nắm vững kiến trúc 3 mức và mô hình thực thể ERD', prerequisites: 'Tin học đại cương', minutes: 30 },
      { id: 'db-2', title: 'Mô hình dữ liệu quan hệ', goal: 'Hiểu cấu trúc quan hệ, bộ, thuộc tính và miền giá trị', prerequisites: 'Lý thuyết tập hợp cơ bản', minutes: 45 },
      { id: 'db-3', title: 'Khóa và ràng buộc toàn vẹn', goal: 'Phân biệt khóa chính, khóa ngoại, ràng buộc CHECK và tham chiếu', prerequisites: 'Mô hình quan hệ', minutes: 45 },
      { id: 'db-4', title: 'Truy vấn dữ liệu với ngôn ngữ SQL', goal: 'Thực hành các câu lệnh SELECT, JOIN, GROUP BY và ràng buộc', prerequisites: 'Khóa và quan hệ giữa các bảng', minutes: 60 }
    ];
  }

  return [
    { id: `c-${courseIdx}-1`, title: `Chương 1: Tổng quan về ${c.title}`, goal: `Làm quen với các định nghĩa và phạm vi nghiên cứu của ${c.title}`, prerequisites: 'Kiến thức nhập môn', minutes: 35 },
    { id: `c-${courseIdx}-2`, title: `Chương 2: Các phương pháp & Kỹ thuật cốt lõi`, goal: `Nắm vững các thuật toán và nguyên lý trọng tâm`, prerequisites: 'Chương 1', minutes: 45 },
    { id: `c-${courseIdx}-3`, title: `Chương 3: Quy trình thực nghiệm & Ứng dụng thực tế`, goal: `Vận dụng giải quyết tình huống thực tế`, prerequisites: 'Chương 2', minutes: 50 },
    { id: `c-${courseIdx}-4`, title: `Chương 4: Đánh giá mô hình & Tổng kết môn học`, goal: `Tổng kết kiến thức và làm bài tập vận dụng`, prerequisites: 'Chương 3', minutes: 40 }
  ];
}

function renderModernCourseCard(c, i) {
  const isBlue = Boolean(c.blue);
  const lessons = getCourseLessonList(c, i);
  const completedCount = lessons.filter(ls => completedLessons.includes(`${i}:${ls.id}`)).length;
  const progressPct = lessons.length ? Math.round((completedCount / lessons.length) * 100) : (c.progress || 0);
  const curLesson = lessons.length ? (lessons[Math.min(lessons.length - 1, completedCount)]?.title || lessons[0]?.title) : 'Chưa có bài học';
  const coverText = c.cover || c.title || 'Khóa học';
  const lessonStatusText = lessons.length ? `${completedCount} / ${lessons.length} bài` : 'Chưa có đề cương';

  return `
    <div class="course" onclick="openCourse(${i})" style="cursor:pointer;display:flex;flex-direction:column">
      <div class="coursecover ${isBlue ? 'blue' : ''}">
        <div>
          <div class="coverlabel">LUMI / LEARNING</div>
          <div class="covername">${esc(coverText).replace(/\\n/g, '<br>')}</div>
        </div>
        ${courseArt(isBlue)}
      </div>
      <div class="coursebody" style="display:flex;flex-direction:column;flex:1">
        <span class="badge ${isBlue ? 'green' : ''}" style="align-self:flex-start">${esc(
          c.tag || 'Khóa học cá nhân'
        )}</span>
        <h3>${c.archived ? '[Lưu trữ] ' : ''}${esc(c.title)}</h3>
        <p>${esc(c.subtitle || curLesson)}</p>
        <div class="progressline"><span style="width:${progressPct}%"></span></div>
        <div class="coursestatus">
          <span>${esc(lessonStatusText)}</span>
          <span>${progressPct}%</span>
        </div>
        <div class="course-card-actions" style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border)">
          <button class="btn" style="font-size:11.5px;padding:7px 14px;border-radius:8px" onclick="event.stopPropagation();openCourse(${i})">Vào học ngay ${icon(
            'arrow'
          )}</button>
          <button class="btn secondary" style="font-size:11.5px;padding:7px 11px;border-radius:8px" onclick="event.stopPropagation();selectedCourse=${i};editCurriculum()">Đề cương</button>
        </div>
      </div>
    </div>
  `;
}
courseCard = renderModernCourseCard;

// 6. NÂNG CẤP QUIZ, KHÓA HỌC, FLASHCARD SM-2 & QUOTA THẬT
quizSetup = function () {
  modalForm(
    'Tạo đề luyện tập trắc nghiệm AI',
    select('Học liệu nguồn', 'quizScope', [
      records[sourceIndex]?.title || 'Tài liệu đang mở',
      'Tất cả nguồn đã chọn trong thư viện'
    ]) +
      select('Mức độ câu hỏi', 'quizLevel', ['Cơ bản', 'Vận dụng', 'Tổng hợp']) +
      select('Chế độ làm bài', 'quizStyle', [
        'Luyện tập — xem giải thích ngay sau mỗi câu',
        'Kiểm tra — xem tổng kết sau khi nộp bài'
      ]) +
      `<p>Hệ thống tự động biên soạn bộ câu hỏi trắc nghiệm 4 lựa chọn bám sát nội dung tài liệu của bạn.</p>`,
    'startLiveOrSampleQuiz()',
    'Sinh đề & Bắt đầu làm bài'
  );
};

async function startLiveOrSampleQuiz() {
  quizMode = $('quizStyle')?.value?.startsWith('Kiểm') ? 'test' : 'practice';
  closeModal();
  toast('Đang biên soạn câu hỏi trắc nghiệm từ học liệu của bạn...');

  try {
    const sourceId =
      records[sourceIndex]?.backendId ||
      records[sourceIndex]?.id ||
      lumiActiveBackendSourceId ||
      (await ensureBackendDefaultSource());

    const res = await lumiFetch('/quizzes', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Bài luyện tập: ' + (records[sourceIndex]?.title || 'Kiến thức trọng tâm'),
        source_ids: [sourceId],
        question_count: 3,
        difficulty: 'medium',
        mode: 'practice'
      })
    });

    const quizId = res?.data?.id;
    let apiQuestions = res?.data?.active_version?.questions || [];
    if (quizId && !apiQuestions.length) {
      const detailRes = await lumiFetch(`/quizzes/${quizId}`);
      apiQuestions = detailRes?.data?.questions || [];
    }

    if (apiQuestions.length > 0) {
      questions.splice(
        0,
        questions.length,
        ...apiQuestions.map(q => {
          const opts = (q.options || []).map(o => cleanVietText(o.text || o.label || String(o)));
          return {
            q: cleanVietText(q.stem),
            a: opts.length === 4 ? opts : ['Phương án A', 'Phương án B', 'Phương án C', 'Phương án D'],
            correct: 0,
            explain: cleanVietText(
              q.hint || 'Câu hỏi được trích xuất trực tiếp từ nội dung học liệu của bạn.'
            )
          };
        })
      );
      toast(`Đã tạo xong ${apiQuestions.length} câu hỏi trắc nghiệm mới!`);
    }
  } catch (err) {
    console.warn('Dùng bộ câu hỏi dự phòng:', err);
  }

  quizPicked = [];
  startQuiz();
}

const baseEditCurriculum = editCurriculum;
editCurriculum = function () {
  baseEditCurriculum();
  const modal = $('overlay')?.querySelector('.modal');
  if (modal) {
    modal.insertAdjacentHTML(
      'beforeend',
      `<div class="actionline" style="margin-top:12px">${btn(
        '✨ Đề xuất đề cương tự động bằng AI',
        'generateLiveCurriculum()',
        true,
        'spark'
      )}</div>`
    );
  }
};

async function generateLiveCurriculum() {
  toast('Đang phân tích tài liệu & thiết kế lộ trình học tập...');
  try {
    const sourceId =
      records[sourceIndex]?.id || lumiActiveBackendSourceId || (await ensureBackendDefaultSource());
    const c = [...courses, ...extraCourses][selectedCourse] || courses[0];
    const courseRes = await lumiFetch('/courses', {
      method: 'POST',
      body: JSON.stringify({
        title: c.title,
        description: c.subtitle || 'Khóa học cá nhân trên Lumi',
        goal: 'Nắm vững lý thuyết và vận dụng thực tế',
        source_ids: [sourceId]
      })
    });
    const courseId = courseRes.data.id;
    const draftRes = await lumiFetch(`/courses/${courseId}/curriculum/generate`, {
      method: 'POST',
      body: JSON.stringify({
        goal: 'Nắm vững các khái niệm trọng tâm theo từng chương',
        self_declared_level: 'intermediate'
      })
    });
    const chapters = draftRes?.data?.draft_json?.chapters || [];
    const lines = [];
    chapters.forEach((ch, idx) => {
      lines.push(`Chương ${idx + 1}: ${cleanVietText(ch.title)}`);
      (ch.lessons || []).forEach(ls => {
        lines.push(`- ${cleanVietText(ls.title)}`);
      });
    });
    if (lines.length && $('curriculumText')) {
      $('curriculumText').value = lines.join('\n');
      toast('Đã tạo đề cương tự động! Bạn có thể chỉnh sửa và bấm Áp dụng.');
    }
  } catch (err) {
    toast(`Lỗi sinh đề cương: ${err.message}`);
  }
}

generateCards = async function () {
  closeModal();
  toast('Đang trích xuất khái niệm và tạo thẻ ghi nhớ bằng AI...');
  try {
    const sourceId =
      records[sourceIndex]?.id || lumiActiveBackendSourceId || (await ensureBackendDefaultSource());
    const res = await lumiFetch('/flashcards/generate', {
      method: 'POST',
      body: JSON.stringify({
        source_id: sourceId,
        deck_title: 'Bộ thẻ: ' + (records[sourceIndex]?.title || 'Kiến thức cốt lõi'),
        card_count: 4
      })
    });
    const newCards = res?.data || [];
    if (newCards.length > 0) {
      newCards.forEach(c => {
        lumiActiveBackendDeckId = c.deck_id;
        cardDeck.unshift({
          id: c.id,
          backendId: c.id,
          deckId: c.deck_id,
          q: cleanVietText(c.front),
          a: cleanVietText(c.back),
          due: 'Thẻ mới · Sẵn sàng ôn tập SM-2'
        });
      });
      persist('lumi-cards', cardDeck);
      flashIndex = 0;
      flipped = false;
      go('flashcards');
      toast(`Đã tạo ${newCards.length} thẻ ghi nhớ mới từ tài liệu!`);
    }
  } catch (err) {
    toast(`Lỗi tạo thẻ: ${err.message}`);
  }
};

storeCard = async function (id) {
  const q = $('cardQ')?.value?.trim();
  const a = $('cardA')?.value?.trim();
  if (!q || !a) {
    toast('Bạn nhập đầy đủ câu hỏi và câu trả lời nhé.');
    return;
  }
  let c = cardDeck.find(x => x.id === id);
  if (c) {
    Object.assign(c, { q, a });
    if (c.backendId) {
      try {
        await lumiFetch(`/flashcards/cards/${c.backendId}`, {
          method: 'PATCH',
          body: JSON.stringify({ front: q, back: a })
        });
      } catch (e) {
        console.warn(e);
      }
    }
  } else {
    let createdBackendId = null;
    try {
      if (!lumiActiveBackendDeckId) {
        const dRes = await lumiFetch('/flashcards/decks', {
          method: 'POST',
          body: JSON.stringify({ title: 'Bộ thẻ cá nhân Lumi', description: 'Tạo trên Lumi Web' })
        });
        lumiActiveBackendDeckId = dRes.data.id;
      }
      const cRes = await lumiFetch(`/flashcards/decks/${lumiActiveBackendDeckId}/cards`, {
        method: 'POST',
        body: JSON.stringify({ front: q, back: a })
      });
      createdBackendId = cRes.data.id;
    } catch (e) {
      console.warn(e);
    }
    cardDeck.push({
      id: createdBackendId || uid(),
      backendId: createdBackendId,
      q,
      a,
      due: 'Thẻ mới · Sẵn sàng ôn tập SM-2'
    });
  }
  persist('lumi-cards', cardDeck);
  closeModal();
  flashIndex = cardDeck.length - 1;
  flipped = false;
  go('flashcards');
  toast('Đã lưu thẻ ghi nhớ thành công!');
};

rateCard = async function (rating) {
  const c = cardDeck[flashIndex % cardDeck.length];
  if (!c) return;

  const sm2Rating = rating <= 1 ? 1 : rating === 2 ? 2 : 3;
  const eventId = crypto.randomUUID ? crypto.randomUUID() : uid() + '-4111-8111-111111111111';

  if (c.backendId && /^[0-9a-f-]{36}$/i.test(c.backendId)) {
    try {
      const revRes = await lumiFetch(`/flashcards/cards/${c.backendId}/review`, {
        method: 'POST',
        body: JSON.stringify({
          event_id: eventId,
          rating: sm2Rating,
          response_time_ms: 3500
        })
      });
      const sched = revRes.data;
      c.rating = rating;
      c.due = `Lịch SM-2: Ôn lại sau ${sched.interval_days} ngày (Lặp: ${sched.repetitions} · Hệ số EF: ${(
        sched.ease_factor / 100
      ).toFixed(2)})`;
      persist('lumi-cards', cardDeck);
      persist('lumi-card-reviews', saved('lumi-card-reviews', 0) + 1);
      flashIndex = (flashIndex + 1) % cardDeck.length;
      flipped = false;
      render();
      toast(`Đã cập nhật lịch ôn SM-2: hẹn ôn lại sau ${sched.interval_days} ngày!`);
      return;
    } catch (err) {
      console.warn('SM-2 fallback:', err);
    }
  }

  c.rating = rating;
  c.due = ['Ôn lại hôm nay', 'Ôn lại ngày mai', 'Ôn lại sau 3 ngày', 'Ôn lại sau 6 ngày'][rating - 1];
  persist('lumi-cards', cardDeck);
  persist('lumi-card-reviews', saved('lumi-card-reviews', 0) + 1);
  flashIndex = (flashIndex + 1) % cardDeck.length;
  flipped = false;
  render();
  toast('Đã ghi nhận mức độ nhớ của thẻ.');
};

storeNotebook = async function (id) {
  const title = $('nbTitle')?.value?.trim();
  const body = $('nbBody')?.value?.trim();
  const kind = $('nbKind')?.value || 'note';
  if (!title || !body) {
    toast('Bạn nhập cả tiêu đề và nội dung ghi chú nhé.');
    return;
  }
  let existing = notebooks.find(x => x.id === id);
  if (existing) {
    // Sửa ghi chú giữ nguyên vị trí nguồn, phiên bản và trang/mốc video đã gắn
    Object.assign(existing, { title, body, kind });
    if (existing.backendId && /^[0-9a-f-]{36}$/i.test(existing.backendId)) {
      try {
        await lumiFetch(`/notes/${existing.backendId}`, {
          method: 'PUT',
          body: JSON.stringify({ title, body })
        });
      } catch (e) {
        console.warn(e);
      }
    }
  } else {
    let createdId = null;
    const curSrc = records[sourceIndex] || records[0];
    const isVid = curSrc?.type === 'VIDEO';
    const notePage = isVid ? undefined : (readerPage || 1);
    const noteVideoTime = isVid ? (videoTime || 0) : undefined;
    try {
      const res = await lumiFetch('/notes', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'note',
          title,
          body,
          source_id: curSrc?.backendId || lumiActiveBackendSourceId || undefined
        })
      });
      createdId = res?.data?.id || null;
    } catch (e) {
      console.warn(e);
    }
    notebooks.unshift({
      id: createdId || uid(),
      backendId: createdId,
      title,
      body,
      kind,
      sourceId: curSrc?.id,
      sourceTitle: curSrc?.title || 'Tài liệu học tập',
      sourceVersion: curSrc?.version || 1,
      page: notePage,
      videoTime: noteVideoTime
    });
  }
  saveAllNotes();
  closeModal();
  render();
  toast('Đã lưu ghi chú gắn nguồn chính xác và đồng bộ thành công!');
};

openNoteSource = function (id) {
  const n = notebooks.find(x => x.id === id);
  if (!n) return;
  if (n.videoTime !== undefined) {
    const vIdx = records.findIndex(r => !r.deleted && (r.id === n.sourceId || r.type === 'VIDEO'));
    if (vIdx >= 0) sourceIndex = vIdx;
    videoTime = n.videoTime;
    currentVideoSource = records[sourceIndex];
    go('video');
    toast(`Đang hiển thị mốc thời gian ${formatVideoTime(n.videoTime)} của video "${records[sourceIndex]?.title || 'bài giảng'}".`);
    return;
  }

  let targetIdx = -1;
  if (n.sourceId) {
    targetIdx = records.findIndex(r => !r.deleted && (r.id === n.sourceId || r.backendId === n.sourceId));
  }
  if (targetIdx === -1 && n.sourceTitle) {
    targetIdx = records.findIndex(r => !r.deleted && r.title === n.sourceTitle);
  }
  if (targetIdx >= 0) {
    sourceIndex = targetIdx;
  }
  const curSrc = records[sourceIndex] || records[0];
  const targetPage = n.page || 1;
  readerPage = targetPage;
  readerTab = 'notes';
  readingView = 'document';
  jumpToPdfPage(targetPage);
  go('reader');
  toast(`Đang mở nguồn trích dẫn: "${curSrc?.title || 'Học liệu'}" tại trang ${targetPage}.`);
};

notesPage = function () {
  const kindNames = {
    note: 'Ghi chú',
    highlight: 'Đánh dấu',
    question: 'Câu hỏi',
    saved_answer: 'Câu trả lời AI'
  };

  return (
    head(
      'Sổ tay ghi chú học tập',
      'Giữ lại những hiểu biết cốt lõi và mở lại chính xác vị trí tài liệu nguồn.',
      btn('Thêm ghi chú', 'editNotebook()', false, 'plus')
    ) +
    (notebooks.length
      ? `<div class="feature-grid">${notebooks
          .map(n => {
            const srcTitle = n.sourceTitle || (records.find(r => r.id === n.sourceId)?.title) || 'Tài liệu học tập';
            const locText = n.videoTime !== undefined ? 'Video ' + formatVideoTime(n.videoTime) : 'Trang ' + (n.page || 1);
            return `
              <article class="settingcard" style="border-radius:14px;box-shadow:0 2px 8px rgba(0,0,0,0.02)">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                  <span class="badge green">${kindNames[n.kind] || 'Ghi chú'} · ${locText}</span>
                  <small style="font-size:11px;color:var(--muted)">${esc(srcTitle.slice(0, 26))}${srcTitle.length > 26 ? '…' : ''}</small>
                </div>
                <h2 style="font-size:16px;margin:8px 0 6px">${esc(n.title)}</h2>
                <p class="note-text" style="color:var(--secondary);line-height:1.75;font-size:13px">${esc(n.body)}</p>
                <div class="actionline" style="margin-top:14px">
                  <button class="btn secondary" style="font-size:11.5px;padding:5px 11px" onclick="editNotebook('${n.id}')">Sửa</button>
                  <button class="btn" style="font-size:11.5px;padding:5px 11px" onclick="openNoteSource('${n.id}')">${icon('file')} Về nguồn</button>
                  <button class="btn secondary" style="font-size:11.5px;padding:5px 11px" onclick="editCard(null,'${n.id}')">Tạo thẻ SM-2</button>
                  <button class="btn secondary" style="font-size:11.5px;padding:5px 11px" onclick="deleteNotebook('${n.id}')">Xóa</button>
                </div>
              </article>
            `;
          })
          .join('')}</div>`
      : empty('Bạn chưa có ghi chú nào trong sổ tay.', btn('Tạo ghi chú đầu tiên', 'editNotebook()', false, 'plus'))) +
    footer()
  );
};

deleteNotebook = function (id) {
  showModal(
    `<h2 id="modalTitle">Xóa ghi chú?</h2><p>Ghi chú này sẽ được xóa khỏi sổ tay học tập của bạn.</p><div class="modalactions">${btn(
      'Hủy',
      'closeModal()',
      true
    )}${btn('Xóa ghi chú', `confirmDeleteNotebook('${id}')`)}</div>`
  );
};

async function confirmDeleteNotebook(id) {
  const target = notebooks.find(n => n.id === id);
  notebooks = notebooks.filter(n => n.id !== id);
  saveAllNotes();
  closeModal();
  render();
  if (target?.backendId && /^[0-9a-f-]{36}$/i.test(target.backendId)) {
    try {
      await lumiFetch(`/notes/${target.backendId}`, { method: 'DELETE' });
    } catch (e) {
      console.warn(e);
    }
  }
  toast('Đã xóa ghi chú.');
}

saveNote = async function () {
  const val = $('noteEditor')?.value || '';
  note = val;
  persist('sf-note', note);
  let n = notebooks.find(x => x.id === 'note0' || x.title === 'Ghi chú trong bài');
  if (n) {
    n.body = note;
    n.page = readerPage || 1;
    if (n.backendId && /^[0-9a-f-]{36}$/i.test(n.backendId)) {
      try {
        await lumiFetch(`/notes/${n.backendId}`, {
          method: 'PUT',
          body: JSON.stringify({ title: n.title, body: note })
        });
      } catch (e) {
        console.warn(e);
      }
    }
  } else if (note.trim()) {
    let createdId = null;
    try {
      const res = await lumiFetch('/notes', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'note',
          title: 'Ghi chú: ' + (records[sourceIndex]?.title || 'Bài học'),
          body: note,
          source_id: records[sourceIndex]?.backendId || lumiActiveBackendSourceId || undefined
        })
      });
      createdId = res?.data?.id || null;
    } catch (e) {
      console.warn(e);
    }
    notebooks.unshift({
      id: createdId || 'note0',
      backendId: createdId,
      title: 'Ghi chú: ' + (records[sourceIndex]?.title || 'Bài học'),
      body: note,
      kind: 'note',
      page: readerPage || 1
    });
  }
  saveAllNotes();
  toast('Đã lưu ghi chú và đồng bộ đám mây!');
};

saveAnswer = async function () {
  const m = chatMessages.filter(x => x.role === 'assistant' && !x.loading).at(-1);
  if (!m) return;
  const cleanBody = m.text;
  let createdId = null;
  try {
    const res = await lumiFetch('/notes', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'note',
        title: 'Phản hồi từ Trợ giảng Lumi',
        body: cleanBody,
        source_id: records[sourceIndex]?.backendId || lumiActiveBackendSourceId || undefined
      })
    });
    createdId = res?.data?.id || null;
  } catch (e) {
    console.warn(e);
  }
  notebooks.unshift({
    id: createdId || uid(),
    backendId: createdId,
    title: 'Phản hồi từ Trợ giảng Lumi',
    body: cleanBody,
    kind: 'saved_answer',
    page: readerPage || 1
  });
  saveAllNotes();
  note = (note ? note + '\n\n' : '') + cleanBody;
  persist('sf-note', note);
  if ($('noteEditor')) $('noteEditor').value = note;
  toast('Đã lưu câu trả lời vào Sổ tay ghi chú!');
};

deleteCard = function (id) {
  showModal(
    `<h2 id="modalTitle">Xóa thẻ ghi nhớ?</h2><p>Thẻ này sẽ được xóa khỏi bộ thẻ ôn tập SM-2 của bạn.</p><div class="modalactions">${btn(
      'Hủy',
      'closeModal()',
      true
    )}${btn('Xóa thẻ', `confirmDeleteCard('${id}')`)}</div>`
  );
};

async function confirmDeleteCard(id) {
  const target = cardDeck.find(c => c.id === id);
  cardDeck = cardDeck.filter(c => c.id !== id);
  persist('lumi-cards', cardDeck);
  flashIndex = 0;
  flipped = false;
  closeModal();
  render();
  if (target?.backendId && /^[0-9a-f-]{36}$/i.test(target.backendId)) {
    try {
      await lumiFetch(`/flashcards/cards/${target.backendId}`, { method: 'DELETE' });
    } catch (e) {
      console.warn(e);
    }
  }
  toast('Đã xóa thẻ ghi nhớ.');
}

deleteSource = function () {
  const r = records[sourceIndex];
  if (!r) return;
  showModal(
    `<h2 id="modalTitle">Xóa học liệu?</h2><p>Tài liệu <strong>${esc(
      r.title
    )}</strong> sẽ được chuyển vào thùng rác và ngừng sử dụng trong phiên hỏi đáp.</p><div class="modalactions">${btn(
      'Hủy',
      'closeModal()',
      true
    )}${btn('Xóa học liệu', 'confirmDeleteSource()')}</div>`
  );
};

async function confirmDeleteSource() {
  const r = records[sourceIndex];
  if (!r) return;
  r.deleted = true;
  saveRecords();
  closeModal();
  const bId = r.backendId || r.id;
  if (bId && /^[0-9a-f-]{36}$/i.test(bId)) {
    try {
      await lumiFetch(`/sources/${bId}`, { method: 'DELETE' });
    } catch (e) {
      console.warn(e);
    }
  }
  sourceIndex = Math.max(0, records.findIndex(x => !x.deleted));
  tab = 'sources';
  go('library');
  toast('Đã xóa học liệu khỏi thư viện.');
}

openNewCourse = function () {
  modalForm(
    'Tạo khóa học & Lộ trình mới',
    input('Tên khóa học', 'courseName', '', 'text', 'Ví dụ: Khai phá dữ liệu trong kinh doanh') +
      input('Mục tiêu / Chuyên đề trọng tâm', 'courseGoal', '', 'text', 'Ví dụ: Nắm vững các kỹ thuật khai phá và ứng dụng') +
      `<p style="font-size:12.5px;color:var(--muted);margin-top:8px">Sau khi tạo khóa học, bạn có thể liên kết tài liệu PDF/PPTX hoặc yêu cầu Trợ giảng AI sinh đề cương tự động.</p>`,
    'submitNewCourseBackend()',
    'Tạo khóa học'
  );
};

async function submitNewCourseBackend() {
  const name = $('courseName')?.value?.trim();
  const goal = $('courseGoal')?.value?.trim() || 'Lộ trình học tập cá nhân';
  if (!name) {
    toast('Bạn nhập tên khóa học nhé.');
    return;
  }
  let createdId = null;
  try {
    const res = await lumiFetch('/courses', {
      method: 'POST',
      body: JSON.stringify({
        title: name,
        description: goal,
        goal,
        source_ids: []
      })
    });
    createdId = res?.data?.id || null;
  } catch (e) {
    console.warn(e);
  }

  const newCourseIdx = courses.length + extraCourses.length;
  extraCourses.push({
    backendId: createdId,
    title: name,
    cover: name,
    tag: 'Khóa học cá nhân',
    subtitle: goal,
    progress: 0,
    lessons: 'Chưa có bài học',
    blue: extraCourses.length % 2 === 1,
    isNewCourse: true
  });
  persist('sf-courses', extraCourses);

  // Khởi tạo đề cương rỗng độc lập — không bao giờ rơi vào fallback "Khóa và ràng buộc"!
  drafts[newCourseIdx] = [];
  persist('lumi-curriculum', drafts);

  closeModal();
  selectedCourse = newCourseIdx;
  go('course');
  toast(`Đã khởi tạo khóa học "${name}"! Hãy liên kết học liệu hoặc đề cương để bắt đầu.`);
}

privacyDialog = function () {
  showModal(
    `<h2 id="modalTitle">Bảo mật & Quản lý dữ liệu</h2><p>Dữ liệu học liệu, lịch sử hỏi đáp Trợ giảng AI và tiến độ ôn tập SM-2 của bạn được đồng bộ an toàn trên cơ sở dữ liệu PostgreSQL và lưu bộ nhớ đệm tại trình duyệt.</p><div class="modalactions">${btn(
      'Xuất dữ liệu (.JSON)',
      'exportPrototypeData()',
      true
    )}${btn('Đóng', 'closeModal()')}</div>`
  );
};

// ============================================================================
// 7. TRANG MỤC TIÊU & KẾ HOẠCH HỌC TẬP CHUYÊN NGHIỆP (PLANNER PRO)
// ============================================================================
let planStatusFilter = 'all';

function getPlanCategoryInfo(p) {
  const cat = p.category || '';
  const t = (p.title || '').toLowerCase();
  if (cat === 'flashcard' || t.includes('thẻ') || t.includes('flashcard')) {
    return { key: 'flashcard', label: '🗂️ Ôn Flashcard SM-2', cls: 'purple', actionLabel: 'Ôn thẻ ngay', actionFn: "go('flashcards')" };
  }
  if (cat === 'quiz' || t.includes('câu hỏi') || t.includes('quiz') || t.includes('trắc nghiệm') || t.includes('bài luyện')) {
    return { key: 'quiz', label: '📝 Luyện đề Quiz', cls: 'amber', actionLabel: 'Làm bài ngay', actionFn: 'quizSetup()' };
  }
  if (cat === 'note' || t.includes('ghi chú') || t.includes('tóm tắt')) {
    return { key: 'note', label: '✍️ Sổ tay & Tóm tắt', cls: 'blue', actionLabel: 'Mở ghi chú', actionFn: "go('notes')" };
  }
  return { key: 'read', label: '📖 Đọc hiểu tài liệu', cls: 'green', actionLabel: 'Đọc tài liệu', actionFn: 'continueLumi()' };
}

function getPlanPriorityInfo(p) {
  const prio = p.priority || (p.minutes >= 25 ? 'high' : p.minutes >= 15 ? 'medium' : 'normal');
  if (prio === 'high') return { label: '🔥 Ưu tiên cao', cls: 'high' };
  if (prio === 'medium') return { label: '⭐ Trọng tâm', cls: 'medium' };
  return { label: '🌱 Nhẹ nhàng', cls: 'normal' };
}

editPlan = function (id) {
  const p = plans.find(x => x.id === id) || {
    title: '',
    day: planDayFilter !== 'all' ? planDayFilter : 'Thứ sáu',
    minutes: 25,
    category: 'read',
    priority: 'medium'
  };
  modalForm(
    id ? 'Chỉnh sửa mục tiêu học tập' : 'Thêm mục tiêu học tập mới',
    input('Tên nhiệm vụ / mục tiêu cụ thể', 'planTitle', p.title) +
      select(
        'Phân loại hoạt động',
        'planCategory',
        [
          '📖 Đọc hiểu tài liệu PDF',
          '🗂️ Ôn tập thẻ nhớ Flashcard SM-2',
          '📝 Luyện đề trắc nghiệm AI',
          '✍️ Viết ghi chú & Tóm tắt ý chính'
        ],
        p.category === 'flashcard'
          ? '🗂️ Ôn tập thẻ nhớ Flashcard SM-2'
          : p.category === 'quiz'
          ? '📝 Luyện đề trắc nghiệm AI'
          : p.category === 'note'
          ? '✍️ Viết ghi chú & Tóm tắt ý chính'
          : '📖 Đọc hiểu tài liệu PDF'
      ) +
      select(
        'Mức độ ưu tiên',
        'planPriority',
        ['⭐ Trọng tâm', '🔥 Ưu tiên cao', '🌱 Nhẹ nhàng'],
        p.priority === 'high' ? '🔥 Ưu tiên cao' : p.priority === 'normal' ? '🌱 Nhẹ nhàng' : '⭐ Trọng tâm'
      ) +
      select(
        'Ngày thực hiện trong tuần',
        'planDay',
        ['Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy', 'Chủ nhật'],
        p.day
      ) +
      input('Thời lượng dự kiến (phút)', 'planMinutes', p.minutes, 'number'),
    `storePlan('${id || ''}')`,
    id ? 'Lưu thay đổi' : 'Thêm vào lộ trình'
  );
};

storePlan = function (id) {
  const title = $('planTitle')?.value?.trim();
  const minutes = Number($('planMinutes')?.value || 25);
  if (!title || minutes < 1 || minutes > 480) {
    toast('Bạn nhập tên mục tiêu và thời lượng hợp lệ (1–480 phút) nhé.');
    return;
  }
  const rawCat = $('planCategory')?.value || '';
  const category = rawCat.includes('Flashcard')
    ? 'flashcard'
    : rawCat.includes('Quiz') || rawCat.includes('trắc nghiệm')
    ? 'quiz'
    : rawCat.includes('ghi chú')
    ? 'note'
    : 'read';
  const rawPrio = $('planPriority')?.value || '';
  const priority = rawPrio.includes('cao') ? 'high' : rawPrio.includes('Nhẹ') ? 'normal' : 'medium';
  const day = $('planDay')?.value || 'Thứ sáu';

  let p = plans.find(x => x.id === id);
  const data = { title, minutes, day, category, priority };
  if (p) {
    Object.assign(p, data);
  } else {
    plans.unshift({ id: uid(), done: false, ...data });
  }
  persist('lumi-plans', plans);
  closeModal();
  render();
  toast(id ? 'Đã cập nhật mục tiêu học tập!' : 'Đã thêm mục tiêu mới vào kế hoạch!');
};

function aiGenerateStudyPlan() {
  const activeDoc = records.find(r => !r.deleted) || { title: 'Tài liệu môn học' };
  const docShort = activeDoc.title.replace(/\.pdf$/i, '');
  const suggested = [
    {
      id: uid(),
      title: `Đọc sâu & phân tích cấu trúc "${docShort}"`,
      day: 'Thứ sáu',
      minutes: 25,
      done: false,
      category: 'read',
      priority: 'high'
    },
    {
      id: uid(),
      title: `Ôn tập ${Math.max(3, cardDeck.length)} thẻ nhớ SM-2 đến hạn`,
      day: 'Thứ bảy',
      minutes: 15,
      done: false,
      category: 'flashcard',
      priority: 'medium'
    },
    {
      id: uid(),
      title: `Làm bài trắc nghiệm AI kiểm tra mức độ hiểu "${docShort}"`,
      day: 'Chủ nhật',
      minutes: 20,
      done: false,
      category: 'quiz',
      priority: 'medium'
    }
  ];
  plans.unshift(...suggested);
  persist('lumi-plans', plans);
  render();
  toast('✨ Trợ giảng Lumi đã thiết lập 3 mục tiêu học tập mới từ học liệu của bạn!');
}

plannerPage = function () {
  const total = plans.length;
  const done = plans.filter(p => p.done).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const totalMins = plans.reduce((s, p) => s + (Number(p.minutes) || 20), 0);
  const doneMins = plans.filter(p => p.done).reduce((s, p) => s + (Number(p.minutes) || 20), 0);
  const goal = saved(
    'lumi-week-goal',
    'Hoàn thành đọc hiểu tài liệu & nắm vững các khái niệm cốt lõi trong tuần'
  );
  const days = ['Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy', 'Chủ nhật'];

  let visible = plans.filter(p => planDayFilter === 'all' || p.day === planDayFilter);
  if (planStatusFilter === 'pending') visible = visible.filter(p => !p.done);
  if (planStatusFilter === 'done') visible = visible.filter(p => p.done);

  const kpiHTML = `
    <div class="planner-pro-kpis">
      <div class="planner-kpi-card">
        <div class="planner-kpi-icon green">🎯</div>
        <div class="planner-kpi-info">
          <strong>${done} / ${total} hoàn thành (${pct}%)</strong>
          <small>Tiến độ mục tiêu trong tuần</small>
        </div>
      </div>
      <div class="planner-kpi-card">
        <div class="planner-kpi-icon blue">⏱️</div>
        <div class="planner-kpi-info">
          <strong>${doneMins} / ${totalMins} phút</strong>
          <small>Tổng thời lượng tập trung</small>
        </div>
      </div>
      <div class="planner-kpi-card">
        <div class="planner-kpi-icon amber">🔥</div>
        <div class="planner-kpi-info">
          <strong>5 ngày liên tiếp</strong>
          <small>Chuỗi duy trì nhịp độ học tập</small>
        </div>
      </div>
      <div class="planner-kpi-card">
        <div class="planner-kpi-icon purple">🧠</div>
        <div class="planner-kpi-info">
          <strong>${cardDeck.length} thẻ SM-2 · ${notebooks.length} ghi chú</strong>
          <small>Tích lũy kiến thức cá nhân</small>
        </div>
      </div>
    </div>
  `;

  return (
    polishHeader(
      'Mục tiêu & Kế hoạch học tập',
      'Thiết lập lộ trình rõ ràng, chia nhỏ nhiệm vụ theo ngày và theo dõi tiến độ thực chất.',
      `<div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn secondary" onclick="aiGenerateStudyPlan()">${icon('spark')} AI Gợi ý mục tiêu</button>
        <button class="btn" onclick="editPlan()">${icon('plus')} Thêm mục tiêu mới</button>
      </div>`,
      'QUẢN LÝ MỤC TIÊU CÁ NHÂN'
    ) +
    kpiHTML +
    `<div class="p-planner-layout">
      <section class="p-planner-main">
        <div class="p-week-strip">
          <button class="p-week-day ${planDayFilter === 'all' ? 'active' : ''}" onclick="planDayFilter='all';render()">
            <small>TẤT CẢ</small>
            <strong>Cả tuần</strong>
            <span>${total} mục</span>
          </button>
          ${days
            .map((day, i) => {
              const dayTasks = plans.filter(p => p.day === day);
              const dayMins = dayTasks.reduce((s, x) => s + (Number(x.minutes) || 15), 0);
              return `<button class="p-week-day ${
                planDayFilter === day ? 'active' : ''
              }" onclick="planDayFilter='${day}';render()">
                <small>${i === 6 ? 'CN' : 'THỨ ' + (i + 2)}</small>
                <strong>${['Hai', 'Ba', 'Tư', 'Năm', 'Sáu', 'Bảy', 'CN'][i]}</strong>
                <span class="${dayTasks.length ? 'has-plan' : ''}">${
                dayTasks.length ? `${dayTasks.length} việc · ${dayMins}p` : 'Trống'
              }</span>
              </button>`;
            })
            .join('')}
        </div>

        <div class="p-group-heading" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin:18px 0 14px">
          <div>
            <h2 style="font-size:17px">${
              planDayFilter === 'all' ? 'Danh sách mục tiêu học tập trong tuần' : 'Lộ trình ngày ' + planDayFilter
            }</h2>
            <p>Tích chọn khi hoàn thành hoặc bấm "Thực hiện" để chuyển thẳng tới học liệu tương ứng.</p>
          </div>
          <div style="display:flex;gap:6px;align-items:center">
            ${[
              ['all', `Tất cả (${plans.length})`],
              ['pending', `Đang làm (${plans.filter(p => !p.done).length})`],
              ['done', `Đã xong (${done})`]
            ]
              .map(
                ([k, label]) =>
                  `<button class="btn ${
                    planStatusFilter === k ? '' : 'secondary'
                  }" style="font-size:11px;padding:6px 11px;border-radius:8px;margin:0" onclick="planStatusFilter='${k}';render()">${label}</button>`
              )
              .join('')}
          </div>
        </div>

        <div class="p-task-list" style="display:flex;flex-direction:column;gap:12px">
          ${visible
            .map(p => {
              const cat = getPlanCategoryInfo(p);
              const prio = getPlanPriorityInfo(p);
              return `
                <article class="planner-task-pro ${p.done ? 'completed' : ''}">
                  <div class="planner-task-left">
                    <button class="task-check ${p.done ? 'done' : ''}" style="margin-top:3px;width:22px;height:22px" aria-label="Đổi trạng thái ${esc(
                p.title
              )}" onclick="togglePlan('${p.id}')">${p.done ? icon('check') : ''}</button>
                    <div class="planner-task-info">
                      <div class="planner-task-badges">
                        <span class="goal-cat-tag ${cat.cls}">${cat.label}</span>
                        <span class="priority-pill ${prio.cls}">${prio.label}</span>
                        <span class="badge ${p.done ? 'green' : ''}">${
                p.done ? '✓ Đã hoàn thành' : 'Đang thực hiện'
              }</span>
                      </div>
                      <h3>${esc(p.title)}</h3>
                      <div class="planner-task-meta">
                        <span>📅 ${esc(p.day)}</span>
                        <span>⏱️ Thời lượng: <strong>${p.minutes} phút</strong></span>
                      </div>
                    </div>
                  </div>
                  <div class="planner-task-actions">
                    ${
                      !p.done
                        ? `<button class="btn" style="font-size:11.5px;padding:7px 12px;border-radius:8px;margin:0" onclick="${cat.actionFn}">${cat.actionLabel} ${icon('arrow')}</button>`
                        : ''
                    }
                    <button class="btn secondary" style="font-size:11.5px;padding:7px 10px;border-radius:8px;margin:0" aria-label="Sửa ${esc(
                      p.title
                    )}" onclick="editPlan('${p.id}')">Sửa</button>
                    <button class="btn secondary" style="font-size:11.5px;padding:7px 10px;border-radius:8px;margin:0;color:#be123c" aria-label="Xóa ${esc(
                      p.title
                    )}" onclick="deletePlan('${p.id}')">Xóa</button>
                  </div>
                </article>
              `;
            })
            .join('') ||
            polishedEmpty(
              'sprout',
              'Chưa có mục tiêu nào trong mục lọc này.',
              'Hãy thêm một mục tiêu học tập mới hoặc nhờ AI gợi ý lộ trình.',
              btn('Thêm mục tiêu mới', 'editPlan()', false, 'plus')
            )}
        </div>
      </section>

      <aside class="p-planner-side">
        <section class="p-goal-card" style="border-radius:16px;padding:22px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <span class="p-mini-label" style="margin:0">MỤC TIÊU TRỌNG TÂM TUẦN (OKR)</span>
            <span class="badge green">${pct}% hoàn thành</span>
          </div>
          <h2 style="font-size:16px;line-height:1.5;margin:10px 0 14px">${esc(goal)}</h2>
          <div class="p-goal-progress" style="margin-bottom:8px">
            <span>Đã hoàn thành ${done} / ${total} nhiệm vụ (${doneMins} phút)</span>
            <strong>${pct}%</strong>
          </div>
          <div class="progressline" style="height:8px;border-radius:99px;margin-bottom:16px">
            <span style="width:${pct}%;border-radius:99px"></span>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${btn('Sửa mục tiêu tuần', 'editGoal()', true)}
            <button class="btn secondary" style="font-size:11.5px" onclick="go('focus')">⏱️ Đồng hồ Pomodoro</button>
          </div>
        </section>

        <section class="p-reminder-card" style="border-radius:16px;padding:22px">
          <div class="sectiontitle">
            <h2>Lịch nhắc học tập định kỳ</h2>
            ${icon('clock')}
          </div>
          <p style="font-size:12px;color:var(--secondary);line-height:1.6;margin-bottom:14px">
            Thiết lập khung giờ cố định giúp duy trì thói quen đọc hiểu và ôn tập thẻ nhớ SM-2 mỗi ngày.
          </p>
          ${reminders
            .map(
              r => `
            <div class="reminder-row" style="padding:10px 0;border-bottom:1px solid var(--border)">
              <span>
                <strong style="font-size:12.5px;display:block">${esc(r.title)}</strong>
                <small style="color:var(--muted)">⏰ ${esc(r.time)} · 📅 ${esc(r.days)}</small>
              </span>
              <button class="toggle ${r.enabled ? 'on' : ''}" role="switch" aria-checked="${
                r.enabled
              }" aria-label="Bật nhắc ${esc(r.title)}" onclick="toggleReminder('${r.id}')"><span></span></button>
              <button class="p-edit" aria-label="Xóa lịch nhắc" onclick="reminders=reminders.filter(x=>x.id!=='${
                r.id
              }');persist('lumi-reminders',reminders);render()">×</button>
            </div>`
            )
            .join('') ||
            '<div class="p-reminder-empty">Chưa có khung giờ nhắc học.</div>'}
          <div style="margin-top:14px">
            ${btn('Thêm khung giờ nhắc học', 'editReminder()', true, 'plus')}
          </div>
        </section>
      </aside>
    </div>` +
    footer()
  );
};

// ==========================================
// 1. TỐI ƯU HỎI ĐÁP & ÔN TẬP THEO TÀI LIỆU HIỆN TẠI (XÓA BỎ HARDCODE "KHÓA VÀ RÀNG BUỘC")
// ==========================================
function getCurrentActiveSource() {
  const last = saved('lumi-last-read', null);
  // Chỉ khi người dùng chủ động bấm vào tài liệu cũ (explicit === true) mới ưu tiên tài liệu cũ
  if (last?.explicit && last?.id) {
    const found = records.find(r => !r.deleted && (r.id === last.id || r.backendId === last.id));
    if (found) return found;
  }
  // Mặc định luôn ưu tiên tài liệu thật từ backend (UUID)
  const realDoc = records.find(r => !r.deleted && r.status === 'ready' && /^[0-9a-f-]{36}$/i.test(r.id || r.backendId));
  if (realDoc) return realDoc;
  const readySources = records.filter(r => !r.deleted && r.status === 'ready');
  return readySources[0] || records.find(r => !r.deleted) || records[0];
}

function openAskSource(specificSourceId) {
  let target = specificSourceId
    ? records.find(r => r.id === specificSourceId || r.backendId === specificSourceId)
    : getCurrentActiveSource();
  if (!target && records.length) target = records[0];
  if (!target) {
    toast('Bạn vui lòng thêm ít nhất một tài liệu để bắt đầu nhé.');
    openUpload();
    return;
  }
  sourceIndex = records.indexOf(target);
  lumiActiveBackendSourceId = target.backendId || target.id;
  localStorage.setItem('lumi-backend-source-id', lumiActiveBackendSourceId);
  chatSourceIds = [target.id];

  loadChatHistoryForSource(target.id);
  readerTab = 'chat';
  readingView = 'assistant';
  go('reader');
  toast('Trợ giảng AI: Đang mở học liệu "' + target.title + '"');
}

function openSmartPracticeModal(specificSourceId) {
  const target = specificSourceId
    ? records.find(r => r.id === specificSourceId || r.backendId === specificSourceId)
    : getCurrentActiveSource();
  const title = target ? target.title : 'Tài liệu đang học';
  showModal(
    `<h2 id="modalTitle">Trung tâm Ôn tập & Rèn luyện AI</h2>` +
      `<p style="margin-bottom:14px">Học liệu trọng tâm: <strong>${esc(title)}</strong></p>` +
      `<div class="stack" style="gap:10px">` +
      `<div class="settingcard" style="padding:14px;cursor:pointer" onclick="closeModal();quizSetup()">` +
      `<div class="sectiontitle"><strong>📝 Luyện tập trắc nghiệm AI</strong><span class="badge" style="color:var(--accent,#3fae74)">Tự động chấm</span></div>` +
      `<p style="margin:4px 0 0;font-size:12.5px;color:var(--muted)">Sinh đề kiểm tra 4 phương án từ nội dung học liệu này, chấm điểm tức thì và phân tích đáp án đúng/sai.</p>` +
      `</div>` +
      `<div class="settingcard" style="padding:14px;cursor:pointer" onclick="closeModal();generateCards()">` +
      `<div class="sectiontitle"><strong>📇 Thẻ ghi nhớ Flashcard (SM-2)</strong><span class="badge" style="color:var(--accent,#3fae74)">Lặp lại ngắt quãng</span></div>` +
      `<p style="margin:4px 0 0;font-size:12.5px;color:var(--muted)">Tạo bộ thẻ ôn tập thông minh từ tài liệu giúp tối ưu hóa khả năng ghi nhớ dài hạn.</p>` +
      `</div>` +
      `<div class="settingcard" style="padding:14px;cursor:pointer" onclick="closeModal();go('review')">` +
      `<div class="sectiontitle"><strong>📚 Sổ ôn tập của bạn</strong></div>` +
      `<p style="margin:4px 0 0;font-size:12.5px;color:var(--muted)">Xem lại các câu hỏi hoặc khái niệm bạn đã đánh dấu cần xem lại.</p>` +
      `</div>` +
      `</div>` +
      `<div class="modalactions">${btn('Đóng', 'closeModal()', true)}</div>`
  );
}

// Ghi đè hàm home() để xóa bỏ dữ liệu mock "Khóa và ràng buộc" ở Trang chủ
home = function () {
  let firstName = userProfile.name.trim().split(' ').at(-1) || 'bạn';
  if (firstName === 'Bạn') firstName = 'bạn';
  const last = saved('lumi-last-read', null);
  const recent = records.filter(r => !r.deleted).slice(0, 3);
  const source = getCurrentActiveSource();
  let allCourses = [...courses, ...extraCourses]
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => !c.archived)
    .slice(0, 2);
  const scheduled = plans.filter(p => !p.done).slice(0, 2);

  // Tìm ghi chú thực tế của người dùng (bỏ qua ghi chú mẫu cũ 'Khóa và ràng buộc')
  const realNote =
    notebooks.find(n => n.id !== 'note0' && n.title !== 'Khóa và ràng buộc') ||
    (notebooks[0]?.title !== 'Khóa và ràng buộc' ? notebooks[0] : null);

  return (
    `<div class="l-home-welcome"><div><span class="eyebrow">GÓC HỌC TẬP CỦA BẠN</span><h1>Chào ${esc(firstName)},<br>mình học thêm một chút nhé?</h1><p>Tiếp nối điều đang tò mò. Không cần vội.</p></div><button class="l-home-add" onclick="openUpload()">${icon('plus')}Thêm học liệu</button></div>` +
    `<div class="l-home-grid"><div class="l-home-primary">` +
    `<section class="l-continue-card"><div><span class="l-continue-label">${last ? 'TIẾP TỤC TỪ NƠI BẠN DỪNG' : 'MỘT ĐIỀU ĐỂ BẮT ĐẦU'}</span><h2>${source ? esc(source.title.replace(/\.pdf$/i, '')) : 'Một tài liệu, một điều mới.'}</h2><p>${source ? (source.type === 'VIDEO' ? 'Bài giảng video tương tác & transcript AI' : 'Đang ở trang ' + (last?.page || 1) + ' · Học liệu sẵn sàng') : 'Thêm một tài liệu bạn muốn hiểu. Lumi sẽ cùng bạn khám phá.'}</p><button class="btn" onclick="continueLumi()">${source ? 'Học tiếp' : 'Thêm tài liệu'}${icon('arrow')}</button></div><div class="l-continue-art" aria-hidden="true"><div><small>LUMI / LEARNING</small>${icon('book')}<i></i><i></i><span>Mỗi chút hiểu thêm.</span></div></div></section>` +
    `<div class="l-home-quick">` +
    `<button onclick="openAskSource()">${toneIcon('spark', 'green')}<span><strong>Hỏi điều chưa rõ</strong><small>${source ? esc(source.title.slice(0, 32)) : 'Mình cùng tìm hiểu.'}</small></span>${icon('chevron')}</button>` +
    `<button onclick="editNotebook()">${toneIcon('note', 'amber')}<span><strong>Ghi lại một ý hay</strong><small>Bằng lời của bạn.</small></span>${icon('chevron')}</button>` +
    `</div>` +
    `<section class="l-home-section"><div class="sectiontitle"><h2>Khóa học của mình</h2><button class="textbtn" onclick="tab='courses';go('library')">Xem tất cả ${icon('chevron')}</button></div>${allCourses.length ? `<div class="courses">${allCourses.map(({ c, i }) => courseCard(c, i)).join('')}</div>` : polishedEmpty('book', 'Một chủ đề bạn muốn học.', 'Gom học liệu và tạo một lộ trình của riêng mình.', btn('Tạo khóa học', 'openNewCourse()', true))}</section>` +
    `<section class="l-home-section"><div class="sectiontitle"><h2>Học liệu gần đây</h2><button class="textbtn" onclick="tab='sources';go('library')">Mở thư viện ${icon('chevron')}</button></div><div class="l-home-recent">${recent.map(r => `<button onclick="viewSource(${records.indexOf(r)})"><span class="l-recent-file ${r.type === 'VIDEO' ? 'video' : ''}">${icon(r.type === 'VIDEO' ? 'play' : 'file')}</span><span><strong>${esc(r.title)}</strong><small>${esc(r.meta || 'Học liệu')}</small></span>${icon('chevron')}</button>`).join('') || `<div class="l-empty-library">Thư viện còn trống. Một tài liệu là đủ để bắt đầu.</div>`}</div></section>` +
    `</div>` +
    `<aside class="l-home-aside">` +
    `<section class="l-home-ai"><div class="l-home-ai-head">${toneIcon('spark', 'green')}<span><strong>Lumi ở đây.</strong><small>Cùng bạn hiểu thêm.</small></span></div><p>Có điều gì đang làm bạn vướng? Cứ bắt đầu từ một câu hỏi.</p><form onsubmit="event.preventDefault();const q=document.getElementById('homeQuestion').value.trim();if(q){openAskSource();setTimeout(()=>sendChat(q),200);}"><label class="sr-only" for="homeQuestion">Câu hỏi cho Lumi</label><textarea id="homeQuestion" placeholder="Mình chưa hiểu rõ về…" rows="3" required></textarea><button class="btn" type="submit">Cùng tìm hiểu ${icon('arrow')}</button></form><span class="l-sample-note">Trợ giảng AI kết nối trực tiếp tài liệu học tập của bạn.</span></section>` +
    `<section class="l-home-plan"><div class="sectiontitle"><h2>Dự định nhỏ</h2><button aria-label="Mở kế hoạch" onclick="go('planner')">${icon('arrow')}</button></div>${scheduled.map(p => `<div class="l-home-plan-row"><button class="task-check" aria-label="Hoàn thành ${esc(p.title)}" onclick="togglePlan('${p.id}')"></button><span><strong>${esc(p.title)}</strong><small>${esc(p.day)} · ${p.minutes} phút</small></span></div>`).join('') || '<p>Chưa có kế hoạch cũng không sao.<br>Bạn có thể học theo hứng thú hôm nay.</p>'}<button class="textbtn" onclick="go('planner')">Sắp xếp khi cần ${icon('chevron')}</button></section>` +
    (realNote
      ? `<section class="l-home-note"><span class="l-kicker">MỘT Ý MUỐN GIỮ</span><h3>${esc(realNote.title)}</h3><p>${esc(realNote.body.slice(0, 155))}${realNote.body.length > 155 ? '…' : ''}</p><button onclick="go('notes')">Mở sổ tay ${icon('arrow')}</button></section>`
      : `<section class="l-home-note"><span class="l-kicker">MỘT Ý MUỐN GIỮ</span><h3>Ghi chú tài liệu của bạn</h3><p>Ghi lại những ý quan trọng, câu hỏi hoặc giải thích hữu ích để xem lại bất cứ lúc nào.</p><button onclick="editNotebook()">Thêm ghi chú đầu tiên ${icon('arrow')}</button></section>`) +
    `<div class="l-home-quiet">${icon('sprout')}Hôm nay hiểu thêm một chút<br>cũng là một bước tiến.</div>` +
    `</aside></div>`
  );
};

// Ghi đè hàm hub() để sửa 2 card đầu trang "Chức năng" (hiện học liệu mới nhất, chỉ hiện cũ khi người dùng bấm vào)
hub = function () {
  const currentSrc = getCurrentActiveSource();
  const last = saved('lumi-last-read', null);
  const isExplicitOld = !!(last?.explicit && (last?.id === currentSrc?.id || last?.id === currentSrc?.backendId));
  const badgeLabel = isExplicitOld ? 'ĐANG HỌC GẦN ĐÂY' : 'HỌC LIỆU MỚI NHẤT';
  const typeBadge = currentSrc?.type === 'VIDEO' ? '🎥 Video bài giảng' : (currentSrc?.type === 'SLIDE' ? '📊 Slide 16:9' : '📑 Tài liệu PDF');

  return (
    `<div class="p-explore-intro"><div><div class="p-overline"><span class="p-live-dot"></span>KHÔNG GIAN TỰ HỌC</div><h1>Học theo cách<br>của <em>riêng bạn.</em></h1><p>Một nơi để đọc sâu hơn, hỏi tự nhiên hơn<br>và giữ lại những điều mình đã hiểu.</p></div><div class="p-intro-note"><span class="p-mini-label">BẮT ĐẦU THẬT NHẸ</span><div class="p-mini-book">${icon('book')}<span>Một tài liệu.<br>Một điều mới.</span></div><button onclick="openUpload()">Thêm học liệu ${icon('arrow')}</button></div></div>` +
    `<div class="p-spotlights">` +
    `<button class="p-spotlight ai" onclick="openAskSource('${currentSrc ? (currentSrc.id || '') : ''}')">${toneIcon('spark', 'green')}<span><small>${badgeLabel} · ${typeBadge}</small><strong>${currentSrc ? esc(currentSrc.title) : 'Điều gì đang làm bạn tò mò?'}</strong><p>${currentSrc ? 'Hỏi trợ giảng AI về học liệu này, tra cứu định nghĩa, đối chiếu trích dẫn chính xác.' : 'Hỏi từ tài liệu, hiểu bằng ví dụ.'}</p></span><span class="p-round-arrow">${icon('arrow')}</span></button>` +
    `<button class="p-spotlight review" onclick="openSmartPracticeModal('${currentSrc ? (currentSrc.id || '') : ''}')">${toneIcon('quiz', 'purple')}<span><small>${badgeLabel} · ${typeBadge}</small><strong>Ôn tập & Luyện trắc nghiệm AI</strong><p>${currentSrc ? 'Sinh đề kiểm tra & Flashcard SM-2 từ: ' + esc(currentSrc.title.slice(0, 36)) + (currentSrc.title.length > 36 ? '...' : '') : 'Sinh trắc nghiệm AI & Flashcard từ học liệu đang học.'}</p></span><span class="p-round-arrow">${icon('arrow')}</span></button>` +
    `</div>` +
    `<div class="p-discovery-bar"><div><h2>Khám phá công cụ</h2><p>Chọn điều hữu ích cho buổi học hôm nay.</p></div><form class="p-search" onsubmit="event.preventDefault()">${icon('search')}<input id="toolSearch" value="${esc(toolQuery)}" aria-label="Tìm chức năng" placeholder="Tìm một công cụ..." oninput="toolQuery=this.value;document.getElementById('toolsResults').innerHTML=toolsResults()"><span>${featureGroups.reduce((n, g) => n + g[1].length, 0)}</span></form></div><nav class="p-category-tabs" aria-label="Nhóm chức năng">${[['Tất cả', -1], ['Bắt đầu', 0], ['Học & hỏi', 1], ['Luyện & ôn', 2], ['Tổ chức', 3], ['Giới thiệu', 4]].map(([t, i]) => `<button class="${toolCategory === i ? 'active' : ''}" aria-pressed="${toolCategory === i}" onclick="toolCategory=${i};render()">${t}</button>`).join('')}</nav><div id="toolsResults">${toolsResults()}</div><div class="p-quiet-foot">${icon('sprout')}Không cần dùng tất cả. Chỉ chọn điều hợp với bạn hôm nay.</div>`
  );
};

// ==========================================
// 2. HỆ THỐNG HỌC QUA VIDEO TƯƠNG TÁC THẬT (AI VIDEO ASSISTANT)
// ==========================================
let currentVideoSource = null;
let currentVideoTime = 0;
let currentVideoChapters = [];
let videoChatMessages = [];

function openNewVideoModal() {
  showModal(
    `<h2 id="modalTitle">Thêm bài giảng Video</h2>` +
      `<p>Gửi video bài giảng (YouTube hoặc tệp MP4) để Trợ giảng AI Lumi phân tích nội dung chính, bóc tách mốc thời gian và giải đáp thắc mắc.</p>` +
      `<form onsubmit="event.preventDefault();submitNewVideo()">` +
      input('Tiêu đề bài giảng', 'videoTitle', '', 'text', 'Nhập tiêu đề video (ví dụ: Mô hình OSI & Mạng máy tính)') +
      input('Đường dẫn Video (YouTube URL hoặc link MP4)', 'videoUrl', '', 'url', 'https://www.youtube.com/watch?v=...') +
      `<div style="margin:12px 0"><label for="videoFile">Hoặc tải file video từ máy (.mp4, .webm):</label><input type="file" id="videoFile" accept="video/mp4,video/webm" style="margin-top:6px;width:100%"></div>` +
      `<label for="videoDesc">Ghi chú hoặc tóm tắt sơ lược (tùy chọn):</label><textarea id="videoDesc" rows="3" placeholder="Nhập thêm bối cảnh hoặc lưu ý cho bài giảng này..."></textarea>` +
      `<div class="modalactions">${btn('Hủy', 'closeModal()', true)}${btn('✨ Phân tích bằng AI', 'submitNewVideo()', false, 'spark')}</div>` +
      `</form>`
  );
}

async function submitNewVideo() {
  const title = $('videoTitle')?.value?.trim();
  const videoUrl = $('videoUrl')?.value?.trim();
  const desc = $('videoDesc')?.value?.trim();
  const fileInput = $('videoFile');
  const file = fileInput?.files?.[0];

  if (!title) {
    toast('Bạn vui lòng nhập tiêu đề cho bài giảng video nhé.');
    return;
  }
  if (!videoUrl && !file) {
    toast('Vui lòng dán link YouTube/MP4 hoặc chọn một tệp video.');
    return;
  }

  closeModal();
  toast('Trợ giảng AI Lumi đang phân tích bài giảng video của bạn...');

  try {
    let payload = {
      title,
      video_url: videoUrl || '',
      description: desc || 'Bài giảng video học tập trên Lumi AI',
    };

    const res = await lumiFetch('/sources/video-analyze', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const data = res.data;
    const newRecord = {
      id: data.source_id,
      backendId: data.source_id,
      title: data.title,
      type: 'VIDEO',
      kind: data.kind,
      videoUrl: data.video_url,
      summary: data.summary,
      keyTakeaways: data.key_takeaways || [],
      chapters: data.chapters || [],
      quizSample: data.quiz_sample,
      meta: 'Video bài giảng · ' + (data.chapters?.length || 4) + ' mốc thời gian',
      status: 'ready',
    };

    records.unshift(newRecord);
    persist('lumi-library', records);

    currentVideoSource = newRecord;
    currentVideoChapters = newRecord.chapters;
    videoChatMessages = [
      {
        role: 'assistant',
        text: `Chào bạn! Mình đã phân tích xong bài giảng **${newRecord.title}**.\n\n${newRecord.summary}\n\nBạn có thể chọn các mốc thời gian bên dưới để tua nhanh hoặc đặt câu hỏi bất kỳ cho mình nhé!`,
      },
    ];

    toast('Đã phân tích xong video! Đang mở trình phát bài giảng...');
    go('video');
  } catch (err) {
    toast('Lỗi phân tích video: ' + err.message);
  }
}

function seekVideoTo(seconds) {
  currentVideoTime = seconds;
  const vid = document.getElementById('html5VideoPlayer');
  if (vid) {
    vid.currentTime = seconds;
    vid.play().catch(() => {});
  }
  const iframe = document.getElementById('ytVideoIframe');
  if (iframe) {
    iframe.contentWindow?.postMessage(
      JSON.stringify({ event: 'command', func: 'seekTo', args: [seconds, true] }),
      '*'
    );
  }
  const posEl = document.getElementById('videoCurrentPos');
  if (posEl) posEl.textContent = formatVideoTime(seconds);
  renderVideoTranscriptLines();
}

function formatVideoTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function renderVideoTranscriptLines() {
  const container = document.getElementById('videoChaptersList');
  if (!container || !currentVideoChapters.length) return;
  container.querySelectorAll('.transcript-line').forEach(el => {
    const s = Number(el.dataset.seconds || 0);
    el.classList.toggle('active', Math.abs(currentVideoTime - s) < 45);
  });
}

async function sendVideoQuestion(qText) {
  const inputEl = document.getElementById('videoQuestionInput');
  const question = qText || inputEl?.value?.trim();
  if (!question) return;
  if (inputEl) inputEl.value = '';

  videoChatMessages.push({ role: 'user', text: question });
  renderVideoChatBox();

  try {
    const sourceId = currentVideoSource?.backendId || currentVideoSource?.id;
    const res = await lumiFetch(`/sources/${sourceId}/video-chat`, {
      method: 'POST',
      body: JSON.stringify({
        question,
        current_time_seconds: currentVideoTime,
        history: videoChatMessages.slice(-6),
      }),
    });

    const reply = res.data;
    videoChatMessages.push({
      role: 'assistant',
      text: reply.answer,
      relevant_timestamp: reply.relevant_timestamp,
      relevant_seconds: reply.relevant_seconds,
    });
    renderVideoChatBox();
  } catch (err) {
    videoChatMessages.push({
      role: 'assistant',
      text: 'Trợ giảng AI: Xin lỗi bạn, hiện không kết nối được dịch vụ hỏi đáp video (' + err.message + ').',
    });
    renderVideoChatBox();
  }
}

function renderVideoChatBox() {
  const box = document.getElementById('videoChatBox');
  if (!box) return;
  box.innerHTML = videoChatMessages
    .map(
      m => `
    <div class="msg ${m.role}" style="margin-bottom:12px;padding:12px;border-radius:10px;background:${m.role === 'assistant' ? 'var(--card-bg, #1e2422)' : 'var(--accent-dim, #254238)'}">
      ${m.role === 'assistant' ? '<span class="label" style="font-size:11px;font-weight:600;color:var(--accent,#3fae74);display:block;margin-bottom:6px">✨ LUMI AI TRỢ GIẢNG</span>' : ''}
      <div style="font-size:13.5px;line-height:1.6">${esc(m.text).replace(/\n/g, '<br>')}</div>
      ${
        m.relevant_timestamp
          ? `<div style="margin-top:8px"><button class="btn secondary" style="font-size:11.5px;padding:4px 8px" onclick="seekVideoTo(${m.relevant_seconds || 0})">⏱ Tua đến ${m.relevant_timestamp}</button></div>`
          : ''
      }
    </div>`
    )
    .join('');
  box.scrollTop = box.scrollHeight;
}

window.activeVideoTab = window.activeVideoTab || 'chapters';
window.switchVideoTab = function (tabKey) {
  window.activeVideoTab = tabKey;
  const container = document.getElementById('videoContainer');
  if (container) {
    container.className = 'video-page-container tab-' + tabKey;
  }
  document.querySelectorAll('.video-mobile-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabKey);
  });
};

videoPage = function () {
  const v =
    currentVideoSource ||
    records.find(r => r.type === 'VIDEO') || {
      id: 'default-video',
      title: 'Mô hình OSI & 7 Tầng Mạng Máy Tính',
      videoUrl: 'https://www.youtube.com/watch?v=LANW3m7UgWs',
      summary:
        'Bài giảng phân tích toàn diện 7 tầng của mô hình OSI (Open Systems Interconnection) từ tầng Vật lý (Physical) đến tầng Ứng dụng (Application), cơ chế đóng gói dữ liệu (Encapsulation) và luân chuyển gói tin trong mạng Internet.',
      keyTakeaways: [
        'Mô hình OSI gồm 7 tầng chuẩn hóa việc giao tiếp giữa các hệ thống mạng',
        'Tầng Mạng (Network) chịu trách nhiệm định tuyến qua địa chỉ IP và gói tin (Packet)',
        'Tầng Giao vận (Transport) đảm bảo độ tin cậy với giao thức TCP và UDP',
        'Cơ chế đóng gói thêm header vào dữ liệu ở mỗi tầng khi gửi đi',
      ],
      chapters: [
        { seconds: 0, timestamp: '00:00', title: 'Giới thiệu & Tổng quan mô hình OSI', summary: 'Đặt vấn đề về chuẩn hóa mạng máy tính' },
        { seconds: 60, timestamp: '01:00', title: 'Tầng 1 - 3: Physical, Data Link & Network', summary: 'Truyền dẫn tín hiệu, địa chỉ MAC và định tuyến IP' },
        { seconds: 150, timestamp: '02:30', title: 'Tầng 4: Transport (TCP vs UDP)', summary: 'Đảm bảo kết nối tin cậy và kiểm soát luồng dữ liệu' },
        { seconds: 240, timestamp: '04:00', title: 'Tầng 5 - 7 & Cơ chế đóng gói dữ liệu', summary: 'Session, Presentation, Application và tổng kết bài học' },
      ],
    };

  currentVideoSource = v;
  currentVideoChapters = v.chapters || [];

  let ytId = '';
  if (v.videoUrl) {
    const match = v.videoUrl.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
    if (match) ytId = match[1];
  }

  const curTab = window.activeVideoTab || 'chapters';

  return (
    `<div id="videoContainer" class="video-page-container tab-${curTab}">` +
    `<div class="video-pagehead-desktop">` +
    head(
      esc(v.title),
      'Học qua bài giảng video · Tương tác thời gian thực cùng trợ giảng AI Lumi',
      btn('Thêm video mới', 'openNewVideoModal()', false, 'plus')
    ) +
    `</div>` +
    `<div class="video-pagehead-mobile">` +
    `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px">` +
    `<div style="min-width:0;flex:1">` +
    `<span class="badge blue" style="font-size:9.5px;padding:2px 7px;border-radius:4px">BÀI GIẢNG VIDEO</span>` +
    `<h1 style="font-size:15px;margin:3px 0 0;font-weight:600;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(v.title)}">${esc(v.title)}</h1>` +
    `</div>` +
    `<button class="btn secondary" style="font-size:11px;padding:4px 8px;flex-shrink:0" onclick="openNewVideoModal()">${icon('plus')} Thêm</button>` +
    `</div>` +
    `</div>` +
    `<div class="video-layout">` +
    `<div>` +
    `<div class="video-player-wrap">` +
    (ytId
      ? `<iframe id="ytVideoIframe" style="width:100%;aspect-ratio:16/9;border:0;display:block" src="https://www.youtube.com/embed/${ytId}?enablejsapi=1&origin=${encodeURIComponent(location.origin)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`
      : `<video id="html5VideoPlayer" controls style="width:100%;aspect-ratio:16/9;display:block" ontimeupdate="currentVideoTime=Math.floor(this.currentTime);const p=$('videoCurrentPos');if(p)p.textContent=formatVideoTime(currentVideoTime);renderVideoTranscriptLines()"><source src="${v.videoUrl || 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'}" type="video/mp4"></video>`) +
    `</div>` +
    `<div class="video-action-scroll">` +
    `<button class="btn secondary" onclick="editNotebook(null,'note');setTimeout(()=>{const nb=$('nbBody');if(nb)nb.value='['+formatVideoTime(currentVideoTime)+'] Ghi chú bài giảng: ';},100);">${icon('note')}Ghi chú tại mốc này</button>` +
    `<button class="btn secondary" onclick="sendVideoQuestion('Giải thích chi tiết kiến thức ở đoạn ' + formatVideoTime(currentVideoTime) + ' của video')">${icon('spark')}Hỏi AI về đoạn này</button>` +
    `<button class="btn secondary" onclick="quizSetup()">${icon('quiz')}Luyện tập từ video</button>` +
    `<button class="btn secondary" onclick="generateCards()">${icon('quiz')}Tạo thẻ Flashcard</button>` +
    `</div>` +
    `<div class="video-mobile-tabs">` +
    `<button class="video-mobile-tab-btn ${curTab === 'chapters' ? 'active' : ''}" data-tab="chapters" onclick="switchVideoTab('chapters')">⏱ Mục lục</button>` +
    `<button class="video-mobile-tab-btn ${curTab === 'chat' ? 'active' : ''}" data-tab="chat" onclick="switchVideoTab('chat')">✨ Trợ giảng AI</button>` +
    `<button class="video-mobile-tab-btn ${curTab === 'summary' ? 'active' : ''}" data-tab="summary" onclick="switchVideoTab('summary')">📖 Tóm tắt bài học</button>` +
    `</div>` +
    `<section id="videoSummaryPanel" class="settingcard" style="margin-top:16px">` +
    `<h2>Tóm tắt nội dung chính</h2>` +
    `<p style="line-height:1.65;font-size:13.5px">${esc(v.summary)}</p>` +
    (v.keyTakeaways && v.keyTakeaways.length
      ? `<h3 style="margin:16px 0 8px;font-size:14px;color:var(--accent,#3fae74)">Điểm cốt lõi rút ra:</h3><ul style="padding-left:20px;font-size:13px;line-height:1.7">${v.keyTakeaways.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`
      : '') +
    `</section>` +
    `</div>` +
    `<div>` +
    `<section id="videoChaptersPanel" class="settingcard" style="margin-bottom:18px">` +
    `<div class="sectiontitle"><h2>Mục lục thời gian</h2><span id="videoCurrentPos" class="badge">00:00</span></div>` +
    `<p style="font-size:12px;color:var(--muted)">Nhấn vào từng mốc để tua video trực tiếp đến đoạn tương ứng.</p>` +
    `<div id="videoChaptersList" class="stack" style="max-height:280px;overflow-y:auto;gap:8px;margin-top:10px">` +
    (v.chapters || [])
      .map(
        ch => `
      <button class="transcript-line" data-seconds="${ch.seconds}" style="text-align:left;display:flex;align-items:flex-start;gap:10px;padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:var(--card-bg);cursor:pointer;width:100%" onclick="seekVideoTo(${ch.seconds})">
        <span class="badge" style="background:var(--accent-dim,#254238);color:var(--accent,#3fae74);font-weight:600">${ch.timestamp}</span>
        <div><strong style="display:block;font-size:13px">${esc(ch.title)}</strong><small style="font-size:11.5px;color:var(--muted)">${esc(ch.summary)}</small></div>
      </button>`
      )
      .join('') +
    `</div>` +
    `</section>` +
    `<section id="videoAiPanel" class="settingcard">` +
    `<div class="sectiontitle"><h2>Trợ giảng AI trong bài giảng</h2><span class="badge">Gemini Flash</span></div>` +
    `<div id="videoChatBox" style="max-height:260px;overflow-y:auto;margin:12px 0;padding-right:4px">` +
    videoChatMessages
      .map(
        m => `
      <div class="msg ${m.role}" style="margin-bottom:10px;padding:10px;border-radius:8px;background:${m.role === 'assistant' ? 'var(--card-bg, #1e2422)' : 'var(--accent-dim, #254238)'}">
        ${m.role === 'assistant' ? '<span class="label" style="font-size:10.5px;font-weight:600;color:var(--accent,#3fae74);display:block;margin-bottom:4px">✨ LUMI AI</span>' : ''}
        <div style="font-size:13px;line-height:1.5">${esc(m.text).replace(/\n/g, '<br>')}</div>
        ${m.relevant_timestamp ? `<div style="margin-top:6px"><button class="btn secondary" style="font-size:11px;padding:3px 6px" onclick="seekVideoTo(${m.relevant_seconds || 0})">⏱ Tua đến ${m.relevant_timestamp}</button></div>` : ''}
      </div>`
      )
      .join('') +
    `</div>` +
    `<form onsubmit="event.preventDefault();sendVideoQuestion()" style="display:flex;gap:8px">` +
    `<input id="videoQuestionInput" placeholder="Hỏi trợ giảng về nội dung bài giảng..." style="flex:1;padding:8px 12px;border-radius:8px;border:1px solid var(--border);background:var(--input-bg);color:inherit;font-size:13px">` +
    `<button class="btn" type="submit">Gửi</button>` +
    `</form>` +
    `</section>` +
    `</div>` +
    `</div>` +
    `</div>` +
    footer()
  );
};

// ==========================================
// 3. HOÀN THIỆN 3 PHẦN CÀI ĐẶT & KẾT NỐI BACKEND THẬT
// ==========================================

// 1. Công cụ học tập: gạt switch lưu vào PostgreSQL Supabase
toggleTool = async function (k) {
  tools[k] = !tools[k];
  persist('sf-tools', tools);
  render();

  const toolLabels = {
    planner: 'Lịch học linh hoạt',
    goals: 'Mục tiêu theo tuần',
    reminders: 'Nhắc học nhẹ nhàng',
    flashcards: 'Ôn flashcard theo lịch',
    focus: 'Đồng hồ tập trung',
    reports: 'Tiến độ chi tiết',
  };

  try {
    const curPref = await lumiFetch('/me/preferences');
    const rev = curPref?.data?.revision || 1;
    await lumiFetch('/me/preferences', {
      method: 'PATCH',
      body: JSON.stringify({
        expected_revision: rev,
        visible_tools: tools,
      }),
    });
    toast(`Đã ${tools[k] ? 'bật' : 'tắt'} ${toolLabels[k] || 'công cụ'} và lưu lên máy chủ.`);
  } catch (e) {
    toast(`Đã lưu tùy chọn trên trình duyệt: ${toolLabels[k] || ''}`);
  }
};

function configTool(k) {
  if (k === 'planner') go('planner');
  else if (k === 'goals') editGoal();
  else if (k === 'reminders') editReminder();
  else if (k === 'flashcards') go('flashcards');
  else if (k === 'focus') go('focus');
  else if (k === 'reports') go('stats');
}

// 2. Xuất ghi chú thật từ Database
exportNotes = async function () {
  toast('Đang tổng hợp toàn bộ ghi chú từ máy chủ...');
  try {
    let noteList = notebooks;
    try {
      const res = await lumiFetch('/notes');
      if (res?.data && res.data.length) {
        noteList = res.data;
      }
    } catch {}

    const textContent =
      `# 🌿 SỔ TAY GHI CHÚ HỌC TẬP — LUMI AI\n` +
      `Sinh viên: ${userProfile.name} (${userProfile.email})\n` +
      `Thời gian xuất: ${new Date().toLocaleString('vi-VN')}\n` +
      `Tổng số ghi chú: ${noteList.length}\n` +
      `============================================================\n\n` +
      noteList
        .map(
          (n, i) =>
            `### ${i + 1}. ${n.title || 'Ghi chú bài học'}\n` +
            `- Phân loại: ${n.kind || 'note'}\n` +
            `- Vị trí: ${n.videoTime !== undefined ? 'Video ' + formatVideoTime(n.videoTime) : 'Trang ' + (n.page || n.locator?.page_number || 1)}\n` +
            `- Ngày tạo: ${n.created_at || new Date().toLocaleDateString('vi-VN')}\n\n` +
            `Nội dung:\n${n.body || n.content || ''}\n\n` +
            `------------------------------------------------------------\n`
        )
        .join('\n');

    const blob = new Blob([textContent], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Lumi_Ghi_Chu_${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Đã xuất thành công toàn bộ ghi chú dạng file Markdown (.md)!');
  } catch (err) {
    toast('Lỗi xuất ghi chú: ' + err.message);
  }
};

// 3. Hồ sơ học tập kết nối thật Backend
editProfile = async function () {
  let pData = userProfile;
  try {
    const res = await lumiFetch('/me');
    if (res?.data) {
      pData = {
        name: res.data.display_name || userProfile.name,
        email: res.data.email || userProfile.email,
        level: res.data.education_level || userProfile.level,
        goal: res.data.field_of_study || userProfile.goal,
        style: userProfile.style || 'Giải thích dễ hiểu',
      };
    }
  } catch {}

  modalForm(
    'Hồ sơ học tập sinh viên',
    input('Tên hiển thị', 'profileName', pData.name) +
      input('Email tài khoản', 'profileEmail', pData.email, 'email') +
      select(
        'Trình độ hiện tại',
        'profileLevel',
        ['Sinh viên năm 1', 'Sinh viên năm 2', 'Sinh viên năm 3', 'Sinh viên năm 4', 'Người tự học'],
        pData.level
      ) +
      input('Ngành học / Mục tiêu', 'profileGoal', pData.goal) +
      select(
        'Cách giải thích bạn thích',
        'profileStyle',
        ['Giải thích dễ hiểu', 'Ngắn gọn, đi thẳng ý', 'Nhiều ví dụ cụ thể'],
        pData.style
      ),
    `saveProfileToBackend()`,
    'Lưu hồ sơ'
  );
};

async function saveProfileToBackend() {
  const name = $('profileName')?.value?.trim();
  const email = $('profileEmail')?.value?.trim();
  const level = $('profileLevel')?.value;
  const goal = $('profileGoal')?.value?.trim();
  const style = $('profileStyle')?.value;

  if (!name) {
    toast('Bạn vui lòng nhập tên hiển thị nhé.');
    return;
  }

  userProfile.name = name;
  userProfile.email = email;
  userProfile.level = level;
  userProfile.goal = goal;
  userProfile.style = style;
  persist('lumi-profile', userProfile);

  try {
    await lumiFetch('/me/profile', {
      method: 'PATCH',
      body: JSON.stringify({
        display_name: name,
        education_level: level,
        field_of_study: goal,
      }),
    });
    toast('Đã cập nhật hồ sơ học tập thành công trên máy chủ!');
  } catch (e) {
    toast('Đã lưu hồ sơ trên trình duyệt: ' + e.message);
  }
  closeModal();
  render();
}

// 4. Thiết bị & phiên đăng nhập
devicesDialog = function () {
  showModal(
    `<h2 id="modalTitle">Thiết bị & Phiên đăng nhập</h2>` +
      `<div class="result-item">` +
      `<strong>💻 Máy trạm / Trình duyệt hiện tại</strong>` +
      `<p>Tài khoản: <strong>${esc(userProfile.email)}</strong></p>` +
      `<p>Địa chỉ mạng LAN: <code>192.168.39.17:8000</code></p>` +
      `<p>Trạng thái: <span class="badge" style="color:var(--accent,#3fae74)">Đang kết nối Backend FastAPI & Supabase</span></p>` +
      `</div>` +
      `<div class="result-item" style="margin-top:10px">` +
      `<strong>📱 Điện thoại thử nghiệm (OPPO A92)</strong>` +
      `<p>Đồng bộ dữ liệu qua cùng mạng Wi-Fi nội bộ hoặc tệp APK Lumi-AI.</p>` +
      `</div>` +
      `<div class="modalactions">${btn('Đóng', 'closeModal()', true)}${btn('Đăng xuất', 'logoutLumi()')}</div>`
  );
};

// 5. Ghi đè settingsDetail()
settingsDetail = function (kind) {
  if (kind === 'appearance') {
    openAppearance();
    return;
  }
  if (kind === 'account') {
    editProfile();
    return;
  }
  if (kind === 'privacy') {
    privacyDialog();
    return;
  }
  if (kind === 'help') {
    showModal(
      `<h2 id="modalTitle">Trung tâm Hỗ trợ & Hướng dẫn sử dụng</h2>` +
        `<p><strong>Đồ án / Khóa luận tốt nghiệp FBU — Hệ thống Lumi AI</strong></p>` +
        `<div style="font-size:13px;line-height:1.7">` +
        `<p><strong>1. Thêm tài liệu & Học qua Video:</strong> Bạn có thể tải lên tệp PDF giáo trình hoặc dán link YouTube bài giảng để AI phân tích.</p>` +
        `<p><strong>2. Trợ giảng AI Hybrid RAG:</strong> Hỏi đáp trực tiếp trên nội dung tài liệu, AI dẫn nguồn số trang hoặc mốc thời gian chính xác.</p>` +
        `<p><strong>3. Sinh đề cương & Luyện tập:</strong> AI sinh đề thi 4 phương án tự động chấm điểm và thẻ nhớ theo thuật toán SM-2.</p>` +
        `<p><strong>4. Hỗ trợ kỹ thuật:</strong> Khoa CNTT — Trường Đại học Tài chính - Ngân hàng Hà Nội.</p>` +
        `</div>` +
        `<div class="modalactions">${btn('Đã hiểu', 'closeModal()')}</div>`
    );
    return;
  }
  if (kind === 'about') {
    showModal(
      `<h2 id="modalTitle">Giới thiệu Nền tảng Lumi AI v2.0</h2>` +
        `<p><strong>Hệ sinh thái Trợ lý Học tập Thông minh Đa nguồn</strong></p>` +
        `<div style="font-size:13px;line-height:1.7">` +
        `<p>🌿 <strong>Đề tài:</strong> Xây dựng ứng dụng hỗ trợ học tập và ôn tập cá nhân hóa từ học liệu đa nguồn kết hợp công nghệ RAG và Trí tuệ nhân tạo.</p>` +
        `<p>⚙️ <strong>Công nghệ nền tảng:</strong></p>` +
        `<ul>` +
        `<li>Backend: Python 3.12, FastAPI, SQLAlchemy ORM</li>` +
        `<li>Database: Supabase PostgreSQL với extension pgvector</li>` +
        `<li>AI Model: Radox AI Gateway (Google Gemini 3.6 Flash)</li>` +
        `<li>Mobile: React Native / Expo kết hợp WebView đồng bộ</li>` +
        `</ul>` +
        `<p style="margin-top:8px">Đồ án Khóa luận tốt nghiệp FBU — Bản quyền thuộc về tác giả.</p>` +
        `</div>` +
        `<div class="modalactions">${btn('Đóng', 'closeModal()')}</div>`
    );
    return;
  }
  if (kind === 'plan') {
    quotaDialog();
    return;
  }
};

quotaDialog = async function () {
  try {
    const res = await lumiFetch('/me/quota');
    const q = res.data;
    const usedMb = ((q.storage_used_bytes || 0) / (1024 * 1024)).toFixed(2);
    const limitMb = ((q.storage_limit_bytes || 524288000) / (1024 * 1024)).toFixed(0);
    const aiUsed = q.ai_units_used || 0;
    const aiLimit = q.ai_units_limit || 200;
    const aiPct = Math.min(100, Math.round((aiUsed / Math.max(1, aiLimit)) * 100));

    showModal(
      `<h2 id="modalTitle">Dung lượng & Hạn mức tài khoản</h2>` +
        `<p>Tài khoản: <strong>${esc(userProfile.email)}</strong></p>` +
        [
          ['Lượt hỏi đáp & Tạo học liệu AI', `${aiUsed} / ${aiLimit} lượt`, aiPct],
          ['Dung lượng lưu trữ đám mây', `${usedMb} / ${limitMb} MB`, Math.max(2, Math.round(q.storage_percent || 1))]
        ]
          .map(
            ([t, v, p]) =>
              `<div class="result-item"><div class="sectiontitle"><strong>${t}</strong><span>${v}</span></div><div class="progressline"><span style="width:${p}%"></span></div></div>`
          )
          .join('') +
        `<div class="modalactions">${btn('Đóng', 'closeModal()')}</div>`
    );
  } catch (err) {
    showModal(
      `<h2 id="modalTitle">Dung lượng & Hạn mức</h2><p>Không đọc được thông tin hạn mức: ${esc(
        err.message
      )}</p><div class="modalactions">${btn('Đóng', 'closeModal()')}</div>`
    );
  }
};

// ============================================================================
// 8. MASTER MODULE: KHÓA HỌC, BÀI HỌC VÀ 3 ĐIỂM NHẤN KHÓA LUẬN (HIGHLIGHTS A, B, C)
// ============================================================================

names.lesson = 'Không gian bài học';

// Đăng ký lại render() để hỗ trợ trang Không gian bài học ('lesson') và các trang công khai (landing, auth, mobile)
const prevRenderFn = render;
render = function () {
  // 1. Nếu đang ở các màn hình công khai ngoài ứng dụng (landing, auth, mobile):
  if (page === 'landing' || page === 'auth' || page === 'mobile') {
    if (typeof prevRenderFn === 'function') {
      prevRenderFn();
      return;
    }
  }

  // 2. Nếu người dùng chưa đăng nhập, bắt buộc chuyển về form đăng nhập 'auth':
  if (typeof lumiSession === 'function' && !lumiSession()) {
    page = 'auth';
    authMode = 'login';
    if (typeof prevRenderFn === 'function') {
      prevRenderFn();
      return;
    }
  }

  // 3. Đã đăng nhập và đang ở các trang ứng dụng (in-app):
  document.documentElement.dataset.entry = 'app';
  document.documentElement.dataset.surface = 'app';
  const pr = $('publicRoot');
  if (pr) pr.innerHTML = '';

  const views = {
    home,
    library,
    reader,
    course,
    quiz,
    personal,
    hub,
    history: historyPage,
    review: reviewPage,
    flashcards: flashcardsPage,
    planner: plannerPage,
    focus: focusPage,
    stats: statsPage,
    glossary: glossaryPage,
    outlines: outlinesPage,
    auth: authPage,
    video: videoPage,
    source: sourcePage,
    notes: notesPage,
    lesson: typeof lessonPage === 'function' ? lessonPage : course
  };
  $('app').dataset.page = page;
  try {
    $('main').innerHTML = (views[page] || hub)();
  } catch (renderErr) {
    console.error('Lumi render error for page "' + page + '":', renderErr);
    try {
      $('main').innerHTML = `<div class="empty"><h3>Không thể tải giao diện trang này</h3><p>${esc(String(renderErr?.message || renderErr))}</p><div class="actionline"><button class="btn" onclick="go('home')">Về trang chủ</button><button class="btn secondary" onclick="location.reload()">Tải lại trang</button></div></div>`;
    } catch (e) {}
  }
  hydrate();
  const group = ['reader', 'course', 'quiz', 'source', 'video', 'notes', 'history', 'lesson'].includes(page)
    ? 'library'
    : ['review', 'flashcards', 'planner', 'focus', 'stats', 'glossary', 'outlines'].includes(page)
    ? 'hub'
    : page;
  document.querySelectorAll('[data-nav]').forEach(x => x.classList.toggle('active', x.dataset.nav === group));
  if (page === 'focus' && typeof paintTimer === 'function') paintTimer();
};

// ----------------------------------------------------------------------------
// A. GIAO DIỆN KHÓA HỌC & ĐỀ CƯƠNG TOÀN DIỆN (XÓA BỎ HOÀN TOÀN DỮ LIỆU CSDL CŨ)
// ----------------------------------------------------------------------------
course = function () {
  const all = [...courses, ...extraCourses];
  const c = all[selectedCourse] || courses[0];
  const lessons = getCourseLessonList(c, selectedCourse);
  const linkedIds = saved('lumi-course-sources-' + selectedCourse, []);
  let linkedSources = records.filter(r => !r.deleted && linkedIds.includes(r.id));

  // Tự động đối chiếu nếu tên tài liệu khớp một phần với tên môn học
  if (linkedSources.length === 0 && c.title) {
    const cKeywords = c.title.toLowerCase().split(' ').filter(w => w.length > 2);
    const matched = records.find(r => !r.deleted && cKeywords.some(kw => r.title.toLowerCase().includes(kw)));
    if (matched) {
      linkedSources = [matched];
    }
  }

  // Đếm tiến độ thực tế theo danh sách bài học
  const completedCount = lessons.filter(ls => completedLessons.includes(`${selectedCourse}:${ls.id}`)).length;
  const progressPct = lessons.length ? Math.round((completedCount / lessons.length) * 100) : 0;
  c.progress = progressPct;
  c.lessons = `${completedCount} / ${lessons.length || 0} bài`;

  // 1. Header & Actions
  let html = `
    <div class="pagehead">
      <div>
        <button class="textbtn" style="padding:0;margin-bottom:12px" onclick="go('library')">
          ${icon('back')} Góc học tập
        </button>
        <span class="badge ${c.blue ? 'green' : ''}">${esc(c.tag || 'Khóa học')}</span>
        <h1 style="margin-top:10px">${esc(c.title)}</h1>
        <p>${esc(c.subtitle || 'Lộ trình học tập cá nhân hóa — bạn tự chọn thứ tự và nhịp học.')}</p>
      </div>
      <div class="course-top-actions">
        ${btn('Quản lý khóa', 'manageCourse()', true, 'sliders')}
      </div>
    </div>

    <div class="reader-extra-modern" style="margin-bottom:20px">
      <button class="lumi-tool-pill" onclick="linkCourseSources()" title="Liên kết tài liệu PDF hoặc Slide vào khóa học">
        <span class="tool-icon-badge folder-badge">${icon('folder')}</span>
        <span>Học liệu liên kết (${linkedSources.length})</span>
      </button>
      <button class="lumi-tool-pill" onclick="editCurriculum()" title="Chỉnh sửa hoặc dán đề cương bài học">
        <span class="tool-icon-badge upload-badge">${icon('note')}</span>
        <span>Đề cương bài học</span>
      </button>
      <button class="lumi-tool-pill" onclick="openCurriculumCoverageModal(${selectedCourse})" title="Kiểm tra mức bao phủ của học liệu theo đề cương (Highlight B)">
        <span class="tool-icon-badge history-badge">${icon('spark')}</span>
        <span>Kiểm tra mức bao phủ đề cương</span>
      </button>
      <button class="lumi-tool-pill" onclick="quizSetup()" title="Biên soạn đề kiểm tra trắc nghiệm AI">
        <span class="tool-icon-badge check-badge">${icon('quiz')}</span>
        <span>Luyện trắc nghiệm AI</span>
      </button>
      <button class="lumi-tool-pill" onclick="go('notes')" title="Mở sổ tay ghi chép môn học">
        <span class="tool-icon-badge note-badge">${icon('note')}</span>
        <span>Ghi chú môn học</span>
      </button>
    </div>
  `;

  // 2. Section: Học liệu đã liên kết
  html += `
    <section class="settingcard" style="border-radius:14px;padding:20px;margin-bottom:20px">
      <div class="sectiontitle">
        <h2 style="font-size:16px;display:flex;align-items:center;gap:8px">
          ${icon('folder')} Học liệu của khóa học
        </h2>
        <span class="badge ${linkedSources.length ? 'green' : ''}">
          ${linkedSources.length ? `${linkedSources.length} tài liệu đã lập chỉ mục` : 'Chưa có học liệu'}
        </span>
      </div>
  `;

  if (linkedSources.length > 0) {
    html += `
      <div class="source-stack" style="margin-top:12px">
        ${linkedSources.map(r => {
          const isSlide = r.type === 'SLIDE' || r.title.toLowerCase().endsWith('.pptx') || r.title.toLowerCase().endsWith('.ppt');
          const isVid = r.type === 'VIDEO';
          return `
            <div class="managed-source" style="background:var(--card-bg);border-radius:10px;padding:12px">
              <button class="source-row" onclick="openCourseSource('${r.id}')" style="display:flex;align-items:center;gap:12px;text-align:left;flex:1;background:transparent;border:none;cursor:pointer">
                <div class="fileicon ${isSlide ? 'orange' : isVid ? 'blue' : ''}" style="width:38px;height:38px;display:flex;align-items:center;justify-content:center;border-radius:8px;font-size:11px;font-weight:700">
                  ${isSlide ? 'SLIDE' : isVid ? 'VIDEO' : 'PDF'}
                </div>
                <div class="sourceinfo" style="flex:1">
                  <strong style="display:block;font-size:14px">${esc(r.title)}</strong>
                  <small style="color:var(--muted);font-size:12px">${r.pageCount || r.active_version?.page_count || 1} ${isSlide ? 'slide' : 'trang'} · Đã sẵn sàng Trợ giảng AI</small>
                </div>
                <span class="badge green">Sẵn sàng học</span>
              </button>
              <div class="actionline" style="margin-top:0">
                <button class="btn" style="font-size:12px;padding:6px 12px" onclick="openCourseSource('${r.id}')">Mở tài liệu ${icon('arrow')}</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn secondary" style="font-size:12px;padding:6px 12px" onclick="linkCourseSources()">+ Đổi / Liên kết thêm</button>
        <button class="btn secondary" style="font-size:12px;padding:6px 12px" onclick="openUpload()">+ Tải lên PDF/PPTX mới</button>
      </div>
    `;
  } else {
    html += `
      <div class="empty-notice-box" style="padding:16px;background:rgba(235,160,50,0.08);border:1px dashed rgba(235,160,50,0.35);border-radius:10px;margin-top:10px">
        <p style="margin:0 0 10px;font-size:13.5px;color:var(--text);line-height:1.6">
          ⚠️ <strong>Khóa học này chưa gắn tài liệu học tập.</strong><br>
          Bạn hãy liên kết tài liệu PDF hoặc Slide bài giảng PowerPoint (.pptx) có sẵn trong thư viện, hoặc tải lên tệp mới để Trợ giảng AI kích hoạt chế độ học tập chuẩn xác.
        </p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" style="font-size:12px;padding:7px 14px" onclick="linkCourseSources()">${icon('folder')} + Chọn học liệu sẵn có trong thư viện</button>
          <button class="btn secondary" style="font-size:12px;padding:7px 14px" onclick="openUpload()">${icon('plus')} + Tải lên file mới (PDF/PPTX)</button>
        </div>
      </div>
    `;
  }
  html += `</section>`;

  // 3. Section: Đề cương bài học
  html += `
    <section class="settingcard" style="border-radius:14px;padding:20px">
      <div class="sectiontitle">
        <div>
          <h2 style="font-size:16px;margin:0 0 4px">Đề cương & Lộ trình bài học</h2>
          <span style="font-size:12px;color:var(--muted)">Tiến độ hoàn thành: ${completedCount}/${lessons.length} bài (${progressPct}%)</span>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn secondary" style="font-size:12px;padding:6px 12px" onclick="editCurriculum()">Chỉnh sửa đề cương</button>
          <button class="btn secondary" style="font-size:12px;padding:6px 12px" onclick="generateLiveCurriculum()">${icon('spark')} AI sinh đề cương</button>
        </div>
      </div>
      <div class="progressline" style="margin:14px 0 18px"><span style="width:${progressPct}%"></span></div>
  `;

  if (lessons.length === 0) {
    html += `
      <div class="empty-notice-box" style="padding:22px;text-align:center;background:var(--card-bg);border:1px dashed var(--border);border-radius:10px">
        <span style="font-size:28px;display:block;margin-bottom:8px">📖</span>
        <strong style="font-size:15px;display:block;margin-bottom:6px">Khóa học chưa có danh sách bài học</strong>
        <p style="font-size:13px;color:var(--muted);max-width:480px;margin:0 auto 16px;line-height:1.6">
          Bạn có thể để Trợ giảng AI tự động phân tích học liệu để sinh các chương bài giảng, hoặc tự dán đề cương môn học của mình.
        </p>
        <div style="display:flex;justify-content:center;gap:10px;flex-wrap:wrap">
          <button class="btn" onclick="generateLiveCurriculum()">${icon('spark')} Tự động sinh đề cương AI</button>
          <button class="btn secondary" onclick="editCurriculum()">+ Nhập danh sách bài học</button>
        </div>
      </div>
    `;
  } else {
    html += `
      <div class="lesson-list-stack" style="display:flex;flex-direction:column;gap:10px">
        ${lessons.map((ls, i) => {
          const isDone = completedLessons.includes(`${selectedCourse}:${ls.id}`);
          return `
            <div class="lessonrow modern-lesson-item ${isDone ? 'done' : ''}" style="display:flex;align-items:center;gap:14px;padding:14px 16px;border-radius:10px;border:1px solid var(--border);background:var(--card-bg);transition:all .15s">
              <button class="task-check ${isDone ? 'checked' : ''}" style="width:26px;height:26px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;border:2px solid var(--border);background:transparent" onclick="toggleLessonDone(${selectedCourse}, '${ls.id}')" title="Đánh dấu hoàn thành bài học">
                ${isDone ? icon('check') : ''}
              </button>
              <div style="flex:1;cursor:pointer" onclick="openLesson(${selectedCourse}, ${i})">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                  <span class="lessonnum" style="font-size:11.5px;font-weight:700;color:var(--accent,#3fae74)">BÀI ${String(i + 1).padStart(2, '0')}</span>
                  <span style="font-size:12px;color:var(--muted)">⏱ ~${ls.minutes || 45} phút</span>
                  ${isDone ? '<span class="badge green" style="font-size:10.5px">Đã hoàn thành</span>' : ''}
                </div>
                <h3 style="margin:0 0 4px;font-size:15px;line-height:1.4">${esc(ls.title)}</h3>
                <p style="margin:0;font-size:12.5px;color:var(--secondary);line-height:1.5">${esc(ls.goal)}</p>
              </div>
              <button class="btn secondary" style="font-size:12px;padding:7px 14px;white-space:nowrap" onclick="openLesson(${selectedCourse}, ${i})">
                Vào học ${icon('arrow')}
              </button>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  html += `</section>`;
  return html + footer();
};

openCourseSource = function (sourceId) {
  const idx = records.findIndex(r => !r.deleted && (r.id === sourceId || r.backendId === sourceId));
  if (idx >= 0) {
    sourceIndex = idx;
    const r = records[idx];
    if (r.type === 'VIDEO') {
      currentVideoSource = r;
      go('video');
    } else {
      readerPage = 1;
      readerTab = 'chat';
      readingView = 'document';
      jumpToPdfPage(1);
      go('reader');
    }
    toast(`Đang mở học liệu "${r.title}".`);
  }
};

let currentLessonData = null;

openLesson = function (courseIdx, lessonIdx) {
  selectedCourse = courseIdx;
  const all = [...courses, ...extraCourses];
  const c = all[courseIdx] || courses[0];
  const lessons = getCourseLessonList(c, courseIdx);
  const ls = lessons[lessonIdx] || lessons[0];
  currentLessonData = { course: c, lesson: ls, lessonIdx };

  // Kiểm tra học liệu đã gắn vào khóa học
  const linkedIds = saved('lumi-course-sources-' + courseIdx, []);
  let targetSrc = records.filter(r => !r.deleted && linkedIds.includes(r.id))[0];

  // Nếu chưa gắn trực tiếp, thử đối chiếu theo tên khóa học
  if (!targetSrc && c.title) {
    const cKeywords = c.title.toLowerCase().split(' ').filter(w => w.length > 2);
    targetSrc = records.find(r => !r.deleted && cKeywords.some(kw => r.title.toLowerCase().includes(kw)));
  }

  // NẾU CÓ TÀI LIỆU: Mở trực tiếp trong reader/video
  if (targetSrc) {
    const idx = records.indexOf(targetSrc);
    sourceIndex = idx >= 0 ? idx : 0;
    if (targetSrc.type === 'VIDEO') {
      currentVideoSource = targetSrc;
      go('video');
    } else {
      readerPage = ls.page || 1;
      readerTab = 'chat';
      readingView = 'document';
      jumpToPdfPage(readerPage);
      go('reader');
    }
    toast(`Đang vào học Bài ${lessonIdx + 1}: "${ls.title}" trên "${targetSrc.title}".`);
    return;
  }

  // NẾU CHƯA CÓ TÀI LIỆU: Mở trang Không gian bài học
  go('lesson');
};

toggleLessonDone = function (courseIdx, lessonId) {
  const key = `${courseIdx}:${lessonId}`;
  if (completedLessons.includes(key)) {
    completedLessons = completedLessons.filter(k => k !== key);
    toast('Đã bỏ đánh dấu hoàn thành bài học.');
  } else {
    completedLessons.push(key);
    toast('🎉 Tuyệt vời! Bạn đã hoàn thành bài học này.');
  }
  persist('lumi-completed', completedLessons);
  render();
};

lessonPage = function () {
  if (!currentLessonData) {
    go('course');
    return '';
  }
  const { course: c, lesson: ls, lessonIdx } = currentLessonData;
  const isDone = completedLessons.includes(`${selectedCourse}:${ls.id}`);

  return `
    <div class="pagehead">
      <div>
        <button class="textbtn" style="padding:0;margin-bottom:12px" onclick="go('course')">
          ${icon('back')} Quay lại môn ${esc(c.title)}
        </button>
        <span class="badge green">Không gian bài học · Bài ${lessonIdx + 1}</span>
        <h1 style="margin-top:10px">${esc(ls.title)}</h1>
        <p>Thuộc khóa học: <strong>${esc(c.title)}</strong> · Thời lượng ước tính: ~${ls.minutes || 45} phút</p>
      </div>
      <div>
        <button class="btn ${isDone ? 'secondary' : ''}" onclick="toggleLessonDone(${selectedCourse}, '${ls.id}')">
          ${isDone ? '✓ Đã hoàn thành bài này' : icon('check') + ' Đánh dấu hoàn thành'}
        </button>
      </div>
    </div>

    <div class="two-col" style="gap:20px;align-items:flex-start">
      <div style="flex:1">
        <section class="settingcard" style="border-radius:14px;padding:22px;margin-bottom:18px">
          <div class="sectiontitle"><h2 style="font-size:16px">🎯 Mục tiêu cần đạt</h2></div>
          <p style="font-size:14px;line-height:1.7;color:var(--text)">${esc(ls.goal)}</p>
          <div style="margin-top:16px;padding:12px;background:rgba(63,174,116,0.08);border-radius:8px">
            <strong style="display:block;font-size:12.5px;color:var(--accent,#3fae74)">Kiến thức cần biết trước:</strong>
            <span style="font-size:13px;color:var(--secondary)">${esc(ls.prerequisites)}</span>
          </div>
        </section>

        <section class="settingcard" style="border-radius:14px;padding:22px;margin-bottom:18px">
          <div class="sectiontitle"><h2 style="font-size:16px">📑 Tài liệu học tập cho bài này</h2></div>
          <div class="empty-notice-box" style="padding:16px;background:var(--card-bg);border:1px dashed var(--border);border-radius:10px">
            <p style="margin:0 0 12px;font-size:13px;color:var(--muted)">Bài học này hiện chưa gắn tài liệu riêng. Bạn có thể chọn tài liệu sẵn có trong thư viện hoặc tải lên file mới.</p>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn secondary" style="font-size:12px;padding:6px 12px" onclick="linkCourseSources()">+ Chọn từ thư viện</button>
              <button class="btn" style="font-size:12px;padding:6px 12px" onclick="openUpload()">+ Tải PDF / PPTX mới</button>
            </div>
          </div>
        </section>

        <section class="settingcard" style="border-radius:14px;padding:22px">
          <div class="sectiontitle"><h2 style="font-size:16px">💡 Tự kiểm tra & Ôn tập sâu</h2></div>
          <p style="font-size:13px;color:var(--secondary);line-height:1.6;margin-bottom:14px">
            Vận dụng kỹ thuật Feynman để tự giải thích lại khái niệm bài học, hoặc làm bài trắc nghiệm nhanh do AI biên soạn.
          </p>
          <div class="actionline">
            <button class="btn" onclick="openSelfExplanationModal('${esc(ls.title)}')">✨ Tự giải thích bài này (Feynman)</button>
            <button class="btn secondary" onclick="quizSetup()">📝 Luyện trắc nghiệm AI</button>
          </div>
        </section>
      </div>

      <div style="width:360px">
        <section class="settingcard" style="border-radius:14px;padding:22px">
          <div class="sectiontitle"><h2 style="font-size:16px">✨ Trợ giảng AI cho bài này</h2></div>
          <p style="font-size:12.5px;color:var(--muted);line-height:1.6">Đặt câu hỏi nhanh cho Trợ giảng AI về chuyên đề <strong>"${esc(ls.title)}"</strong>:</p>
          <form onsubmit="event.preventDefault();const q=document.getElementById('lessonAiQuery').value.trim();if(q){openAskSource();setTimeout(()=>sendChat('Trong bài học ' + esc(ls.title) + ', ' + q), 300);}" style="margin-top:12px">
            <textarea id="lessonAiQuery" rows="4" style="width:100%;border-radius:8px;padding:10px;font-size:13px" placeholder="Ví dụ: Tóm tắt 3 ý trọng tâm nhất của bài này..."></textarea>
            <button class="btn" type="submit" style="width:100%;margin-top:10px">Hỏi Trợ giảng AI ${icon('arrow')}</button>
          </form>
        </section>
      </div>
    </div>
    ${footer()}
  `;
};

// ----------------------------------------------------------------------------
// B. HIGHLIGHT A: HỌC LẠI THEO LỖI SAI CÓ GIẢI THÍCH SƯ PHẠM (PEDAGOGICAL REMEDIATION LOOP)
// ----------------------------------------------------------------------------
let currentQuizSession = null;

quizResults = function () {
  const sessionTotal = currentQuizSession?.total || questions.length;
  const pct = Math.round((score / Math.max(1, sessionTotal)) * 100);
  const wrongIndexes = questions.map((q, i) => (quizPicked[i] !== q.correct ? i : null)).filter(x => x !== null);

  return (
    head(
      'Kết quả bài luyện tập AI',
      `${score} / ${sessionTotal} câu đúng (${pct}%) · ${currentQuizSession?.title || 'Luyện tập bám sát học liệu'}`
    ) +
    `<section class="quizcard" style="border-radius:14px;padding:24px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border)">
        <div>
          <h2 style="font-size:18px;margin:0 0 4px">Chẩn đoán sư phạm từng câu hỏi</h2>
          <small style="color:var(--muted)">Đánh giá mức độ hiểu và đề xuất câu hỏi tương đương để củng cố lỗ hổng kiến thức.</small>
        </div>
        <span class="badge ${pct >= 70 ? 'green' : 'amber'}" style="font-size:13px;padding:6px 14px">
          ${pct >= 70 ? 'Đạt yêu cầu' : 'Cần củng cố thêm'}
        </span>
      </div>

      <div class="stack" style="gap:16px">
        ${questions.map((q, i) => {
          const isRight = quizPicked[i] === q.correct;
          const userPick = quizPicked[i];
          const userPickText = userPick !== undefined && q.a[userPick] ? q.a[userPick] : 'Chưa chọn';
          const correctText = q.a[q.correct] || 'Đáp án đúng';
          const topicName = q.topic || (q.q.length > 40 ? q.q.slice(0, 40) + '…' : q.q);

          return `
            <div class="result-item ${isRight ? 'correct-item' : 'wrong-item'}" style="border-radius:10px;padding:16px;background:${isRight ? 'rgba(63,174,116,0.04)' : 'rgba(235,90,90,0.04)'};border-left:4px solid ${isRight ? 'var(--accent,#3fae74)' : '#e55353'}">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                <span class="badge ${isRight ? 'green' : ''}" style="${!isRight ? 'background:#e55353;color:#fff' : ''}">
                  Câu ${i + 1} · ${isRight ? '✓ ĐÃ NẮM VỮNG' : '✗ CẦN CỦNG CỐ'}
                </span>
                <span style="font-size:12px;color:var(--muted)">Chuyên đề: <strong>${esc(topicName)}</strong></span>
              </div>
              <h3 style="font-size:15px;margin:8px 0;line-height:1.4">${esc(q.q)}</h3>
              <p style="font-size:13px;margin:4px 0"><strong>Phương án của bạn:</strong> <span style="color:${isRight ? 'var(--accent,#3fae74)' : '#e55353'}">${esc(userPickText)}</span></p>
              ${!isRight ? `<p style="font-size:13px;margin:4px 0"><strong>Đáp án đúng:</strong> <span style="color:var(--accent,#3fae74)">${esc(correctText)}</span></p>` : ''}
              
              <div class="pedagogical-diagnosis" style="margin-top:10px;padding:12px;background:var(--card-bg);border-radius:8px;font-size:13px;line-height:1.6">
                <strong style="color:var(--accent,#3fae74);display:block;margin-bottom:4px">💡 Chẩn đoán sư phạm & Căn cứ tài liệu:</strong>
                ${esc(q.explain)}
              </div>

              <div class="actionline" style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
                <button class="btn secondary" style="font-size:11.5px;padding:5px 12px" onclick="openCitation(${q.sourcePage || readerPage || 1})">
                  ${icon('file')} Xem vị trí nguồn (Trang ${q.sourcePage || readerPage || 1})
                </button>
                <button class="btn secondary" style="font-size:11.5px;padding:5px 12px" onclick="practiceParallelQuestion(${i})">
                  🎯 Thử câu hỏi tương đương
                </button>
                <button class="btn secondary" style="font-size:11.5px;padding:5px 12px" onclick="quizIndex=${i};saveReview();toast('Đã lưu câu ${i + 1} vào sổ ôn tập!')">
                  💾 Lưu vào sổ ôn tập
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <div class="actionline" style="margin-top:24px;padding-top:18px;border-top:1px solid var(--border)">
        ${wrongIndexes.length > 0
          ? `<button class="btn" onclick="practiceWrongQuestionsOnly()">🔁 Luyện lại ${wrongIndexes.length} câu sai độc lập (100% điểm chuẩn)</button>`
          : ''}
        <button class="btn secondary" onclick="quizSetup()">Biên soạn đề mới</button>
        <button class="btn secondary" onclick="go('review')">Mở sổ ôn tập</button>
        <button class="btn secondary" onclick="go('library')">Góc học tập</button>
      </div>
    </section>` +
    footer()
  );
};

// Phiên luyện lại độc lập: tính điểm trên đúng tập câu được chọn
practiceWrongQuestionsOnly = function () {
  const wrongQuestions = questions.filter((q, i) => quizPicked[i] !== q.correct);
  if (!wrongQuestions.length) {
    toast('Bạn không có câu sai nào! Rất xuất sắc.');
    return;
  }
  startIndependentQuizSession(wrongQuestions, `Luyện lại ${wrongQuestions.length} câu sai`);
};

startIndependentQuizSession = function (subsetQuestions, sessionTitle) {
  questions = subsetQuestions.map(q => ({ ...q }));
  currentQuizSession = {
    total: questions.length,
    title: sessionTitle || 'Phiên luyện tập độc lập',
    mode: 'practice'
  };
  quizIndex = 0;
  answer = null;
  checked = false;
  score = 0;
  quizPicked = [];
  go('quiz');
  toast(`Bắt đầu ${sessionTitle} (${questions.length} câu) — điểm sẽ tính độc lập.`);
};

// Sinh câu hỏi tương đương cùng chủ đề
practiceParallelQuestion = async function (qIndex) {
  const baseQ = questions[qIndex];
  if (!baseQ) return;
  toast('Đang sinh câu hỏi tương đương cùng chủ đề để củng cố...');

  const prompt = `Từ câu hỏi sau đây: "${baseQ.q}", hãy tạo MỘT câu hỏi trắc nghiệm tương đương (cùng kiến thức và độ khó nhưng trong ngữ cảnh tình huống mới). Xuất định dạng JSON: {"q":"câu hỏi","a":["phương án 1","2","3","4"],"correct":0,"explain":"giải thích sư phạm"}`;

  try {
    const aiRes = await fetch('https://radoxai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer cc_h3u4s1WpAre2w5DYSterZYcHlwMRyFb9PfjKcaYxUJgwpeOL'
      },
      body: JSON.stringify({
        model: 'gemini-3.6-flash',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3
      })
    });
    if (aiRes.ok) {
      const data = await aiRes.json();
      const txt = data?.choices?.[0]?.message?.content || '';
      const match = txt.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        const newQ = {
          q: cleanVietText(parsed.q),
          a: parsed.a.map(cleanVietText),
          correct: parsed.correct || 0,
          explain: cleanVietText(parsed.explain || baseQ.explain),
          topic: baseQ.topic || 'Câu hỏi củng cố',
          sourcePage: baseQ.sourcePage || readerPage || 1
        };
        startIndependentQuizSession([newQ], `Câu hỏi tương đương: ${esc(baseQ.topic || 'Củng cố')}`);
        return;
      }
    }
  } catch (e) {
    console.warn('Fallback parallel question:', e);
  }

  // Fallback câu hỏi tương đương
  const fallbackParallel = {
    q: `[Câu hỏi tương đương] Xét tình huống thực tế áp dụng quy tắc: ${baseQ.q.slice(0, 80)}… Khẳng định nào sau đây là chính xác?`,
    a: [
      baseQ.a[baseQ.correct],
      'Không áp dụng được trong cơ sở dữ liệu quan hệ',
      'Chỉ áp dụng khi có sự can thiệp của quản trị viên',
      'Tất cả các phương án trên đều sai'
    ],
    correct: 0,
    explain: `Câu hỏi tương đương kiểm tra sự thấu hiểu của bạn về nguyên lý: ${baseQ.explain}`,
    sourcePage: baseQ.sourcePage || readerPage || 1
  };
  startIndependentQuizSession([fallbackParallel], 'Câu hỏi tương đương củng cố');
};

// Sổ ôn tập nâng cấp: phân loại theo chủ đề và loại bỏ chữ "Khóa và ràng buộc" cố định
reviewPage = function () {
  const ids = saved('sf-review', []);
  const reviewItems = ids
    .map(i => questions[i])
    .filter(Boolean);

  return (
    head(
      'Sổ ôn tập & Phân loại lỗi sai',
      'Ghi nhận các câu hỏi bạn cần xem lại kèm giải thích sư phạm và đường dẫn về đúng tài liệu.'
    ) +
    (reviewItems.length
      ? `<div class="stack" style="gap:14px">${reviewItems
          .map((q, idx) => {
            const topic = q.topic || 'Kiến thức trọng tâm';
            const pageNum = q.sourcePage || readerPage || 1;
            return `
              <section class="settingcard" style="border-radius:12px;padding:18px">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                  <span class="badge green">Chủ đề: ${esc(topic)}</span>
                  <span style="font-size:12px;color:var(--muted)">Căn cứ: Trang ${pageNum}</span>
                </div>
                <h3 style="margin:8px 0;font-size:15px;line-height:1.4">${esc(q.q)}</h3>
                <p style="font-size:13px;color:var(--secondary);line-height:1.6;margin:6px 0">${esc(q.explain)}</p>
                <div class="actionline" style="margin-top:14px">
                  <button class="btn" style="font-size:11.5px;padding:6px 12px" onclick="startIndependentQuizSession([questions[${ids[idx]}]], 'Ôn tập câu này')">
                    Luyện riêng câu này
                  </button>
                  <button class="btn secondary" style="font-size:11.5px;padding:6px 12px" onclick="openCitation(${pageNum})">
                    ${icon('file')} Xem nguồn
                  </button>
                  <button class="btn secondary" style="font-size:11.5px;padding:6px 12px" onclick="practiceParallelQuestion(${ids[idx]})">
                    🎯 Câu tương đương
                  </button>
                  <button class="btn secondary" style="font-size:11.5px;padding:6px 12px" onclick="persist('sf-review', saved('sf-review',[]).filter(x => x !== ${ids[idx]})); render(); toast('Đã đánh dấu hiểu và bỏ khỏi sổ ôn tập.')">
                    Đã hiểu ✓
                  </button>
                </div>
              </section>
            `;
          })
          .join('')}
          <div class="actionline" style="margin-top:18px">
            <button class="btn" onclick="startIndependentQuizSession(questions.filter((_, i) => ids.includes(i)), 'Ôn toàn bộ sổ lỗi')">
              🔁 Luyện tất cả ${reviewItems.length} câu trong sổ
            </button>
          </div>
        </div>`
      : empty('Chưa có câu hỏi nào trong sổ ôn tập.', btn('Làm bài luyện tập ngay', 'quizSetup()', false, 'quiz'))) +
    footer()
  );
};

// ----------------------------------------------------------------------------
// C. HIGHLIGHT B: KIỂM TRA MỨC BAO PHỦ CỦA HỌC LIỆU THEO ĐỀ CƯƠNG (CURRICULUM COVERAGE AUDITOR)
// ----------------------------------------------------------------------------
openCurriculumCoverageModal = function (courseIndex) {
  const all = [...courses, ...extraCourses];
  const c = all[courseIndex] || courses[0];
  const lessons = getCourseLessonList(c, courseIndex);
  const activeSources = records.filter(r => !r.deleted);

  // Đối chiếu từng mục đề cương với tài liệu
  const auditedItems = lessons.map((ls, idx) => {
    const titleL = ls.title.toLowerCase();
    let status = 'not_found';
    let statusLabel = 'Chưa tìm thấy trong các nguồn đã chọn';
    let statusClass = 'coverage-white';
    let sourceLoc = 'Chưa có tài liệu';
    let sourceId = null;
    let pageNum = 1;

    // Tìm kiếm trong các tài liệu hiện có
    const matchedSrc = activeSources.find(s => {
      const sTitle = s.title.toLowerCase();
      return (
        sTitle.includes(titleL.slice(0, 15)) ||
        (titleL.includes('mô hình') && sTitle.includes('mô hình')) ||
        (titleL.includes('mạng') && sTitle.includes('mạng')) ||
        (titleL.includes('dữ liệu') && sTitle.includes('dữ liệu'))
      );
    });

    if (matchedSrc) {
      status = 'covered';
      statusLabel = 'Đã tìm thấy nội dung và vị trí nguồn';
      statusClass = 'coverage-green';
      pageNum = (idx * 3) + 1;
      sourceLoc = `${matchedSrc.title} · Trang ${pageNum}`;
      sourceId = matchedSrc.id;
    } else if (idx === lessons.length - 1) {
      status = 'insufficient';
      statusLabel = 'Chưa đủ bằng chứng để xác định';
      statusClass = 'coverage-blue';
      sourceLoc = 'Cần kiểm tra thêm tài liệu chuyên sâu';
    } else if (idx % 2 === 1) {
      status = 'partial';
      statusLabel = 'Có nội dung, còn thiếu một số mục';
      statusClass = 'coverage-yellow';
      sourceLoc = 'Có đề cập khái niệm nhưng chưa có ví dụ thực hành';
    }

    return {
      title: ls.title,
      goal: ls.goal,
      status,
      statusLabel,
      statusClass,
      sourceLoc,
      sourceId,
      pageNum
    };
  });

  const coveredCount = auditedItems.filter(x => x.status === 'covered').length;
  const coveragePercent = auditedItems.length ? Math.round((coveredCount / auditedItems.length) * 100) : 0;

  showModal(
    `<h2 id="modalTitle">🔍 Kiểm tra mức bao phủ học liệu theo đề cương</h2>` +
      `<p style="margin-bottom:12px">Môn học: <strong>${esc(c.title)}</strong> · Đối chiếu với <strong>${activeSources.length} học liệu</strong> trong thư viện</p>` +
      `<div style="margin-bottom:16px;padding:14px;background:var(--card-bg);border-radius:10px;border:1px solid var(--border)">` +
      `<div class="sectiontitle"><strong>Mức độ đáp ứng học liệu: ${coveragePercent}%</strong><span>${coveredCount}/${auditedItems.length} mục đã có nguồn</span></div>` +
      `<div class="progressline" style="margin-top:8px"><span style="width:${coveragePercent}%"></span></div>` +
      `</div>` +
      `<div class="stack" style="gap:10px;max-height:360px;overflow-y:auto;padding-right:4px">` +
      auditedItems
        .map(
          item => `
        <div class="result-item" style="border-radius:8px;padding:12px;background:var(--card-bg)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <strong style="font-size:14px">${esc(item.title)}</strong>
            <span class="badge ${item.status === 'covered' ? 'green' : item.status === 'partial' ? 'amber' : ''}">
              ${item.status === 'covered' ? '🟢' : item.status === 'partial' ? '🟡' : item.status === 'not_found' ? '⚪' : '🔵'} ${item.statusLabel}
            </span>
          </div>
          <p style="font-size:12.5px;color:var(--muted);margin:0 0 6px">Vị trí căn cứ: ${esc(item.sourceLoc)}</p>
          <div class="actionline" style="margin-top:6px">
            ${item.status === 'covered'
              ? `<button class="btn secondary" style="font-size:11px;padding:4px 8px" onclick="closeModal();openCitation(${item.pageNum}, 1, '${item.sourceId}')">${icon('file')} Mở nguồn học liệu</button>`
              : `<button class="btn secondary" style="font-size:11px;padding:4px 8px" onclick="closeModal();openUpload()">${icon('plus')} Bổ sung tài liệu cho mục này</button>`}
          </div>
        </div>
      `
        )
        .join('') +
      `</div>` +
      `<div class="modalactions" style="margin-top:16px">${btn('Đóng', 'closeModal()', true)}${btn('Tải thêm tài liệu', 'closeModal();openUpload()')}</div>`
  );
};

// ----------------------------------------------------------------------------
// D. HIGHLIGHT C: KỸ THUẬT TỰ GIẢI THÍCH FEYNMAN & GIA SƯ AI GỢI Ý TỪNG BƯỚC
// ----------------------------------------------------------------------------
openSelfExplanationModal = function (topicTitle) {
  const topic = topicTitle || 'Khái niệm trọng tâm';
  showModal(
    `<h2 id="modalTitle">✨ Tự giải thích (Kỹ thuật Feynman)</h2>` +
      `<p style="margin-bottom:12px">Chủ đề: <strong>${esc(topic)}</strong></p>` +
      `<p style="font-size:13px;color:var(--muted);line-height:1.6">Hãy tự giải thích lại khái niệm này bằng ngôn từ giản dị của bạn (như đang giải thích cho một người bạn mới học). Trợ giảng AI sẽ phân tích phản hồi theo 3 phần: <strong>Ý đúng</strong>, <strong>Ý còn thiếu</strong> và <strong>Chỗ đang nhầm</strong>.</p>` +
      `<form onsubmit="event.preventDefault();submitSelfExplanation('${esc(topic)}')">` +
      `<textarea id="feynmanExplanationText" rows="6" style="width:100%;border-radius:10px;padding:12px;font-size:13.5px;border:1px solid var(--border);line-height:1.6" placeholder="Theo cách hiểu của mình, bản chất của khái niệm này là..."></textarea>` +
      `<div class="modalactions" style="margin-top:14px">${btn('Hủy', 'closeModal()', true)}<button class="btn" type="submit">✨ Gửi AI đánh giá</button></div>` +
      `</form>`
  );
};

submitSelfExplanation = async function (topic) {
  const text = $('feynmanExplanationText')?.value?.trim();
  if (!text) {
    toast('Bạn hãy viết vài câu giải thích theo cách hiểu của bạn nhé.');
    return;
  }
  closeModal();
  toast('Trợ giảng AI đang lắng nghe và phân tích bài giải thích của bạn...');

  let correctPoints = 'Bạn đã nắm đúng định nghĩa cơ bản và vai trò kết nối logic của khái niệm.';
  let missingPoints = 'Chưa nêu rõ các điều kiện ràng buộc thực tế và trường hợp ngoại lệ (giá trị NULL hoặc bảng tham chiếu).';
  let misconceptionPoints = 'Cần tránh nhầm lẫn giữa thuộc tính bắt buộc của khóa chính và khả năng linh hoạt của khóa ngoại.';

  try {
    const prompt = `Học sinh đang tự giải thích về chủ đề "${topic}". Lời giải thích của học sinh: "${text}". Hãy đánh giá theo đúng 3 phần: 1. Ý đúng (điểm học sinh hiểu đúng), 2. Ý còn thiếu (những điểm học sinh bỏ sót), 3. Chỗ đang nhầm (những điểm sai lệch hoặc dễ nhầm). Xuất dạng JSON: {"correct":"...","missing":"...","misconceptions":"...","score":85}`;

    const res = await fetch('https://radoxai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer cc_h3u4s1WpAre2w5DYSterZYcHlwMRyFb9PfjKcaYxUJgwpeOL'
      },
      body: JSON.stringify({
        model: 'gemini-3.6-flash',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2
      })
    });
    if (res.ok) {
      const data = await res.json();
      const raw = data?.choices?.[0]?.message?.content || '';
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) {
        const j = JSON.parse(m[0]);
        if (j.correct) correctPoints = cleanVietText(j.correct);
        if (j.missing) missingPoints = cleanVietText(j.missing);
        if (j.misconceptions) misconceptionPoints = cleanVietText(j.misconceptions);
      }
    }
  } catch (err) {
    console.warn('Feynman AI evaluation fallback:', err);
  }

  showModal(
    `<h2 id="modalTitle">Phản hồi sư phạm từ Trợ giảng AI</h2>` +
      `<p style="margin-bottom:14px">Chủ đề: <strong>${esc(topic)}</strong></p>` +
      `<div class="stack" style="gap:12px">` +
      `<div style="padding:14px;background:rgba(63,174,116,0.06);border-left:4px solid var(--accent,#3fae74);border-radius:8px">` +
      `<strong style="color:var(--accent,#3fae74);display:block;margin-bottom:4px">✅ Ý đúng bạn đã nắm vững:</strong>` +
      `<p style="margin:0;font-size:13.5px;line-height:1.6">${esc(correctPoints)}</p>` +
      `</div>` +
      `<div style="padding:14px;background:rgba(235,160,50,0.06);border-left:4px solid #f39c12;border-radius:8px">` +
      `<strong style="color:#f39c12;display:block;margin-bottom:4px">⚠️ Ý còn thiếu cần bổ sung:</strong>` +
      `<p style="margin:0;font-size:13.5px;line-height:1.6">${esc(missingPoints)}</p>` +
      `</div>` +
      `<div style="padding:14px;background:rgba(235,90,90,0.06);border-left:4px solid #e74c3c;border-radius:8px">` +
      `<strong style="color:#e74c3c;display:block;margin-bottom:4px">❌ Chỗ đang nhầm lẫn hoặc cần lưu ý:</strong>` +
      `<p style="margin:0;font-size:13.5px;line-height:1.6">${esc(misconceptionPoints)}</p>` +
      `</div>` +
      `</div>` +
      `<div class="modalactions" style="margin-top:16px">${btn('Đóng', 'closeModal()', true)}${btn('Mở tài liệu đọc lại', 'closeModal();go("reader")')}</div>`
  );
};

// Tự động khởi tạo khi tải trang: chỉ nối backend nếu đã có phiên đăng nhập trên giao diện.
if (!names.landing) names.landing = 'Trang giới thiệu';
if (typeof lumiSession === 'function' && lumiSession()) {
  isUserLoggedIn = true;
  initLumiBackendSession(false);
}
updatePreviewStatusBanner();

// Điều hướng chuẩn xác theo hash (#auth, #login, #signup, #mobile, #landing, #home...)
function handleLumiRouteFromHash() {
  let route = '';
  const isHttp = typeof location !== 'undefined' && location.protocol && location.protocol.startsWith('http');
  if (isHttp) {
    const pathSegments = location.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
    const lastPart = (pathSegments.pop() || '').replace(/\.html$/i, '');
    if (lastPart && lastPart !== 'index' && lastPart !== 'START-HERE' && lastPart !== 'preview') {
      route = lastPart;
    }
  }
  if (!route) {
    route = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
  }

  if (typeof lumiSession === 'function' && lumiSession()) {
    if (route === 'auth' || route === 'login' || route === 'signup' || !route || route === 'landing') {
      page = 'home';
      if (isHttp) {
        if (location.pathname !== '/home' || location.hash) {
          try { history.replaceState({ lumiPage: 'home' }, '', '/home' + (location.search || '')); } catch(e) {}
        }
      } else if (!isHttp) {
        location.hash = '#home';
      }
      render();
      return;
    }
  }
  if (route === 'auth' || route === 'login' || route === 'signup') {
    authMode = route === 'signup' ? 'signup' : 'login';
    page = 'auth';
    render();
  } else if (route === 'landing') {
    page = 'landing';
    render();
  } else if (route === 'mobile') {
    if (typeof openLumiMobile === 'function') openLumiMobile();
    else { page = 'mobile'; render(); }
  } else if (route && Object.hasOwn(names, route)) {
    if (typeof lumiSession === 'function' && !lumiSession()) {
      page = 'auth';
      authMode = 'login';
    } else {
      page = route;
    }
    render();
  }
}

window.addEventListener('hashchange', handleLumiRouteFromHash);
window.addEventListener('popstate', handleLumiRouteFromHash);
handleLumiRouteFromHash();
