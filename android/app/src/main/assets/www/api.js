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
let LUMI_API_BASE = /^https?:$/.test(window.location.protocol)
  ? `${window.location.origin}/api/v1`
  : (localStorage.getItem('lumi-api-base') || 'https://neighborhood-cove-marks-fred.trycloudflare.com/api/v1');

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
    'https://neighborhood-cove-marks-fred.trycloudflare.com/api/v1',
    localStorage.getItem('lumi-api-base'),
    'http://192.168.39.17:8000/api/v1',
    'http://100.120.76.189:8000/api/v1',
    'http://localhost:8000/api/v1'
  ].filter((v, i, a) => v && a.indexOf(v) === i);

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
const lumiLoadingChunks = {};
let lumiDocMode = 'pdf';

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
    if (method === 'DELETE' && match) {
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
  // 1. Thử gọi máy chủ FastAPI (Localhost, LAN hoặc Cloudflare Tunnel)
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3500);
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
    const data = await response.json().catch(() => ({}));
    if (response.ok) {
      lumiBackendConnected = true;
      updatePreviewStatusBanner();
      return data;
    }
  } catch (err) {
    // Máy tính đã tắt hoặc server nội bộ không chạy -> Chuyển sang kết nối trực tiếp Supabase Đám Mây 24/7
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
  if (!sourceId || !/^[0-9a-f-]{36}$/i.test(sourceId)) return [];
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
      const readySrc = serverSources.find(s => s.status === 'ready') || serverSources[0];
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
      records.splice(0, records.length, ...mapped);
      saveRecords();
      if (!chatSourceIds.length || !chatSourceIds.some(id => mapped.some(m => m.id === id))) {
        chatSourceIds = [lumiActiveBackendSourceId];
      }
      await loadSourceChunks(records[sourceIndex]?.id || lumiActiveBackendSourceId);
      return lumiActiveBackendSourceId;
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
      await ensureBackendDefaultSource();
      await Promise.all([
        syncFlashcardsFromBackend(),
        syncNotesFromBackend(),
        syncCoursesFromBackend()
      ]);
      render();
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

async function renderPdfDocumentViaPdfJs(pdfUrl, initialPage = 1) {
  const viewport = document.getElementById('pdfScrollViewport');
  if (!viewport) return;

  if (lastLoadedPdfUrl === pdfUrl && currentPdfDoc) {
    jumpToPdfPage(initialPage);
    return;
  }

  viewport.innerHTML =
    '<div style="color:#94a3b8;padding:40px;text-align:center;font-size:13px">⏳ Đang nạp bản PDF chuẩn 100% với công nghệ hiển thị trang mượt mà...</div>';

  try {
    if (typeof pdfjsLib === 'undefined') {
      throw new Error('PDF.js library not loaded');
    }
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.js';

    const loadingTask = pdfjsLib.getDocument({
      url: pdfUrl,
      disableWorker: window.location.protocol === 'file:',
      cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
      cMapPacked: true
    });

    currentPdfDoc = await loadingTask.promise;
    lastLoadedPdfUrl = pdfUrl;
    const numPages = currentPdfDoc.numPages;

    const r = records[sourceIndex];
    if (r) {
      r.pageCount = numPages;
      r.meta = `${numPages} trang · Đã đồng bộ đám mây`;
      saveRecords();
    }

    viewport.innerHTML = '';

    for (let p = 1; p <= numPages; p++) {
      const pageCard = document.createElement('div');
      pageCard.className = 'pdf-page-card';
      pageCard.id = `pdf-page-card-${p}`;
      pageCard.innerHTML = `<div class="pdf-page-badge">Trang ${p} / ${numPages}</div><canvas id="pdf-canvas-${p}"></canvas>`;
      viewport.appendChild(pageCard);

      renderSinglePdfPage(currentPdfDoc, p);
    }

    const pageNumEl = document.getElementById('pageNum');
    if (pageNumEl) pageNumEl.textContent = `Trang ${initialPage} / ${numPages}`;

    setupPdfScrollObserver(viewport, numPages);

    if (initialPage > 1) {
      setTimeout(() => jumpToPdfPage(initialPage), 250);
    }
  } catch (err) {
    console.warn('PDF.js render fallback to iframe:', err);
    viewport.innerHTML = `<iframe id="lumiPdfFrame" src="${pdfUrl}#page=${initialPage}&zoom=page-width" style="width:100%;height:100%;border:0;display:block"></iframe>`;
  }
}

async function renderSinglePdfPage(pdfDoc, pageNum) {
  try {
    const page = await pdfDoc.getPage(pageNum);
    const canvas = document.getElementById(`pdf-canvas-${pageNum}`);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const desiredWidth = Math.min(840, window.innerWidth > 900 ? 760 : window.innerWidth - 60);
    const viewport = page.getViewport({ scale: 1 });
    const scale = (desiredWidth / viewport.width) * 1.5;
    const scaledViewport = page.getViewport({ scale });

    canvas.width = scaledViewport.width;
    canvas.height = scaledViewport.height;
    canvas.style.width = `${scaledViewport.width / 1.5}px`;
    canvas.style.height = `${scaledViewport.height / 1.5}px`;

    await page.render({
      canvasContext: ctx,
      viewport: scaledViewport
    }).promise;
  } catch (e) {
    console.warn(`Lỗi vẽ trang PDF ${pageNum}:`, e);
  }
}

function setupPdfScrollObserver(viewport, totalPages) {
  let isScrolling = null;
  viewport.addEventListener('scroll', () => {
    clearTimeout(isScrolling);
    isScrolling = setTimeout(() => {
      const cards = viewport.querySelectorAll('.pdf-page-card');
      let visiblePage = readerPage;
      let minDiff = Infinity;
      const viewTop = viewport.scrollTop;
      cards.forEach(c => {
        const p = parseInt(c.id.replace('pdf-page-card-', ''), 10);
        const diff = Math.abs(c.offsetTop - viewTop);
        if (diff < minDiff) {
          minDiff = diff;
          visiblePage = p;
        }
      });
      if (visiblePage !== readerPage) {
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
    if (pageCard) {
      pageCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      pageCard.classList.add('page-citation-focus');
      setTimeout(() => pageCard.classList.remove('page-citation-focus'), 3000);
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
  const pdfWrap = document.getElementById('lumiPdfWrapper');
  const textWrap = document.getElementById('lumiTextWrapper');
  if (pdfWrap && textWrap) {
    pdfWrap.style.display = mode === 'pdf' ? 'flex' : 'none';
    textWrap.style.display = mode === 'text' ? 'block' : 'none';
    document.querySelectorAll('.doc-mode-toggle button').forEach(b => {
      const isActive =
        (b.textContent.includes('Bản PDF') && mode === 'pdf') ||
        (b.textContent.includes('Văn bản') && mode === 'text');
      b.classList.toggle('active', isActive);
      b.style.background = isActive ? 'var(--accent)' : 'transparent';
      b.style.color = isActive ? '#fff' : 'var(--text)';
    });
    if (mode === 'pdf') {
      const activeRec = records[sourceIndex] || records[0];
      const isRealUUID = activeRec?.id && /^[0-9a-f-]{36}$/i.test(activeRec.id);
      const realPdfId = isRealUUID ? activeRec.id : (lumiActiveBackendSourceId || null);
      if (realPdfId) {
        renderPdfDocumentViaPdfJs(`${LUMI_API_BASE}/sources/${realPdfId}/file`, readerPage);
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
  readerPage = saved('lumi-source-page-' + r.id, 1);
  if (r.type === 'VIDEO') {
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
  const totalPages = Math.max(1, currentPdfDoc?.numPages || pages.length || r.pageCount || (r.title.includes('03') ? 9 : 2));
  if (readerPage > totalPages) readerPage = 1;
  if (readerPage < 1) readerPage = 1;

  const sourceTitle = cleanVietText(r.title || 'Tài liệu học tập');
  const activeSourceNames =
    chatSourceIds
      .map(id => cleanVietText(records.find(x => x.id === id && !x.deleted)?.title || ''))
      .filter(Boolean)
      .join(', ') || sourceTitle;

  // Thanh công cụ hiện đại (Ảnh số 2) với các icon màu bắt mắt
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
      <button class="lumi-tool-pill" onclick="reuploadCurrentSourceFile()" title="Tải tệp PDF từ máy tính của bạn">
        <span class="tool-icon-badge upload-badge">${icon('plus')}</span>
        <span>Tải lại file PDF từ máy</span>
      </button>
      <button class="lumi-tool-pill" onclick="editNotebook(null,'highlight')" title="Ghi chú nhanh ý quan trọng">
        <span class="tool-icon-badge note-badge">${icon('note')}</span>
        <span>Ghi chú nhanh</span>
      </button>
      <button class="lumi-tool-pill" onclick="completeLesson()" title="Đánh dấu đã hoàn thành bài học này">
        <span class="tool-icon-badge check-badge">${icon('check')}</span>
        <span>Đánh dấu hoàn thành</span>
      </button>
    </div>
  `;

  const isRealUUID = r.id && /^[0-9a-f-]{36}$/i.test(r.id);
  const realPdfId = isRealUUID ? r.id : (/^[0-9a-f-]{36}$/i.test(lumiActiveBackendSourceId) ? lumiActiveBackendSourceId : null);
  const pdfUrl = realPdfId ? `${LUMI_API_BASE}/sources/${realPdfId}/file` : '';

  // Khung xem bản PDF gốc bằng Canvas (Zero-Flicker)
  const pdfViewerWrapHTML = `
    <div class="pdf-viewer-wrap" id="lumiPdfWrapper" style="display:${lumiDocMode === 'pdf' ? 'flex' : 'none'}">
      <div class="pdf-scroll-viewport" id="pdfScrollViewport">
        <div style="color:#94a3b8;padding:40px;text-align:center;font-size:13px">Đang chuẩn bị hiển thị tài liệu...</div>
      </div>
    </div>
  `;

  // Khung xem Văn bản AI (liệt kê toàn bộ các trang để cuộn mượt khi bấm trích dẫn)
  const allPagesTextHTML = pages.length > 0 ? pages.map(pObj => {
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

  // Tự động kích hoạt vẽ PDF bằng PDF.js sau khi DOM đã được gắn
  if (pdfUrl) {
    setTimeout(() => {
      if (lumiDocMode === 'pdf') {
        renderPdfDocumentViaPdfJs(pdfUrl, readerPage);
      }
    }, 40);
  }

  return (
    `<div class="pagehead"><div><button class="textbtn" style="padding:0;margin-bottom:12px" onclick="tab='sources';go('library')">${icon(
      'back'
    )}Thư viện học liệu</button><h1 style="font-size:24px">${esc(
      sourceTitle
    )}</h1><p>${esc(sourceTitle)} · ${totalPages} trang · ${
      chunks.length
    } phân đoạn kiến thức đã lập chỉ mục AI</p></div><button class="btn secondary" onclick="quizSetup()">${icon(
      'quiz'
    )}Luyện tập từ nguồn này</button></div>` +
    bar +
    `<p class="source-context">Nguồn hội thoại đang chọn: <strong>${esc(activeSourceNames)}</strong></p>` +
    `<div class="reading-switch"><button class="${
      readingView === 'document' ? 'active' : ''
    }" onclick="readingView='document';render()">${icon(
      'file'
    )} Nội dung Tài liệu</button><button class="${
      readingView === 'assistant' ? 'active' : ''
    }" onclick="readingView='assistant';render()">${icon('spark')} Trợ giảng AI</button></div>` +
    `<div class="readergrid" data-view="${readingView}">` +
    `<section class="reader"><div class="readertools">` +
    `<div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1"><span style="font-weight:600;font-size:13px;display:flex;align-items:center;gap:7px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${icon(
      'file'
    )} ${esc(sourceTitle)}</span><span class="badge green" style="font-size:10px;padding:3px 8px;border-radius:6px;flex-shrink:0">PDF Gốc Chuẩn</span></div>` +
    `<div class="doc-mode-toggle" style="display:flex;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:3px;gap:3px;margin:0 10px"><button class="${
      lumiDocMode === 'pdf' ? 'active' : ''
    }" style="font-size:11px;padding:5px 10px;border-radius:6px;border:0;cursor:pointer;background:${
      lumiDocMode === 'pdf' ? 'var(--accent)' : 'transparent'
    };color:${lumiDocMode === 'pdf' ? '#fff' : 'var(--text)'};font-weight:600" onclick="switchDocMode('pdf')">${icon(
      'file'
    )} Bản PDF gốc (100%)</button><button class="${
      lumiDocMode === 'text' ? 'active' : ''
    }" style="font-size:11px;padding:5px 10px;border-radius:6px;border:0;cursor:pointer;background:${
      lumiDocMode === 'text' ? 'var(--accent)' : 'transparent'
    };color:${lumiDocMode === 'text' ? '#fff' : 'var(--text)'};font-weight:600" onclick="switchDocMode('text')">${icon(
      'note'
    )} Văn bản AI</button></div>` +
    `<div style="display:flex;align-items:center;gap:6px;flex-shrink:0"><button class="btn secondary" style="padding:5px 10px;font-size:11.5px" aria-label="Trang trước" onclick="changePage(-1)">‹ Trang trước</button> <strong id="pageNum" style="font-size:11.5px;min-width:85px;text-align:center">Trang ${readerPage} / ${totalPages}</strong> <button class="btn secondary" style="padding:5px 10px;font-size:11.5px" aria-label="Trang sau" onclick="changePage(1)">Trang sau ›</button>${
      realPdfId
        ? `<a class="btn secondary" href="${LUMI_API_BASE}/sources/${realPdfId}/file" target="_blank" title="Mở file PDF gốc trong tab mới" style="padding:5px 9px;font-size:11.5px;text-decoration:none">${icon(
            'link'
          )} Phóng to</a>`
        : ''
    }</div></div>${pdfViewerWrapHTML}${textViewerWrapHTML}</section>` +
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
    `<div id="readerNotesTab" style="padding:18px;flex:1;display:${readerTab === 'notes' ? 'block' : 'none'}"><p style="font-size:12.5px;color:var(--secondary);line-height:1.7">Ghi lại các ý quan trọng theo cách hiểu của bạn. Ghi chú được lưu và đồng bộ vào tài khoản.</p><textarea class="notearea" id="noteEditor" aria-label="Nội dung ghi chú">${esc(
      note
    )}</textarea><button class="btn" onclick="saveNote()">${icon(
      'check'
    )}Lưu ghi chú</button></div>` +
    `<div id="readerChatTab" style="display:${readerTab === 'chat' ? 'flex' : 'none'};flex-direction:column;flex:1;min-height:0"><div class="chats" id="chats"><div class="msg assistant"><span class="label">${icon(
      'spark'
    )} TRỢ GIẢNG LUMI AI</span>Chào <strong>${esc(
      userProfile.name
    )}</strong>! Mình đang đồng hành cùng bạn trên tài liệu <strong>${esc(
      sourceTitle
    )}</strong> (${totalPages} trang).<br>Bạn có thể hỏi bất kỳ câu hỏi nào hoặc chọn gợi ý dưới đây nhé:<div class="suggestions"><button onclick="askPreset('Tóm tắt các nội dung chính trong tài liệu ${esc(
      sourceTitle
    )}')">Tóm tắt nội dung chính</button><button onclick="askPreset('Liệt kê các yêu cầu và mốc thời gian quan trọng nhất trong tài liệu này')">Các yêu cầu quan trọng</button></div></div>${chatMessages
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
    `<p>Tải tệp PDF hoặc nhập văn bản bài học. Lumi sẽ tự động trích xuất nội dung theo trang và lập chỉ mục cho Trợ giảng AI.</p>` +
      select('Loại học liệu', 'uploadKind', [
        'PDF / Slide bài giảng PDF',
        'Văn bản / Ghi chú môn học',
        'Tài liệu tham khảo mở rộng'
      ]) +
      input('Tên học liệu', 'uploadTitle') +
      `<label for="protoFile">Chọn tệp PDF từ máy tính</label><input id="protoFile" type="file" accept=".pdf,.txt" onchange="if(this.files[0])document.getElementById('uploadTitle').value=this.files[0].name">` +
      `<label for="uploadText">Hoặc dán nội dung văn bản (nếu không chọn file PDF)</label><textarea id="uploadText" rows="4" placeholder="Dán nội dung bài giảng hoặc tóm tắt chương tại đây..."></textarea>`,
    'addPrototypeSource()',
    'Tải lên & Mở tài liệu'
  );
};

addPrototypeSource = async function () {
  const title = $('uploadTitle')?.value?.trim();
  if (!title) {
    toast('Bạn nhập tên học liệu nhé.');
    return;
  }
  const kind = $('uploadKind')?.value || 'PDF';
  let textContent = $('uploadText')?.value?.trim() || '';
  const fileInput = $('protoFile');
  const file = fileInput?.files?.[0];

  closeModal();
  toast('Đang tải lên và phân tích nội dung tài liệu...');

  let pdfBase64 = null;
  if (file) {
    if (file.name.toLowerCase().endsWith('.pdf')) {
      pdfBase64 = await new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      });
    } else if (!textContent) {
      try {
        textContent = await file.text();
      } catch (e) {
        console.warn(e);
      }
    }
  }

  try {
    const res = await lumiFetch('/sources/web-ingest', {
      method: 'POST',
      body: JSON.stringify({
        title,
        kind: kind.startsWith('PDF') ? 'pdf' : 'pdf',
        description: 'Tải lên từ Lumi Web',
        pdf_base64: pdfBase64,
        text_content: textContent || undefined
      })
    });
    const s = res.data;
    lumiActiveBackendSourceId = s.id;
    localStorage.setItem('lumi-backend-source-id', s.id);
    const newRec = {
      id: s.id,
      backendId: s.id,
      title: cleanVietText(s.title),
      type: 'PDF',
      pageCount: s.active_version?.page_count || 1,
      status: s.status || 'ready',
      version: s.active_version?.version_no || 1,
      tags: ['Đã lập chỉ mục AI', 'Trích dẫn theo trang', 'Sẵn sàng hỏi đáp'],
      meta: `${s.active_version?.page_count || 1} trang · Đã đồng bộ đám mây`
    };
    records.unshift(newRec);
    saveRecords();
    chatSourceIds = [s.id];
    lumiActiveBackendConvId = '';
    sourceIndex = 0;
    readerPage = 1;
    await loadSourceChunks(s.id, true);
    go('reader');
    toast(`Đã xử lý xong và mở "${s.title}" (${s.active_version?.page_count || 1} trang)!`);
  } catch (err) {
    toast(`Lỗi xử lý nguồn: ${err.message}`);
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

openCitation = function (targetPage, ordinal = 1) {
  const p = targetPage || readerPage || 1;
  readerTab = 'chat';
  readingView = 'document';

  // Điều hướng trang mượt mà ngay trên bản PDF gốc (PDF.js Canvas) hoặc Văn bản AI
  jumpToPdfPage(p);

  // Hiệu ứng phát sáng trên nút trích dẫn vừa bấm
  document.querySelectorAll('.citation-ref-btn').forEach(btn => {
    if (btn.textContent.trim() === `[${ordinal}]`) {
      btn.classList.add('citation-active-pulse');
      setTimeout(() => btn.classList.remove('citation-active-pulse'), 2500);
    }
  });

  toast(`🔍 Đang hiển thị nguồn trích dẫn [${ordinal}] tại Trang ${p} trên tài liệu PDF.`);
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

  // 1. Thống kê nhanh chỉ số học tập
  const statsHTML = `
    <div class="l-library-stats">
      <div class="l-lib-stat-badge">
        <span class="stat-icon">🎓</span>
        <span>Khóa học: <strong>${all.length} lộ trình</strong></span>
      </div>
      <div class="l-lib-stat-badge">
        <span class="stat-icon">📑</span>
        <span>Học liệu đã lập chỉ mục AI: <strong>${allSources.length} tài liệu</strong></span>
      </div>
      <div class="l-lib-stat-badge">
        <span class="stat-icon">📝</span>
        <span>Sổ tay ghi chú: <strong>${notebooks.length} mục</strong></span>
      </div>
      <div class="l-lib-stat-badge">
        <span class="stat-icon">🗂️</span>
        <span>Thẻ nhớ SM-2: <strong>${cardDeck.length} thẻ</strong></span>
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
      <button class="lumi-tool-pill" onclick="openNewCourse()" title="Khởi tạo môn học hoặc lộ trình cá nhân">
        <span class="tool-icon-badge folder-badge">${icon('folder')}</span>
        <span>Tạo khóa học</span>
      </button>
      <button class="lumi-tool-pill" onclick="go('notes')" title="Mở toàn bộ sổ tay ghi chép">
        <span class="tool-icon-badge note-badge">${icon('note')}</span>
        <span>Ghi chú bài học</span>
      </button>
      <button class="lumi-tool-pill" onclick="go('history')" title="Xem lại các phiên thảo luận cùng trợ giảng AI">
        <span class="tool-icon-badge history-badge">${icon('clock')}</span>
        <span>Lịch sử hỏi đáp AI</span>
      </button>
      <button class="lumi-tool-pill" onclick="quizSetup()" title="Biên soạn đề thi trắc nghiệm AI">
        <span class="tool-icon-badge check-badge">${icon('quiz')}</span>
        <span>Luyện trắc nghiệm AI</span>
      </button>
    </div>
  `;

  let content = '';
  if (tab === 'courses') {
    content = `
      <div class="librarygrid">
        ${filtered.map(x => renderModernCourseCard(x.c, x.i)).join('')}
      </div>
    `;
  } else if (tab === 'sources') {
    content = sourceRows();
  } else if (tab === 'notes') {
    content = notebooks.length
      ? `<div class="feature-grid">${notebooks
          .map(
            n => `
          <article class="settingcard" style="border-radius:14px;box-shadow:0 2px 8px rgba(0,0,0,0.02)">
            <span class="badge green">${cleanVietText(n.kind || 'Ghi chú')} · Trang ${n.page || 1}</span>
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

function renderModernCourseCard(c, i) {
  const isBlue = Boolean(c.blue);
  const lessons = drafts[i] || [
    'Tổng quan môn học',
    'Các khái niệm nền tảng',
    'Khóa và ràng buộc',
    'Ứng dụng và luyện tập'
  ];
  const curLesson =
    lessons[Math.min(lessons.length - 1, Math.floor(((c.progress || 0) / 100) * lessons.length))] ||
    lessons[0];
  const coverText = c.cover || c.title || 'Khóa học';
  return `
    <div class="course" onclick="openCourse(${i})" style="cursor:pointer;display:flex;flex-direction:column">
      <div class="coursecover ${isBlue ? 'blue' : ''}">
        <div>
          <div class="coverlabel">LUMI / LEARNING</div>
          <div class="covername">${esc(coverText).replace(/\n/g, '<br>')}</div>
        </div>
        ${courseArt(isBlue)}
      </div>
      <div class="coursebody" style="display:flex;flex-direction:column;flex:1">
        <span class="badge ${isBlue ? 'green' : ''}" style="align-self:flex-start">${esc(
          c.tag || 'CNTT · Nền tảng'
        )}</span>
        <h3>${c.archived ? '[Lưu trữ] ' : ''}${esc(c.title)}</h3>
        <p>${esc(c.subtitle || curLesson)}</p>
        <div class="progressline"><span style="width:${c.progress || 0}%"></span></div>
        <div class="coursestatus">
          <span>Đã mở ${esc(c.lessons || '3 / 8 bài')}</span>
          <span>${c.progress || 0}%</span>
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
    try {
      const res = await lumiFetch('/notes', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'note',
          title,
          body,
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
      title,
      body,
      kind,
      page: readerPage || 1
    });
  }
  saveAllNotes();
  closeModal();
  render();
  toast('Đã lưu ghi chú và đồng bộ thành công!');
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
    input('Tên khóa học', 'courseName', '', 'text', 'Ví dụ: Trí tuệ nhân tạo đại cương') +
      input('Mục tiêu / Chuyên đề trọng tâm', 'courseGoal', '', 'text', 'Ví dụ: Bài 1 · Các thuật toán tìm kiếm'),
    'submitNewCourseBackend()',
    'Tạo khóa học'
  );
};

async function submitNewCourseBackend() {
  const name = $('courseName')?.value?.trim();
  const goal = $('courseGoal')?.value?.trim() || 'Bài 1 · Tổng quan môn học';
  if (!name) {
    toast('Bạn nhập tên khóa học nhé.');
    return;
  }
  let createdId = null;
  try {
    const srcIds = records
      .filter(r => !r.deleted && /^[0-9a-f-]{36}$/i.test(r.id))
      .slice(0, 2)
      .map(r => r.id);
    const res = await lumiFetch('/courses', {
      method: 'POST',
      body: JSON.stringify({
        title: name,
        description: goal,
        goal,
        source_ids: srcIds.length ? srcIds : undefined
      })
    });
    createdId = res?.data?.id || null;
  } catch (e) {
    console.warn(e);
  }
  extraCourses.push({
    backendId: createdId,
    title: name,
    cover: name,
    tag: 'Khóa học cá nhân',
    subtitle: goal,
    progress: 12,
    lessons: '1 / 6 bài',
    blue: extraCourses.length % 2 === 1
  });
  persist('sf-courses', extraCourses);
  closeModal();
  tab = 'courses';
  go('library');
  toast(`Đã khởi tạo khóa học "${name}"!`);
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

// Tự động khởi tạo khi tải trang: chỉ nối backend nếu đã có phiên đăng nhập trên giao diện.
if (!names.landing) names.landing = 'Trang giới thiệu';
if (typeof lumiSession === 'function' && lumiSession()) {
  isUserLoggedIn = true;
  initLumiBackendSession(false);
}
updatePreviewStatusBanner();
