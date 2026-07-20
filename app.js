/**
 * app.js — BillPro v3.0 — Complete Offline Billing Application
 * All screens, state, and business logic — production ready.
 */

import {
  openDB, dbGetAll, dbGet, dbAdd, dbPut, dbDelete,
  getSetting, setSetting, nextBillNumber,
  exportBackup, importBackup, dbClear
} from './db.js';

/* ════════════════════════════════════════════════════
   STATE
   ════════════════════════════════════════════════════ */
const state = {
  cart: [],            // [{item, qty}]
  payMode: 'cash',
  discount: 0,
  editingItem: null,   // item object when editing
  currentBills: [],
  currentItems: [],
  filterCat: 'All',
  billFilterCat: 'All',
  adminPIN: '9999',
  pinStep: 'enter',    // 'enter' | 'confirm'
  pinNewFirst: '',     // For PIN change — first entry
  activeBillId: null,  // For bill detail modal
};

/* ════════════════════════════════════════════════════
   HELPERS
   ════════════════════════════════════════════════════ */
const q = sel => document.querySelector(sel);
const fmt = n => (+n || 0).toFixed(2);
const dateStr = d => d.toISOString().slice(0, 10);
const timeStr = d => d.toTimeString().slice(0, 5);
const esc = s => String(s || '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
);

async function getCurrency() {
  return (await getSetting('currency')) || '₹';
}

async function getAllSettings() {
  const keys = ['shopName', 'phone', 'address', 'footer', 'upiId', 'currency', 'qrCode', 'logo'];
  const result = {};
  for (const k of keys) result[k] = await getSetting(k);
  return result;
}

/* ════════════════════════════════════════════════════
   INIT
   ════════════════════════════════════════════════════ */
async function init() {
  await openDB();
  state.adminPIN = (await getSetting('adminPIN')) || '9999';
  const theme = await getSetting('theme');
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
    q('#darkToggle')?.classList.remove('on');
  }

  // Set admin date
  const dateEl = q('#adminDate');
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString('en-IN', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
  }

  registerServiceWorker();
  showScreen('login');
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  }
}

/* ════════════════════════════════════════════════════
   SCREEN ROUTER
   ════════════════════════════════════════════════════ */
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById('screen-' + name);
  if (target) {
    target.classList.add('active');
    target.scrollTop = 0;
  }
}

/* ════════════════════════════════════════════════════
   TOAST
   ════════════════════════════════════════════════════ */
function toast(msg, type = '') {
  const c = q('#toastContainer');
  if (!c) return;
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 2800);
}

/* ════════════════════════════════════════════════════
   PIN MODAL
   ════════════════════════════════════════════════════ */
let pinBuffer = '';
let pinTarget = ''; // 'admin' | 'change'

function openPinModal(target, title = '🔐 Admin PIN') {
  pinBuffer = '';
  pinTarget = target;
  state.pinStep = 'enter';
  state.pinNewFirst = '';
  q('#pinModalTitle').textContent = title;
  renderPinDots();
  q('#pinModal').classList.add('active');
}

function closePinModal() {
  q('#pinModal').classList.remove('active');
  pinBuffer = '';
  state.pinStep = 'enter';
  state.pinNewFirst = '';
}

function pinPress(val) {
  if (pinBuffer.length >= 4) return;
  pinBuffer += val;
  renderPinDots();
  if (pinBuffer.length === 4) setTimeout(submitPin, 180);
}

function pinDel() {
  pinBuffer = pinBuffer.slice(0, -1);
  renderPinDots();
}

function renderPinDots() {
  document.querySelectorAll('.pin-dot').forEach((d, i) => {
    d.classList.toggle('filled', i < pinBuffer.length);
  });
}

async function submitPin() {
  if (pinTarget === 'admin') {
    if (pinBuffer === state.adminPIN) {
      closePinModal();
      await loadAdminDashboard();
      showScreen('admin');
    } else {
      toast('Wrong PIN ❌', 'error');
      pinBuffer = '';
      renderPinDots();
    }

  } else if (pinTarget === 'change') {
    if (state.pinStep === 'enter') {
      // First entry — ask to confirm
      state.pinNewFirst = pinBuffer;
      pinBuffer = '';
      state.pinStep = 'confirm';
      q('#pinModalTitle').textContent = '🔐 Confirm New PIN';
      renderPinDots();
    } else {
      // Second entry — compare
      if (pinBuffer === state.pinNewFirst) {
        await setSetting('adminPIN', pinBuffer);
        state.adminPIN = pinBuffer;
        closePinModal();
        toast('PIN updated! 🔐', 'success');
      } else {
        toast('PINs don\'t match ❌', 'error');
        pinBuffer = '';
        state.pinStep = 'enter';
        state.pinNewFirst = '';
        q('#pinModalTitle').textContent = '🔐 New PIN';
        renderPinDots();
      }
    }
  }
}

/* ════════════════════════════════════════════════════
   ADMIN DASHBOARD
   ════════════════════════════════════════════════════ */
async function loadAdminDashboard() {
  const [bills, items] = await Promise.all([dbGetAll('bills'), dbGetAll('items')]);
  const currency = await getCurrency();

  const now = new Date();
  const today = dateStr(now);
  const yesterday = dateStr(new Date(now - 864e5));
  const month = today.slice(0, 7);

  const sum = arr => arr.reduce((s, b) => s + (b.grandTotal || 0), 0);

  const todaySale = sum(bills.filter(b => b.date === today));
  const yesterdaySale = sum(bills.filter(b => b.date === yesterday));
  const monthlySale = sum(bills.filter(b => b.date.startsWith(month)));

  // Top item
  const itemMap = {};
  bills.forEach(b => (b.items || []).forEach(i => {
    itemMap[i.name] = (itemMap[i.name] || 0) + (i.qty || 0);
  }));
  const topItem = Object.entries(itemMap).sort((a, b) => b[1] - a[1])[0];

  q('#stat-today').textContent = currency + fmt(todaySale);
  q('#stat-yesterday').textContent = currency + fmt(yesterdaySale);
  q('#stat-month').textContent = currency + fmt(monthlySale);
  q('#stat-top').textContent = topItem ? topItem[0] : '—';
  q('#stat-bills').textContent = bills.length;
  q('#stat-items').textContent = items.length;
}

