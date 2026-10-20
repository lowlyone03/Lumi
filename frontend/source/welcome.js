/* Public presentation, frontend-only session flow and a quieter learner home. */
let lumiGuestMenu=false,landingStep=0,deviceStory='web',pendingLumiRoute='home';
function lumiSession(){try{const s=JSON.parse(sessionStorage.getItem('lumi-demo-session')||'null');if(s&&typeof s.email==='string'&&s.expires>Date.now())return s;const l=JSON.parse(localStorage.getItem('lumi-demo-session')||'null');if(l&&typeof l.email==='string'&&l.expires>Date.now()){sessionStorage.setItem('lumi-demo-session',JSON.stringify(l));return l;}if(localStorage.getItem('lumi-jwt-token')||localStorage.getItem('lumi-logged-in')==='true'){const f={email:userProfile?.email||'an.nguyen@sv.edu.vn',expires:Date.now()+365*24*60*60*1000};sessionStorage.setItem('lumi-demo-session',JSON.stringify(f));localStorage.setItem('lumi-demo-session',JSON.stringify(f));return f;}return null}catch{return null}}
function lBrand(){return `<span class="l-logo">${icon('leaf')}</span><span>Lumi<span class="l-logo-dot">.</span></span>`}
function landingPage(){const steps=[['file','Đưa điều bạn muốn học vào Lumi.','Một bản PDF, đoạn văn hay nội dung video có transcript. Không cần tạo khóa học để bắt đầu.','Bài giảng Cơ sở dữ liệu.pdf','42 trang · Tài liệu mẫu'],['spark','Hỏi theo cách bạn thấy tự nhiên.','Một khái niệm chưa rõ, một ví dụ muốn hiểu thêm. Cùng lần theo câu trả lời và vị trí nguồn.','“Khóa ngoại giống một cầu nối?”','Câu hỏi minh họa'],['quiz','Giữ lại điều mình vừa hiểu.','Viết ghi chú bằng lời của mình. Thử một câu hỏi hoặc một tấm thẻ khi muốn ôn lại.','Một chút hiểu thêm, mỗi ngày.','Ghi chú · Luyện tập · Flashcard']];const [ic,title,desc,card,sub]=steps[landingStep];return `<div class="l-landing"><header class="l-nav"><a class="l-brand" href="#landing" aria-label="Lumi trang giới thiệu">${lBrand()}</a><nav aria-label="Điều hướng giới thiệu" class="${lumiGuestMenu?'open':''}"><a href="#" onclick="event.preventDefault();scrollLanding('l-how')">Cách Lumi hoạt động</a><a href="#" onclick="event.preventDefault();scrollLanding('l-devices')">Học ở mọi nơi</a><a href="#" onclick="event.preventDefault();scrollLanding('l-faq')">Câu hỏi thường gặp</a></nav><div class="l-nav-actions"><button class="l-login" onclick="enterLumi('login')">Đăng nhập</button><button class="l-button small" onclick="enterLumi('signup')">Bắt đầu cùng Lumi ${icon('arrow')}</button><button class="l-menu" aria-label="Mở menu giới thiệu" aria-expanded="${lumiGuestMenu}" onclick="toggleGuestMenu()">${icon('sliders')}</button></div></header><main><section class="l-hero"><div class="l-hero-copy"><div class="l-kicker"><i></i>MỘT GÓC RIÊNG CHO VIỆC HỌC</div><h1>Từ “chưa hiểu”…<br>đến <em>“à, ra vậy.”</em></h1><p>Đọc tài liệu, hỏi điều còn vướng và giữ lại những gì vừa hiểu. Lumi ở đây để bạn học theo nhịp của mình.</p><div class="l-hero-actions"><button class="l-button" onclick="enterLumi('signup')">Tạo không gian học ${icon('arrow')}</button><button class="l-text-button" onclick="scrollLanding('l-how')">Khám phá Lumi <span>↓</span></button></div><span class="l-subtle">Không deadline bắt buộc. Không bảng xếp hạng.</span></div><div class="l-hero-scene" aria-label="Minh họa không gian tài liệu và trợ giảng Lumi"><div class="l-scene-top"><span><i></i><i></i><i></i></span><strong>Góc học tập của mình</strong><span>${icon('leaf')}</span></div><div class="l-scene-body"><div class="l-scene-rail">${icon('book')}${icon('note')}${icon('spark')}</div><div class="l-mini-doc"><span class="l-doc-category">CƠ SỞ DỮ LIỆU / 02</span><h2>Một chiếc cầu<br>giữa các bảng.</h2><div class="l-doc-lines"><i></i><i></i><i></i></div><div class="l-doc-highlight">Khóa ngoại giúp kết nối dữ liệu<br>và giữ các mối liên hệ nhất quán.</div><div class="l-doc-table"><span>Sinh viên</span><span>Lớp học</span><i>ma_lop</i><i>ma_lop</i></div><div class="l-doc-page">12 / 42 · Nội dung minh họa</div></div></div><div class="l-scene-chat"><span class="l-chat-symbol">${icon('spark')}</span><div><small>CÙNG LUMI HIỂU THÊM</small><p>Hãy hình dung khóa ngoại như<br>một chiếc cầu nối hai bảng…</p><span>${icon('file')}Bài giảng · Trang 12</span></div></div><div class="l-scene-note">${icon('check')}À, mình hiểu rồi!</div></div></section><section class="l-beliefs" aria-label="Điểm chính"><span>${icon('file')}Bắt đầu từ học liệu của bạn</span><span>${icon('link')}Hỏi đáp có vị trí nguồn</span><span>${icon('sprout')}Công cụ học hoàn toàn tùy chọn</span></section><section id="l-how" class="l-how l-section"><div class="l-section-heading"><span class="l-kicker">MỘT HÀNH TRÌNH NHẸ NHÀNG</span><h2>Không cần biết mọi thứ.<br>Chỉ cần một điều muốn hiểu.</h2></div><div class="l-how-layout"><div class="l-step-tabs" role="tablist" aria-label="Các bước học">${steps.map(([i,t,d],n)=>`<button role="tab" aria-selected="${landingStep===n}" class="${landingStep===n?'active':''}" onclick="landingStep=${n};refreshLandingSection('l-how')"><span>0${n+1}</span><div><strong>${['Mang tài liệu đến','Cùng tìm lời giải','Ghi nhớ theo cách riêng'][n]}</strong><p>${d}</p></div></button>`).join('')}</div><div class="l-step-demo"><span class="l-step-icon">${icon(ic)}</span><span class="l-kicker">${String(landingStep+1).padStart(2,'0')} / 03</span><h3>${title}</h3><div class="l-step-demo-card">${icon(ic)}<div><strong>${card}</strong><span>${sub}</span></div>${icon('check')}</div><span class="l-demo-caption">Minh họa giao diện · Chưa xử lý nguồn hoặc gọi AI thật</span></div></div></section><section class="l-principle"><div><span class="l-kicker">HỌC SÂU, KHÔNG THÊM ÁP LỰC</span><h2>Bạn chọn nhịp.<br>Lumi giữ không gian.</h2></div><div><p>Có hôm bạn chỉ muốn hỏi một câu. Có hôm bạn muốn đi hết một chủ đề. Cả hai đều là một cách học.</p><div class="l-principle-items"><span>${icon('spark')}Hỏi ngay từ một tài liệu</span><span>${icon('book')}Tổ chức thành khóa học khi cần</span><span>${icon('quiz')}Ôn tập khi bạn sẵn sàng</span></div></div></section><section id="l-devices" class="l-section l-devices"><div class="l-device-copy"><span class="l-kicker">Ở NƠI BẠN MUỐN HỌC</span><h2>Màn hình lớn để tập trung.<br>Màn hình nhỏ để tiếp nối.</h2><p>Cùng một hướng thiết kế, được sắp xếp riêng cho máy tính và điện thoại.</p><div class="l-device-tabs" aria-label="Bố cục thiết bị">${[['web','Web & desktop','book'],['mobile','Điện thoại','file']].map(([v,t,i])=>`<button class="${deviceStory===v?'active':''}" aria-pressed="${deviceStory===v}" onclick="deviceStory='${v}';refreshLandingSection('l-devices')">${icon(i)}${t}</button>`).join('')}</div><p class="l-device-detail">${deviceStory==='web'?'Không gian rộng để vừa đọc tài liệu, vừa đặt câu hỏi và ghi lại điều quan trọng.':'Bố cục gọn, chuyển riêng giữa tài liệu và trợ giảng. Dễ học thêm một chút khi rảnh.'}</p><small>Hiện là bản trải nghiệm giao diện trên trình duyệt. Ứng dụng cài đặt và đồng bộ thiết bị chưa được triển khai.</small></div><div class="l-device-preview ${deviceStory}">${deviceStory==='web'?`<div class="l-browser-dots"><i></i><i></i><i></i><span>Lumi / Không gian học</span></div><div class="l-browser-content"><aside>${icon('leaf')}${icon('home')}${icon('book')}${icon('note')}</aside><article><span>HỌC TIẾP MỘT CHÚT</span><h3>Khóa và ràng buộc</h3><p>Mình cùng làm rõ điều còn vướng.</p><div class="l-preview-paper"><i></i><i></i><i></i><b>Khóa chính & khóa ngoại</b><i></i></div></article><div class="l-preview-assistant">${icon('spark')}<strong>Lumi</strong><p>Bạn muốn hiểu thêm điều gì?</p><span>Gửi một câu hỏi…</span></div></div>`:`<div class="l-phone-notch"></div><div class="l-phone-brand">${icon('leaf')}Lumi.</div><small>GÓC HỌC TẬP CỦA BẠN</small><h3>Học tiếp<br>một chút nhé?</h3><div class="l-phone-card">${icon('book')}<strong>Khóa và ràng buộc</strong><span>Tiếp tục từ trang 12 →</span></div><div class="l-phone-shortcuts"><span>${icon('spark')}Hỏi Lumi</span><span>${icon('note')}Ghi chú</span></div><div class="l-phone-bottom">${icon('home')}${icon('book')}${icon('spark')}${icon('user')}</div>`}</div></section><section id="l-faq" class="l-section l-faq"><div><span class="l-kicker">TRƯỚC KHI BẮT ĐẦU</span><h2>Có thể bạn<br>đang thắc mắc.</h2></div><div>${[['Mình có cần tạo khóa học trước không?','Không. Bạn có thể thêm một tài liệu rồi hỏi ngay. Khóa học chỉ hữu ích khi bạn muốn gom nhiều nguồn và học theo một đề cương.'],['Lumi có làm bài thay mình không?','Lumi được thiết kế để giải thích, gợi mở, giúp bạn luyện tập và kiểm tra lại kiến thức qua nguồn. Bạn vẫn là người chủ động suy nghĩ và lựa chọn cách học.'],['Mình có dùng thử trên điện thoại được không?','Có. Bản giao diện có thể mở bằng trình duyệt điện thoại; bên trong còn có nút chuyển bố cục Máy tính / Điện thoại. Chưa có bản tải từ cửa hàng ứng dụng.'],['Đăng nhập và AI đã hoạt động thật chưa?','Chưa. Đây là prototype giao diện. Đăng nhập, xử lý tài liệu và phản hồi AI đang mô phỏng; dữ liệu bạn tạo chỉ lưu tại trình duyệt. Đăng nhập mẫu không tạo tài khoản thật.']].map(([q,a])=>`<details><summary>${q}<span>+</span></summary><p>${a}</p></details>`).join('')}</div></section><section class="l-last-call l-start" aria-labelledby="l-start-title"><div class="l-start-copy"><span class="l-kicker">BẮT ĐẦU HÀNH TRÌNH CÙNG LUMI</span><h2 id="l-start-title">Một nơi để học,<br>hiểu và ghi nhớ.</h2><p>Tập hợp học liệu, làm rõ kiến thức và ôn tập theo cách của bạn. Bắt đầu từ một tài liệu, tiếp nối trên máy tính hoặc điện thoại.</p><div class="l-start-actions"><button class="l-button" onclick="enterLumi('signup')">Tạo không gian học ${icon('arrow')}</button><button class="l-start-mobile" onclick="openLumiMobile()">${icon('play')}Trải nghiệm app mobile</button></div><span class="l-start-caption">Bản trải nghiệm giao diện · Khám phá theo nhịp của bạn</span></div><div class="l-start-journey"><div class="l-start-journey-heading"><span class="l-start-symbol">${icon('leaf')}</span><div><strong>Từ học liệu đến kiến thức</strong><span>Ba bước trong một không gian</span></div></div><ol>${[['file','Thêm học liệu','Tài liệu, văn bản hoặc nội dung video'],['spark','Làm rõ điều chưa hiểu','Hỏi đáp, giải thích và xem lại nguồn'],['quiz','Ghi nhớ kiến thức','Ghi chú, flashcard và bài luyện tập']].map(([i,t,d],n)=>`<li><span class="l-start-number">0${n+1}</span><span class="l-start-step-icon">${icon(i)}</span><div><strong>${t}</strong><span>${d}</span></div></li>`).join('')}</ol><div class="l-start-platforms">${icon('book')}Web & desktop<span></span>${icon('file')}App mobile</div></div></section></main><footer class="l-footer"><a class="l-brand" href="#landing">${lBrand()}</a><span>Học theo nhịp của bạn.</span><div><button onclick="enterLumi('login')">Đăng nhập</button><button onclick="scrollLanding('l-faq')">Thông tin bản trải nghiệm</button></div><div class="l-footer-bottom"><small>Lumi · Bản thiết kế trải nghiệm học tập</small><span class="l-design-credit">Thiết kế bởi <strong>TriThuc</strong></span></div></footer></div>`}
function enterLumi(mode){
  if(lumiSession()){go('home');return;}
  if(mode==='login'){
    const sess={email:'an.nguyen@sv.edu.vn',expires:Date.now()+365*24*60*60*1000};
    try{
      sessionStorage.setItem('lumi-demo-session',JSON.stringify(sess));
      localStorage.setItem('lumi-demo-session',JSON.stringify(sess));
      localStorage.setItem('lumi-logged-in','true');
    }catch{}
    userProfile.email=sess.email;
    userProfile.name='Nguyễn Văn An';
    persist('lumi-profile',userProfile);
    setLumiEntry('app');
    if($('publicRoot'))$('publicRoot').innerHTML='';
    page='home';
    location.hash='#home';
    render();
    toast('Chào mừng bạn đến với Lumi AI!');
    return;
  }
  authMode=mode;
  go('auth');
}
function scrollLanding(id){lumiGuestMenu=false;document.querySelector('.l-nav nav')?.classList.remove('open');document.querySelector('.l-menu')?.setAttribute('aria-expanded','false');$(id)?.scrollIntoView({behavior:'smooth',block:'start'})}
function refreshLandingSection(id){const top=window.scrollY;const container=$('publicRoot');container.innerHTML=landingPage();window.scrollTo({top,behavior:'instant'});}
function toggleGuestMenu(){lumiGuestMenu=!lumiGuestMenu;document.querySelector('.l-nav nav')?.classList.toggle('open',lumiGuestMenu);document.querySelector('.l-menu')?.setAttribute('aria-expanded',String(lumiGuestMenu))}
const previousLumiRender=render,previousLumiAuth=authPage;
authPage=function(){let h=previousLumiAuth().replace("onclick=\"go('hub')\"","onclick=\"go('landing')\"").replace('Quay lại không gian học','Về trang giới thiệu');return h.replace('<div class="p-auth-disclaimer">',`${authMode==='login'?`<button class="l-fill-demo" onclick="fillLumiDemo()">${icon('play')}Điền tài khoản mẫu để thử</button>`:''}<div class="p-auth-disclaimer">`)};
function fillLumiDemo(){if($('authEmail'))$('authEmail').value='an.nguyen@sv.edu.vn';if($('authPassword'))$('authPassword').value='123456'}
function setLumiEntry(mode){document.documentElement.dataset.entry=mode}
render=function(){
  if(page==='landing'){setLumiEntry('public');$('publicRoot').innerHTML=landingPage();document.title='Lumi — Một góc riêng cho việc học';return}
  if(page==='auth'){
    if(lumiSession()){page='home';location.hash='#home';render();return}
    setLumiEntry('public');$('publicRoot').innerHTML=`<div class="l-auth-public"><header><a class="l-brand" href="#landing">${lBrand()}</a><button onclick="go('landing')">${icon('back')}Trang giới thiệu</button></header>${authPage()}<p class="l-auth-bottom">Học theo nhịp của bạn. Mỗi chút hiểu thêm đều có ý nghĩa.</p></div>`;document.title='Lumi — '+(authMode==='signup'?'Đăng ký':authMode==='reset'?'Khôi phục mật khẩu':'Đăng nhập');return
  }
  if(!lumiSession()){
    pendingLumiRoute=Object.hasOwn(names,page)?page:'home';page='auth';authMode='login';render();return
  }
  setLumiEntry('app');
  if($('publicRoot'))$('publicRoot').innerHTML='';
  document.title='Lumi — '+(names[page]||'Không gian học');
  previousLumiRender();
  updateLumiProfile()
};
function updateLumiProfile(){const avatarText=userProfile.name.split(' ').filter(Boolean).slice(-2).map(x=>x[0]).join('').toUpperCase();document.querySelectorAll('.profile>span:nth-child(2)>strong').forEach(x=>x.textContent=userProfile.name);document.querySelectorAll('.profile .avatar,.topright>.avatar').forEach(x=>x.textContent=avatarText||'L')}
go=function(p){
  if(p==='landing'){page='landing';lumiGuestMenu=false}
  else if(p==='auth'){page='auth'}
  else if(!lumiSession()){pendingLumiRoute=Object.hasOwn(names,p)?p:'home';authMode='login';page='auth'}
  else{
    page=Object.hasOwn(names,p)?p:'home';
    if(page==='reader'&&readerTab==='notes')readingView='assistant'
  }
  const isHttp = typeof location !== 'undefined' && location.protocol && location.protocol.startsWith('http');
  if(isHttp){
    const cleanPath = (page==='landing'||(!lumiSession()&&page==='landing'))?'/':('/'+page);
    if(location.pathname!==cleanPath){
      try{history.pushState({lumiPage:page},'',cleanPath+(location.search||''));}catch(e){}
    }
  } else {
    const hash='#'+page;
    if(location.hash!==hash){
      try{history.pushState({lumiPage:page},'',hash);}catch(e){}
    }
  }
  if($('crumb'))$('crumb').textContent=names[page]||'Lumi';
  render();
  window.scrollTo({top:0,behavior:'instant'})
};
submitAuth=function(){
  let email=$('authEmail')?.value.trim()||'';
  let pass=$('authPassword')?.value||'';
  if(!email){
    email='an.nguyen@sv.edu.vn';
    if($('authEmail'))$('authEmail').value=email;
  }
  if(!pass||pass.length<6){
    pass='123456';
    if($('authPassword'))$('authPassword').value=pass;
  }
  if(authMode==='reset'){showModal(`<h2 id="modalTitle">Yêu cầu đã hoàn tất</h2><p>Hướng dẫn đặt lại mật khẩu đã được gửi đến email của bạn.</p><div class="modalactions">${btn('Về đăng nhập',"closeModal();authMode='login';go('auth')")}</div>`);return}
  if(authMode==='signup'){let n=$('authName')?.value.trim();if(!n){toast('Bạn nhập tên hiển thị nhé.');return}userProfile.name=n}
  else {userProfile.name='Nguyễn Văn An'}
  userProfile.email=email;
  persist('lumi-profile',userProfile);
  const sess={email,expires:Date.now()+365*24*60*60*1000};
  try{
    sessionStorage.setItem('lumi-demo-session',JSON.stringify(sess));
    localStorage.setItem('lumi-demo-session',JSON.stringify(sess));
    localStorage.setItem('lumi-logged-in','true');
  }catch{}
  setLumiEntry('app');
  if($('publicRoot'))$('publicRoot').innerHTML='';
  const destination=pendingLumiRoute||'home';
  pendingLumiRoute='home';
  closeModal();
  page=destination;
  if(typeof location!=='undefined'&&location.protocol&&location.protocol.startsWith('http')){
    const cleanPath = destination==='landing'?'/':('/'+destination);
    try{history.replaceState({lumiPage:destination},'',cleanPath+(location.search||''));}catch(e){}
  }else{location.hash='#'+destination;}
  render();
  toast('Chào mừng bạn đến với không gian học tập Lumi AI!');
};
function logoutLumi(){try{sessionStorage.removeItem('lumi-demo-session');localStorage.removeItem('lumi-demo-session');localStorage.removeItem('lumi-jwt-token');localStorage.removeItem('lumi-logged-in');}catch{}if(focusTimer)clearInterval(focusTimer);focusRunning=false;videoPlaying=false;closeModal();pendingLumiRoute='home';go('landing')}
devicesDialog=function(){showModal(`<h2 id="modalTitle">Phiên đăng nhập</h2><div class="result-item"><strong>Trình duyệt hiện tại</strong><p>${esc(userProfile.email)} · Phiên mẫu trong thẻ trình duyệt này.</p></div><p>Đăng xuất sẽ đưa bạn về trang giới thiệu. Ghi chú và học liệu mẫu đã lưu vẫn được giữ.</p><div class="modalactions">${btn('Đóng','closeModal()',true)}${btn('Đăng xuất','logoutLumi()')}</div>`)};
function continueLumi(){
  const target=typeof getCurrentActiveSource==='function'?getCurrentActiveSource():(records.find(r=>!r.deleted&&r.status==='ready')||records[0]);
  if(target){
    let i=records.indexOf(target);
    if(i<0)i=0;
    sourceIndex=i;
    const last=saved('lumi-last-read',null);
    readerPage=(last?.id===target.id&&last?.page)?last.page:saved('lumi-source-page-'+target.id,1);
    readerTab='chat';
    readingView='document';
    if(typeof viewSource==='function')viewSource(i);
    else go(target.type==='VIDEO'?'video':'reader')
  }else openUpload()
}
home=function(){
  let firstName=userProfile.name.trim().split(' ').at(-1)||'bạn';
  if(firstName==='Bạn')firstName='bạn';
  const last=saved('lumi-last-read',null);
  const recent=records.filter(r=>!r.deleted).slice(0,3);
  const source=typeof getCurrentActiveSource==='function'?getCurrentActiveSource():(records.find(r=>!r.deleted&&r.status==='ready')||records[0]);
  let allCourses=[...courses,...extraCourses].map((c,i)=>({c,i})).filter(({c})=>!c.archived).slice(0,2);
  const scheduled=plans.filter(p=>!p.done).slice(0,2);
  const currentPg=(last?.id===source?.id&&last?.page)?last.page:1;
  return `<div class="l-home-welcome"><div><span class="eyebrow">GÓC HỌC TẬP CỦA BẠN</span><h1>Chào ${esc(firstName)},<br>mình học thêm một chút nhé?</h1><p>Tiếp nối điều đang tò mò. Không cần vội.</p></div><button class="l-home-add" onclick="openUpload()">${icon('plus')}Thêm học liệu</button></div><div class="l-home-grid"><div class="l-home-primary"><section class="l-continue-card"><div><span class="l-continue-label">${last?'TIẾP TỤC TỪ NƠI BẠN DỪNG':'MỘT ĐIỀU ĐỂ BẮT ĐẦU'}</span><h2>${source?esc(source.title.replace(/\.pdf$/i,'')):'Một tài liệu, một điều mới.'}</h2><p>${source?(source.type==='VIDEO'?'Video và transcript tương tác':'Đang ở trang '+currentPg+' · Học liệu sẵn sàng'):'Thêm một tài liệu bạn muốn hiểu. Lumi sẽ cùng bạn khám phá.'}</p><button class="btn" onclick="continueLumi()">${source?'Học tiếp':'Thêm tài liệu'}${icon('arrow')}</button></div><div class="l-continue-art" aria-hidden="true"><div><small>LUMI / LEARNING</small>${icon('book')}<i></i><i></i><span>Mỗi chút hiểu thêm.</span></div></div></section><div class="l-home-quick"><button onclick="readerTab='chat';readingView='assistant';if(typeof openAskSource==='function')openAskSource();else go('reader')">${toneIcon('spark','green')}<span><strong>Hỏi điều chưa rõ</strong><small>Mình cùng tìm hiểu.</small></span>${icon('chevron')}</button><button onclick="editNotebook()">${toneIcon('note','amber')}<span><strong>Ghi lại một ý hay</strong><small>Bằng lời của bạn.</small></span>${icon('chevron')}</button></div><section class="l-home-section"><div class="sectiontitle"><h2>Khóa học của mình</h2><button class="textbtn" onclick="tab='courses';go('library')">Xem tất cả ${icon('chevron')}</button></div>${allCourses.length?`<div class="courses">${allCourses.map(({c,i})=>courseCard(c,i)).join('')}</div>`:polishedEmpty('book','Một chủ đề bạn muốn học.','Gom học liệu và tạo một lộ trình của riêng mình.',btn('Tạo khóa học','openNewCourse()',true))}</section><section class="l-home-section"><div class="sectiontitle"><h2>Học liệu gần đây</h2><button class="textbtn" onclick="tab='sources';go('library')">Mở thư viện ${icon('chevron')}</button></div><div class="l-home-recent">${recent.map(r=>`<button onclick="viewSource(${records.indexOf(r)})"><span class="l-recent-file ${r.type==='VIDEO'?'video':''}">${icon(r.type==='VIDEO'?'play':'file')}</span><span><strong>${esc(r.title)}</strong><small>${esc(r.meta)}</small></span>${icon('chevron')}</button>`).join('')||`<div class="l-empty-library">Thư viện còn trống. Một tài liệu là đủ để bắt đầu.</div>`}</div></section></div><aside class="l-home-aside"><section class="l-home-ai"><div class="l-home-ai-head">${toneIcon('spark','green')}<span><strong>Lumi ở đây.</strong><small>Cùng bạn hiểu thêm.</small></span></div><p>Có điều gì đang làm bạn vướng? Cứ bắt đầu từ một câu hỏi.</p><form onsubmit="event.preventDefault();const q=document.getElementById('homeQuestion').value.trim();if(q)sendChat(q)"><label class="sr-only" for="homeQuestion">Câu hỏi cho Lumi</label><textarea id="homeQuestion" placeholder="Hỏi trợ giảng AI về tài liệu đang học..." rows="3" required></textarea><button class="btn" type="submit">Cùng tìm hiểu ${icon('arrow')}</button></form><span class="l-sample-note">Trợ giảng AI Hybrid RAG · Tự động bám sát tài liệu đang học.</span></section><section class="l-home-plan"><div class="sectiontitle"><h2>Dự định nhỏ</h2><button aria-label="Mở kế hoạch" onclick="go('planner')">${icon('arrow')}</button></div>${scheduled.map(p=>`<div class="l-home-plan-row"><button class="task-check" aria-label="Hoàn thành ${esc(p.title)}" onclick="togglePlan('${p.id}')"></button><span><strong>${esc(p.title)}</strong><small>${esc(p.day)} · ${p.minutes} phút</small></span></div>`).join('')||'<p>Chưa có kế hoạch cũng không sao.<br>Bạn có thể học theo hứng thú hôm nay.</p>'}<button class="textbtn" onclick="go('planner')">Sắp xếp khi cần ${icon('chevron')}</button></section>${notebooks[0]?`<section class="l-home-note"><span class="l-kicker">MỘT Ý MUỐN GIỮ</span><h3>${esc(notebooks[0].title)}</h3><p>${esc(notebooks[0].body.slice(0,155))}${notebooks[0].body.length>155?'…':''}</p><button onclick="go('notes')">Mở sổ tay ${icon('arrow')}</button></section>`:''}<div class="l-home-quiet">${icon('sprout')}Hôm nay hiểu thêm một chút<br>cũng là một bước tiến.</div></aside></div>`};
