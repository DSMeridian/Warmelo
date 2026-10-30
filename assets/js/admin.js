'use strict';
let   PW        = '';   // set once /api/cms-login accepts it; sent with every save
const CMS_KEY  = 'warmelo_cms_content';
const UPL_PFX   = 'warmelo_upload_';
const CMS_API   = '/api/cms';
const N_EVENTS  = 6;

let pending      = {};
let uploads      = {};   // key → dataURL (not yet in localStorage)
let curPage      = 'index.html';
let unsaved      = false;
let serverOnline = false;

const PAGE_NAMES = {
  'index.html':'Home','zandsculpturen.html':'Zandsculpturen','tuinen.html':'Tuinen',
  'evenementen.html':'Evenementen','horeca.html':'Horeca','verhuur.html':'Verhuur',
  'openingstijden.html':'Bezoek','contact.html':'Contact'
};

/* ── CLOSE ADMIN ────────────────────────────────────────────────── */
function closeAdmin() {
  if (unsaved && !confirm('Er zijn niet-opgeslagen wijzigingen.\nToch de editor verlaten?')) return;
  window.location.href = curPage || 'index.html';
}

/* ── LOGIN ──────────────────────────────────────────────────────── */
async function doLogin() {
  const input = document.getElementById('pwInput');
  const err   = document.getElementById('loginErr');
  const pw    = input.value;
  err.textContent = '';
  let r;
  try {
    r = await fetch('/api/cms-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw })
    });
  } catch (e) {
    err.textContent = 'Server niet bereikbaar — probeer het later opnieuw.';
    return;
  }
  if (r.ok) {
    PW = pw;
    document.getElementById('loginScreen').style.display = 'none';
    const p = document.getElementById('adminPanel');
    p.style.display = 'block';
    initAdmin();
  } else {
    err.textContent = r.status === 401 ? 'Ongeldig wachtwoord.' : 'Aanmelden mislukt (status ' + r.status + ').';
    input.value = '';
    input.focus();
  }
}

/* ── SERVER STATUS ──────────────────────────────────────────────── */
function setServerStatus(state, msg) {
  const dot = document.getElementById('srvDot');
  const lbl = document.getElementById('srvLbl');
  if (dot) { dot.className = 'srv-dot ' + state; }
  if (lbl) lbl.textContent = msg;
  serverOnline = (state === 'online');
}

async function checkServer() {
  setServerStatus('checking', 'Verbinding controleren…');
  try {
    const r = await fetch(CMS_API, { cache: 'no-store' });
    if (r.ok) {
      setServerStatus('online', '✓ Server verbonden — wijzigingen worden permanent opgeslagen voor alle bezoekers');
    } else {
      setServerStatus('offline', '⚠ Server niet bereikbaar (status ' + r.status + ') — wijzigingen worden alleen lokaal opgeslagen');
    }
  } catch (e) {
    setServerStatus('offline', '⚠ Geen serververbinding — lokaal werkend (voer "netlify dev" uit voor volledige functionaliteit)');
  }
}

async function syncFromServer() {
  setServerStatus('checking', 'Ophalen van server…');
  try {
    const r = await fetch(CMS_API, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    localStorage.setItem(CMS_KEY, JSON.stringify(data));
    pending = {}; uploads = {}; unsaved = false;
    setSt('✓ Gesynchroniseerd van server', 'ok');
    setServerStatus('online', '✓ Server verbonden — gesynchroniseerd om ' + new Date().toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'}));
    updateStorage(); reloadFrame(); loadGlobals(); buildEvCards(); buildMenu();
  } catch (e) {
    setServerStatus('offline', '⚠ Sync mislukt: ' + e.message);
  }
}

/* ── INIT ───────────────────────────────────────────────────────── */
function initAdmin() {
  checkServer().then(() => {
    if (serverOnline) {
      // Load latest content from server into local cache
      fetch(CMS_API, { cache: 'no-store' })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data && Object.keys(data).length > 0) {
            localStorage.setItem(CMS_KEY, JSON.stringify(data));
          }
          buildEvCards();
          buildMenu();
          loadGlobals();
          updateStorage();
        })
        .catch(() => { buildEvCards(); buildMenu(); loadGlobals(); updateStorage(); });
    } else {
      buildEvCards();
      buildMenu();
      loadGlobals();
      updateStorage();
    }
  });
}

/* ── PAGE SWITCH ────────────────────────────────────────────────── */
function switchPage(tab) {
  const page = tab.dataset.page;
  if (page === curPage) return;
  curPage = page;
  document.querySelectorAll('.ptb').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  document.getElementById('edPage').textContent = PAGE_NAMES[page] || page;
  document.getElementById('siteFrame').src = page;
  document.getElementById('dynTexts').innerHTML  = '<div class="loading">Pagina laden…</div>';
  document.getElementById('dynButtons').innerHTML = '';
  document.getElementById('dynFooter').innerHTML = '';
  document.getElementById('dynImages').innerHTML = '';
  document.getElementById('dynVideos').innerHTML = '';
}

function reloadFrame() {
  try { document.getElementById('siteFrame').contentWindow.location.reload(); }
  catch(e) { document.getElementById('siteFrame').src = curPage; }
}

/* ── FRAME LOAD ─────────────────────────────────────────────────── */
function onFrameLoad() {
  try {
    const d = iDoc();
    if (!d) return;
    // Prevent recursive editing if the iframe somehow loaded admin.html
    try { if (d.location.pathname.includes('admin.html')) return; } catch(e) {}

    // Sync active tab when the iframe navigates via internal links
    try {
      const loaded = d.location.pathname.split('/').pop() || 'index.html';
      if (loaded !== curPage && PAGE_NAMES[loaded]) {
        curPage = loaded;
        document.querySelectorAll('.ptb').forEach(t =>
          t.classList.toggle('active', t.dataset.page === curPage));
        document.getElementById('edPage').textContent = PAGE_NAMES[curPage];
      }
    } catch(e) {}

    scanTexts(d);
    scanButtons(d);
    scanFooter(d);
    scanImages(d);
    scanVideos(d);
    applyPendingToFrame(d);
    injectEditHandlers(d);
  } catch(e) {
    document.getElementById('dynTexts').innerHTML = '<div class="empty">Kan pagina niet scannen (cross-origin?).</div>';
  }
}

/* ── INJECT CLICK-TO-EDIT INTO IFRAME ───────────────────────────── */
function injectEditHandlers(d) {
  // Inject hover-outline styles
  const old = d.getElementById('__cms_st');
  if (old) old.remove();
  const st = d.createElement('style');
  st.id = '__cms_st';
  st.textContent =
    '.__ce{outline:2px dashed transparent!important;outline-offset:3px;cursor:pointer!important;transition:outline-color .15s!important}' +
    '.__ce:hover{outline-color:rgba(191,140,42,.65)!important}' +
    '.__cm{cursor:pointer!important}' +
    '.__cb{opacity:0;transition:opacity .2s}';
  d.head.appendChild(st);

  // ── internal buttons: data-cms-btn → Knoppen card. Capture on the <a> runs
  //    before the label span's own text handler, so the whole button opens the card.
  d.querySelectorAll('[data-cms-btn]').forEach(el => {
    if (el.__ce) return; el.__ce = true;
    el.classList.add('__ce');
    el.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); focusBtnCard(el.getAttribute('data-cms-btn')); }, true);
  });

  // ── contact details (address, phone, e-mail…) → Footer & Contact
  d.querySelectorAll('[data-cms-contact]').forEach(el => {
    if (el.__ce) return; el.__ce = true;
    el.classList.add('__ce');
    el.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); focusEditor(document.getElementById('f_ct_' + el.getAttribute('data-cms-contact'))); }, true);
  });

  // ── menu prices → Horeca Menukaart
  d.querySelectorAll('[data-cms-price]').forEach(el => {
    if (el.__ce) return; el.__ce = true;
    el.classList.add('__ce');
    el.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); focusEditor(document.getElementById('mn_' + el.getAttribute('data-cms-price'))); }, true);
  });

  // ── text: data-i18n
  d.querySelectorAll('[data-i18n]').forEach(el => {
    if (el.__ce) return; el.__ce = true;
    el.classList.add('__ce');
    el.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); focusField('i18n', el.getAttribute('data-i18n')); }, true);
  });

  // ── season / price keys → click jumps to Seizoen & Toegang section
  const seasonFieldMap = {
    'season-period':'f_sp','season-hours':'f_sh','season-closed':'f_sc',
    'season-label':'f_sl','season-text':'f_st',
    'price-volwassene':'f_pv','price-kind':'f_pk','price-gratis':'f_pg'
  };
  d.querySelectorAll('[data-cms]').forEach(el => {
    const k = el.getAttribute('data-cms');
    const fid = seasonFieldMap[k];
    if (fid) {
      if (el.__ce) return; el.__ce = true;
      el.classList.add('__ce');
      el.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); window.parent.focusSeasonField(fid); }, true);
      return;
    }
    if (el.__ce) return; el.__ce = true;
    el.classList.add('__ce');
    el.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); focusField('cms', k); }, true);
  });

  // ── tagged images: data-cms-img
  d.querySelectorAll('[data-cms-img]').forEach(el => {
    if (el.__ce) return; el.__ce = true;
    const id = el.getAttribute('data-cms-img');
    addImgHoverBadge(d, el, '📷 Bewerken', () => {
      window.parent.focusImgTile(id, 'img');
    });
  });

  // ── untagged images (skip nav/footer/lightbox icons)
  d.querySelectorAll('img:not([data-cms-img])').forEach((el, i) => {
    if (el.__ce) return;
    const src = el.getAttribute('src') || '';
    if (!src || src.startsWith('data:') || /wapenschild|logo|icon|emblem/i.test(src)) return;
    if (el.closest('nav, footer, .nav, .footer, #lightbox, [style*="display:none"]')) return;
    el.__ce = true;
    const fname = src.split('/').pop().replace(/[^a-z0-9]/gi,'_').toLowerCase().slice(0,30);
    const autoId = 'auto_' + fname + '_' + i;
    el.setAttribute('data-cms-img', autoId);
    addImgHoverBadge(d, el, '📷 Foto wisselen', () => window.parent.showUploadModal(autoId, 'img', el.src));
  });

  // ── tagged backgrounds: data-cms-bg
  d.querySelectorAll('[data-cms-bg]').forEach(el => {
    if (el.__ce) return; el.__ce = true;
    const id = el.getAttribute('data-cms-bg');
    addFixedBadge(d, el, '📷 Achtergrond wisselen', () => window.parent.showUploadModal(id, 'bg', null));
  });

  // ── tagged videos: data-cms-vid
  d.querySelectorAll('[data-cms-vid]').forEach(el => {
    if (el.__ce) return; el.__ce = true;
    const id = el.getAttribute('data-cms-vid');
    addFixedBadge(d, el, '🎬 Video wisselen', () => window.parent.showUploadModal(id, 'vid', null));
  });

  // ── untagged videos
  d.querySelectorAll('video:not([data-cms-vid])').forEach((el, i) => {
    if (el.__ce) return; el.__ce = true;
    const autoId = 'auto_vid_' + i;
    el.setAttribute('data-cms-vid', autoId);
    addFixedBadge(d, el, '🎬 Video wisselen', () => window.parent.showUploadModal(autoId, 'vid', null));
  });

  // ── social / external links (data-cms-link)
  d.querySelectorAll('[data-cms-link]').forEach(el => {
    if (el.__ce) return; el.__ce = true;
    const id = el.getAttribute('data-cms-link');
    el.classList.add('__ce');
    el.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      window.parent.focusLinkField(id);
    }, true);
  });
}