/* ════════════════════════════════════════════════════
   ITEM MANAGEMENT
   ════════════════════════════════════════════════════ */
async function openItemManager() {
  state.filterCat = 'All';
  q('#itemSearch').value = '';
  await renderItemManager();
  showScreen('items');
}

async function renderItemManager() {
  const items = await dbGetAll('items');
  state.currentItems = items;
  const searchVal = q('#itemSearch').value.toLowerCase();
  const cat = state.filterCat;
  const currency = await getCurrency();

  // Category chips
  const cats = ['All', ...new Set(items.map(i => i.category).filter(Boolean))];
  const chipsEl = q('#itemCatChips');
  chipsEl.innerHTML = cats.map(c =>
    `<div class="chip ${c === cat ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</div>`
  ).join('');
  chipsEl.querySelectorAll('.chip').forEach(ch =>
    ch.addEventListener('click', () => {
      state.filterCat = ch.dataset.cat;
      renderItemManager();
    })
  );

  let filtered = items;
  if (cat !== 'All') filtered = filtered.filter(i => i.category === cat);
  if (searchVal) filtered = filtered.filter(i =>
    (i.name || '').toLowerCase().includes(searchVal) ||
    (i.category || '').toLowerCase().includes(searchVal)
  );

  const grid = q('#itemsGrid');
  if (!filtered.length) {
    grid.innerHTML = `<div class="empty-state"><div class="es-icon">📦</div><p>No items found</p></div>`;
    return;
  }

  grid.innerHTML = filtered.map(item => `
    <div class="item-card" data-id="${item.id}">
      <div class="item-img">
        ${item.image
          ? `<img src="${item.image}" alt="${esc(item.name)}" loading="lazy">`
          : `<span>🛍️</span>`}
      </div>
      <div class="item-info">
        <div class="item-name">${esc(item.name)}</div>
        <div class="item-cat">${esc(item.category || 'General')}</div>
        <div class="item-price">${currency}${fmt(item.price)} / ${esc(item.unit || 'pc')}</div>
        ${item.stock != null ? `<div class="item-stock">Stock: ${item.stock}</div>` : ''}
      </div>
      <div class="item-actions">
        <button class="btn-edit" data-id="${item.id}">✏️ Edit</button>
        <button class="btn-del" data-id="${item.id}">🗑️ Del</button>
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('.btn-edit').forEach(btn =>
    btn.addEventListener('click', e => { e.stopPropagation(); editItem(+btn.dataset.id); })
  );
  grid.querySelectorAll('.btn-del').forEach(btn =>
    btn.addEventListener('click', e => { e.stopPropagation(); deleteItem(+btn.dataset.id); })
  );
}

async function editItem(id) {
  const item = await dbGet('items', id);
  if (!item) return;
  state.editingItem = item;
  populateItemForm(item);
  q('#itemFormTitle').textContent = 'Edit Item';
  showScreen('item-form');
}

async function deleteItem(id) {
  if (!confirm('Delete this item? This cannot be undone.')) return;
  await dbDelete('items', id);
  toast('Item deleted', 'success');
  renderItemManager();
}

function openAddItem() {
  state.editingItem = null;
  clearItemForm();
  q('#itemFormTitle').textContent = 'Add Item';
  showScreen('item-form');
}

function clearItemForm() {
  q('#fItemName').value = '';
  q('#fItemCategory').value = '';
  q('#fItemPrice').value = '';
  q('#fItemUnit').value = 'pc';
  q('#fItemStock').value = '';
  q('#fItemPreview').src = '';
  q('#fItemPreview').style.display = 'none';
  q('#pickPlaceholder').style.display = 'flex';
  q('#capturedImageData').value = '';
}

function populateItemForm(item) {
  q('#fItemName').value = item.name || '';
  q('#fItemCategory').value = item.category || '';
  q('#fItemPrice').value = item.price || '';
  q('#fItemUnit').value = item.unit || 'pc';
  q('#fItemStock').value = item.stock != null ? item.stock : '';
  if (item.image) {
    q('#fItemPreview').src = item.image;
    q('#fItemPreview').style.display = 'block';
    q('#pickPlaceholder').style.display = 'none';
    q('#capturedImageData').value = item.image;
  } else {
    q('#fItemPreview').src = '';
    q('#fItemPreview').style.display = 'none';
    q('#pickPlaceholder').style.display = 'flex';
    q('#capturedImageData').value = '';
  }
}

function handleImageFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    toast('Please select an image file', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = e => compressImage(e.target.result, result => {
    q('#capturedImageData').value = result;
    q('#fItemPreview').src = result;
    q('#fItemPreview').style.display = 'block';
    q('#pickPlaceholder').style.display = 'none';
  });
  reader.readAsDataURL(file);
}

function compressImage(dataUrl, cb) {
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    const maxW = 400;
    const ratio = Math.min(maxW / img.width, maxW / img.height, 1);
    canvas.width = Math.round(img.width * ratio);
    canvas.height = Math.round(img.height * ratio);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    cb(canvas.toDataURL('image/jpeg', 0.72));
  };
  img.onerror = () => cb(dataUrl); // Fallback: use original
  img.src = dataUrl;
}

async function saveItem() {
  const name = q('#fItemName').value.trim();
  const priceStr = q('#fItemPrice').value;
  const price = parseFloat(priceStr);

  if (!name) { toast('Item name is required', 'error'); q('#fItemName').focus(); return; }
  if (!priceStr || isNaN(price) || price < 0) { toast('Enter a valid price', 'error'); q('#fItemPrice').focus(); return; }

  const stockVal = q('#fItemStock').value;
  const data = {
    name,
    category: q('#fItemCategory').value.trim() || 'General',
    price,
    unit: q('#fItemUnit').value || 'pc',
    stock: stockVal !== '' ? parseFloat(stockVal) : null,
    image: q('#capturedImageData').value || null,
    updatedAt: new Date().toISOString(),
  };

  if (state.editingItem) {
    await dbPut('items', { ...state.editingItem, ...data });
    toast('Item updated! ✅', 'success');
  } else {
    await dbAdd('items', data);
    toast('Item added! ✅', 'success');
  }
  state.editingItem = null;
  await renderItemManager();
  showScreen('items');
}

/* ════════════════════════════════════════════════════
   BILLING SCREEN
   ════════════════════════════════════════════════════ */
async function openBilling() {
  state.cart = [];
  state.discount = 0;
  state.payMode = 'cash';
  state.billFilterCat = 'All';
  q('#discountInput').value = '';
  q('#customerName').value = '';
  q('#customerMobile').value = '';
  q('#billNotes').value = '';
  q('#billSearch').value = '';
  q('#cartPanel').classList.remove('open');
  q('#payCash').classList.add('active');
  q('#payUpi').classList.remove('active');
  q('#payCard').classList.remove('active');
  await renderBillingItems();
  renderCart();
  showScreen('billing');
}

async function renderBillingItems() {
  const items = await dbGetAll('items');
  state.currentItems = items;
  const search = q('#billSearch').value.toLowerCase();
  const cat = state.billFilterCat;
  const currency = await getCurrency();

  // Category chips
  const cats = ['All', ...new Set(items.map(i => i.category).filter(Boolean))];
  const chipsEl = q('#billCatChips');
  chipsEl.innerHTML = cats.map(c =>
    `<div class="chip ${c === cat ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</div>`
  ).join('');
  chipsEl.querySelectorAll('.chip').forEach(ch =>
    ch.addEventListener('click', () => {
      state.billFilterCat = ch.dataset.cat;
      renderBillingItems();
    })
  );

  let filtered = items;
  if (cat !== 'All') filtered = filtered.filter(i => i.category === cat);
  if (search) filtered = filtered.filter(i =>
    (i.name || '').toLowerCase().includes(search) ||
    (i.category || '').toLowerCase().includes(search)
  );

  const grid = q('#billingItemsGrid');

  if (!filtered.length) {
    grid.innerHTML = `<div class="empty-state"><div class="es-icon">🛍️</div><p>${items.length ? 'No items match' : 'No items yet — add some first!'}</p></div>`;
    return;
  }

  grid.innerHTML = filtered.map(item => {
    const entry = state.cart.find(c => c.item.id === item.id);
    const qty = entry ? entry.qty : 0;
    return `
      <div class="b-item-card ${qty > 0 ? 'in-cart' : ''}" data-id="${item.id}">
        <div class="b-img" data-id="${item.id}">
          ${item.image
            ? `<img src="${item.image}" alt="${esc(item.name)}" loading="lazy">`
            : `<div class="no-img">🛍️</div>`}
          ${qty > 0 ? `<div class="qty-badge">${qty}</div>` : ''}
        </div>
        <div class="b-info">
          <div class="b-name">${esc(item.name)}</div>
          <div class="b-price">${currency}${fmt(item.price)}</div>
          ${item.stock != null ? `<div class="b-stock">${item.stock > 0 ? `Stock: ${item.stock}` : '<span style="color:var(--red)">Out of stock</span>'}</div>` : ''}
        </div>
        <button class="b-add" data-id="${item.id}">＋</button>
      </div>
    `;
  }).join('');

  // Add to cart on button click
  grid.querySelectorAll('.b-add').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      addToCart(+btn.dataset.id);
    });
  });

  // Tap image to add
  grid.querySelectorAll('.b-img').forEach(imgDiv => {
    let pressTimer;
    imgDiv.addEventListener('click', () => addToCart(+imgDiv.dataset.id));
    imgDiv.addEventListener('touchstart', e => {
      pressTimer = setTimeout(() => {
        removeFromCart(+imgDiv.dataset.id);
        e.preventDefault();
      }, 600);
    }, { passive: true });
    imgDiv.addEventListener('touchend', () => clearTimeout(pressTimer));
    imgDiv.addEventListener('touchmove', () => clearTimeout(pressTimer));
  });
}

