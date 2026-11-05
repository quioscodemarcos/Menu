'use strict';
const DB_URL = 'https://quioscodemarcos-default-rtdb.firebaseio.com/menu_v2.json';
const {normalize, escape: esc, format: money} = MenuCore;
const CACHE_KEY = 'qm-menu-cache-v3', DRAFT_KEY = 'qm-menu-draft-v3';
let menu = normalize(menuInicial), baseline = null, remoteEtag = null;
let adminActivo = false, dirty = false, saving = false, catActiva = 'todo';
let cloudReady = false, searchText = '';
const $ = id => document.getElementById(id);
const clone = value => JSON.parse(JSON.stringify(value));
function storageGet(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function storageSet(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } }
function storageRemove(key) { try { localStorage.removeItem(key); } catch {} }
function status(message, error = false) { $('statusText').textContent = message; $('statusText').classList.toggle('error', error); }
function updateDirty() {
  dirty = true;
  const data = leerMenuDOM(false);
  const stored = storageSet(DRAFT_KEY, {data, baseline, at: new Date().toISOString()});
  $('saveOk').textContent = stored ? 'Borrador en este dispositivo' : 'Cambios sin guardar; descarga un respaldo';
  $('saveOk').classList.add('on');
}
function itemHTML(item, extra = false) {
  return `<div class="item" data-id="${esc(item.id)}">
    <div class="item-info"><div class="item-name"><span class="editable">${esc(item.nombre)}</span><span class="badge-top" ${item.top ? '' : 'hidden'}>★ TOP</span></div><div class="item-desc editable-desc">${esc(item.desc || '')}</div></div>
    <div class="item-price">${extra ? '<span aria-label="adicional">+ </span>' : ''}<span class="editable-price" inputmode="numeric">${esc(item.precio)}</span></div>
    <div class="item-actions"><button class="btn-icon top ${item.top ? 'on' : ''}" aria-label="Destacar producto" aria-pressed="${!!item.top}" onclick="toggleTop(this)">★</button><button class="btn-icon del" aria-label="Eliminar producto" onclick="delItem(this)">✕</button></div></div>`;
}
function subcategoryHTML(sub) {
  const extra = sub.tipo === 'agregados';
  return `<div class="subcategory ${extra ? 'shake-extras' : ''}" data-kind="${extra ? 'agregados' : ''}" data-label="${esc(sub.label || '')}">${sub.label ? `<h3 class="subcat-label">${esc(sub.label)}</h3>` : ''}${extra ? '<p class="subcat-note">El valor de cada agregado se suma al precio base del batido.</p>' : ''}${(sub.items || []).map(item => itemHTML(item, extra)).join('')}<button class="btn-add-item" onclick="addItem(this)">+ Agregar producto${sub.label ? ' a ' + esc(sub.label) : ''}</button></div>`;
}
function renderMenu(data) {
  menu = clone(data);
  if (catActiva !== 'todo' && !data.categorias.some(cat => cat.id === catActiva)) catActiva = 'todo';
  $('catNav').innerHTML = `<button class="cat-btn ${catActiva === 'todo' ? 'active' : ''}" data-cat="todo" onclick="filtrar('todo',this)">Todo</button>` + data.categorias.map(cat => `<button class="cat-btn ${catActiva === cat.id ? 'active' : ''}" data-cat="${esc(cat.id)}" onclick="filtrar(this.dataset.cat,this)">${esc(cat.icon)} ${esc(cat.nombre)}</button>`).join('');
  $('menuMain').innerHTML = data.categorias.map(cat => `<section class="categoria" data-cat="${esc(cat.id)}" data-name="${esc(cat.nombre)}" data-icon="${esc(cat.icon)}"><h2 class="cat-title"><span>${esc(cat.icon)}</span> ${esc(cat.nombre)}</h2>${cat.subcats.map(subcategoryHTML).join('')}</section>`).join('');
  if (adminActivo) activarEdicion();
  applyFilters();
}
function applyFilters() {
  const term = searchText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  let visible = 0;
  document.querySelectorAll('.categoria').forEach(sec => {
    let matches = 0;
    sec.querySelectorAll('.subcategory').forEach(sub => {
      let count = 0;
      sub.querySelectorAll('.item').forEach(item => {
        const text = item.querySelector('.item-info').textContent.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        const show = adminActivo || !term || text.includes(term);
        item.hidden = !show; if (show) count++;
      });
      sub.hidden = !adminActivo && !count; matches += count;
    });
    const show = (catActiva === 'todo' || sec.dataset.cat === catActiva) && (matches > 0 || adminActivo);
    sec.classList.toggle('visible', show); if (show) visible += matches;
  });
  $('emptyState').hidden = visible > 0 || adminActivo;
}
function filtrar(cat, btn) {
  catActiva = cat;
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.toggle('active', b === btn));
  applyFilters();
}
async function request(options = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
  try {
    let url = DB_URL;
    if (options.method === 'PUT' && window.ADMIN_GOOGLE_ENABLED) url += '?auth=' + encodeURIComponent(await FirebaseAdmin.token());
    return await fetch(url, {...options, cache: 'no-store', signal: controller.signal});
  }
  finally { clearTimeout(timer); }
}
async function refresh() {
  if (adminActivo || saving) return;
  try {
    const response = await request({headers: {'X-Firebase-ETag': 'true'}});
    if (!response.ok) throw new Error('No se pudo consultar el menú.');
    const raw = await response.json();
    const data = raw === null ? normalize(menuInicial) : normalize(raw);
    // An administrator may have started editing while the request was pending.
    if (adminActivo || saving) return;
    cloudReady = true; remoteEtag = response.headers.get('etag'); baseline = raw;
    storageSet(CACHE_KEY, data); renderMenu(data);
    status(raw === null ? 'Menú de respaldo · Aún sin publicación en la nube' : 'Menú para clientes · Precios en pesos chilenos');
  } catch {
    status('Sin conexión · Mostrando el último menú disponible', true);
  }
}
function leerMenuDOM(validate = true) {
  const data = {categorias: Array.from(document.querySelectorAll('.categoria')).map(sec => ({id: sec.dataset.cat, nombre: sec.dataset.name, icon: sec.dataset.icon, subcats: Array.from(sec.querySelectorAll('.subcategory')).map(sub => ({...(sub.dataset.kind === 'agregados' ? {tipo:'agregados'} : {}), label: sub.dataset.label || null, items: Array.from(sub.querySelectorAll('.item')).map(el => ({id: el.dataset.id, nombre: el.querySelector('.editable').textContent.trim(), precio: el.querySelector('.editable-price').textContent.trim(), desc: el.querySelector('.editable-desc').textContent.trim(), top: el.querySelector('.btn-icon.top').classList.contains('on')}))}))}))};
  return validate ? normalize(data) : data;
}
async function guardar() {
  if (!adminActivo || saving) return;
  let data;
  try { data = leerMenuDOM(); } catch (error) { alert(error.message); return; }
  if (!cloudReady || !remoteEtag) { alert('Conéctate antes de publicar. Tu borrador sigue disponible; puedes descargarlo.'); return; }
  saving = true; $('saveButton').disabled = true; $('saveButton').textContent = 'Guardando…';
  document.querySelectorAll('[contenteditable]:not([contenteditable="false"])').forEach(el => el.contentEditable = 'false');
  try {
    const response = await request({method: 'PUT', headers: {'Content-Type': 'application/json', 'if-match': remoteEtag, 'X-Firebase-ETag': 'true'}, body: JSON.stringify(data)});
    if (response.status === 412) throw new Error('Otro dispositivo cambió el menú. Descarga tu borrador, sal de edición y vuelve a entrar para revisar esos cambios. No se sobrescribió el menú publicado.');
    if (!response.ok) throw new Error('No se pudo publicar. Revisa la conexión y los permisos de Firebase. Tu borrador se conserva.');
    const saved = normalize(await response.json());
    remoteEtag = response.headers.get('etag'); baseline = clone(saved); dirty = false;
    storageRemove(DRAFT_KEY); storageSet(CACHE_KEY, saved); renderMenu(saved);
    $('saveOk').textContent = '✓ Guardado en la nube'; $('saveOk').classList.add('on');
    status('Cambios publicados · Todos los dispositivos recibirán el menú');
  } catch (error) {
    // A timeout can occur after Firebase accepted the write; keep the draft for reconciliation.
    status('No se confirmó el guardado · Conserva tu borrador', true);
    alert(error.name === 'AbortError' ? 'No se confirmó el guardado a tiempo. Conserva el borrador y revisa el menú antes de repetir.' : error.message);
  } finally { saving = false; $('saveButton').disabled = false; $('saveButton').textContent = 'Guardar'; activarEdicion(); }
}
async function abrirModal() {
  if (window.ADMIN_GOOGLE_ENABLED) {
    try { await FirebaseAdmin.signIn(); activarAdmin(); }
    catch (error) {
      const messages = {
        'auth/popup-closed-by-user':'Se cerró la ventana de Google. Puedes volver a intentarlo.',
        'auth/cancelled-popup-request':'Ya hay una ventana de ingreso abierta. Complétala para continuar.',
        'auth/popup-blocked':'Permite la ventana de ingreso de Google y vuelve a intentarlo.',
        'auth/unauthorized-domain':'El acceso con Google aún no está habilitado para esta dirección.',
        'auth/operation-not-allowed':'El ingreso con Google aún no está disponible.',
        'auth/network-request-failed':'No se pudo conectar con Google. Revisa tu conexión.'
      };
      alert(messages[error.code] || (error.code?.startsWith('auth/') ? 'No se pudo ingresar con Google. Intenta nuevamente.' : error.message) || 'No se pudo ingresar con Google.');
    }
    return;
  }
  $('modalBg').classList.add('on'); $('pwInput').focus();
}
function cerrarModal() { $('modalBg').classList.remove('on'); $('pwInput').value = ''; $('modalErr').textContent = ''; }
function login() {
  if (window.ADMIN_GOOGLE_ENABLED) return;
  if ($('pwInput').value !== 'Quioscodemarcos') { $('modalErr').textContent = 'Clave incorrecta'; $('pwInput').value = ''; return; }
  cerrarModal(); activarAdmin();
}
function activarAdmin() {
  adminActivo = true; searchText = ''; $('searchInput').value = ''; $('searchInput').disabled = true;
  $('adminBar').classList.add('on'); $('adminToggle').hidden = true;
  $('menuMain').classList.add('admin-mode'); document.body.classList.add('admin-on');
  const draft = storageGet(DRAFT_KEY);
  if (draft && confirm('Hay un borrador guardado en este dispositivo. ¿Recuperarlo?')) {
    // Use the original baseline, so stale drafts cannot overwrite a newer publication.
    try {
      const valid = normalize(draft.data);
      if (JSON.stringify(draft.baseline) !== JSON.stringify(baseline)) {
        alert('El menú publicado cambió desde este borrador. Puedes descargarlo, pero para publicarlo debes revisar y volver a aplicar los cambios.');
        cloudReady = false;
      }
      renderMenu(valid); dirty = true;
    } catch { alert('Ese borrador contiene datos incompletos. Descárgalo antes de reemplazarlo.'); }
  }
  activarEdicion(); applyFilters();
}
function activarEdicion() { if (adminActivo && !saving) document.querySelectorAll('.editable,.editable-price,.editable-desc').forEach(el => {el.contentEditable = 'plaintext-only';}); }
function salirAdmin() {
  if (saving) return;
  if (dirty && !confirm('Hay cambios sin publicar. El borrador queda en este dispositivo. ¿Salir?')) return;
  adminActivo = false; dirty = false;
  $('adminBar').classList.remove('on'); $('adminToggle').hidden = false; $('saveOk').classList.remove('on');
  $('searchInput').disabled = false; $('menuMain').classList.remove('admin-mode'); document.body.classList.remove('admin-on');
  renderMenu(baseline || menuInicial); refresh();
  if (window.ADMIN_GOOGLE_ENABLED) FirebaseAdmin.signOut().catch(() => {});
}
function toggleTop(btn) {
  if (!adminActivo || saving) return;
  const on = btn.classList.toggle('on'); btn.setAttribute('aria-pressed', on);
  btn.closest('.item').querySelector('.badge-top').hidden = !on; updateDirty();
}
function delItem(btn) {
  if (!adminActivo || saving) return;
  if (confirm('¿Quitar este producto del borrador?')) { btn.closest('.item').remove(); updateDirty(); }
}
function addItem(btn) {
  if (!adminActivo || saving) return;
  const container = document.createElement('div');
  container.innerHTML = itemHTML({id: crypto.randomUUID(), nombre: 'Nuevo producto', precio: '', top: false}, btn.closest('.subcategory').dataset.kind === 'agregados');
  const item = container.firstElementChild; btn.before(item); activarEdicion(); updateDirty(); item.querySelector('.editable').focus();
}
function descargarRespaldo() {
  const data = adminActivo ? leerMenuDOM(false) : menu;
  const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = 'quiosco-menu-' + new Date().toISOString().slice(0, 10) + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function importarRespaldo(event) {
  const file = event.target.files[0];
  try {
    if (!adminActivo || saving || !file) return;
    if (file.size > 1000000) throw new Error('El archivo es demasiado grande.');
    const data = normalize(JSON.parse(await file.text()));
    if (confirm('¿Cargar este menú como borrador? Se publicará solo cuando presiones Guardar.')) { renderMenu(data); updateDirty(); }
  } catch (error) { alert('No se importó el archivo: ' + error.message); }
  finally { event.target.value = ''; }
}
$('menuMain').addEventListener('input', () => { if (adminActivo && !saving) updateDirty(); });
$('searchInput').addEventListener('input', event => { searchText = event.target.value; applyFilters(); });
$('importFile').addEventListener('change', importarRespaldo);
window.addEventListener('beforeunload', event => { if (dirty || saving) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('online', refresh);
window.addEventListener('keydown', event => { if (event.key === 'Escape') cerrarModal(); });
window.addEventListener('scroll', () => $('backTop').classList.toggle('on', scrollY > 200), {passive: true});
try { const cache = storageGet(CACHE_KEY); if (cache) menu = normalize(cache); } catch {}
renderMenu(menu); refresh();
if (window.ADMIN_GOOGLE_ENABLED) {
  $('adminToggle').disabled = true;
  FirebaseAdmin.load().catch(() => {}).finally(() => { $('adminToggle').disabled = false; });
}
setInterval(() => { if (!document.hidden) refresh(); }, 30000);