function routeLumiFromURL(){
  let route='';
  const isHttp = typeof location !== 'undefined' && location.protocol && location.protocol.startsWith('http');
  if(isHttp){
    const pathPart = location.pathname.replace(/^\/+|\/+$/g,'').split('/')[0];
    if(pathPart && pathPart!=='index.html' && pathPart!=='START-HERE.html' && pathPart!=='preview.html'){
      route = pathPart;
    }
  }
  if(!route){
    route = (location.hash||'').replace(/^#\/?/,'').split('?')[0];
  }
  if(lumiSession()){
    if(route==='auth'||route==='login'||route==='signup'||!route||route==='landing'){
      page='home';
      if(isHttp && location.pathname!=='/home'){
        try{history.replaceState({lumiPage:'home'},'','/home'+(location.search||''));}catch(e){}
      } else if(!isHttp){
        location.hash='#home';
      }
      render();
      return;
    }
  }
  if(route==='login'||route==='signup'){
    authMode=route==='signup'?'signup':'login';page='auth';
  } else if(route==='auth'){
    page='auth';
  } else if(route && Object.hasOwn(names,route)){
    page=route;
  } else page='landing';
  render();
}
window.addEventListener('hashchange',routeLumiFromURL);
window.addEventListener('popstate',routeLumiFromURL);
// Expose clear ways back to the introduction and out of the prototype session.
const sideFooter=document.querySelector('.sidebottom');if(sideFooter)sideFooter.insertAdjacentHTML('beforeend',`<div class="l-app-footer"><button onclick="go('landing')">${icon('back')}Giới thiệu Lumi</button><button onclick="logoutLumi()">Đăng xuất</button></div>`);
const previousPersonalLumi=personal;personal=function(){return previousPersonalLumi().replace('<div class="settings-foot">',`<div class="l-account-exit">${btn('Trang giới thiệu',"go('landing')",true,'back')}${btn('Đăng xuất','logoutLumi()',true)}</div><div class="settings-foot">`)};
routeLumiFromURL();
