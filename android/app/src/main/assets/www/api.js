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
const LUMI_API_BASE = /^https?:$/.test(window.location.protocol)
  ? `${window.location.origin}/api/v1`
  : 'http://localhost:8000/api/v1';

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

async function lumiFetch(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  if (lumiToken) {
    headers['Authorization'] = `Bearer ${lumiToken}`;
  }
  const response = await fetch(`${LUMI_API_BASE}${path}`, {
    ...options,
    headers
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg = data?.error?.message || data?.detail || `HTTP ${response.status}`;
    throw new Error(msg);
  }
  return data;
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

async function initLumiBackendSession(showNotice = false) {
  try {
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
      await syncFlashcardsFromBackend();
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
  lumiActiveBackendConvId = '';
  readerTab = 'chat';
  readingView = 'document';
  readerPage = saved('lumi-source-page-' + r.id, 1);
  if (r.type === 'VIDEO') {
    go('video');
    return;
  }
  go('reader');
  await loadSourceChunks(r.id);
};

changePage = function (d) {
  const r = records[sourceIndex] || records[0];
  const chunks = r ? lumiChunksCache[r.id] || [] : [];
  const pages = getPagesFromChunks(chunks);
  const maxPage = Math.max(1, pages.length || r?.pageCount || 1);
  readerPage = Math.min(maxPage, Math.max(1, readerPage + d));
  if (r) persist('lumi-source-page-' + r.id, readerPage);

  const iframe = document.getElementById('lumiPdfFrame');
  const isRealUUID = r?.id && /^[0-9a-f-]{36}$/i.test(r.id);
  const realPdfId = isRealUUID ? r.id : (/^[0-9a-f-]{36}$/i.test(lumiActiveBackendSourceId) ? lumiActiveBackendSourceId : null);

  if (iframe && realPdfId && lumiDocMode === 'pdf') {
    const baseSrc = `${LUMI_API_BASE}/sources/${realPdfId}/file`;
    iframe.src = `${baseSrc}#page=${readerPage}&zoom=page-width`;
    const pageNumEl = document.getElementById('pageNum');
    if (pageNumEl) pageNumEl.textContent = `Trang ${readerPage} / ${maxPage}`;
  } else {
    render();
  }
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

  const chunks = lumiChunksCache[r.id] || [];
  const pages = getPagesFromChunks(chunks);
  const totalPages = Math.max(1, pages.length || r.pageCount || 1);
  if (readerPage > totalPages) readerPage = 1;
  if (readerPage < 1) readerPage = 1;

  const currentPageObj = pages[readerPage - 1] || pages[0] || null;
  const sourceTitle = cleanVietText(r.title || 'Tài liệu học tập');
  const activeSourceNames =
    chatSourceIds
      .map(id => cleanVietText(records.find(x => x.id === id && !x.deleted)?.title || ''))
      .filter(Boolean)
      .join(', ') || sourceTitle;

  const bar = `<div class="actionline reader-extra">${btn(
    'Chọn nguồn học liệu',
    'chooseChatSources()',
    true,
    'folder'
  )}${btn('Lịch sử hỏi đáp', "go('history')", true, 'clock')}${btn(
    'Tóm tắt tài liệu',
    `askPreset('Tóm tắt chi tiết nội dung chính của tài liệu ${esc(sourceTitle)}')`,
    true,
    'spark'
  )}${btn(
    'Tải lại file PDF từ máy',
    'reuploadCurrentSourceFile()',
    true,
    'plus'
  )}${btn('Ghi chú nhanh', "editNotebook(null,'highlight')", true, 'note')}${btn(
    'Đánh dấu hoàn thành',
    'completeLesson()',
    true,
    'check'
  )}</div>`;

  let paperBodyHTML = '';
  const isRealUUID = r.id && /^[0-9a-f-]{36}$/i.test(r.id);
  const realPdfId = isRealUUID ? r.id : (/^[0-9a-f-]{36}$/i.test(lumiActiveBackendSourceId) ? lumiActiveBackendSourceId : null);

  if (lumiDocMode === 'pdf' && realPdfId) {
    const pdfUrl = `${LUMI_API_BASE}/sources/${realPdfId}/file#page=${readerPage}&zoom=page-width`;
    paperBodyHTML = `
      <div class="pdf-viewer-wrap" style="padding:10px;background:var(--surface2);border-radius:14px;box-sizing:border-box">
        <iframe id="lumiPdfFrame" src="${pdfUrl}" title="${esc(sourceTitle)}" style="width:100%;height:calc(100vh - 270px);min-height:700px;border:1px solid var(--border);border-radius:12px;background:#fff;display:block"></iframe>
      </div>
    `;
  } else if (lumiDocMode === 'pdf' && !realPdfId) {
    paperBodyHTML = `
      <article class="paper" style="max-width:980px;width:calc(100% - 40px);margin:20px auto;text-align:center;padding:48px 24px">
        <div style="font-size:42px;margin-bottom:12px">📄</div>
        <small style="color:var(--accent);font-weight:700">CHẾ ĐỘ XEM BẢN PDF GỐC 100%</small>
        <h2 style="margin:12px 0 10px;font-size:22px">${esc(sourceTitle)}</h2>
        <p style="color:var(--secondary);max-width:540px;margin:0 auto 24px;line-height:1.8">
          Nguồn này đang dùng dữ liệu trích xuất mẫu. Để trải nghiệm <strong>trình đọc nguyên bản PDF chuẩn 100%</strong> (giữ nguyên từng trang, phông chữ, bảng biểu, hình vẽ và mộc dấu), bạn hãy tải tệp PDF thật từ máy tính lên Lumi nhé.
        </p>
        <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
          <button class="btn" onclick="reuploadCurrentSourceFile()">${icon('plus')} Tải lên tệp PDF từ máy tính</button>
          <button class="btn secondary" onclick="lumiDocMode='text';render()">${icon('note')} Chuyển sang đọc Văn bản AI</button>
        </div>
      </article>
    `;
  } else if (lumiLoadingChunks[r.id]) {
    paperBodyHTML = `
      <article class="paper">
        <small>ĐANG ĐỒNG BỘ NỘI DUNG TÀI LIỆU...</small>
        <h2>${esc(sourceTitle)}</h2>
        <p>Hệ thống đang tải nội dung các trang của tài liệu...</p>
      </article>
    `;
  } else if (currentPageObj) {
    const paragraphsHTML = currentPageObj.blocks
      .map(block =>
        block
          .split(/\n+/)
          .map(line => cleanVietText(line).trim())
          .filter(Boolean)
          .map(line => `<p style="text-align:justify;line-height:1.85;margin:12px 0">${esc(line)}</p>`)
          .join('')
      )
      .join('<hr style="border:0;border-top:1px dashed var(--border);margin:18px 0">');

    paperBodyHTML = `
      <article class="paper" id="doc-page-${readerPage}" style="max-width:980px;width:calc(100% - 40px);margin:20px auto;padding:clamp(32px,3.5vw,60px) clamp(28px,3.5vw,52px)">
        <small style="color:var(--accent);font-weight:700">TRANG ${readerPage} / ${totalPages} · NỘI DUNG HỌC LIỆU</small>
        <h2 style="margin:10px 0 18px;font-size:21px">${esc(
          currentPageObj.heading || sourceTitle
        )}</h2>
        <div class="doc-real-content">${paragraphsHTML}</div>
        <div class="actionline" style="margin-top:24px">
          <button class="citation" onclick="askPreset('Giải thích chi tiết nội dung Trang ${readerPage} của tài liệu ${esc(
      sourceTitle
    )}')">${icon('spark')}Nhờ AI giải thích Trang ${readerPage}</button>
          <button class="citation" onclick="askPreset('Tạo 3 câu hỏi ôn tập từ nội dung Trang ${readerPage}')">${icon(
      'quiz'
    )}Tạo câu hỏi từ Trang ${readerPage}</button>
        </div>
        <div style="text-align:center;font-size:11px;color:var(--muted);margin-top:24px">
          Trang ${readerPage} / ${totalPages} · ${esc(sourceTitle)}
        </div>
      </article>
    `;
  } else {
    paperBodyHTML = `
      <article class="paper" style="max-width:980px;width:calc(100% - 40px);margin:20px auto">
        <small>TÀI LIỆU HỌC TẬP</small>
        <h2>${esc(sourceTitle)}</h2>
        <p>Hãy chọn tệp PDF từ máy tính để Lumi hiển thị đầy đủ các trang của tài liệu này.</p>
        <div class="actionline">
          ${btn('Chọn tệp PDF từ máy tính', 'reuploadCurrentSourceFile()', false, 'plus')}
        </div>
      </article>
    `;
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
    };color:${lumiDocMode === 'pdf' ? '#fff' : 'var(--text)'};font-weight:600" onclick="lumiDocMode='pdf';render()">${icon(
      'file'
    )} Bản PDF gốc (100%)</button><button class="${
      lumiDocMode === 'text' ? 'active' : ''
    }" style="font-size:11px;padding:5px 10px;border-radius:6px;border:0;cursor:pointer;background:${
      lumiDocMode === 'text' ? 'var(--accent)' : 'transparent'
    };color:${lumiDocMode === 'text' ? '#fff' : 'var(--text)'};font-weight:600" onclick="lumiDocMode='text';render()">${icon(
      'note'
    )} Văn bản AI</button></div>` +
    `<div style="display:flex;align-items:center;gap:6px;flex-shrink:0"><button class="btn secondary" style="padding:5px 10px;font-size:11.5px" aria-label="Trang trước" onclick="changePage(-1)">‹ Trang trước</button> <strong id="pageNum" style="font-size:11.5px;min-width:85px;text-align:center">Trang ${readerPage} / ${totalPages}</strong> <button class="btn secondary" style="padding:5px 10px;font-size:11.5px" aria-label="Trang sau" onclick="changePage(1)">Trang sau ›</button>${
  realPdfId
    ? `<a class="btn secondary" href="${LUMI_API_BASE}/sources/${realPdfId}/file" target="_blank" title="Mở file PDF gốc toàn màn hình" style="padding:5px 9px;font-size:11.5px;text-decoration:none">${icon(
        'link'
      )} Phóng to</a>`
    : ''
}</div></div>${paperBodyHTML}</section>` +
    `<section class="chatpanel"><div class="chatheader"><div class="aititle"><span class="tileicon" style="width:34px!important;height:34px!important;border-radius:10px!important">${icon(
      'spark'
    )}</span>Trợ giảng AI Lumi <span class="badge green" style="margin-left:auto">Trực tuyến</span></div><div class="chattabs"><button class="${
      readerTab === 'chat' ? 'active' : ''
    }" onclick="readerTab='chat';render()">Hỏi đáp AI</button><button class="${
      readerTab === 'notes' ? 'active' : ''
    }" onclick="readerTab='notes';render()">Ghi chú bài học</button></div></div>` +
    (readerTab === 'notes'
      ? `<div style="padding:18px;flex:1"><p style="font-size:12.5px;color:var(--secondary);line-height:1.7">Ghi lại các ý quan trọng theo cách hiểu của bạn. Ghi chú được lưu và đồng bộ vào tài khoản.</p><textarea class="notearea" id="noteEditor" aria-label="Nội dung ghi chú">${esc(
          note
        )}</textarea><button class="btn" onclick="saveNote()">${icon(
          'check'
        )}Lưu ghi chú</button></div>`
      : `<div class="chats" id="chats"><div class="msg assistant"><span class="label">${icon(
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
        )}</button></form><small>Trợ giảng AI trả lời trực tiếp dựa trên nội dung học liệu của bạn</small></div>`) +
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
  const textContent = $('uploadText')?.value?.trim() || '';
  const fileInput = $('protoFile');
  const file = fileInput?.files?.[0];

  closeModal();
  toast('Đang tải lên và phân tích nội dung tài liệu...');

  let pdfBase64 = null;
  if (file && file.name.toLowerCase().endsWith('.pdf')) {
    pdfBase64 = await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
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

openCitation = function (targetPage, ordinal = 1) {
  if (targetPage) readerPage = targetPage;
  readerTab = 'chat';
  readingView = 'document';

  const r = records[sourceIndex] || records[0];
  const maxPage = Math.max(1, r?.pageCount || 1);
  if (r) persist('lumi-source-page-' + r.id, readerPage);

  const iframe = document.getElementById('lumiPdfFrame');
  const isRealUUID = r?.id && /^[0-9a-f-]{36}$/i.test(r.id);
  const realPdfId = isRealUUID ? r.id : (/^[0-9a-f-]{36}$/i.test(lumiActiveBackendSourceId) ? lumiActiveBackendSourceId : null);

  if (iframe && realPdfId) {
    const baseSrc = `${LUMI_API_BASE}/sources/${realPdfId}/file`;
    iframe.src = `${baseSrc}#page=${readerPage}&zoom=page-width`;
    const pageNumEl = document.getElementById('pageNum');
    if (pageNumEl) pageNumEl.textContent = `Trang ${readerPage} / ${maxPage}`;
  } else {
    render();
  }

  // Hiệu ứng phát sáng trên nút trích dẫn vừa bấm
  document.querySelectorAll('.citation-ref-btn').forEach(btn => {
    if (btn.textContent.trim() === `[${ordinal}]`) {
      btn.classList.add('citation-active-pulse');
      setTimeout(() => btn.classList.remove('citation-active-pulse'), 2500);
    }
  });

  // Nếu đang ở chế độ text thì cuộn tới đoạn tương ứng
  const targetEl = document.getElementById(`doc-page-${targetPage}`);
  if (targetEl) {
    targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    targetEl.classList.add('doc-page-highlight');
    setTimeout(() => targetEl.classList.remove('doc-page-highlight'), 3000);
  }

  toast(`🔍 Đang hiển thị nguồn trích dẫn [${ordinal}] tại Trang ${readerPage} trên tài liệu PDF.`);
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

  chatMessages.push({ role: 'user', text });
  const loadingMsg = {
    role: 'assistant',
    text: '⏳ Trợ giảng Lumi AI đang phân tích học liệu và tổng hợp câu trả lời cho bạn...',
    loading: true
  };
  chatMessages.push(loadingMsg);
  if (page !== 'reader') go('reader');
  else render();

  const chatBox = $('chats');
  if (chatBox) chatBox.scrollTop = chatBox.scrollHeight;

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

    // Đọc đúng cấu trúc MessageResponse trả về từ /api/v1/conversations/{id}/messages
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

    if (!activeSession) {
      activeSession = lumiActiveBackendConvId || uid();
      sessions.unshift({
        id: activeSession,
        title: text.slice(0, 55),
        messages: [],
        sources: [sourceId]
      });
    }
    const s = sessions.find(x => x.id === activeSession);
    if (s) {
      s.messages = chatMessages.map(m => ({ ...m }));
      persist('lumi-chats', sessions);
    }
    render();
    const updatedChatBox = $('chats');
    if (updatedChatBox) updatedChatBox.scrollTop = updatedChatBox.scrollHeight;
  } catch (err) {
    loadingMsg.text = `Không thể kết nối máy chủ AI: ${err.message}. Vui lòng thử lại.`;
    loadingMsg.loading = false;
    lumiActiveBackendConvId = '';
    render();
  }
};

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

const baseStoreNotebook = storeNotebook;
storeNotebook = async function (id) {
  const title = $('nbTitle')?.value?.trim();
  const body = $('nbBody')?.value?.trim();
  baseStoreNotebook(id);
  if (title && body && lumiBackendConnected) {
    try {
      await lumiFetch('/notes', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'note',
          title,
          body,
          source_id: lumiActiveBackendSourceId || undefined
        })
      });
    } catch (e) {
      console.warn(e);
    }
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

// Tự động khởi tạo khi tải trang: chỉ nối backend nếu đã có phiên đăng nhập trên giao diện.
if (!names.landing) names.landing = 'Trang giới thiệu';
if (typeof lumiSession === 'function' && lumiSession()) {
  isUserLoggedIn = true;
  initLumiBackendSession(false);
}
updatePreviewStatusBanner();