function addToCart(id) {
  const item = state.currentItems.find(i => i.id === id);
  if (!item) return;
  const entry = state.cart.find(c => c.item.id === id);
  if (entry) {
    entry.qty++;
  } else {
    state.cart.push({ item, qty: 1 });
    // Auto-open cart panel when first item added
    if (state.cart.length === 1) {
      q('#cartPanel').classList.add('open');
    }
  }
  renderBillingItemsPartial(id);
  renderCart();
}

function removeFromCart(id) {
  const entry = state.cart.find(c => c.item.id === id);
  if (!entry) return;
  if (entry.qty > 1) entry.qty--;
  else state.cart = state.cart.filter(c => c.item.id !== id);
  renderBillingItemsPartial(id);
  renderCart();
}

function changeCartQty(id, delta) {
  const entry = state.cart.find(c => c.item.id === id);
  if (!entry) return;
  entry.qty += delta;
  if (entry.qty <= 0) state.cart = state.cart.filter(c => c.item.id !== id);
  renderBillingItemsPartial(id);
  renderCart();
}

// Partial refresh of a single billing card (performance optimization)
function renderBillingItemsPartial(id) {
  const card = q(`#billingItemsGrid .b-item-card[data-id="${id}"]`);
  if (!card) return;
  const entry = state.cart.find(c => c.item.id === id);
  const qty = entry ? entry.qty : 0;
  card.classList.toggle('in-cart', qty > 0);
  const badgeEl = card.querySelector('.qty-badge');
  if (qty > 0) {
    if (badgeEl) badgeEl.textContent = qty;
    else {
      const badge = document.createElement('div');
      badge.className = 'qty-badge';
      badge.textContent = qty;
      card.querySelector('.b-img').appendChild(badge);
    }
  } else if (badgeEl) {
    badgeEl.remove();
  }
}