function css(el) {
  // Use the element's own document's window for getComputedStyle — avoids
  // cross-frame style access issues when admin reads iframe element styles.
  return el.ownerDocument.defaultView.getComputedStyle(el);
}

function addImgHoverBadge(d, el, label, cb) {
  // Skip hidden fallback images (e.g. hero__bg-img which is display:none)
  if (css(el).display === 'none') return;
  // Absolutely/fixed-positioned images must not be wrapped — badge on parent
  if (css(el).position !== 'static') {
    addFixedBadge(d, el.parentElement || el, label, cb);
    return;
  }
  const wrap = d.createElement('div');
  wrap.className = '__cm';
  wrap.style.cssText = 'display:inline-block;position:relative;line-height:0;width:' + (el.style.width||'100%');
  el.parentNode.insertBefore(wrap, el);
  wrap.appendChild(el);
  const btn = mkBadge(d, label);
  wrap.appendChild(btn);
  wrap.addEventListener('mouseenter', () => { btn.style.opacity = '1'; });
  wrap.addEventListener('mouseleave', () => { btn.style.opacity = '0'; });
  btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); cb(); }, true);
  wrap.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); cb(); }, true);
}

function addFixedBadge(d, el, label, cb) {
  // For <video>: go up TWO levels (video → hero__media → hero section) because
  // hero__media has will-change:transform which isolates its stacking context
  // below sibling overlay divs — the badge would be invisible there.
  let target = el;
  if (el && el.tagName === 'VIDEO') {
    const p = el.parentElement;
    target = (p && p.parentElement) ? p.parentElement : (p || el);
  }
  if (!target) return;
  if (css(target).position === 'static') target.style.position = 'relative';
  target.style.cursor = 'pointer';
  const btn = mkBadge(d, label);
  target.appendChild(btn);
  target.addEventListener('mouseenter', () => { btn.style.opacity = '1'; });
  target.addEventListener('mouseleave', () => { btn.style.opacity = '0'; });
  btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); cb(); }, true);
  // Only clicks on the bare area open the upload. Texts, buttons and images inside
  // it (e.g. the hero over the video) keep their own editor (__ce / __cm).
  target.addEventListener('click', e => { if (e.target !== btn && !e.target.closest('.__ce, .__cm')) { e.preventDefault(); e.stopPropagation(); cb(); } }, true);
}

function mkBadge(d, label) {
  const btn = d.createElement('button');
  btn.className = '__cb';
  btn.textContent = label;
  btn.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;' +
    'background:rgba(191,140,42,.95);color:#0d1f14;border:none;padding:10px 18px;' +
    'font-size:12px;font-weight:700;cursor:pointer;border-radius:3px;font-family:sans-serif;' +
    'letter-spacing:.04em;white-space:nowrap;pointer-events:auto;box-shadow:0 4px 16px rgba(0,0,0,.4)';
  return btn;
}

/* ── FOCUS SEASON/PRICE FIELD (called from iframe click) ────────── */
function focusSeasonField(fieldId) {
  openSec('secSeason');
  const el = document.getElementById(fieldId);
  if (!el) return;
  const scroll = document.getElementById('edScroll');
  const top = el.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop - 60;
  scroll.scrollTo({ top, behavior: 'smooth' });
  setTimeout(() => {
    el.focus();
    el.classList.add('field-flash');
    setTimeout(() => el.classList.remove('field-flash'), 2200);
  }, 200);
}

