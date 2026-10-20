/* ============================================================================
 * device.js — Phân định rõ ràng: Trình duyệt Web vs Bản cài đặt Native APK.
 * 
 * NGUYÊN TẮC:
 * 1. TRÌNH DUYỆT WEB (Chrome, Safari, Firefox... trên PC, Laptop hay Điện thoại):
 *    - VẪN LÀ GIAO DIỆN WEB.
 *    - Tuyệt đối KHÔNG tự động chuyển sang màn chào APK mobile (go('mobile')).
 *    - Khi chưa đăng nhập: Hiển thị trang giới thiệu Web (landing) chuẩn responsive.
 *    - Nút "Giới thiệu Lumi" luôn dẫn về trang giới thiệu Web chuẩn.
 * 
 * 2. BẢN CÀI ĐẶT ANDROID APK (chạy trong WebView file:///android_asset/... hoặc có AndroidBridge):
 *    - Nhận diện đúng là ứng dụng di động cài đặt (Native APK).
 *    - Gắn html[data-device="phone"], kích hoạt giao diện app mobile tràn viền.
 *    - Khi chưa đăng nhập: Mở 3 màn chào onboarding của app mobile (mobileWelcomePage).
 * ============================================================================ */
(function () {
  const q = new URLSearchParams(location.search);
  const forcedDevice = q.get('device');
  const forcedApk = q.get('apk') === 'true' || forcedDevice === 'apk';

  // 1. Nhận diện môi trường Native APK Android thật:
  const isNativeApk =
    forcedApk ||
    location.protocol === 'file:' ||
    location.href.indexOf('android_asset') !== -1 ||
    Boolean(window.AndroidBridge) ||
    Boolean(window.isNativeApp) ||
    (forcedDevice === 'phone' && location.protocol !== 'http:' && location.protocol !== 'https:');

  // 2. Dọn dẹp cache cũ trong sessionStorage nếu trước đây từng bị lưu nhầm 'phone' trên web:
  try {
    if (!isNativeApk) {
      if (sessionStorage.getItem('lumi-device') === 'phone') {
        sessionStorage.removeItem('lumi-device');
      }
      if (sessionStorage.getItem('lumi-device-mode') === 'mobile' && !forcedDevice) {
        sessionStorage.removeItem('lumi-device-mode');
      }
    }
  } catch {}

  // 3. XỬ LÝ MÔI TRƯỜNG WEB (bao gồm cả trình duyệt Chrome trên điện thoại):
  if (!isNativeApk) {
    const mq = q => typeof window.matchMedia === 'function' && window.matchMedia(q).matches;
    const isMobileWeb = mq('(max-width: 768px)') && (mq('(pointer: coarse)') || /Android|iPhone|iPod/i.test(navigator.userAgent));
    if (isMobileWeb) {
      document.documentElement.dataset.deviceWeb = 'mobile';
    }
    // Đảm bảo không ép mode 'mobile' và không chuyển go('mobile') khi đang duyệt Web!
    return;
  }

  // 4. XỬ LÝ DÀNH RIÊNG CHO BẢN CÀI ĐẶT NATIVE APK:
  document.documentElement.dataset.device = 'phone';
  const mq = q => typeof window.matchMedia === 'function' && window.matchMedia(q).matches;
  const isStandalone = mq('(display-mode: standalone)') || navigator.standalone === true;
  if (isStandalone) document.documentElement.dataset.standalone = 'true';

  if (typeof setMode === 'function') setMode('mobile');

  // Trên Native APK: Chưa có phiên → mở 3 màn chào của app mobile
  const hash = location.hash.slice(1).split('?')[0];
  const hasSession = typeof lumiSession === 'function' && lumiSession();
  if (!hasSession && (!hash || hash === 'landing') && typeof go === 'function') {
    go('mobile');
  } else if (typeof render === 'function') {
    render();
  }

  // Trên Native APK: Nút quay về trang giới thiệu sẽ dẫn tới màn chào app
  if (typeof go === 'function') {
    const goBeforeDevice = go;
    go = function (p) {
      if (p === 'landing' && !(typeof lumiSession === 'function' && lumiSession())) p = 'mobile';
      return goBeforeDevice(p);
    };
  }
})();