async function renderCart() {
  const currency = await getCurrency();
  const itemsEl = q('#cartItems');
  const total = state.cart.reduce((s, c) => s + c.item.price * c.qty, 0);
  const discountRaw = parseFloat(q('#discountInput').value) || 0;
  state.discount = Math.max(0, Math.min(discountRaw, total));
  const grand = Math.max(0, total - state.discount);

  const cartCount = state.cart.reduce((s, c) => s + c.qty, 0);
  q('#cartBadge').textContent = cartCount;
  q('#cartTotal').textContent = currency + fmt(total);
  q('#cartGrand').textContent = currency + fmt(grand);

  const checkoutBtn = q('#checkoutBtn');
  checkoutBtn.disabled = state.cart.length === 0;
  q('#cartToggleHint').textContent = q('#cartPanel').classList.contains('open') ? 'tap to collapse' : 'tap to expand';

  if (!state.cart.length) {
    itemsEl.innerHTML = `<div class="empty-cart"><span>🛒</span><p>Cart is empty</p></div>`;
    return;
  }

  itemsEl.innerHTML = state.cart.map(c => `
    <div class="cart-row" data-id="${c.item.id}">
      <div class="ci-img">
        ${c.item.image ? `<img src="${c.item.image}" alt="">` : '🛍️'}
      </div>
      <div class="ci-info">
        <div class="ci-name">${esc(c.item.name)}</div>
        <div class="ci-price">${currency}${fmt(c.item.price)} / ${esc(c.item.unit || 'pc')}</div>
      </div>
      <div class="ci-ctrl">
        <button class="ci-btn ci-minus" data-id="${c.item.id}">−</button>
        <span class="ci-qty">${c.qty}</span>
        <button class="ci-btn ci-plus" data-id="${c.item.id}">+</button>
      </div>
      <div class="ci-sub">${currency}${fmt(c.item.price * c.qty)}</div>
    </div>
  `).join('');

  itemsEl.querySelectorAll('.ci-plus').forEach(b =>
    b.addEventListener('click', () => changeCartQty(+b.dataset.id, 1)));
  itemsEl.querySelectorAll('.ci-minus').forEach(b =>
    b.addEventListener('click', () => changeCartQty(+b.dataset.id, -1)));
}

/* ── Checkout ── */
async function checkout() {
  if (!state.cart.length) return;
  if (state.payMode === 'upi') {
    await showUpiScreen();
  } else {
    await saveBill();
  }
}

async function showUpiScreen() {
  const settings = await getAllSettings();
  const currency = settings.currency || '₹';
  const total = state.cart.reduce((s, c) => s + c.item.price * c.qty, 0);
  const discount = parseFloat(q('#discountInput').value) || 0;
  const grand = Math.max(0, total - discount);

  q('#upiShopName').textContent = settings.shopName || 'BillPro Shop';
  q('#upiAmount').textContent = currency + fmt(grand);
  q('#upiIdDisplay').textContent = settings.upiId || 'UPI ID not set in Settings';

  const qrImg = q('#upiQrImg');
  const qrPlaceholder = q('#upiQrPlaceholder');
  if (settings.qrCode) {
    qrImg.src = settings.qrCode;
    qrImg.style.display = 'block';
    qrPlaceholder.style.display = 'none';
  } else {
    qrImg.style.display = 'none';
    qrPlaceholder.style.display = 'flex';
  }
  showScreen('upi');
}

async function saveBill() {
  if (!state.cart.length) return;

  const settings = await getAllSettings();
  const currency = settings.currency || '₹';
  const total = state.cart.reduce((s, c) => s + c.item.price * c.qty, 0);
  const discount = parseFloat(q('#discountInput').value) || 0;
  const grand = Math.max(0, total - discount);
  const billNumber = await nextBillNumber();
  const now = new Date();

  const bill = {
    billNumber,
    date: dateStr(now),
    time: timeStr(now),
    customer: q('#customerName').value.trim(),
    mobile: q('#customerMobile').value.trim(),
    notes: q('#billNotes').value.trim(),
    items: state.cart.map(c => ({
      id: c.item.id,
      name: c.item.name,
      price: c.item.price,
      unit: c.item.unit || 'pc',
      qty: c.qty,
      subtotal: +(c.item.price * c.qty).toFixed(2),
    })),
    subtotal: +total.toFixed(2),
    discount: +discount.toFixed(2),
    grandTotal: +grand.toFixed(2),
    payMode: state.payMode,
    shopName: settings.shopName || 'BillPro Shop',
    shopPhone: settings.phone || '',
    shopAddress: settings.address || '',
    footer: settings.footer || 'Thank you! Visit again 🙏',
    currency,
  };

  const savedId = await dbAdd('bills', bill);
  bill.id = savedId;

  toast(`${billNumber} saved! ✅`, 'success');

  // Reset cart
  state.cart = [];
  state.discount = 0;
  q('#discountInput').value = '';
  q('#customerName').value = '';
  q('#customerMobile').value = '';
  q('#billNotes').value = '';
  q('#cartPanel').classList.remove('open');

  await loadAdminDashboard();

  // Show receipt after saving
  showBillReceipt(bill);
}

/* ════════════════════════════════════════════════════
   BILL RECEIPT MODAL
   ════════════════════════════════════════════════════ */
function showBillReceipt(bill) {
  state.activeBillId = bill.id;
  const html = generateReceiptHTML(bill);
  q('#billDetailInner').innerHTML = html;

  q('#billDetailPrintBtn').onclick = () => printBillObj(bill);
  q('#billDetailPdfBtn').onclick = () => downloadPdfFromBill(bill);
  q('#billDetailCloseBtn').onclick = () => {
    q('#billDetailModal').classList.remove('active');
    showScreen('admin');
  };

  q('#billDetailModal').classList.add('active');
}