/* ── HIGHLIGHT MATCHING ELEMENTS IN IFRAME PREVIEW ─────────────── */
function highlightInFrame(selector) {
  const d = iDoc(); if (!d) return;
  const els = d.querySelectorAll(selector);
  if (!els.length) return;
  els.forEach(el => {
    const prevOutline = el.style.outline;
    const prevBg = el.style.backgroundColor;
    el.style.transition = 'outline 0.15s, background-color 0.15s';
    el.style.outline = '3px solid rgba(191,140,42,0.9)';
    el.style.backgroundColor = 'rgba(191,140,42,0.15)';
    setTimeout(() => {
      el.style.outline = prevOutline;
      el.style.backgroundColor = prevBg;
    }, 2000);
  });
  els[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* ── FOCUS EDITOR FIELD (called from iframe click) ──────────────── */
function focusField(type, key) {
  focusEditor(document.getElementById('fi_' + type + '_' + key.replace(/[.\-]/g,'_')));
}

/* Open whichever section holds the field, scroll to it and flash it */
function focusEditor(el) {
  if (!el) return;
  const sec = el.closest('.edsec');
  if (sec) openSec(sec.id);
  const scroll = document.getElementById('edScroll');
  const top = el.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop - 60;
  scroll.scrollTo({ top, behavior: 'smooth' });
  setTimeout(() => {
    if (el.matches('input, textarea, select')) el.focus();
    el.classList.add('field-flash');
    setTimeout(() => el.classList.remove('field-flash'), 2200);
  }, 200);
}

/* ── UPLOAD MODAL ────────────────────────────────────────────────── */
let umTarget = null; // { id, type }

function showUploadModal(id, type, currentSrc) {
  umTarget = { id, type };
  const isVid = type === 'vid';
  document.getElementById('umTitle').textContent = isVid ? 'Video wisselen' : 'Afbeelding wisselen';
  document.getElementById('umIco').textContent = isVid ? '🎬' : '📷';
  document.getElementById('umFile').accept = isVid ? 'video/*' : 'image/*';
  document.getElementById('umWarn').textContent = '';
  document.getElementById('umUrlIn').value = '';
  // URL option: visible for images and backgrounds, show hint for video
  const sepEl = document.getElementById('umSepUrl');
  const urlRow = document.getElementById('umUrlRow');
  if (isVid) {
    if (sepEl) sepEl.textContent = 'of geef een URL naar een geüploade video';
    if (urlRow) urlRow.style.display = 'flex';
    document.getElementById('umUrlIn').placeholder = 'https://kasteel-warmelo.nl/Web/hero.mp4';
  } else {
    if (sepEl) sepEl.textContent = 'of gebruik een URL';
    if (urlRow) urlRow.style.display = 'flex';
    document.getElementById('umUrlIn').placeholder = 'https://kasteel-warmelo.nl/Web/images/...';
  }
  // Show current image if available
  const cur = document.getElementById('umCurrent');
  const curImg = document.getElementById('umCurrentImg');
  if (!isVid && currentSrc && !currentSrc.startsWith('data:') && currentSrc.length < 300) {
    curImg.src = currentSrc; cur.style.display = 'block';
  } else { cur.style.display = 'none'; }
  document.getElementById('uploadModal').style.display = 'flex';
}

function hideUploadModal() {
  document.getElementById('uploadModal').style.display = 'none';
  umTarget = null;
  document.getElementById('umFile').value = '';
  document.getElementById('umUrlIn').value = '';
}

/* ── APPLY URL DIRECTLY (no upload needed) ───────────────────────── */
function applyUploadUrl() {
  const url = document.getElementById('umUrlIn').value.trim();
  if (!url || !umTarget) return;
  const { id, type } = umTarget;

  // Store directly as URL (no base64, no localStorage needed)
  if (type === 'img')  { pending.images      = pending.images||{};      pending.images[id]      = url; }
  if (type === 'bg')   { pending.backgrounds = pending.backgrounds||{}; pending.backgrounds[id] = url; }
  if (type === 'vid')  { pending.videos      = pending.videos||{};      pending.videos[id]      = url; }

  // Apply live in iframe
  const doc = iDoc();
  if (doc) {
    if (type === 'img') doc.querySelectorAll('[data-cms-img="'+id+'"]').forEach(el => { el.src = url; let lb=el.parentElement; while(lb&&lb!==doc.body){if(lb.hasAttribute('data-lightbox')){lb.setAttribute('data-lightbox',url);break;}lb=lb.parentElement;} });
    if (type === 'bg')  doc.querySelectorAll('[data-cms-bg="'+id+'"]').forEach(el => el.style.backgroundImage = "url('"+url+"')");
    if (type === 'vid') doc.querySelectorAll('[data-cms-vid="'+id+'"]').forEach(el => { const s=el.querySelector('source'); if(s){s.setAttribute('src',url);el.load();} });
  }

  // Update preview tile if visible
  const fid = 'uf_' + type + '_' + id.replace(/[.\-]/g,'_');
  const prevEl = document.getElementById('prev_' + fid);
  if (prevEl) updatePrevEl('prev_' + fid, type, url);

  markDirty();
  hideUploadModal();
}

function onUmFile(input) {
  if (!input.files[0] || !umTarget) return;
  processMediaUpload(input.files[0]);
  hideUploadModal();
}

function onUmDrop(e) {
  e.preventDefault();
  document.getElementById('umDrop').classList.remove('over');
  if (!e.dataTransfer.files[0] || !umTarget) return;
  processMediaUpload(e.dataTransfer.files[0]);
  hideUploadModal();
}

/* ── Upload image to server immediately — no localStorage needed ── */
async function uploadImageToServer(id, type, dataURL) {
  const imgId = 'cms_' + type + '_' + id.replace(/[^a-z0-9_-]/gi,'_');
  try {
    const r = await fetch('/api/cms-img?id=' + encodeURIComponent(imgId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PW, data: dataURL })
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const res = await r.json();
    return res.url; // e.g. "/api/cms-img?id=cms_img_xyz"
  } catch(e) {
    console.warn('Image server upload failed, keeping in memory:', e.message);
    // Fallback: keep in memory only (will be included in main save)
    const uk = curPage.replace('.html','') + '_' + type + '_' + id;
    uploads[uk] = dataURL;
    return 'warmelo_upload:' + uk;
  }
}

function processMediaUpload(file) {
  if (!umTarget) return;
  const { id, type } = umTarget;
  const MB = file.size / 1024 / 1024;
  if (type === 'vid' && MB > 60) { alert('Video is te groot ('+MB.toFixed(0)+' MB). Comprimeer voor gebruik.'); return; }
  if (type !== 'vid' && MB > 8)  { alert('Afbeelding is te groot ('+MB.toFixed(1)+' MB). Comprimeer naar <2 MB voor beste resultaat.'); }

  const reader = new FileReader();
  reader.onload = async e => {
    const dataURL = e.target.result;

    // 1. Apply preview to iframe immediately (no waiting)
    const doc = iDoc();
    if (doc) {
      if (type === 'img') {
        doc.querySelectorAll('[data-cms-img="'+id+'"]').forEach(el => {
          const img = el.tagName === 'IMG' ? el : el.querySelector('img');
          if (img) img.src = dataURL; else el.src = dataURL;
          // Update lightbox URL on ancestor
          let lbEl = el; while(lbEl&&lbEl!==doc.body){if(lbEl.hasAttribute('data-lightbox')){lbEl.setAttribute('data-lightbox',dataURL);break;}lbEl=lbEl.parentElement;}
        });
      }
      if (type === 'bg') doc.querySelectorAll('[data-cms-bg="'+id+'"]').forEach(el => el.style.backgroundImage="url('"+dataURL+"')");
      if (type === 'vid') doc.querySelectorAll('[data-cms-vid="'+id+'"]').forEach(el => { const s=el.querySelector('source'); if(s){s.setAttribute('src',dataURL);el.load();} });
    }

    // Update editor preview tile immediately
    const fid = 'uf_' + type + '_' + id.replace(/[.\-]/g,'_');
    const prevEl = document.getElementById('prev_' + fid);
    if (prevEl) updatePrevEl('prev_' + fid, type, dataURL);

    if (type === 'vid') {
      // Videos: can't store on server (too large). Show notice only.
      const mb = MB.toFixed(1);
      const notice = document.createElement('div');
      notice.style.cssText = 'margin-top:10px;padding:12px 16px;background:rgba(191,140,42,.12);border:1px solid rgba(191,140,42,.35);font-size:12px;color:rgba(255,255,255,.8);line-height:1.6;border-radius:2px;';
      notice.innerHTML = '✅ <strong style="color:var(--gold);">Video getoond in preview</strong> — '+mb+' MB<br>'
        + '⚠ Videos zijn te groot voor browseropslag. Zet het bestand online via de beheerder.';
      notice.className = 'vid-notice';
      markDirty();
      return;
    }

    // 2. Upload image to server immediately (bypasses localStorage entirely)
    setSt('⬆ Afbeelding uploaden…', 'saving');
    const serverUrl = await uploadImageToServer(id, type, dataURL);

    // 3. Store server URL (not base64) in pending — tiny, no localStorage pressure
    if (type === 'img')  { pending.images      = pending.images||{};      pending.images[id]      = serverUrl; }
    if (type === 'bg')   { pending.backgrounds = pending.backgrounds||{}; pending.backgrounds[id] = serverUrl; }

    setSt('● Afbeelding opgeslagen — klik Opslaan om alles te bevestigen', 'unsaved');
    markDirty();
  };
  reader.readAsDataURL(file);
}

/* ── FOCUS IMAGE TILE IN RIGHT PANEL (called from iframe click) ─── */
function focusImgTile(id, type) {
  openSec('secImages');
  const scroll = document.getElementById('edScroll');
  const tiles  = document.querySelectorAll('.imgf');
  for (const tile of tiles) {
    const idEl = tile.querySelector('.imgf-id');
    if (idEl && idEl.textContent.trim() === id) {
      const top = tile.getBoundingClientRect().top
        - scroll.getBoundingClientRect().top
        + scroll.scrollTop - 60;
      scroll.scrollTo({ top, behavior: 'smooth' });
      setTimeout(() => {
        tile.classList.add('imgf-flash');
        setTimeout(() => tile.classList.remove('imgf-flash'), 2000);
      }, 200);
      return;
    }
  }
  showUploadModal(id, type, null);
}

/* ─────────────────────────────────────────────────────────────────
   CROP MODAL — visual position + zoom + height
   ──────────────────────────────────────────────────────────────── */
let cmId = null, cmType = null;
let cmX = 50, cmY = 50;  // focal point as 0-100 percentages
let cmScale = 1.0;        // zoom multiplier
let cmHeight = null;      // cell height override in px (null = keep original)
let cmDragging = false;

const CM_DEFAULT_H = 220; // px, default gallery cell height

function openCropModal(id, type, src) {
  cmId = id; cmType = type;
  const s   = getCms();
  const fit = Object.assign({}, (s.imgfit && s.imgfit[id]) || {}, (pending.imgfit && pending.imgfit[id]) || {});

  /* parse saved pos ("45.3% 62.1%") */
  if (fit.pos) {
    const parts = fit.pos.match(/([\d.]+)%\s+([\d.]+)%/);
    if (parts) { cmX = parseFloat(parts[1]); cmY = parseFloat(parts[2]); }
  } else { cmX = 50; cmY = 50; }
  cmScale  = fit.scale  || 1.0;
  cmHeight = fit.height ? parseInt(fit.height) : null;

  /* ── Detect actual container dimensions from iframe ─────────── */
  let containerAR  = 4 / 3;  // fallback aspect ratio
  let detectedH    = CM_DEFAULT_H;
  let containerCtx = '';
  try {
    const d = iDoc();
    if (d) {
      const imgEl = d.querySelector('[data-cms-img="'+id+'"]');
      if (imgEl) {
        const cont = imgEl.closest('.gallery__item, .zoom') || imgEl.parentElement;
        if (cont && cont.offsetWidth && cont.offsetHeight) {
          detectedH    = cont.offsetHeight;
          containerAR  = cont.offsetWidth / cont.offsetHeight;
          const tag    = cont.className || '';
          containerCtx = tag.includes('span') ? ' (ruim vak)' : '';
        }
      }
    }
  } catch(e) {}

  /* show detected size hint below presets */
  const hint = document.getElementById('cmSizeHint');
  if (hint) hint.textContent = detectedH !== CM_DEFAULT_H
    ? '⬆ Huidige celgrootte: ' + detectedH + ' px' + containerCtx
    : '';

  /* mark the matching preset active */
  const activeH = cmHeight || detectedH;
  document.querySelectorAll('.cm-pre').forEach(btn => {
    btn.classList.toggle('cm-pre-active', parseInt(btn.dataset.h) === activeH);
  });

  /* set preview size: width fills modal, height from actual AR */
  const prev    = document.getElementById('cmPreview');
  const maxW    = Math.min(window.innerWidth * 0.88, 460);
  const prevH   = Math.min(maxW / containerAR, 320);
  prev.style.height = prevH + 'px';

  /* resolve image src */
  let resolvedSrc = src;
  if (src && src.startsWith('warmelo_upload:')) {
    const key = src.replace('warmelo_upload:', '');
    resolvedSrc = uploads[key] || localStorage.getItem(UPL_PFX + key) || src;
  }
  if (!resolvedSrc || resolvedSrc === 'null' || resolvedSrc === '') {
    try {
      const el = iDoc() && iDoc().querySelector('[data-cms-img="'+id+'"]');
      if (el) resolvedSrc = el.src || el.getAttribute('src');
    } catch(e) {}
  }
  document.getElementById('cmImg').src = resolvedSrc || '';

  /* sync zoom slider */
  document.getElementById('cmZoomSlider').value = Math.round(cmScale * 100);
  document.getElementById('cmZoomVal').textContent = cmScale.toFixed(1) + '×';

  cmUpdatePreview();
  document.getElementById('cropModal').style.display = 'flex';
}

function closeCropModal() {
  document.getElementById('cropModal').style.display = 'none';
  cmId = null;
}

/* Update preview image object-position, scale, focal dot */
function cmUpdatePreview() {
  const img   = document.getElementById('cmImg');
  const focal = document.getElementById('cmFocal');
  img.style.objectPosition = cmX + '% ' + cmY + '%';
  img.style.transform      = cmScale > 1 ? 'scale(' + cmScale + ')' : '';
  img.style.transformOrigin = cmX + '% ' + cmY + '%';
  focal.style.left = cmX + '%';
  focal.style.top  = cmY + '%';
}

/* Drag handlers on preview area */
function cmGetPct(e, el) {
  const rect = el.getBoundingClientRect();
  const cx = (e.clientX - rect.left)  / rect.width  * 100;
  const cy = (e.clientY - rect.top)   / rect.height * 100;
  return [Math.max(0, Math.min(100, cx)), Math.max(0, Math.min(100, cy))];
}

function cmStartDrag(e) {
  cmDragging = true;
  e.currentTarget.classList.add('dragging');
  e.currentTarget.setPointerCapture(e.pointerId);
  [cmX, cmY] = cmGetPct(e, e.currentTarget);
  cmUpdatePreview();
}
function cmDoDrag(e) {
  if (!cmDragging) return;
  [cmX, cmY] = cmGetPct(e, e.currentTarget);
  cmUpdatePreview();
}
function cmEndDrag(e) {
  if (!cmDragging) return;
  cmDragging = false;
  e.currentTarget.classList.remove('dragging');
}

/* Zoom slider */
function cmSetZoom(val) {
  cmScale = parseInt(val) / 100;
  document.getElementById('cmZoomVal').textContent = cmScale.toFixed(1) + '×';
  cmUpdatePreview();
}

/* Height presets */
function cmSetHeight(h, btn) {
  cmHeight = h;
  document.querySelectorAll('.cm-pre').forEach(b => b.classList.remove('cm-pre-active'));
  if (btn) btn.classList.add('cm-pre-active');
  /* resize preview box proportionally (cap at 340) */
  document.getElementById('cmPreview').style.height = Math.min(h, 340) + 'px';
}

/* Reset all fit settings */
function cmResetAll() {
  cmX = 50; cmY = 50; cmScale = 1.0; cmHeight = null;
  document.getElementById('cmZoomSlider').value = 100;
  document.getElementById('cmZoomVal').textContent = '1.0×';
  document.querySelectorAll('.cm-pre').forEach(b => b.classList.toggle('cm-pre-active', parseInt(b.dataset.h) === CM_DEFAULT_H));
  document.getElementById('cmPreview').style.height = Math.min(CM_DEFAULT_H, 340) + 'px';
  cmUpdatePreview();
}

/* Apply settings and close */
function cmApplyAndClose() {
  if (!cmId) return;
  pending.imgfit         = pending.imgfit || {};
  pending.imgfit[cmId]   = {};
  const fit = pending.imgfit[cmId];

  if (cmX !== 50 || cmY !== 50) fit.pos    = cmX.toFixed(1) + '% ' + cmY.toFixed(1) + '%';
  if (cmScale > 1.01)            fit.scale  = parseFloat(cmScale.toFixed(2));
  if (cmHeight && cmHeight !== CM_DEFAULT_H) fit.height = cmHeight + 'px';

  /* apply to iframe */
  applyFitToFrame(cmId);

  /* refresh the tile badge in right panel */
  const fid  = 'tile_uf_' + cmType + '_' + cmId.replace(/[.\-]/g,'_');
  const tile = document.getElementById(fid);
  if (tile) {
    const btn   = tile.querySelector('.imgfit-btn');
    const badge = btn && btn.querySelector('.imgfit-badge');
    const summary = [
      fit.scale ? Math.round(fit.scale*100)+'%' : '',
      fit.height || '',
      fit.pos ? 'pos' : '',
    ].filter(Boolean).join(' · ');
    if (badge) badge.textContent = summary;
    else if (btn && summary) { const s = document.createElement('span'); s.className='imgfit-badge'; s.textContent=summary; btn.appendChild(s); }
    /* also update the tiny preview */
    const prevImg = tile.querySelector('.imgf-prev');
    if (prevImg) {
      prevImg.style.objectPosition = fit.pos || '';
      prevImg.style.transform = fit.scale > 1 ? 'scale('+fit.scale+')' : '';
      prevImg.style.transformOrigin = fit.pos || '50% 50%';
    }
  }

  markDirty();
  closeCropModal();
}

/* Apply pending imgfit to iframe — scale only via class to avoid overlap bugs */
function applyFitToFrame(id) {
  const d = iDoc(); if (!d) return;
  const saved = (getCms().imgfit && getCms().imgfit[id]) || {};
  const pend  = (pending.imgfit  && pending.imgfit[id])  || {};
  const fit   = Object.assign({}, saved, pend);
  d.querySelectorAll('[data-cms-img="'+id+'"]').forEach(img => {
    img.style.objectPosition = fit.pos || '';
    if (fit.scale && fit.scale > 1.01) {
      img.classList.add('cms-scaled');
      img.style.setProperty('--cms-scale',       fit.scale);
      img.style.setProperty('--cms-scale-hover', parseFloat((fit.scale * 1.07).toFixed(3)));
      img.style.setProperty('--cms-origin',      fit.pos || '50% 50%');
    } else {
      img.classList.remove('cms-scaled');
      img.style.removeProperty('--cms-scale');
      img.style.removeProperty('--cms-scale-hover');
      img.style.removeProperty('--cms-origin');
    }
    if (fit.height) {
      const container = img.closest ? img.closest('.gallery__item, .zoom') : img.parentElement;
      if (container) container.style.height = fit.height;
    }
  });
  d.querySelectorAll('[data-cms-bg="'+id+'"]').forEach(el => {
    if (fit.pos) el.style.backgroundPosition = fit.pos;
  });
}

/* ── FOCUS LINK FIELD (called from iframe link click) ───────────── */
function focusLinkField(id) {
  openSec('secLinks');
  const el = document.getElementById('f_lk_' + id);
  if (!el) return;
  const scroll = document.getElementById('edScroll');
  const top = el.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop - 60;
  scroll.scrollTo({ top, behavior: 'smooth' });
  setTimeout(() => {
    el.focus(); el.select();
    el.classList.add('field-flash');
    setTimeout(() => el.classList.remove('field-flash'), 2200);
  }, 200);
}

/* ── TRIGGER IMAGE UPLOAD from editor panel (right side buttons) ─── */
function triggerImgUpload(id, type) {
  showUploadModal(id, type, null);
}
function triggerVidUpload(id) {
  showUploadModal(id, 'vid', null);
}

/* ── SCAN: TEXTS ────────────────────────────────────────────────── */
/* Texts are listed in page order, grouped per page section and labelled by
   what they are (Titel, Tekst, Knoptekst…). Footer, menu card, season and
   price texts live in their own sections.                                   */
function scanTexts(d) {
  const groups = new Map(), seen = new Set();
  let n = 0;
  d.querySelectorAll('[data-i18n], [data-cms]').forEach(el => {
    const type = el.hasAttribute('data-i18n') ? 'i18n' : 'cms';
    const k = el.getAttribute(type === 'i18n' ? 'data-i18n' : 'data-cms');
    if (!k || el.closest('footer')) return;
    if (type === 'cms' && /^(season|price|menu)-/.test(k)) return;
    if (seen.has(type + ':' + k)) return;
    seen.add(type + ':' + k); n++;
    const sec = el.closest('nav, .nav__overlay, section, header') || d.body;
    if (!groups.has(sec)) groups.set(sec, []);
    groups.get(sec).push({ el, type, k });
  });

  if (!n) {
    document.getElementById('dynTexts').innerHTML = '<div class="empty">Geen bewerkbare teksten op deze pagina.</div>';
    return;
  }

  const lang = previewLang();
  let h = secWrap('secTexts', '✏️', 'Teksten', n + ' velden');
  h += '<div class="fh" style="margin-bottom:10px">Taal: <strong>'+lang.toUpperCase()+'</strong> — wissel de taal in de preview om andere talen te bewerken. Klik op een tekst in de preview om er direct naartoe te gaan.</div>';
  let i = 0;
  for (const [sec, items] of groups) {
    const isMenu = sec.matches('nav, .nav__overlay');
    h += '<div class="fg"><div class="fg-t">'+esc(textGroupName(sec, isMenu ? 0 : ++i))+'</div>';
    for (const { el, type, k } of items) {
      const pended = type === 'i18n' ? getI18nForLang(pending.i18n, lang)[k] : (pending.text && pending.text[k]);
      // the preview already shows saved content, so it is the current value
      const html = el.hasAttribute('data-count') ? el.getAttribute('data-count') : el.innerHTML;
      h += mkTextFld(k, type, pended != null ? pended : html, textLabel(el));
    }
    h += '</div>';
  }
  h += '</div></div>';
  document.getElementById('dynTexts').innerHTML = h;
  openSec('secTexts');
}

function textGroupName(sec, i) {
  if (sec.matches('nav, .nav__overlay')) return 'Menu';
  const hd = sec.querySelector('h1, h2');
  const t  = hd ? toSimple(hd.innerHTML).replace(/\*/g, '').replace(/\n/g, ' ') : '';
  return i + ' · ' + (t ? (t.length > 40 ? t.slice(0, 38) + '…' : t) : 'Sectie');
}

function textLabel(el) {
  const tag = el.tagName;
  if (el.closest('.btn')) return 'Knoptekst';
  if (el.closest('nav, .nav__overlay')) return 'Menu-item';
  if (tag === 'H1') return 'Hoofdtitel';
  if (tag === 'H2') return 'Titel';
  if (/^H[3-6]$/.test(tag)) return 'Subtitel';
  if (el.hasAttribute('data-count')) return 'Getal';
  if (el.closest('li')) return 'Opsommingspunt';
  if (el.closest('a')) return 'Linktekst';
  if (tag === 'P' || el.textContent.trim().length > 90) return 'Tekst';
  return 'Label';
}

/* Text fields show a simple format instead of HTML:
   Enter = line break (<br>), *woord* = accent text (<em>).
   The original <em …> tag is kept so styled accents keep their colour.      */
function mkTextFld(key, type, html, label) {
  const id  = 'fi_' + type + '_' + key.replace(/[.\-]/g,'_');
  const val = toSimple(html);
  const em  = (String(html||'').match(/<em\b[^>]*>/i) || [''])[0];
  const fmt = /\n|\*/.test(val);
  const attrs = 'id="'+id+'" data-fk="'+escA(key)+'" data-ft="'+type+'" data-em="'+escA(em)+'" title="'+escA(key)+'" oninput="onTxt(this)"';
  let h = '<div class="fr"><label class="fl" for="'+id+'">' + esc(label || key) + '</label>';
  if (fmt || val.length > 90) {
    const rows = Math.min(6, Math.max(2, val.split('\n').length, Math.ceil(val.length / 60)));
    h += '<textarea class="fta" rows="'+rows+'" '+attrs+'>'+esc(val)+'</textarea>';
  } else {
    h += '<input type="text" class="fi" value="'+escA(val)+'" '+attrs+' />';
  }
  if (fmt) h += '<div class="fh">Enter = nieuwe regel · *woord* = accentkleur</div>';
  return h + '</div>';
}

function toSimple(html) {
  // DOMParser documents never run scripts or event handlers
  const body = new DOMParser().parseFromString(String(html||'').replace(/<br\s*\/?>/gi, '\u0001'), 'text/html').body;
  body.querySelectorAll('em').forEach(em => em.replaceWith('*' + em.textContent + '*'));
  return body.textContent.replace(/\s+/g, ' ').replace(/ ?\u0001 ?/g, '\n').trim();
}

function toHtml(val, emTag) {
  return esc(val).replace(/\*([^*\n]+)\*/g, (m, t) => (emTag || '<em>') + t + '</em>').replace(/\r?\n/g, '<br>');
}

/* ── SCAN: IMAGES ───────────────────────────────────────────────── */
function scanImages(d) {
  const imgs = new Map(), bgs = new Map();
  d.querySelectorAll('[data-cms-img]').forEach(el => {
    const id = el.getAttribute('data-cms-img');
    if (id && !imgs.has(id)) imgs.set(id, { src: el.getAttribute('src')||'', alt: el.alt||id });
  });
  d.querySelectorAll('[data-cms-bg]').forEach(el => {
    const id = el.getAttribute('data-cms-bg');
    if (id && !bgs.has(id)) bgs.set(id, id);
  });

  if (!imgs.size && !bgs.size) { document.getElementById('dynImages').innerHTML=''; return; }

  const s = getCms();
  let h = secWrap('secImages', '🖼', 'Afbeeldingen', imgs.size + bgs.size + ' afbeeldingen', true);

  if (imgs.size) {
    h += '<div class="fg"><div class="fg-t">Pagina-afbeeldingen</div>';
    for (const [id, info] of imgs) {
      let src = info.src;
      if (s.images && s.images[id]) src = resolveAny(s.images[id]);
      if (pending.images && pending.images[id]) src = resolveAny(pending.images[id]);
      h += mkImgFld(id, 'img', src, info.alt);
    }
    h += '</div>';
  }
  if (bgs.size) {
    h += '<div class="fg" style="margin-top:14px"><div class="fg-t">Achtergrondafbeeldingen</div>';
    for (const [id] of bgs) {
      let src = null;
      if (s.backgrounds && s.backgrounds[id]) src = resolveAny(s.backgrounds[id]);
      if (pending.backgrounds && pending.backgrounds[id]) src = resolveAny(pending.backgrounds[id]);
      h += mkImgFld(id, 'bg', src, id);
    }
    h += '</div>';
  }
  h += '</div></div>';
  document.getElementById('dynImages').innerHTML = h;
}

function mkImgFld(id, type, curSrc, lbl) {
  const fid    = 'uf_' + type + '_' + id.replace(/[.\-]/g,'_');
  const s      = getCms();
  const fit    = (s.imgfit && s.imgfit[id]) || {};
  const hasFit = !!(fit.pos || fit.scale || fit.height);

  let h = '<div class="imgf" id="tile_'+fid+'">';
  h += '<div class="imgf-hd"><span class="imgf-name">'+esc(lbl)+'</span><span class="imgf-id">'+esc(id)+'</span></div>';

  const goodSrc = curSrc && !curSrc.startsWith('warmelo_upload:');
  if (goodSrc && type === 'img') {
    const posStyle = fit.pos   ? 'object-position:'+fit.pos+';' : '';
    const scaleStyle = fit.scale && fit.scale > 1 ? 'transform:scale('+fit.scale+');transform-origin:'+(fit.pos||'50% 50%')+';' : '';
    h += '<img class="imgf-prev" src="'+escA(curSrc)+'" alt="'+escA(lbl)+'" id="prev_'+fid+'" style="object-fit:cover;'+posStyle+scaleStyle+'" />';
  } else if (goodSrc && type === 'bg') {
    h += '<div class="imgf-prev-bg" id="prev_'+fid+'" style="background-image:url(\''+escA(curSrc)+'\')"></div>';
  } else {
    h += '<div class="imgf-none" id="prev_'+fid+'">Geen afbeelding</div>';
  }

  h += '<div class="imgf-acts">';
  h += '<button class="ubtn" onclick="showUploadModal(\''+esc(id)+'\',\''+type+'\',null)">📁 Foto wisselen</button>';
  h += '<button class="rbtn" onclick="resetImg(\''+esc(id)+'\',\''+type+'\',\'prev_'+fid+'\')">Origineel</button>';
  h += '</div>';

  /* ── Single "crop" button opens the visual modal ── */
  const fitSummary = hasFit
    ? [(fit.scale&&fit.scale>1 ? Math.round(fit.scale*100)+'% zoom':''), (fit.height||''), (fit.pos||'')].filter(Boolean).join(' · ')
    : '';
  h += '<button class="imgfit-btn" onclick="openCropModal(\''+esc(id)+'\',\''+type+'\',\''+escA(curSrc||'')+'\')">';
  h += '✂ Bijsnijden &amp; schalen';
  if (fitSummary) h += ' <span class="imgfit-badge">'+esc(fitSummary)+'</span>';
  h += '</button>';

  h += '<div class="size-warn" id="swarn_'+fid+'" style="display:none"></div>';
  return h + '</div>';
}

/* ── SCAN: VIDEOS ───────────────────────────────────────────────── */
function scanVideos(d) {
  const vids = new Map();
  d.querySelectorAll('[data-cms-vid]').forEach(el => {
    const id = el.getAttribute('data-cms-vid');
    if (!id || vids.has(id)) return;
    const s = el.querySelector('source');
    vids.set(id, s ? (s.getAttribute('src')||'') : '');
  });

  if (!vids.size) { document.getElementById('dynVideos').innerHTML=''; return; }

  let h = secWrap('secVideos', '🎬', "Video's", vids.size+" video's", true);
  for (const [id, src] of vids) {
    const fid = 'vf_' + id.replace(/[.\-]/g,'_');
    h += '<div class="imgf">';
    h += '<div class="imgf-hd"><span class="imgf-name">'+esc(id)+'</span><span class="imgf-id">data-cms-vid="'+esc(id)+'"</span></div>';
    if (src) h += '<div style="font-size:10px;color:var(--m2);margin-bottom:7px">Huidig: '+esc(src.split('/').pop())+'</div>';
    h += '<input type="file" id="'+fid+'" accept="video/*" style="display:none" data-id="'+esc(id)+'" onchange="onVid(this)" />';
    h += '<button class="ubtn" onclick="document.getElementById(\''+fid+'\').click()">📁 Video kiezen</button>';
    h += '</div>';
  }
  h += '</div></div>';
  document.getElementById('dynVideos').innerHTML = h;
}

/* ── SCAN: BUTTONS (data-cms-btn) ───────────────────────────────── */
/* content.buttons[id] = { href, alt: { on, from, to, repeat, href, label:{nl,en,de} } }
   href '' = keep the link from the HTML; alt is the seasonal version.            */
function scanButtons(d) {
  const btns = new Map();
  d.querySelectorAll('[data-cms-btn]').forEach(el => {
    const id = el.getAttribute('data-cms-btn');
    if (!id || btns.has(id) || el.closest('footer')) return; // footer links → Footer & Contact
    const lbl = el.querySelector('[data-i18n]');
    btns.set(id, {
      // data-cms-href holds the original HTML link once the site script has overridden it
      href:  el.getAttribute('data-cms-href') || el.getAttribute('href') || '',
      label: (lbl || el).textContent.trim(),
      key:   lbl ? lbl.getAttribute('data-i18n') : ''
    });
  });

  if (!btns.size) { document.getElementById('dynButtons').innerHTML=''; return; }

  const s = getCms();
  let h = secWrap('secButtons', '🔘', 'Knoppen', btns.size + ' knoppen');
  h += '<div class="fh" style="margin-bottom:10px">Kies waar elke knop naartoe gaat. Met een seizoensversie toont de knop binnen een periode automatisch een andere link en tekst.</div>';
  for (const [id, info] of btns) {
    h += mkBtnCard(id, info, (pending.buttons && pending.buttons[id]) || (s.buttons && s.buttons[id]) || {});
  }
  h += '</div></div>';
  document.getElementById('dynButtons').innerHTML = h;
}

function mkBtnCard(id, info, b) {
  const f = btnFid(id), alt = b.alt || {}, lb = alt.label || {};
  const on = 'onBtn(\''+esc(id)+'\')';
  const defName = PAGE_NAMES[info.href.replace(/^\.\//,'').split(/[?#]/)[0]] || info.href;
  const [stCls, stMsg] = btnStatus(alt);

  let h = '<div class="evc" id="'+f+'_card">';
  h += '<div class="evc-hd"><span class="evc-num">'+esc(info.label || id)+'</span><span class="imgf-id">'+esc(id)+'</span></div>';
  if (info.key) h += '<div class="btc-lbl"><a onclick="focusField(\'i18n\',\''+esc(info.key)+'\')">✏️ Knoptekst bewerken</a></div>';
  h += '<div class="fr"><label class="fl">Gaat naar</label>' + mkHrefSel(f+'_href', b.href||'', 'Standaard — '+defName, on) + '</div>';

  h += '<label class="evc-hide"><input type="checkbox" id="'+f+'_on" '+(alt.on?'checked':'')+' onchange="'+on+'" /> Seizoensversie</label>';
  h += '<div class="btc-alt" id="'+f+'_alt"'+(alt.on?'':' style="display:none"')+'>';
  h += '<div class="fr2">';
  h += '<div class="fr"><label class="fl">Van</label><input type="date" class="fi" id="'+f+'_from" value="'+escA(alt.from)+'" onchange="'+on+'" /></div>';
  h += '<div class="fr"><label class="fl">Tot en met</label><input type="date" class="fi" id="'+f+'_to" value="'+escA(alt.to)+'" onchange="'+on+'" /></div>';
  h += '</div>';
  h += '<label class="evc-hide"><input type="checkbox" id="'+f+'_rep" '+(alt.repeat!==false?'checked':'')+' onchange="'+on+'" /> Elk jaar herhalen (alleen dag en maand tellen)</label>';
  h += '<div class="fh">Laat de datums leeg om de seizoensversie direct en doorlopend te tonen.</div>';
  h += '<div class="fr" style="margin-top:9px"><label class="fl">Gaat naar (seizoen)</label>' + mkHrefSel(f+'_ahref', alt.href||'', 'Zelfde als hierboven', on) + '</div>';
  h += '<div class="fr3">';
  for (const l of ['nl','en','de']) {
    h += '<div class="fr"><label class="fl">Tekst '+l.toUpperCase()+'</label><input type="text" class="fi" id="'+f+'_'+l+'" value="'+escA(lb[l])+'" oninput="'+on+'" /></div>';
  }
  h += '</div>';
  h += '<div class="fh">Leeg = de gewone knoptekst blijft staan in die taal.</div>';
  h += '<div class="btc-st '+stCls+'" id="'+f+'_st">'+esc(stMsg)+'</div>';
  h += '</div></div>';
  return h;
}

/* Page dropdown + free URL field (shown when "Eigen URL…" is picked) */
function mkHrefSel(fid, cur, defLbl, on) {
  const pages  = Object.keys(PAGE_NAMES).map(p => './'+p);
  const custom = cur !== '' && !pages.includes(cur);
  let h = '<select class="fi" id="'+fid+'" onchange="'+on+'"><option value="">'+esc(defLbl)+'</option>';
  for (const p of pages) h += '<option value="'+p+'"'+(cur===p?' selected':'')+'>'+esc(PAGE_NAMES[p.slice(2)])+'</option>';
  h += '<option value="__custom"'+(custom?' selected':'')+'>Eigen URL…</option></select>';
  h += '<input type="text" class="fi" id="'+fid+'_url" value="'+escA(custom?cur:'')+'" placeholder="./evenementen.html#agenda of https://…" style="margin-top:6px'+(custom?'':';display:none')+'" oninput="'+on+'" />';
  return h;
}

/* Read a mkHrefSel pair; also shows/hides its URL field */
function hrefFromSel(fid) {
  const sel = document.getElementById(fid), url = document.getElementById(fid + '_url');
  const custom = sel.value === '__custom';
  url.style.display = custom ? '' : 'none';
  return custom ? url.value.trim() : sel.value;
}

function btnFid(id) { return 'bt_' + id.replace(/[.\-]/g,'_'); }

function btnStatus(alt) {
  if (!alt.on) return ['', ''];
  if (!alt.repeat && alt.from && alt.to && alt.from > alt.to) return ['', '⚠ De einddatum ligt vóór de startdatum.'];
  let active = false;
  try { active = iDoc().defaultView.warmeloCmsSeasonActive(alt); } catch(e) {}
  return active ? ['on', '● Vandaag actief op de website'] : ['', '○ Vandaag niet actief'];
}

function onBtn(id) {
  const f = btnFid(id), v = s => document.getElementById(f + s);
  const b = {
    href: hrefFromSel(f + '_href'),
    alt: {
      on: v('_on').checked, from: v('_from').value, to: v('_to').value, repeat: v('_rep').checked,
      href: hrefFromSel(f + '_ahref'),
      label: { nl: v('_nl').value.trim(), en: v('_en').value.trim(), de: v('_de').value.trim() }
    }
  };
  pending.buttons = pending.buttons||{}; pending.buttons[id] = b;

  v('_alt').style.display = b.alt.on ? '' : 'none';
  const [stCls, stMsg] = btnStatus(b.alt);
  v('_st').className = 'btc-st ' + stCls; v('_st').textContent = stMsg;

  applyButtonsToFrame(iDoc(), { [id]: b });
  markDirty();
}

/* Preview through the page's own warmelo-cms script so admin and site behave identically */
function applyButtonsToFrame(d, buttons) {
  try { d.defaultView.warmeloCmsApply({ buttons }); } catch(e) {}
}

function focusBtnCard(id) {
  focusEditor(document.getElementById(btnFid(id) + '_card'));
}

/* ── SCAN: FOOTER & CONTACT ─────────────────────────────────────── */
/* One section for what every page shares: contact details (content.contact,
   data-cms-contact), footer texts (i18n) and footer links (content.buttons). */
const CONTACT_FIELDS = [
  { k:'name',     lbl:'Naam',                 def:'Kasteel Warmelo',          where:'Menu · Footer' },
  { k:'street',   lbl:'Straat en huisnummer', def:'Stedeke 11',               where:'Footer · Home · Bezoek · Contact' },
  { k:'city',     lbl:'Postcode en plaats',   def:'7478 RV Diepenheim',       where:'Footer · Home · Bezoek · Contact' },
  { k:'entrance', lbl:'Ingang & parkeren',    def:'Borculoseweg, Diepenheim', where:'Home · Bezoek · Contact' },
  { k:'phone',    lbl:'Telefoon',             def:'0547 – 352547',            where:'Footer · Bezoek · Contact' },
  { k:'email',    lbl:'E-mail',               def:'info@kasteelwarmelo.nl',   where:'Footer · Bezoek · Contact' }
];
const FOOTER_LABELS = {
  'footer.desc':'Beschrijving', 'footer.open':'Kop kolom 2', 'footer.visit':'Kop kolom 3',
  'footer.follow':'Kop kolom 4', 'footer.copy.full':'Copyright', 'footer.copy':'Regel onderaan'
};

function scanFooter(d) {
  const foot = d.querySelector('footer');
  const s = getCms(), lang = previewLang();
  const contact = Object.assign({}, s.contact, pending.contact);

  let h = secWrap('secFooter', '📇', 'Footer & Contact', 'alle pagina\'s');
  h += '<div class="fh" style="margin-bottom:10px">Deze gegevens staan op elke pagina. Eén keer aanpassen is genoeg.</div>';

  h += '<div class="fg"><div class="fg-t">Contactgegevens</div>';
  for (const f of CONTACT_FIELDS) {
    h += '<div class="fr"><label class="fl" for="f_ct_'+f.k+'">'+esc(f.lbl)+'</label>';
    h += '<input type="text" class="fi" id="f_ct_'+f.k+'" value="'+escA(contact[f.k] || f.def)+'" oninput="onContact(\''+f.k+'\',this.value)" />';
    h += '<div class="fh">📍 '+esc(f.where)+'</div></div>';
  }
  h += '</div>';

  if (foot) {
    const texts = [...foot.querySelectorAll('[data-i18n]')].filter(el => !el.closest('[data-cms-btn]'));
    h += '<div class="fg"><div class="fg-t">Footerteksten <span style="opacity:.5;font-size:10px;">(taal: '+lang.toUpperCase()+')</span></div>';
    for (const el of texts) {
      const k = el.getAttribute('data-i18n'), pended = getI18nForLang(pending.i18n, lang)[k];
      h += mkTextFld(k, 'i18n', pended != null ? pended : el.innerHTML, FOOTER_LABELS[k] || textLabel(el));
    }
    h += '</div>';

    h += '<div class="fg"><div class="fg-t">Footerlinks</div>';
    foot.querySelectorAll('[data-cms-btn]').forEach(el => {
      const id = el.getAttribute('data-cms-btn'), k = el.getAttribute('data-i18n');
      const b  = (pending.buttons && pending.buttons[id]) || (s.buttons && s.buttons[id]) || {};
      const f  = btnFid(id), on = 'onFooterLink(\''+esc(id)+'\')';
      const defHref = el.getAttribute('data-cms-href') || el.getAttribute('href') || '';
      const defName = PAGE_NAMES[defHref.replace(/^\.\//,'').split(/[?#]/)[0]] || defHref;
      const pended  = getI18nForLang(pending.i18n, lang)[k];
      h += '<div class="evc" id="'+f+'_card">';
      h += mkTextFld(k, 'i18n', pended != null ? pended : el.innerHTML, 'Linktekst');
      h += '<div class="fr"><label class="fl">Gaat naar</label>' + mkHrefSel(f+'_href', b.href||'', 'Standaard — '+defName, on) + '</div>';
      h += '<label class="evc-hide"><input type="checkbox" id="'+f+'_hid" '+(b.hidden?'checked':'')+' onchange="'+on+'" /> Verbergen</label>';
      h += '</div>';
    });
    h += '</div>';
  }
  h += '</div></div>';
  document.getElementById('dynFooter').innerHTML = h;
}

function onContact(k, v) {
  pending.contact = pending.contact||{}; pending.contact[k] = v.trim();
  applyContactToFrame(iDoc(), { [k]: v.trim() });
  markDirty();
}

function applyContactToFrame(d, contact) {
  try { d.defaultView.warmeloCmsApply({ contact }); } catch(e) {}
}

function onFooterLink(id) {
  const f = btnFid(id);
  const b = { href: hrefFromSel(f + '_href'), hidden: document.getElementById(f + '_hid').checked };
  pending.buttons = pending.buttons||{}; pending.buttons[id] = b;
  applyButtonsToFrame(iDoc(), { [id]: b });
  markDirty();
}

/* ── SECTION WRAPPER HELPER ─────────────────────────────────────── */
function secWrap(id, ico, lbl, cnt, open) {
  const o = open ? ' open' : '';
  return '<div class="edsec" id="'+id+'">'+
    '<div class="edsec-hd" onclick="toggleSec(\''+id+'\')">'+
    '<div class="edsec-hl"><span class="edsec-ico">'+ico+'</span>'+
    '<span class="edsec-lbl">'+lbl+'</span>'+
    '<span class="edsec-cnt">'+cnt+'</span></div>'+
    '<span class="edsec-tog'+o+'" id="tog_'+id+'">▾</span></div>'+
    '<div class="edsec-body'+o+'" id="body_'+id+'">';
}

function toggleSec(id) {
  const body = document.getElementById('body_'+id);
  const tog  = document.getElementById('tog_'+id);
  if (!body) return;
  const open = body.classList.contains('open');
  body.classList.toggle('open', !open);
  if (tog) tog.classList.toggle('open', !open);
}
function openSec(id) {
  const body = document.getElementById('body_'+id);
  const tog  = document.getElementById('tog_'+id);
  if (body) body.classList.add('open');
  if (tog) tog.classList.add('open');
}

/* ── BUILD: EVENT CARDS ─────────────────────────────────────────── */
function buildEvCards() {
  const s = getCms();
  let h = '';
  for (let i = 1; i <= N_EVENTS; i++) {
    const ev = (s.events && s.events[i-1]) || {};
    h += '<div class="evc">';
    h += '<div class="evc-hd"><span class="evc-num">Event '+i+'</span>';
    h += '<label class="evc-hide"><input type="checkbox" id="ev'+i+'_hid" '+(ev.hidden?'checked':'')+' onchange="onEv('+i+')" /> Verbergen</label></div>';
    h += '<div class="fr3">';
    h += '<div class="fr"><label class="fl">Dag</label><input type="text" class="fi" id="ev'+i+'_d" value="'+escA(ev.day||'')+'" placeholder="15" oninput="onEv('+i+')" /></div>';
    h += '<div class="fr"><label class="fl">Maand</label><input type="text" class="fi" id="ev'+i+'_m" value="'+escA(ev.month||'')+'" placeholder="JUL" oninput="onEv('+i+')" /></div>';
    h += '<div class="fr"><label class="fl">Tag</label><input type="text" class="fi" id="ev'+i+'_t" value="'+escA(ev.tag||'')+'" placeholder="Muziek" oninput="onEv('+i+')" /></div>';
    h += '</div>';
    h += '<div class="fr"><label class="fl">Titel</label><input type="text" class="fi" id="ev'+i+'_ti" value="'+escA(ev.title||'')+'" oninput="onEv('+i+')" /></div>';
    h += '<div class="fr"><label class="fl">Beschrijving</label><textarea class="fta" id="ev'+i+'_de" rows="2" oninput="onEv('+i+')">'+esc(ev.desc||'')+'</textarea></div>';
    h += '</div>';
  }
  document.getElementById('evCards').innerHTML = h;
}

/* ── BUILD: MENU ────────────────────────────────────────────────── */
/* Defaults as on horeca.html. Names, descriptions and headings are texts
   (content.text, data-cms="menu-…"); prices stay in content.menu.          */
const MENU = [
  { head:'head-1', lbl:'Warme dranken', items: [
    {id:'koffie',        price:'3,10', name:'Koffie'},
    {id:'espresso',      price:'3,10', name:'Espresso'},
    {id:'cappuccino',    price:'3,30', name:'Cappuccino'},
    {id:'thee',          price:'3,00', name:'Thee'},
    {id:'muntthee',      price:'3,90', name:'Verse muntthee'},
    {id:'kannetje',      price:'5,80', name:'Kannetje koffie'},
  ]},
  { head:'head-2', lbl:'Frisdranken', items: [
    {id:'frisdrank',     price:'3,10', name:'Div. soorten frisdrank'},
    {id:'vitaminewater', price:'3,90', name:'Vitaminewater'},
  ]},
  { head:'head-3', lbl:'Alcoholische dranken', items: [
    {id:'wittewijn',     price:'6,50', name:'Witte wijn', desc:'Chardonnay, flesje 250 ml'},
    {id:'rose',          price:'6,50', name:'Rosé',       desc:'Flesje 250 ml'},
    {id:'rodewijn',      price:'6,50', name:'Rode wijn',  desc:'Merlot, flesje 250 ml'},
    {id:'bier',          price:'3,50', name:'Bier'},
    {id:'witbier',       price:'3,50', name:'Witbier'},
    {id:'radler',        price:'3,50', name:'Radler (2.3%)'},
    {id:'bier00',        price:'3,50', name:'Bier 0,0%'},
  ]},
  { head:'head-4', lbl:'Verse broodjes', items: [
    {id:'gezond',        price:'7,80', name:'Broodje Gezond'},
    {id:'brie',          price:'7,80', name:'Broodje Brie'},
    {id:'eiersalade',    price:'7,80', name:'Broodje Eiersalade'},
    {id:'kipkerrie',     price:'7,80', name:'Broodje Kipkerrie'},
    {id:'ham',           price:'7,80', name:'Broodje Ham'},
    {id:'kaas',          price:'7,80', name:'Broodje Kaas'},
  ]},
  { head:'head-5', lbl:'Warme snacks', items: [
    {id:'appelflap',     price:'3,00', name:'Appelflap'},
    {id:'saucijzen',     price:'3,00', name:'Saucijzenbroodje'},
    {id:'kroket',        price:'3,50', name:'Broodje Kroket'},
    {id:'tosti',         price:'3,20', name:"Tosti's diverse soorten"},
    {id:'bitterballen',  price:'5,00', name:'Portie bitterballen (8 st)'},
  ]},
  { head:'head-6', lbl:'Zoet', items: [
    {id:'appelgebak',    price:'3,00', name:'Appelgebak'},
    {id:'luxegebak',     price:'3,40', name:'Luxe gebak', desc:'Diverse soorten'},
    {id:'petitfour',     price:'1,20', name:'Petitfour'},
    {id:'stroopwafel',   price:'1,50', name:'Stroopwafel'},
  ]},
];

function buildMenu() {
  const s = getCms();
  const txt = (k, def) => {
    const p = pending.text && pending.text[k];
    return p != null ? p : ((s.text && s.text[k]) || def);
  };
  const fld = (k, val, ph) => '<input type="text" class="fi" id="fi_cms_'+k.replace(/[.\-]/g,'_')+'" data-fk="'+escA(k)+'" data-ft="cms" data-em=""'
    + ' value="'+escA(toSimple(val))+'" placeholder="'+escA(ph||'')+'" oninput="onTxt(this)" />';
  let h = '<div class="fh" style="margin-bottom:10px">Naam, omschrijving en prijs per gerecht. Klik op de Horeca-pagina in de preview op een gerecht om er direct naartoe te gaan.</div>';
  MENU.forEach(g => {
    h += '<div class="fg"><div class="fg-t">'+esc(g.lbl)+'</div>';
    h += '<div class="fr"><label class="fl">Kop</label>' + fld('menu-'+g.head, txt('menu-'+g.head, g.lbl)) + '</div>';
    g.items.forEach(it => {
      const price = (pending.menu && pending.menu[it.id]) || (s.menu && s.menu[it.id]) || it.price;
      h += '<div class="mn-row">' + fld('menu-'+it.id, txt('menu-'+it.id, it.name));
      h += '<div class="mn-price"><span>€</span><input type="text" class="fi" id="mn_'+it.id+'" value="'+escA(price)+'" placeholder="0,00" oninput="onMenu(\''+it.id+'\',this.value)" /></div></div>';
      if (it.desc) h += '<div class="mn-desc">' + fld('menu-'+it.id+'-desc', txt('menu-'+it.id+'-desc', it.desc), 'Omschrijving') + '</div>';
    });
    h += '</div>';
  });
  document.getElementById('menuItems').innerHTML = h;
}

/* ── LOAD EXISTING GLOBALS ──────────────────────────────────────── */
function loadGlobals() {
  const c = getCms();
  const s = c.season||{}, p = c.prices||{}, l = c.links||{};
  setFld('f_sp', s.period); setFld('f_sh', s.hours);  setFld('f_sc', s.closed);
  setFld('f_sl', s.label);  setFld('f_st', s.text);
  setFld('f_pv', p.volwassene); setFld('f_pk', p.kind); setFld('f_pg', p.gratis);
  setFld('f_lk_facebook', l.facebook); setFld('f_lk_instagram', l.instagram);
  setFld('f_lk_youtube', l.youtube);   setFld('f_lk_tripadvisor', l.tripadvisor);
  setFld('f_lk_maps', l.maps);
  setFld('f_lk_airbnb-orangerie', l['airbnb-orangerie']); setFld('f_lk_airbnb-rentmeester', l['airbnb-rentmeester']);
}
function setFld(id, v) { const el = document.getElementById(id); if (el && v) el.value = v; }

/* ── CHANGE HANDLERS ────────────────────────────────────────────── */
/* Get the active language of the iframe preview */
function previewLang() {
  try { const d = iDoc(); if (d) return d.documentElement.lang || 'nl'; } catch(e){}
  return 'nl';
}

/* Get i18n overrides for a specific language (handles both old flat + new per-lang format) */
function getI18nForLang(src, lang) {
  if (!src) return {};
  // New per-language format: { nl: {...}, en: {...}, de: {...} }
  if (src.nl || src.en || src.de) return src[lang] || {};
  // Old flat format (backwards compat): apply to all languages
  return src;
}

function onTxt(el) {
  const k = el.dataset.fk, t = el.dataset.ft, v = toHtml(el.value, el.dataset.em);
  if (t === 'i18n') {
    const lang = previewLang();
    pending.i18n = pending.i18n||{};
    pending.i18n[lang] = pending.i18n[lang]||{};
    pending.i18n[lang][k] = v;
    applyFrame('[data-i18n="'+k+'"]', v, false);
  } else {
    pending.text = pending.text||{}; pending.text[k] = v;
    applyFrame('[data-cms="'+k+'"]', v, false);
  }
  markDirty();
}

function onGlobal(sec, fld, v) {
  pending[sec] = pending[sec]||{}; pending[sec][fld] = v;
  applyFrame('[data-cms="'+sec+'-'+fld+'"]', v, false);
  markDirty();
}

function onPrice(fld, v) {
  pending.prices = pending.prices||{}; pending.prices[fld] = v;
  const disp = (fld !== 'gratis' && v) ? '€ ' + v : v;
  applyFrame('[data-cms="price-'+fld+'"]', disp, false);
  markDirty();
}

function onLink(id, v) {
  pending.links = pending.links||{}; pending.links[id] = v;
  // Update all matching links in iframe live
  const doc = iDoc(); if (!doc) { markDirty(); return; }
  doc.querySelectorAll('[data-cms-link="'+id+'"]').forEach(el => el.href = v);
  markDirty();
}

function onEv(i) {
  if (!pending.events) {
    const c = getCms();
    pending.events = c.events ? JSON.parse(JSON.stringify(c.events)) : Array.from({length:N_EVENTS},()=>({}));
    while (pending.events.length < N_EVENTS) pending.events.push({});
  }
  const ev = pending.events[i-1] = pending.events[i-1] || {};
  ev.day    = document.getElementById('ev'+i+'_d').value;
  ev.month  = document.getElementById('ev'+i+'_m').value;
  ev.tag    = document.getElementById('ev'+i+'_t').value;
  ev.title  = document.getElementById('ev'+i+'_ti').value;
  ev.desc   = document.getElementById('ev'+i+'_de').value;
  ev.hidden = document.getElementById('ev'+i+'_hid').checked;
  const d = iDoc(); if (!d) { markDirty(); return; }
  const card = d.querySelector('[data-cms-event="'+i+'"]');
  if (card) {
    setIn(card,'.event-card__day',ev.day); setIn(card,'.event-card__month',ev.month);
    setIn(card,'.event-card__tag',ev.tag); setIn(card,'.event-card__title',ev.title);
    setIn(card,'.event-card__desc',ev.desc);
    card.style.display = ev.hidden ? 'none' : '';
  }
  markDirty();
}

function onMenu(id, v) {
  pending.menu = pending.menu||{}; pending.menu[id] = v;
  const d = iDoc(); if (!d) { markDirty(); return; }
  d.querySelectorAll('[data-cms-price="'+id+'"]').forEach(el => el.innerHTML = '€ '+v);
  markDirty();
}

function onImg(input) {
  const file = input.files[0]; if (!file) return;
  const id = input.dataset.id, type = input.dataset.type, prevId = input.dataset.prev;
  const fid = input.id;
  const warn = document.getElementById('swarn_'+fid);
  const mb = (file.size/1024/1024).toFixed(1);
  if (warn) {
    warn.style.display = file.size > 1.5*1024*1024 ? 'block' : 'none';
    if (file.size > 1.5*1024*1024) warn.textContent = '⚠ Groot bestand ('+mb+' MB). Comprimeer voor beter resultaat.';
  }
  const reader = new FileReader();
  reader.onload = e => {
    const dataURL = e.target.result;
    const uk = curPage.replace('.html','') + '_' + type + '_' + id;
    uploads[uk] = dataURL;
    if (type==='img') { pending.images=pending.images||{}; pending.images[id]='warmelo_upload:'+uk; }
    else               { pending.backgrounds=pending.backgrounds||{}; pending.backgrounds[id]='warmelo_upload:'+uk; }
    updatePrevEl(prevId, type, dataURL);
    const d = iDoc(); if (d) {
      if (type==='img') d.querySelectorAll('[data-cms-img="'+id+'"]').forEach(el => { el.src=dataURL; let lb=el.parentElement; while(lb&&lb!==d.body){if(lb.hasAttribute('data-lightbox')){lb.setAttribute('data-lightbox',dataURL);break;}lb=lb.parentElement;} });
      else               d.querySelectorAll('[data-cms-bg="'+id+'"]').forEach(el => el.style.backgroundImage="url('"+dataURL+"')");
    }
    updateStorage(); markDirty();
  };
  reader.readAsDataURL(file);
}

function onVid(input) {
  const file = input.files[0]; if (!file) return;
  const id = input.dataset.id;
  const mb = (file.size/1024/1024).toFixed(1);

  // Videos are too large for localStorage (5 MB limit).
  // Preview via blob URL (session only), then instruct user to deploy the file.
  const blobURL = URL.createObjectURL(file);
  const d = iDoc(); if (d) {
    d.querySelectorAll('[data-cms-vid="'+id+'"]').forEach(el => {
      const s = el.querySelector('source');
      if (s) { s.setAttribute('src', blobURL); el.load(); }
    });
  }

  // Show inline notice instead of storing in localStorage
  const notice = document.createElement('div');
  notice.style.cssText = 'margin-top:10px;padding:12px 16px;background:rgba(191,140,42,.12);border:1px solid rgba(191,140,42,.35);font-size:12px;color:rgba(255,255,255,.8);line-height:1.6;border-radius:2px;';
  notice.innerHTML = '✅ <strong style="color:var(--gold);">Video getoond in preview</strong> — '+mb+' MB<br>'
    + '⚠ Videos zijn te groot voor browseropslag. Sla het bestand op in de projectmap en zet het online via de beheerder.';
  const wrap = input.closest('.fr') || input.parentElement;
  const old = wrap.querySelector('.vid-notice');
  if (old) old.remove();
  notice.className = 'vid-notice';
  wrap.appendChild(notice);
}

function updatePrevEl(prevId, type, dataURL) {
  const el = document.getElementById(prevId); if (!el) return;
  if (type === 'img') {
    if (el.tagName === 'IMG') { el.src = dataURL; }
    else {
      const img = document.createElement('img');
      img.className = 'imgf-prev'; img.id = prevId; img.src = dataURL;
      el.parentNode.replaceChild(img, el);
    }
  } else {
    el.style.backgroundImage = "url('"+dataURL+"')";
    el.className = 'imgf-prev-bg';
  }
}

function resetImg(id, type, prevId) {
  if (!confirm('Originele afbeelding herstellen?\nSla daarna op om dit permanent te maken.')) return;
  // Remove from pending
  if (type==='img') { if(pending.images) delete pending.images[id]; }
  else               { if(pending.backgrounds) delete pending.backgrounds[id]; }
  // Remove from localStorage cache
  const c = getCms();
  if (type==='img' && c.images) { delete c.images[id]; localStorage.setItem(CMS_KEY,JSON.stringify(c)); }
  if (type==='bg' && c.backgrounds) { delete c.backgrounds[id]; localStorage.setItem(CMS_KEY,JSON.stringify(c)); }
  // Mark unsaved so user knows to save to server
  markDirty();
  setSt('● Origineel hersteld — klik Opslaan om dit permanent te maken', 'unsaved');
  reloadFrame();
}

/* ── APPLY PENDING TO FRAME ─────────────────────────────────────── */
function applyPendingToFrame(d) {
  if (pending.i18n) { const lo=getI18nForLang(pending.i18n, previewLang()); for (const [k,v] of Object.entries(lo)) d.querySelectorAll('[data-i18n="'+k+'"]').forEach(el=>el.innerHTML=v); }
  if (pending.contact)     applyContactToFrame(d, pending.contact);
  if (pending.text)        for (const [k,v] of Object.entries(pending.text))        d.querySelectorAll('[data-cms="'+k+'"]').forEach(el=>{ el.innerHTML=v; if(el.hasAttribute('data-count')){ el.setAttribute('data-count',v); el.textContent=v+(el.getAttribute('data-suffix')||''); } });
  if (pending.season)      for (const [k,v] of Object.entries(pending.season))      d.querySelectorAll('[data-cms="season-'+k+'"]').forEach(el=>el.innerHTML=v);
  if (pending.prices)      for (const [k,v] of Object.entries(pending.prices))      { const disp=(k!=='gratis'&&v)?'€ '+v:v; d.querySelectorAll('[data-cms="price-'+k+'"]').forEach(el=>el.innerHTML=disp); }
  if (pending.menu)        for (const [k,v] of Object.entries(pending.menu))        d.querySelectorAll('[data-cms-price="'+k+'"]').forEach(el=>el.innerHTML='€ '+v);
  if (pending.links)       for (const [k,v] of Object.entries(pending.links))       { if(v) d.querySelectorAll('[data-cms-link="'+k+'"]').forEach(el=>el.href=v); }
  if (pending.buttons)     applyButtonsToFrame(d, pending.buttons);
  if (pending.images)      for (const [k,v] of Object.entries(pending.images))      { const s=resolveAny(v); d.querySelectorAll('[data-cms-img="'+k+'"]').forEach(el=>{ el.src=s; let lb=el.parentElement; while(lb&&lb!==d.body){if(lb.hasAttribute('data-lightbox')){lb.setAttribute('data-lightbox',s);break;}lb=lb.parentElement;} }); }
  if (pending.backgrounds) for (const [k,v] of Object.entries(pending.backgrounds)) { const s=resolveAny(v); d.querySelectorAll('[data-cms-bg="'+k+'"]').forEach(el=>el.style.backgroundImage="url('"+s+"')"); }
  if (pending.events && Array.isArray(pending.events)) pending.events.forEach((ev,i) => {
    const card = d.querySelector('[data-cms-event="'+(i+1)+'"]'); if (!card||!ev) return;
    const s = (sel,val) => { const el=card.querySelector(sel); if(el&&val) el.textContent=val; };
    s('.event-card__day',ev.day); s('.event-card__month',ev.month); s('.event-card__tag',ev.tag);
    s('.event-card__title',ev.title); s('.event-card__desc',ev.desc);
    if (ev.hidden !== undefined) card.style.display = ev.hidden ? 'none' : '';
  });
  /* ── imgfit: object-position + CSS custom props for scale ── */
  const allFit = Object.assign({}, (getCms().imgfit||{}), (pending.imgfit||{}));
  Object.entries(allFit).forEach(([id, fit]) => {
    if (!fit) return;
    d.querySelectorAll('[data-cms-img="'+id+'"]').forEach(img => {
      img.style.objectPosition = fit.pos || '';
      if (fit.pos) img.style.setProperty('--cms-origin', fit.pos);
      else         img.style.removeProperty('--cms-origin');
      if (fit.scale && fit.scale > 1.01) img.style.setProperty('--cms-scale', fit.scale);
      else                               img.style.removeProperty('--cms-scale');
      if (fit.height) {
        const c2 = img.closest ? img.closest('.gallery__item, .zoom') : img.parentElement;
        if (c2) c2.style.height = fit.height;
      }
    });
    d.querySelectorAll('[data-cms-bg="'+id+'"]').forEach(el => { if (fit.pos) el.style.backgroundPosition = fit.pos; });
  });
}

function applyFrame(sel, val, useText) {
  const d = iDoc(); if (!d) return;
  d.querySelectorAll(sel).forEach(el => useText ? (el.textContent=val) : (el.innerHTML=val));
}

function setIn(parent, sel, val) {
  if (!val) return; const el = parent.querySelector(sel); if (el) el.textContent = val;
}

/* ── RESOLVE UPLOAD REFS → REAL DATA BEFORE SERVER SAVE ────────── */
/* warmelo_upload:key strings are localStorage-only.                 */
/* Replace them with actual base64 so the server stores real data.   */
function resolveUploadsForServer(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(item => resolveUploadsForServer(item));
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && v.startsWith('warmelo_upload:')) {
      const key = v.replace('warmelo_upload:', '');
      const resolved = uploads[key] || localStorage.getItem(UPL_PFX + key);
      out[k] = resolved || v; // fallback to ref if somehow not found
    } else if (v && typeof v === 'object') {
      out[k] = resolveUploadsForServer(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/* ── SAVE ───────────────────────────────────────────────────────── */
async function saveChanges() {
  const btn = document.getElementById('saveBtn');
  if (btn) btn.disabled = true;
  setSt('Opslaan…', 'saving');

  // Images are already on the server (uploaded immediately when picked).
  // pending.images[id] = "/api/cms-img?id=..." (tiny URL, not base64).
  // Any remaining warmelo_upload: refs (server offline fallback) are resolved here.
  if (pending.videos) delete pending.videos;
  const merged = deepMerge(getCms(), pending);

  // Save text/prices/links/events + image URLs to server
  // resolveUploadsForServer handles any fallback in-memory uploads
  const dataForServer = resolveUploadsForServer(merged);
  const payloadStr    = JSON.stringify({ password: PW, data: dataForServer });
  const payloadMB     = payloadStr.length / 1024 / 1024;

  const pwEl = document.getElementById('payloadWarn');
  if (pwEl) pwEl.style.display = payloadMB > 4 ? 'block' : 'none';

  if (payloadMB > 9) {
    setSt('⚠ Payload te groot (' + payloadMB.toFixed(1) + ' MB). Verklein afbeeldingen.', 'warn');
    if (btn) btn.disabled = false;
    return;
  }

  const t = new Date().toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'});
  try {
    const r = await fetch(CMS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payloadStr
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || 'HTTP ' + r.status);
    }
    // Success: update localStorage cache (no images stored, just small metadata)
    try { localStorage.setItem(CMS_KEY, JSON.stringify(merged)); } catch(e) {}
    // Clean up any leftover upload keys to free space
    try {
      const keys = [];
      for(let i=0;i<localStorage.length;i++) keys.push(localStorage.key(i));
      keys.filter(k=>k.startsWith(UPL_PFX)).forEach(k=>localStorage.removeItem(k));
    } catch(e) {}

    pending = {}; uploads = {}; unsaved = false;
    setSt('✓ Permanent opgeslagen op server om ' + t, 'ok');
    setServerStatus('online', '✓ Server verbonden — laatste opslag om ' + t);
  } catch (e) {
    pending = {}; uploads = {}; unsaved = false;
    setSt('⚠ Lokaal opgeslagen om ' + t + ' (server niet bereikbaar)', 'warn');
    setServerStatus('offline', '⚠ Server niet bereikbaar — wijzigingen alleen lokaal opgeslagen');
  }

  if (btn) btn.disabled = false;
  updateStorage();
  setTimeout(() => { try { document.getElementById('siteFrame').contentWindow.location.reload(); } catch(e){} }, 300);
  setTimeout(() => { loadGlobals(); buildEvCards(); buildMenu(); }, 900);
}

/* ── RESET ──────────────────────────────────────────────────────── */
function confirmReset() {
  if (!confirm('Alle CMS-aanpassingen en uploads wissen?\nDit kan niet ongedaan gemaakt worden.')) return;
  localStorage.removeItem(CMS_KEY);
  const keys=[];
  for(let i=0;i<localStorage.length;i++) keys.push(localStorage.key(i));
  keys.filter(k=>k.startsWith(UPL_PFX)).forEach(k=>localStorage.removeItem(k));
  pending={}; uploads={}; unsaved=false;
  setSt('Alle aanpassingen gewist.','');
  updateStorage(); reloadFrame(); loadGlobals(); buildEvCards(); buildMenu();
}

/* ── EXPORT / IMPORT ────────────────────────────────────────────── */
function doExport() {
  const data = { cms:getCms(), exported:new Date().toISOString(), version:2 };
  const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'warmelo-backup-'+new Date().toISOString().slice(0,10)+'.json';
  a.click(); URL.revokeObjectURL(a.href);
}

function doImport(input) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      localStorage.setItem(CMS_KEY, JSON.stringify(data.cms||data));
      setSt('✓ Back-up geïmporteerd','ok');
      updateStorage(); reloadFrame(); loadGlobals(); buildEvCards(); buildMenu();
    } catch(err) { alert('Ongeldig back-upbestand: '+err.message); }
    input.value='';
  };
  reader.readAsText(file);
}

/* ── STORAGE BAR ────────────────────────────────────────────────── */
function updateStorage() {
  let tot=0;
  for(let i=0;i<localStorage.length;i++){
    const k=localStorage.key(i), v=localStorage.getItem(k)||'';
    tot+=k.length+v.length;
  }
  const kb=Math.round(tot/1024), pct=Math.min(100,(tot/(5*1024*1024))*100);
  document.getElementById('storUsed').textContent=kb+' KB / ~5 MB';
  const fill=document.getElementById('storFill');
  fill.style.width=pct+'%';
  fill.className='sb-fill'+(pct>85?' danger':pct>65?' warn':'');
}

/* ── HELPERS ────────────────────────────────────────────────────── */
function getCms(){ try{return JSON.parse(localStorage.getItem(CMS_KEY))||{};}catch(e){return{};} }
function iDoc(){ try{return document.getElementById('siteFrame').contentDocument;}catch(e){return null;} }

function resolveAny(val) {
  if (!val) return val;
  if (val.startsWith('warmelo_upload:')) {
    const k = val.replace('warmelo_upload:','');
    return uploads[k] || localStorage.getItem(UPL_PFX+k) || val;
  }
  return val;
}

function deepMerge(t, s) {
  const out = Object.assign({},t);
  for (const k of Object.keys(s)) {
    if (Array.isArray(s[k])) out[k]=s[k];
    else if (s[k]&&typeof s[k]==='object') out[k]=deepMerge(t[k]||{},s[k]);
    else out[k]=s[k];
  }
  return out;
}

function markDirty() {
  if (!unsaved) { unsaved=true; setSt('● Niet-opgeslagen wijzigingen','unsaved'); }
}
function setSt(msg,cls) {
  const el=document.getElementById('saveStatus');
  el.textContent=msg; el.className='savest'+(cls?' '+cls:'');
}
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escA(s){ return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;'); }

/* ── BOOT ───────────────────────────────────────────────────────── */
// The preview can finish loading while this file is still downloading, so
// hook its load event here and catch up if it has already fired.
(() => {
  const frame = document.getElementById('siteFrame');
  frame.addEventListener('load', onFrameLoad);
  try {
    const d = frame.contentDocument;
    if (d && d.readyState === 'complete' && d.location.href !== 'about:blank') onFrameLoad();
  } catch(e) {}
})();

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('pwInput').focus();
  // Clean up any video blobs previously stored in localStorage (too large)
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('warmelo_upload_') && k.includes('_vid_')) {
        localStorage.removeItem(k);
      }
    }
  } catch(e) {}
});
