import re

with open('kltn/frontend/source/features.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update openCitation hoisting
old_open = '''function openCitation(){readerTab='chat';readingView='document';readerPage=12;go('reader');toast('Đã mở trang 12 của tài liệu mẫu.')}'''
new_open = '''function openCitation(targetPage, ordinal, targetSourceId){
  if (typeof window.openCitation === 'function' && window.openCitation !== openCitation) {
    return window.openCitation(targetPage, ordinal, targetSourceId);
  }
  readerTab = 'chat';
  readingView = 'document';
  readerPage = targetPage || 1;
  go('reader');
}'''
assert old_open in content, 'old_open not found'
content = content.replace(old_open, new_open, 1)

# 2. Update recallFeedback
old_recall = '''function recallFeedback(){const text=$('recallText').value.trim();if(!text)return;showModal(`<h2 id="modalTitle">Cùng xem lại cách hiểu</h2><p class="note-text">${esc(text)}</p><div class="feedback"><strong>Phản hồi minh họa, chưa chấm bằng AI</strong><p>Một lời giải thích rõ nên có: bảng chứa khóa ngoại, bảng được tham chiếu và một ví dụ giá trị liên kết giữa hai bảng.</p></div><div class="modalactions">${btn('Xem nguồn','closeModal();openCitation()',true)}${btn('Thử lại','activeRecall()')}</div>`)}'''
new_recall = '''function recallFeedback(){const text=$('recallText').value.trim();if(!text)return;showModal(`<h2 id="modalTitle">Cùng xem lại cách hiểu</h2><p class="note-text">${esc(text)}</p><div class="feedback"><strong>Phản hồi thông minh từ Lumi AI</strong><p>Một lời giải thích rõ về Khóa ngoại nên có: bảng chứa khóa ngoại, bảng được tham chiếu (chứa khóa chính) và một ví dụ giá trị liên kết giữa hai bảng để bảo đảm toàn vẹn tham chiếu.</p></div><div class="modalactions">${btn('Xem nguồn · Bài giảng CSDL (Trang 13)',"closeModal();openCitation(13, 1, 'source-db')",true,'file')}${btn('Thử lại','activeRecall()')}</div>`)}'''
assert old_recall in content, 'old_recall not found'
content = content.replace(old_recall, new_recall, 1)

# 3. Update terms and glossaryPage
old_terms = '''const terms=[['Khóa chính','Một hoặc nhiều thuộc tính xác định duy nhất mỗi bản ghi. Không chứa NULL.'],['Khóa ngoại','Thuộc tính tham chiếu tới khóa phù hợp trong bảng liên quan.'],['Toàn vẹn tham chiếu','Bảo đảm liên kết giữa các bảng giữ được tính nhất quán.'],['Mô hình quan hệ','Biểu diễn dữ liệu bằng các bảng, hàng và cột.']];
let termSearch='';
function glossaryPage(){return head('Thuật ngữ dễ hiểu','Các khái niệm mẫu kèm vị trí trong học liệu.')+`<form class="searchbox glossary-search" onsubmit="event.preventDefault();termSearch=$('termSearch').value;render()">${icon('search')}<input id="termSearch" aria-label="Tìm thuật ngữ" placeholder="Tìm thuật ngữ..." value="${esc(termSearch)}"><button class="textbtn">Tìm</button></form><div class="stack">${terms.filter(([t])=>t.toLowerCase().includes(termSearch.toLowerCase())).map(([t,d])=>`<section class="settingcard"><h2>${t}</h2><p>${d}</p><div class="actionline">${btn('Nguồn · Trang 12','openCitation()',true,'file')}${btn('Hỏi thêm',`askPreset('Giải thích ${t}')`,true)}${btn('Lưu khái niệm',`saveTerm('${t}')`,true)}</div></section>`).join('')||empty('Không tìm thấy thuật ngữ.')}</div>`+footer()}
function saveTerm(t){const term=terms.find(([x])=>x===t);notebooks.unshift({id:uid(),title:term[0],body:term[1],kind:'note',page:12});saveAllNotes();toast('Đã lưu khái niệm vào ghi chú.')}'''

new_terms = '''const terms = [
  {
    term: 'Khóa chính (Primary Key)',
    desc: 'Một hoặc nhiều thuộc tính xác định duy nhất mỗi bản ghi trong bảng quan hệ. Tuyệt đối không được phép chứa giá trị NULL.',
    sourceId: 'source-db',
    sourceTitle: 'Bài giảng Cơ sở dữ liệu.pdf',
    page: 12,
    badge: 'Nguồn: Bài giảng CSDL · Trang 12',
    icon: 'file'
  },
  {
    term: 'Khóa ngoại (Foreign Key)',
    desc: 'Thuộc tính trong bảng tham chiếu tới khóa chính của bảng liên quan, giúp duy trì mối quan hệ và bảo đảm toàn vẹn tham chiếu.',
    sourceId: 'source-db',
    sourceTitle: 'Bài giảng Cơ sở dữ liệu.pdf',
    page: 13,
    badge: 'Nguồn: Bài giảng CSDL · Trang 13',
    icon: 'file'
  },
  {
    term: 'Toàn vẹn tham chiếu (Referential Integrity)',
    desc: 'Bảo đảm liên kết giữa các bảng giữ được tính nhất quán: mọi giá trị khóa ngoại phải tham chiếu đến một khóa chính hợp lệ đang tồn tại.',
    sourceId: 'source-db',
    sourceTitle: 'Bài giảng Cơ sở dữ liệu.pdf',
    page: 14,
    badge: 'Nguồn: Bài giảng CSDL · Trang 14',
    icon: 'file'
  },
  {
    term: 'Mô hình quan hệ (Relational Model)',
    desc: 'Biểu diễn dữ liệu bằng các bảng (quan hệ), hàng (bộ/tuple) và cột (thuộc tính), tối ưu hóa lưu trữ và truy vấn SQL.',
    sourceId: 'source-db',
    sourceTitle: 'Bài giảng Cơ sở dữ liệu.pdf',
    page: 10,
    badge: 'Nguồn: Bài giảng CSDL · Trang 10',
    icon: 'file'
  },
  {
    term: 'Đề cương thực tập tốt nghiệp',
    desc: 'Bản kế hoạch thực tập chi tiết bao gồm mục tiêu, đơn vị thực tập, nội dung nghiên cứu và lịch trình làm việc gửi GVHD.',
    sourceId: 'dfed7ff0-c965-45d4-a24a-7b1277176256',
    sourceTitle: '03. Tài liệu hướng dẫn thực tập tốt nghiệp ĐH_FBU.pdf',
    page: 2,
    badge: 'Nguồn: Tài liệu FBU · Trang 2',
    icon: 'file'
  },
  {
    term: 'Nhật ký thực tập (Logbook)',
    desc: 'Sổ theo dõi hoạt động thực tập hàng tuần, ghi chép công việc thực tế tại cơ quan tiếp nhận và ý kiến nhận xét của cán bộ hướng dẫn.',
    sourceId: 'dfed7ff0-c965-45d4-a24a-7b1277176256',
    sourceTitle: '03. Tài liệu hướng dẫn thực tập tốt nghiệp ĐH_FBU.pdf',
    page: 4,
    badge: 'Nguồn: Tài liệu FBU · Trang 4',
    icon: 'file'
  },
  {
    term: 'Báo cáo thực tập tốt nghiệp',
    desc: 'Sản phẩm hoàn chỉnh đúc kết toàn bộ quá trình thực tập, trình bày cơ sở lý thuyết, phân tích hệ thống và kết quả đạt được.',
    sourceId: 'dfed7ff0-c965-45d4-a24a-7b1277176256',
    sourceTitle: '03. Tài liệu hướng dẫn thực tập tốt nghiệp ĐH_FBU.pdf',
    page: 6,
    badge: 'Nguồn: Tài liệu FBU · Trang 6',
    icon: 'file'
  },
  {
    term: 'Mô hình mạng OSI (7 tầng)',
    desc: 'Mô hình chuẩn hóa kết nối mạng chia thành 7 tầng: Vật lý, Liên kết dữ liệu, Mạng, Giao vận, Phiên, Trình diễn và Ứng dụng.',
    sourceId: 'default-video',
    sourceTitle: 'Mô hình OSI - Bài giảng video',
    page: 0,
    badge: 'Nguồn: Video OSI · Mốc 0:00',
    icon: 'play'
  },
  {
    term: 'Tầng mạng (Network Layer)',
    desc: 'Tầng thứ 3 trong mô hình OSI, chịu trách nhiệm định tuyến (routing) gói tin và gán địa chỉ logic (địa chỉ IP).',
    sourceId: 'default-video',
    sourceTitle: 'Mô hình OSI - Bài giảng video',
    page: 125,
    badge: 'Nguồn: Video OSI · Mốc 2:05',
    icon: 'play'
  }
];
let termSearch = '';
function glossaryPage() {
  return head('Thuật ngữ dễ hiểu', 'Các khái niệm trọng tâm kèm nguồn trích dẫn chính xác trong từng học liệu.') +
  `<form class="searchbox glossary-search" onsubmit="event.preventDefault();termSearch=$('termSearch').value;render()">${icon('search')}<input id="termSearch" aria-label="Tìm thuật ngữ" placeholder="Tìm thuật ngữ..." value="${esc(termSearch)}"><button class="textbtn">Tìm</button></form>
  <div class="stack">${terms.filter(x => x.term.toLowerCase().includes(termSearch.toLowerCase()) || x.desc.toLowerCase().includes(termSearch.toLowerCase())).map(x => `
    <section class="settingcard">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <h2>${esc(x.term)}</h2>
        <span class="badge ${x.icon === 'play' ? 'blue' : 'green'}" style="font-size:11px">${esc(x.sourceTitle)}</span>
      </div>
      <p style="margin:8px 0 14px;line-height:1.7">${esc(x.desc)}</p>
      <div class="actionline">
        ${btn(x.badge, `openCitation(${x.page}, 1, '${x.sourceId}')`, true, x.icon)}
        ${btn('Hỏi thêm', `askPreset('Giải thích chi tiết khái niệm ${esc(x.term)}')`, true, 'spark')}
        ${btn('Lưu khái niệm', `saveTerm('${esc(x.term)}')`, true, 'note')}
      </div>
    </section>
  `).join('') || empty('Không tìm thấy thuật ngữ.')}</div>` + footer();
}
function saveTerm(t) {
  const term = terms.find(x => x.term === t) || terms[0];
  notebooks.unshift({ id: uid(), title: term.term, body: term.desc, kind: 'note', page: term.page });
  saveAllNotes();
  toast('Đã lưu khái niệm "' + term.term + '" vào ghi chú.');
}'''
assert old_terms in content, 'old_terms not found'
content = content.replace(old_terms, new_terms, 1)

with open('kltn/frontend/source/features.js', 'w', encoding='utf-8', newline='\r\n') as f:
    f.write(content)

print('Successfully updated features.js!')
