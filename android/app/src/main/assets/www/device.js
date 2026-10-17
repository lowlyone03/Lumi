/* ============================================================================
 * device.js — Nhận diện điện thoại thật và vào luồng "App mobile" của Lumi.
 * - Điện thoại (màn hẹp + cảm ứng) → gắn html[data-device="phone"], bật bố cục
 *   mobile; nếu chưa đăng nhập thì mở 3 màn chào của app thay vì trang giới thiệu web.
 * - Có thể ép bằng URL: ?device=phone hoặc ?device=web (lưu lại trong phiên).
 * Nạp sau account.js và api.js.
 * ============================================================================ */
(function () {
  const q = new URLSearchParams(location.search);
  let forced = q.get('device');
  try {
    if (forced === 'phone' || forced === 'web') sessionStorage.setItem('lumi-device', forced);
    else forced = sessionStorage.getItem('lumi-device');
  } catch {}

  const mq = q => typeof window.matchMedia === 'function' && window.matchMedia(q).matches;
  const looksLikePhone =
    mq('(max-width: 600px)') && (mq('(pointer: coarse)') || /Android|iPhone|iPod/i.test(navigator.userAgent));
  const isPhone = forced ? forced === 'phone' : looksLikePhone;
  if (!isPhone) return;

  document.documentElement.dataset.device = 'phone';
  const isStandalone = mq('(display-mode: standalone)') || navigator.standalone === true;
  if (isStandalone) document.documentElement.dataset.standalone = 'true';

  if (typeof setMode === 'function') setMode('mobile');

  // Chưa có phiên → mở màn chào app mobile (thay cho trang giới thiệu dành cho web).
  const hash = location.hash.slice(1).split('?')[0];
  const hasSession = typeof lumiSession === 'function' && lumiSession();
  if (!hasSession && (!hash || hash === 'landing') && typeof go === 'function') {
    go('mobile');
  } else if (typeof render === 'function') {
    render();
  }

  // Khi đã ở trong app, nút "Trang giới thiệu" trên điện thoại quay về màn chào app.
  if (typeof go === 'function') {
    const goBeforeDevice = go;
    go = function (p) {
      if (p === 'landing' && !(typeof lumiSession === 'function' && lumiSession())) p = 'mobile';
      return goBeforeDevice(p);
    };
  }
})();