function generateReceiptHTML(bill) {
  const c = bill.currency || '₹';
  const rows = (bill.items || []).map(i =>
    `<tr>
      <td style="padding:.2rem 0">${esc(i.name)}</td>
      <td style="text-align:center;padding:.2rem .25rem">${i.qty}</td>
      <td style="text-align:right;padding:.2rem 0">${c}${fmt(i.price)}</td>
      <td style="text-align:right;padding:.2rem 0;font-weight:700">${c}${fmt(i.subtotal)}</td>
    </tr>`
  ).join('');

  return `
    <div class="receipt-wrap">
      <div class="r-center r-bold" style="font-size:15px;margin-bottom:.15rem">${esc(bill.shopName || 'BillPro Shop')}</div>
      ${bill.shopPhone ? `<div class="r-center" style="font-size:10px">📞 ${esc(bill.shopPhone)}</div>` : ''}
      ${bill.shopAddress ? `<div class="r-center" style="font-size:9px;color:#555">${esc(bill.shopAddress)}</div>` : ''}
      <div class="r-dashes"></div>
      <div class="r-center" style="font-size:10px">${bill.date} • ${bill.time || ''}</div>
      <div class="r-center r-bold" style="font-size:11px">Bill: ${esc(bill.billNumber)}</div>
      ${bill.customer ? `<div class="r-center" style="font-size:10px">👤 ${esc(bill.customer)}${bill.mobile ? ' · ' + esc(bill.mobile) : ''}</div>` : ''}
      <div class="r-dashes"></div>
      <table style="width:100%;border-collapse:collapse;font-size:10px">
        <tr style="border-bottom:1px dashed #ccc">
          <th style="text-align:left;padding-bottom:.25rem">Item</th>
          <th style="text-align:center">Qty</th>
          <th style="text-align:right">Rate</th>
          <th style="text-align:right">Amt</th>
        </tr>
        ${rows}
      </table>
      <div class="r-dashes"></div>
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <tr><td>Subtotal</td><td style="text-align:right">${c}${fmt(bill.subtotal)}</td></tr>
        ${bill.discount > 0 ? `<tr><td>Discount</td><td style="text-align:right;color:#ef4444">−${c}${fmt(bill.discount)}</td></tr>` : ''}
        <tr class="r-bold" style="font-size:13px;border-top:1px solid #ccc"><td>TOTAL</td><td style="text-align:right">${c}${fmt(bill.grandTotal)}</td></tr>
        <tr style="font-size:10px;color:#555"><td>Payment</td><td style="text-align:right">${bill.payMode === 'upi' ? 'UPI' : bill.payMode === 'card' ? 'Card' : 'Cash'}</td></tr>
      </table>
      ${bill.notes ? `<div class="r-dashes"></div><div style="font-size:9px;color:#555">Note: ${esc(bill.notes)}</div>` : ''}
      <div class="r-dashes"></div>
      <div class="r-center" style="font-size:10px;color:#555">${esc(bill.footer || 'Thank you! Visit again 🙏')}</div>
    </div>
  `;
}

function printBillObj(bill) {
  const html = generateReceiptHTML(bill);
  const win = window.open('', '_blank', 'width=380,height=600');
  if (!win) { toast('Allow popups to print', 'error'); return; }
  win.document.write(`<!DOCTYPE html><html><head><title>${esc(bill.billNumber)}</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:monospace;font-size:12px;color:#000;padding:10px;max-width:320px}
      .receipt-wrap{font-family:monospace;padding:0}
      .r-center{text-align:center}
      .r-dashes{border-top:1px dashed #000;margin:5px 0}
      .r-bold{font-weight:700}
      table{width:100%;border-collapse:collapse}
      td,th{vertical-align:top}
    </style>
  </head><body>${html}<script>window.onload=()=>{window.print();setTimeout(()=>window.close(),1000)}<\/script></body></html>`);
  win.document.close();
}

async function downloadPdfFromBill(bill) {
  if (typeof window.jspdf === 'undefined') {
    toast('PDF library not loaded. Check internet connection.', 'error');
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: [80, 240] });
  const c = bill.currency || '₹';
  let y = 8;

  const line = (txt, align = 'left', bold = false, size = 7) => {
    doc.setFontSize(size);
    doc.setFont('courier', bold ? 'bold' : 'normal');
    const x = align === 'center' ? 40 : 4;
    doc.text(String(txt), x, y, align === 'center' ? { align: 'center' } : {});
    y += size * 0.45 + 1.5;
  };
  const dashes = () => {
    doc.setLineWidth(0.1);
    doc.setDrawColor(180);
    doc.line(4, y, 76, y);
    y += 3;
  };

  line(bill.shopName || 'BillPro Shop', 'center', true, 10);
  if (bill.shopPhone) line('Tel: ' + bill.shopPhone, 'center', false, 7);
  if (bill.shopAddress) line(bill.shopAddress, 'center', false, 6);
  dashes();
  line(`${bill.date}  ${bill.time || ''}`, 'center', false, 7);
  line('Bill: ' + bill.billNumber, 'center', false, 7);
  if (bill.customer) line('Customer: ' + bill.customer, 'center', false, 7);
  dashes();

  (bill.items || []).forEach(i => {
    line(`${i.name}`, 'left', false, 7);
    const sub = `${i.qty} x ${c}${fmt(i.price)} = ${c}${fmt(i.subtotal)}`;
    line('  ' + sub, 'left', false, 7);
  });

  dashes();
  line('Subtotal: ' + c + fmt(bill.subtotal), 'left', false, 7);
  if (bill.discount > 0) line('Discount: -' + c + fmt(bill.discount), 'left', false, 7);
  line('TOTAL: ' + c + fmt(bill.grandTotal), 'left', true, 9);
  line('Payment: ' + (bill.payMode === 'upi' ? 'UPI' : bill.payMode === 'card' ? 'Card' : 'Cash'), 'left', false, 7);
  if (bill.notes) { dashes(); line('Note: ' + bill.notes, 'left', false, 6); }
  dashes();
  line(bill.footer || 'Thank you! Visit again', 'center', false, 7);

  doc.save(bill.billNumber + '.pdf');
}

/* ════════════════════════════════════════════════════
   BILL HISTORY
   ════════════════════════════════════════════════════ */
async function openHistory() {
  state.currentBills = await dbGetAll('bills');
  state.currentBills.sort((a, b) => {
    const aNum = parseInt((a.billNumber || '0').replace(/\D/g, ''), 10);
    const bNum = parseInt((b.billNumber || '0').replace(/\D/g, ''), 10);
    return bNum - aNum;
  });
  q('#historySearch').value = '';
  renderBillList();
  showScreen('history');
}

