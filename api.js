// ============================================================
  // Wrapper Promise di atas google.script.run supaya bisa async/await.
  // Semua pemanggilan backend WAJIB lewat fungsi ini agar tidak
  // pernah reload / navigasi halaman.
  //
  // CATATAN: build_static.py mengganti isi fungsi api() di bawah ini
  // (bukan komentar ini) dengan versi fetch() saat membangun versi
  // GitHub Pages -- lihat static-site/api.js untuk hasilnya.
  // ============================================================
  async function api(fnName, ...args) {
    if (!API_BASE_URL || API_BASE_URL.indexOf('PASTE_URL') !== -1) {
      throw new Error('API_BASE_URL belum diisi di config.js. Buka file itu dan tempelkan URL Web App Anda.');
    }
    const url = API_BASE_URL
      + '?action=' + encodeURIComponent(fnName)
      + '&args=' + encodeURIComponent(JSON.stringify(args));
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' dari server.');
    return await res.json();
  }

  function getToken() {
    return sessionStorage.getItem('psrental_token');
  }

  function toastSuccess(msg) {
    Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: msg, showConfirmButton: false, timer: 2200, timerProgressBar: true });
  }
  function toastError(msg) {
    Swal.fire({ toast: true, position: 'top-end', icon: 'error', title: msg, showConfirmButton: false, timer: 3000, timerProgressBar: true });
  }
  function showLoading(text) {
    Swal.fire({ title: text || 'Memproses...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
  }
  function hideLoading() { Swal.close(); }

  async function confirmAction(title, text) {
    const res = await Swal.fire({
      title: title || 'Yakin?',
      text: text || '',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Ya, lanjutkan',
      cancelButtonText: 'Batal',
      confirmButtonColor: '#4f46e5'
    });
    return res.isConfirmed;
  }

  function formatRupiah(n) {
    return 'Rp' + Math.round(Number(n) || 0).toLocaleString('id-ID');
  }

  function formatDateTimeShort(d) {
    if (!d) return '-';
    const dt = new Date(d);
    return dt.toLocaleDateString('id-ID') + ' ' + dt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  }

  // Chart.js sengaja TIDAK dimuat di awal (mempercepat loading pertama
  // aplikasi untuk semua orang, termasuk yang cuma pakai modul Kasir/PS/
  // Pelanggan sehari-hari) -- baru diambil sekali saat halaman Dashboard
  // atau Laporan pertama kali dibuka.
  let chartJsLoadPromise = null;
  function ensureChartJs() {
    if (window.Chart) return Promise.resolve();
    if (chartJsLoadPromise) return chartJsLoadPromise;
    chartJsLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.2/dist/chart.umd.min.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Gagal memuat Chart.js'));
      document.head.appendChild(script);
    });
    return chartJsLoadPromise;
  }

  /**
   * Mengubah file gambar menjadi data URL base64 yang sudah diperkecil,
   * supaya aman disimpan sebagai teks di sel Google Spreadsheet.
   * maxDim: dimensi terpanjang maksimum (px). quality: kualitas JPEG 0-1.
   */
  function resizeImageToDataUrl(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith('image/')) { reject('File harus berupa gambar.'); return; }

      const reader = new FileReader();
      reader.onerror = () => reject('Gagal membaca file.');
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject('Gagal memuat gambar.');
        img.onload = () => {
          let { width, height } = img;
          if (width > height && width > maxDim) { height = Math.round(height * maxDim / width); width = maxDim; }
          else if (height > maxDim) { width = Math.round(width * maxDim / height); height = maxDim; }

          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality || 0.75));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // ---------------- Sidebar & Dark mode ----------------
  function toggleSidebar() {
    document.querySelector('.app-sidebar').classList.toggle('show');
  }

  function toggleDarkMode() {
    const html = document.documentElement;
    const isDark = html.getAttribute('data-theme') === 'dark';
    html.setAttribute('data-theme', isDark ? 'light' : 'dark');
    localStorage.setItem('psrental_theme', isDark ? 'light' : 'dark');
  }

  (function initTheme() {
    const saved = localStorage.getItem('psrental_theme');
    if (saved === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  })();

  // ---------------- Sesi (tanpa navigasi apapun) ----------------
  // Mengembalikan data user jika token valid, atau null jika tidak.
  // TIDAK PERNAH melakukan redirect/navigasi -- pemanggil yang memutuskan
  // tampilan mana yang harus ditampilkan.
  async function checkSession_() {
    const token = getToken();
    if (!token) return null;
    try {
      const res = await api('validateSession', token);
      return res.success ? res.data : null;
    } catch (e) {
      return null;
    }
  }

  async function doLogout() {
    const token = getToken();
    try { await api('logoutUser', token); } catch (e) { /* abaikan */ }
    sessionStorage.removeItem('psrental_token');
    sessionStorage.removeItem('psrental_nama');
    sessionStorage.removeItem('psrental_role');
    clearTimeout(idleTimer);
    showLoginView();
  }

  // Auto logout setelah tidak ada aktivitas (idle) sesuai SESSION_TIMEOUT_MINUTES.
  let idleTimer;
  function resetIdleTimer() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      Swal.fire('Sesi Berakhir', 'Anda logout otomatis karena tidak ada aktivitas.', 'info')
        .then(() => doLogout());
    }, 30 * 60 * 1000);
  }
  ['click', 'keydown', 'mousemove', 'touchstart'].forEach(evt =>
    document.addEventListener(evt, () => { if (getToken()) resetIdleTimer(); }, { passive: true })
  );