function renderBillList() {
  const searchVal = q('#historySearch').value.toLowerCase();
  let bills = state.currentBills;

  if (searchVal) {
    bills = bills.filter(b =>
      (b.billNumber || '').toLowerCase().includes(searchVal) ||
      (b.date || '').includes(searchVal) ||
      (b.customer || '').toLowerCase().includes(searchVal) ||
      (b.mobile || '').includes(searchVal) ||
      (b.items || []).some(i => (i.name || '').toLowerCase().includes(searchVal))
    );
  }

  const list = q('#billList');
  if (!bills.length) {
    list.innerHTML = `<div class="empty-state"><div class="es-icon">🧾</div><p>${state.currentBills.length ? 'No bills match' : 'No bills yet'}</p></div>`;
    return;
  }

  list.innerHTML = bills.map(b => {
    const modeLabel = b.payMode === 'upi' ? '📱 UPI' : b.payMode === 'card' ? '💳 Card' : '💵 Cash';
    return `
      <div class="bill-row" data-id="${b.id}">
        <div class="br-mode-badge">${modeLabel}</div>
        <div class="br-top">
          <div>
            <div class="br-num">${esc(b.billNumber)}</div>
            <div class="br-date">${esc(b.date)} ${esc(b.time || '')}</div>
          </div>
          <div class="br-amount">${esc(b.currency || '₹')}${fmt(b.grandTotal)}</div>
        </div>
        ${b.customer ? `<div class="br-customer">👤 ${esc(b.customer)}${b.mobile ? ' · ' + esc(b.mobile) : ''}</div>` : ''}
        <div class="br-items">${(b.items || []).map(i => esc(i.name)).join(', ')}</div>
        <div class="bill-actions-bar">
          <button class="btn-view-bill" data-id="${b.id}">👁 View</button>
          <button class="btn-print-bill" data-id="${b.id}">🖨 Print</button>
          <button class="btn-pdf-bill" data-id="${b.id}">📄 PDF</button>
          <button class="btn-del-bill" data-id="${b.id}">🗑</button>
        </div>
      </div>
    `;
  }).join('');

  // Bind action buttons
  list.querySelectorAll('.btn-view-bill').forEach(btn =>
    btn.addEventListener('click', () => viewBillById(+btn.dataset.id))
  );
  list.querySelectorAll('.btn-print-bill').forEach(btn =>
    btn.addEventListener('click', () => {
      const bill = state.currentBills.find(b => b.id === +btn.dataset.id);
      if (bill) printBillObj(bill);
    })
  );
  list.querySelectorAll('.btn-pdf-bill').forEach(btn =>
    btn.addEventListener('click', () => {
      const bill = state.currentBills.find(b => b.id === +btn.dataset.id);
      if (bill) downloadPdfFromBill(bill);
    })
  );
  list.querySelectorAll('.btn-del-bill').forEach(btn =>
    btn.addEventListener('click', () => deleteBill(+btn.dataset.id))
  );
}

function viewBillById(id) {
  const bill = state.currentBills.find(b => b.id === id);
  if (!bill) return;
  state.activeBillId = id;
  const html = generateReceiptHTML(bill);
  q('#billDetailInner').innerHTML = html;

  q('#billDetailPrintBtn').onclick = () => printBillObj(bill);
  q('#billDetailPdfBtn').onclick = () => downloadPdfFromBill(bill);
  q('#billDetailCloseBtn').onclick = () => q('#billDetailModal').classList.remove('active');

  q('#billDetailModal').classList.add('active');
}

async function deleteBill(id) {
  if (!confirm('Delete this bill? This cannot be undone.')) return;
  await dbDelete('bills', id);
  state.currentBills = state.currentBills.filter(b => b.id !== id);
  toast('Bill deleted', 'success');
  renderBillList();
}

/* ════════════════════════════════════════════════════
   REPORTS
   ════════════════════════════════════════════════════ */
async function openReports() {
  const [bills] = await Promise.all([dbGetAll('bills')]);
  const currency = await getCurrency();
  const now = new Date();
  const today = dateStr(now);
  const yesterday = dateStr(new Date(now - 864e5));
  const weekAgo = dateStr(new Date(now - 7 * 864e5));
  const month = today.slice(0, 7);
  const year = today.slice(0, 4);

  const sum = arr => arr.reduce((s, b) => s + (b.grandTotal || 0), 0);

  const todayB = bills.filter(b => b.date === today);
  const yesterdayB = bills.filter(b => b.date === yesterday);
  const weekB = bills.filter(b => b.date >= weekAgo);
  const monthB = bills.filter(b => b.date.startsWith(month));
  const yearB = bills.filter(b => b.date.startsWith(year));

  // Top selling item
  const itemMap = {};
  bills.forEach(b => (b.items || []).forEach(i => {
    itemMap[i.name] = (itemMap[i.name] || 0) + (i.qty || 0);
  }));
  const topItem = Object.entries(itemMap).sort((a, b) => b[1] - a[1])[0];

  q('#rep-today').textContent = currency + fmt(sum(todayB));
  q('#rep-yesterday').textContent = currency + fmt(sum(yesterdayB));
  q('#rep-week').textContent = currency + fmt(sum(weekB));
  q('#rep-month').textContent = currency + fmt(sum(monthB));
  q('#rep-year').textContent = currency + fmt(sum(yearB));
  q('#rep-total-bills').textContent = bills.length;
  q('#rep-avg').textContent = bills.length
    ? currency + fmt(sum(bills) / bills.length)
    : currency + '0.00';
  q('#rep-top').textContent = topItem ? `${topItem[0]} (${topItem[1]} units)` : 'N/A';

  showScreen('reports');
}

/* ── Excel Export ── */
async function exportExcel(range) {
  if (typeof window.XLSX === 'undefined') {
    toast('XLSX library not loaded — check internet', 'error');
    return;
  }
  const bills = await dbGetAll('bills');
  const now = new Date();
  const today = dateStr(now);
  const month = today.slice(0, 7);
  const year = today.slice(0, 4);

  let filtered = bills;
  let label = 'all';
  if (range === 'daily') { filtered = bills.filter(b => b.date === today); label = today; }
  if (range === 'monthly') { filtered = bills.filter(b => b.date.startsWith(month)); label = month; }
  if (range === 'yearly') { filtered = bills.filter(b => b.date.startsWith(year)); label = year; }

  if (!filtered.length) { toast('No data for this period', 'error'); return; }

  const rows = [];
  filtered.forEach(b => {
    (b.items || []).forEach(i => {
      rows.push({
        'Bill No': b.billNumber,
        'Date': b.date,
        'Time': b.time || '',
        'Customer': b.customer || '',
        'Mobile': b.mobile || '',
        'Item': i.name,
        'Unit': i.unit || 'pc',
        'Qty': i.qty,
        'Rate': i.price,
        'Item Total': i.subtotal,
        'Discount': b.discount || 0,
        'Grand Total': b.grandTotal || 0,
        'Payment': b.payMode === 'upi' ? 'UPI' : b.payMode === 'card' ? 'Card' : 'Cash',
        'Notes': b.notes || '',
      });
    });
  });

  const ws = XLSX.utils.json_to_sheet(rows);

  // Column widths
  ws['!cols'] = [
    { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 18 }, { wch: 14 },
    { wch: 20 }, { wch: 6 }, { wch: 6 }, { wch: 10 }, { wch: 10 },
    { wch: 10 }, { wch: 12 }, { wch: 8 }, { wch: 20 }
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Bills');
  XLSX.writeFile(wb, `BillPro_${range}_${label}.xlsx`);
  toast('Excel exported! ✅', 'success');
}

/* ── PDF Report Export ── */
async function exportPdfReport() {
  if (typeof window.jspdf === 'undefined') {
    toast('PDF library not loaded', 'error');
    return;
  }
  const bills = await dbGetAll('bills');
  const currency = await getCurrency();
  const now = new Date();
  const month = dateStr(now).slice(0, 7);
  const monthBills = bills.filter(b => b.date.startsWith(month));

  if (!monthBills.length) { toast('No bills this month', 'error'); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('BillPro — Monthly Report', 14, 20);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Period: ' + month, 14, 28);
  doc.text('Generated: ' + new Date().toLocaleString(), 14, 34);

  let y = 45;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  const headers = ['Bill No', 'Date', 'Customer', 'Items', 'Discount', 'Total', 'Mode'];
  const colX = [14, 40, 62, 100, 140, 163, 185];
  headers.forEach((h, i) => doc.text(h, colX[i], y));
  y += 2;
  doc.line(14, y, 200, y);
  y += 5;
  doc.setFont('helvetica', 'normal');

  let totalRevenue = 0;
  monthBills.forEach(b => {
    if (y > 270) { doc.addPage(); y = 20; }
    const itemNames = (b.items || []).map(i => i.name).join(', ');
    doc.text(b.billNumber || '', colX[0], y);
    doc.text(b.date || '', colX[1], y);
    doc.text((b.customer || '—').substring(0, 15), colX[2], y);
    doc.text(itemNames.substring(0, 25), colX[3], y);
    doc.text(currency + fmt(b.discount || 0), colX[4], y);
    doc.text(currency + fmt(b.grandTotal), colX[5], y);
    doc.text(b.payMode === 'upi' ? 'UPI' : b.payMode === 'card' ? 'Card' : 'Cash', colX[6], y);
    totalRevenue += b.grandTotal || 0;
    y += 6;
  });

  y += 3;
  doc.line(14, y, 200, y);
  y += 7;
  doc.setFont('helvetica', 'bold');
  doc.text(`Total Bills: ${monthBills.length}`, 14, y);
  doc.text(`Total Revenue: ${currency}${fmt(totalRevenue)}`, 120, y);

  doc.save(`BillPro_Report_${month}.pdf`);
  toast('PDF exported! ✅', 'success');
}

/* ════════════════════════════════════════════════════
   SETTINGS
   ════════════════════════════════════════════════════ */
async function openSettings() {
  const s = await getAllSettings();
  q('#setShopName').value = s.shopName || '';
  q('#setPhone').value = s.phone || '';
  q('#setAddress').value = s.address || '';
  q('#setFooter').value = s.footer || '';
  q('#setUpiId').value = s.upiId || '';
  q('#setCurrency').value = s.currency || '₹';

  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  q('#darkToggle').classList.toggle('on', !isLight);

  if (s.qrCode) {
    q('#qrPreview').src = s.qrCode;
    q('#qrPreview').style.display = 'block';
  } else {
    q('#qrPreview').style.display = 'none';
  }
  showScreen('settings');
}

async function saveSettings() {
  const fields = [
    ['shopName', '#setShopName'],
    ['phone', '#setPhone'],
    ['address', '#setAddress'],
    ['footer', '#setFooter'],
    ['upiId', '#setUpiId'],
    ['currency', '#setCurrency'],
  ];
  for (const [key, sel] of fields) {
    await setSetting(key, document.querySelector(sel).value.trim());
  }
  toast('Settings saved! ✅', 'success');
}

function handleQrFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    toast('Please select an image file', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = async e => {
    // Compress QR image
    compressImage(e.target.result, async result => {
      await setSetting('qrCode', result);
      q('#qrPreview').src = result;
      q('#qrPreview').style.display = 'block';
      toast('QR code saved! ✅', 'success');
    });
  };
  reader.readAsDataURL(file);
}

async function toggleDarkMode() {
  const toggle = q('#darkToggle');
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  if (isLight) {
    document.documentElement.removeAttribute('data-theme');
    await setSetting('theme', 'dark');
    toggle.classList.add('on');
  } else {
    document.documentElement.setAttribute('data-theme', 'light');
    await setSetting('theme', 'light');
    toggle.classList.remove('on');
  }
}

/* ════════════════════════════════════════════════════
   BACKUP & RESTORE
   ════════════════════════════════════════════════════ */
async function backupData() {
  try {
    const json = await exportBackup();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `BillPro_backup_${dateStr(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('Backup downloaded! ✅', 'success');
  } catch (err) {
    toast('Backup failed: ' + err.message, 'error');
  }
}

function restoreData() {
  if (!confirm('Restoring will overwrite all current data. Continue?')) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      await importBackup(text);
      toast('Backup restored! ✅', 'success');
      await loadAdminDashboard();
    } catch (err) {
      toast('Invalid backup file: ' + err.message, 'error');
    }
  };
  input.click();
}

async function clearAllData() {
  if (!confirm('DELETE ALL data?\n\nThis will remove all bills, items, and settings.\n\nThis CANNOT be undone!')) return;
  if (!confirm('Are you absolutely sure? All data will be permanently lost.')) return;
  await dbClear('bills');
  await dbClear('items');
  toast('All data cleared', 'success');
  await loadAdminDashboard();
}

/* ════════════════════════════════════════════════════
   DOM EVENT BINDINGS
   ════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  await init();

  /* ── Login ── */
  q('#cardAdmin').addEventListener('click', () => openPinModal('admin', '🔐 Admin PIN'));
  q('#cardBilling').addEventListener('click', () => openBilling());
  q('#pinModalClose').addEventListener('click', closePinModal);
  document.querySelectorAll('.pin-btn[data-n]').forEach(b =>
    b.addEventListener('click', () => pinPress(b.dataset.n))
  );
  q('#pinDel').addEventListener('click', pinDel);

  // Also close modal on overlay click
  q('#pinModal').addEventListener('click', e => {
    if (e.target === q('#pinModal')) closePinModal();
  });

  /* ── Admin nav ── */
  q('#menuBilling').addEventListener('click', () => openBilling());
  q('#menuItems').addEventListener('click', () => openItemManager());
  q('#menuHistory').addEventListener('click', () => openHistory());
  q('#menuReports').addEventListener('click', () => openReports());
  q('#menuSettings').addEventListener('click', () => openSettings());
  q('#menuBackup').addEventListener('click', () => backupData());
  q('#adminLogout').addEventListener('click', () => showScreen('login'));

  /* ── Item Manager ── */
  q('#itemsBack').addEventListener('click', () => showScreen('admin'));
  q('#fabAddItem').addEventListener('click', openAddItem);
  q('#itemSearch').addEventListener('input', () => renderItemManager());

  /* ── Item Form ── */
  q('#itemFormBack').addEventListener('click', () => {
    if (confirm('Discard changes?')) showScreen('items');
  });
  q('#saveItemBtn').addEventListener('click', saveItem);

  // Image area — click the whole area OR the gallery button
  q('#imgPickerArea').addEventListener('click', () => q('#fileGallery').click());
  q('#openGallery').addEventListener('click', e => { e.stopPropagation(); q('#fileGallery').click(); });
  q('#captureCamera').addEventListener('click', e => { e.stopPropagation(); q('#fileCamera').click(); });
  q('#fileGallery').addEventListener('change', e => { handleImageFile(e.target.files[0]); e.target.value = ''; });
  q('#fileCamera').addEventListener('change', e => { handleImageFile(e.target.files[0]); e.target.value = ''; });

  /* ── Billing ── */
  q('#billingBack').addEventListener('click', () => {
    if (state.cart.length > 0) {
      if (!confirm('Leave billing? Cart will be cleared.')) return;
    }
    showScreen('admin');
  });
  q('#clearCartBtn').addEventListener('click', () => {
    if (!state.cart.length) return;
    if (!confirm('Clear cart?')) return;
    state.cart = [];
    q('#discountInput').value = '';
    q('#cartPanel').classList.remove('open');
    renderBillingItems();
    renderCart();
  });
  q('#billSearch').addEventListener('input', () => renderBillingItems());

  /* ── Cart panel toggle ── */
  q('#cartHeader').addEventListener('click', () => {
    q('#cartPanel').classList.toggle('open');
    q('#cartToggleHint').textContent = q('#cartPanel').classList.contains('open') ? 'tap to collapse' : 'tap to expand';
  });
  q('#discountInput').addEventListener('input', () => renderCart());
  q('#payCash').addEventListener('click', () => {
    state.payMode = 'cash';
    q('#payCash').classList.add('active');
    q('#payUpi').classList.remove('active');
    q('#payCard').classList.remove('active');
  });
  q('#payUpi').addEventListener('click', () => {
    state.payMode = 'upi';
    q('#payUpi').classList.add('active');
    q('#payCash').classList.remove('active');
    q('#payCard').classList.remove('active');
  });
  q('#payCard').addEventListener('click', () => {
    state.payMode = 'card';
    q('#payCard').classList.add('active');
    q('#payCash').classList.remove('active');
    q('#payUpi').classList.remove('active');
  });
  q('#checkoutBtn').addEventListener('click', checkout);

  /* ── UPI screen ── */
  q('#upiPayDone').addEventListener('click', async () => {
    await saveBill();
  });
  q('#upiBack').addEventListener('click', () => showScreen('billing'));

  /* ── Bill Detail Modal ── */
  q('#billDetailModal').addEventListener('click', e => {
    if (e.target === q('#billDetailModal')) q('#billDetailModal').classList.remove('active');
  });
  q('#billDetailCloseBtn').addEventListener('click', () => {
    q('#billDetailModal').classList.remove('active');
  });

  /* ── History ── */
  q('#historyBack').addEventListener('click', () => showScreen('admin'));
  q('#historySearch').addEventListener('input', renderBillList);

  /* ── Reports ── */
  q('#reportsBack').addEventListener('click', () => showScreen('admin'));
  q('#exportDaily').addEventListener('click', () => exportExcel('daily'));
  q('#exportMonthly').addEventListener('click', () => exportExcel('monthly'));
  q('#exportYearly').addEventListener('click', () => exportExcel('yearly'));
  q('#exportPdfReport').addEventListener('click', () => exportPdfReport());

  /* ── Settings ── */
  q('#settingsBack').addEventListener('click', () => showScreen('admin'));
  q('#saveSettingsBtn').addEventListener('click', saveSettings);
  q('#qrFileInput').addEventListener('change', e => { handleQrFile(e.target.files[0]); e.target.value = ''; });
  q('#pickQrBtn').addEventListener('click', () => q('#qrFileInput').click());
  q('#darkToggle').addEventListener('click', toggleDarkMode);
  q('#changePinBtn').addEventListener('click', () => openPinModal('change', '🔐 Enter New PIN'));
  q('#backupBtn').addEventListener('click', backupData);
  q('#restoreBtn').addEventListener('click', restoreData);
  q('#clearAllDataBtn').addEventListener('click', clearAllData);
});
