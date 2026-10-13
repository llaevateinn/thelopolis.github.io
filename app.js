/* ============================================================
   忒洛波利斯 · 故事档案 —— 主逻辑（清理重写版）
   数据保存在 localStorage，键名与旧版一致，旧数据自动迁移。
   ============================================================ */
'use strict';

/* ============ 常量 ============ */
const KEY = 'thelopolis-story-archive-v1';
const SITE_VERSION = '2026-10-14-r6';   // 文件新旧校验：控制台会打印
const KINDS = { god: '神', human: '人类', animal: '动物', other: '其他' };
const kindClass = k => (KINDS[k] ? k : 'other');
const kindLabel = k => KINDS[k] || '其他';
const STORY_COLORS = ['#737755', '#b26d50', '#6b8290', '#a98d58', '#8a6d8f', '#5d8577', '#a05c5c', '#7a7a52'];
const TL_MIN = 0.25, TL_MAX = 2.5, TL_DOT = 0.3;   // 时间线缩放范围 / 纯圆点阈值
const BD_MIN = 0.3, BD_MAX = 1.6, BD_DOT = 0.45;   // 线索板缩放范围 / 纯圆点阈值
const ROW_H = 200;                                  // 时间线展开模式行高
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ============ 数据加载与迁移 ============ */
function loadDB(fetched = null) {
  let d = fetched;
  try { if (!d) d = JSON.parse(localStorage.getItem(KEY)); } catch {}
  if (!d || !Array.isArray(d.stories) || !Array.isArray(d.passages)) {
    d = { stories: [], passages: [], characters: [], clues: [], links: [], hiddenLinks: [], timeRelations: [] };
  }
  d.characters ||= []; d.clues ||= []; d.links ||= []; d.hiddenLinks ||= []; d.timeRelations ||= [];
  d.prefs ||= {};
  // 迁移①：角色分类 主角/配角 → 神/人类/动物/其他
  const kindMap = { major: 'human', supporting: 'other' };
  d.characters.forEach(c => { if (kindMap[c.kind]) c.kind = kindMap[c.kind]; if (!KINDS[c.kind]) c.kind = 'human'; });
  // 迁移②：clip 的 role 同步映射
  d.passages.forEach(p => (p.characters || []).forEach(x => { if (kindMap[x.role]) x.role = kindMap[x.role]; }));
  // 迁移③：字符串 tags → 线索库 clueIds
  d.passages.forEach(p => {
    if (Array.isArray(p.tags)) {
      p.tags.forEach(name => {
        const n = String(name).trim(); if (!n) return;
        let clue = d.clues.find(c => c.name === n);
        if (!clue) { clue = { id: id(), name: n, description: '' }; d.clues.push(clue); }
        (p.clueIds ||= []).includes(clue.id) || p.clueIds.push(clue.id);
      });
      delete p.tags;
    }
    p.clueIds ||= []; p.section ||= 'body'; p.characters ||= [];
  });
  // 迁移④：clip 标题末尾的序号（1/5）→ 数字全角（１/５），斜杠保持半角；竖排显示时数字保持正向直立
  d.passages.forEach(p => {
    if (typeof p.title === 'string') {
      p.title = p.title.replace(/（([0-9０-９]+)[\/／]([0-9０-９]+)）$/, (m, a, b) => `（${fwNum(a)}/${fwNum(b)}）`);
    }
  });
  return d;
}

/* ============ 编辑权限（参观 / 编辑双模式） ============ */
const PASS_HASH = 'ad877d45c9086c38bbb0d310a8bc46f0b414980ead7fef4fdf7c4cb569f78ab7';   // 口令的 SHA-256，明文不落盘
let editUnlocked = false;
let db = null;

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
/* 启动：解锁用户用本地数据；访客拉取仓库里的 archive.json（始终看到最新发布版） */
async function boot() {
  let local = null;
  try { local = JSON.parse(localStorage.getItem(KEY)); } catch {}
  editUnlocked = !!local?.prefs?.unlocked;
  let d = local;
  if (!editUnlocked) {
    try { const r = await fetch('archive.json', { cache: 'no-store' }); if (r.ok) d = await r.json(); } catch {}
  }
  db = loadDB(d);
  activeStoryId = db.stories[0]?.id || null;
  tlZoom = clamp(db.prefs.tlZoom ?? 1, TL_MIN, TL_MAX);
  boardZoom = clamp(db.prefs.boardZoom ?? 1, BD_MIN, BD_MAX);
  bindEvents();
  applyTheme();
  applyFontSize();
  document.body.classList.toggle('side-collapsed', !!db.prefs.sideCollapsed);
  $('#side-toggle .nav-icon').textContent = db.prefs.sideCollapsed ? '▸' : '◂';
  applyEditMode();
  render();
  console.log('忒洛波利斯版本：' + SITE_VERSION);
}
async function tryUnlock() {
  const input = prompt('输入编辑口令：');
  if (input == null) return;
  if (await sha256(input) === PASS_HASH) {
    editUnlocked = true;
    db.prefs.unlocked = true;
    save(); applyEditMode(); renderWriter();
    notify('已进入编辑模式');
  } else notify('口令错误');
}
function lockDown() {
  if (!confirm('退出编辑模式？将恢复为参观模式，并重新加载已发布的版本。')) return;
  if (db?.prefs) { delete db.prefs.unlocked; try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} }
  location.reload();
}
function applyEditMode() {
  document.body.classList.toggle('unlocked', editUnlocked);
  const btn = $('#auth-toggle');
  const shackle = editUnlocked ? 'M5.5 7V5a2.5 2.5 0 0 1 5-.6' : 'M5.5 7V5a2.5 2.5 0 0 1 5 0v2';
  if (btn) btn.innerHTML = `<span class="nav-icon"><svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><rect x="3.5" y="7" width="9" height="6.5" rx="1.2"/><path d="${shackle}"/></svg></span>${editUnlocked ? '退出编辑' : '进入编辑'}`;
}

/* ============ 全局状态 ============ */
let activeView = 'timeline';
let libraryTab = 'stories';
let activeStoryId = null;   // boot() 中依数据赋值
let selectedBoard = [];
let selectedTimeNodes = [];
let tlPeekId = null;           // 未展开状态点击放大的节点
let toastTimer, writerSaveTimer;
let lastWriterEditor = null;
let writerSectionFilter = 'all';   // 码字页：正文/大纲筛选
let tlZoom = 1;              // boot() 中依数据赋值
let tlExpanded = false;
let boardZoom = 1;           // boot() 中依数据赋值
let timeNodeEls = new Map();   // 时间线节点元素缓存（实现展开动画）
let tlRowCount = 1;            // 展开模式当前行数（幽灵行轴线吸附用）
let poolDragId = null;         // 正在从未入线池拖出的 clip id
const expandedCards = new Set();   // 就地展开全文的卡片：'ls:故事' 'lc:库clip' 'tl:索引clip'
let tlIndexSort = 'select';        // 索引排序：select=最新选择在前 / time=按时间
function viewExpandKeys() {
  const prefix = activeView === 'library' ? ['ls:', 'lc:'] : activeView === 'timeline' ? ['tl:'] : null;
  if (!prefix) return [];
  return [...expandedCards].filter(k => prefix.some(p => k.startsWith(p)));
}
function updateCollapseAllBtn() {
  $('#collapse-all-float')?.classList.toggle('hidden', viewExpandKeys().length < 2);
}
/* 展开卡片的悬浮「收起」键：固定于视口右侧、跟随各自卡片，滚到哪都点得到 */
const floatCollapses = new Map();
function updateFloatCollapses() {
  // body.zoom（字号设置）坐标系换算：getBoundingClientRect 与 innerHeight 同为渲染坐标；style.top/left 是布局坐标，渲染时会被 ×zoom，故赋值要 ÷zoom
  const z = parseFloat(document.body.style.zoom) || 1;
  const vh = window.innerHeight, vw = window.innerWidth;
  const items = [];
  if (activeView === 'timeline') {
    $$('#timeline-list .passage-row.expanded').forEach(el => items.push({ key: 'tl:' + el.dataset.pid, el }));
  } else if (activeView === 'library') {
    $$('#library-content .story-card.expanded').forEach(el => items.push({ key: 'ls:' + el.dataset.storyOpen, el }));
    $$('#library-content .library-card.expanded').forEach(el => items.push({ key: 'lc:' + el.dataset.edit, el }));
  }
  [...floatCollapses.keys()].forEach(k => {
    if (!items.some(x => x.key === k)) { floatCollapses.get(k).remove(); floatCollapses.delete(k); }
  });
  items.forEach(({ key, el }, idx) => {
    let btn = floatCollapses.get(key);
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'float-collapse';
      btn.textContent = '收起';
      btn.onclick = () => {
        expandedCards.delete(key);
        renderLibrary(); renderTimelineList(); updateCollapseUI();
      };
      document.body.appendChild(btn);
      floatCollapses.set(key, btn);
    }
    const r = el.getBoundingClientRect();
    if (r.bottom < 60 || r.top > vh) { btn.style.display = 'none'; return; }
    btn.style.display = '';
    // 水平：始终与「全部收起」所在列左对齐（它隐藏时临时量出它应在的位置）
    const allBtn = $('#collapse-all-float');
    const wasHidden = allBtn.classList.contains('hidden');
    if (wasHidden) allBtn.classList.remove('hidden');
    const ar = allBtn.getBoundingClientRect();
    if (wasHidden) allBtn.classList.add('hidden');
    const bw = btn.getBoundingClientRect().width || 60;
    btn.style.left = '';
    btn.style.right = ((vw - ar.left - bw) / z) + 'px';
    // 垂直：卡底可见则跟随卡底，否则停靠视口右下角（多个向上堆叠）
    if (r.bottom <= vh) btn.style.top = (clamp(r.bottom - 44, 64, vh - 44) / z) + 'px';
    else btn.style.top = ((vh - 44 - idx * 40) / z) + 'px';
    // 与「全部收起」冲突时：钉在它正上方
    if (!wasHidden) {
      const br = btn.getBoundingClientRect();
      if (br.right > ar.left - 6 && br.left < ar.right + 6 && br.bottom > ar.top - 6) {
        btn.style.top = ((ar.top - 42) / z) + 'px';
      }
    }
  });
}
function updateCollapseUI() { updateCollapseAllBtn(); updateFloatCollapses(); }
/* 滚动/缩放时逐帧合并：一帧内多次触发只执行一次，避免滚动过程中反复读写布局 */
let floatCollapsesScheduled = false;
function scheduleFloatCollapses() {
  if (floatCollapsesScheduled) return;
  floatCollapsesScheduled = true;
  requestAnimationFrame(() => { floatCollapsesScheduled = false; updateFloatCollapses(); });
}
window.addEventListener('scroll', scheduleFloatCollapses, { passive: true });
window.addEventListener('resize', scheduleFloatCollapses);

/* ============ 基础工具 ============ */
function $(q, r = document) { return r.querySelector(q); }
function $$(q, r = document) { return [...r.querySelectorAll(q)]; }
/* 数字与斜杠转全角：竖排标题中全角字符保持正向直立，不会整段侧躺 */
function fwNum(v) { return String(v).replace(/[0-9]/g, d => String.fromCharCode(0xFF10 + Number(d))); }
function esc(s = '') { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function id() { return crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2); }
function story(sid) { return db.stories.find(s => s.id === sid); }
function clip(pid) { return db.passages.find(p => p.id === pid); }
function charObj(cid) { return db.characters.find(c => c.id === cid); }
function clueObj(cid) { return db.clues.find(c => c.id === cid); }
function charsFor(p) { return (p.characters || []).map(x => { const c = charObj(x.id); return c ? { ...c, role: c.kind } : null; }).filter(Boolean); }   // 身份永远跟随数据库当前值，不用旧快照
function cluesFor(p) { return (p.clueIds || []).map(cid => clueObj(cid)).filter(Boolean); }
function dateSort(a, b) { return (a.date || '').localeCompare(b.date || '', 'zh-CN', { numeric: true, sensitivity: 'base' }); }
function storyColor(sid) { const i = db.stories.findIndex(s => s.id === sid); return STORY_COLORS[(i < 0 ? 0 : i) % STORY_COLORS.length]; }
function emptyHTML(title, sub, icon = '✳') { return `<div class="empty-state"><span class="empty-icon">${icon}</span><strong>${esc(title)}</strong><p>${esc(sub)}</p></div>`; }
function notify(s) { const t = $('#toast'); t.textContent = s; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200); }
function save() {
  if (!editUnlocked) return;   // 参观模式：任何交互都不落盘
  db.prefs = { ...(db.prefs || {}), tlZoom, boardZoom };
  localStorage.setItem(KEY, JSON.stringify(db));
  $('.save-state').innerHTML = '<i></i> 自动保存';
  updateCounts();
}
function updateCounts() {
  $('#story-count').textContent = db.stories.length;
  $('#passage-count').textContent = db.passages.length;
  $('#link-count').textContent = visibleLinks().length;
  $('#clue-count').textContent = db.clues.length;
  $('#tab-passage-count').textContent = db.passages.length;
  $('#tab-story-count').textContent = db.stories.length;
}

/* ============ 筛选 ============ */
function fillFilters() {
  const configs = [['filter-story', 'story', '全部故事'], ['filter-character', 'char', '全部角色'], ['filter-timeline', 'timeline', '全部时间线'], ['filter-clue', 'clue', '全部线索'],
    ['board-story-filter', 'story', '全部故事'], ['board-character-filter', 'char', '全部角色'], ['board-timeline-filter', 'timeline', '全部时间线']];
  configs.forEach(([sel, type, all]) => {
    const el = $('#' + sel), prior = el.value;
    let options = [];
    if (type === 'story') options = db.stories.map(s => [s.id, s.title]);
    if (type === 'char') options = db.characters.map(c => [c.id, c.name]);
    if (type === 'timeline') options = [...new Set(db.passages.map(p => p.timeline).filter(Boolean))].map(t => [t, t]);
    if (type === 'clue') options = db.clues.map(c => [c.id, c.name]);
    el.innerHTML = `<option value="all">${all}</option>` + options.map(([v, n]) => `<option value="${esc(v)}">${esc(n)}</option>`).join('');
    el.value = options.some(([v]) => v === prior) ? prior : 'all';
  });
}
function filteredPassages(prefix = 'filter') {
  let list = [...db.passages];
  const storyF = $('#' + (prefix === 'filter' ? 'filter-story' : 'board-story-filter')).value;
  const charF = $('#' + (prefix === 'filter' ? 'filter-character' : 'board-character-filter')).value;
  const timeF = $('#' + (prefix === 'filter' ? 'filter-timeline' : 'board-timeline-filter')).value;
  const clueF = prefix === 'filter' ? ($('#filter-clue')?.value || 'all') : 'all';
  if (storyF !== 'all') list = list.filter(p => p.storyId === storyF);
  if (charF !== 'all') list = list.filter(p => (p.characters || []).some(c => c.id === charF));
  if (timeF !== 'all') list = list.filter(p => p.timeline === timeF);
  if (clueF !== 'all') list = list.filter(p => (p.clueIds || []).includes(clueF));
  return list;
}
function render() { fillFilters(); updateCounts(); renderTimeline(); renderLibrary(); renderBoard(); }

/* ============ 关联（手动 + 线索自动） ============ */
const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
function autoLinkPairs() {
  const byClue = new Map();
  db.passages.forEach(p => (p.clueIds || []).forEach(cid => {
    if (!byClue.has(cid)) byClue.set(cid, []);
    byClue.get(cid).push(p.id);
  }));
  const set = new Set();
  byClue.forEach(ids => { for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) set.add(pairKey(ids[i], ids[j])); });
  return set;
}
function visibleLinks() {
  const hidden = new Set(db.hiddenLinks);
  const map = new Map();
  autoLinkPairs().forEach(k => { if (!hidden.has(k)) { const [a, b] = k.split('|'); map.set(k, { a, b, auto: true }); } });
  db.links.forEach(l => map.set(pairKey(l.a, l.b), { a: l.a, b: l.b, auto: false }));
  return [...map.values()];
}
function toggleBoardLink(a, b) {
  const key = pairKey(a, b);
  const existing = visibleLinks().find(l => pairKey(l.a, l.b) === key);
  if (existing) {
    db.links = db.links.filter(l => pairKey(l.a, l.b) !== key);
    if (existing.auto && !db.hiddenLinks.includes(key)) db.hiddenLinks.push(key);
    notify('已移除这条关联');
  } else {
    db.links.push({ a, b });
    db.hiddenLinks = db.hiddenLinks.filter(k => k !== key);
    notify('已建立 clips 关联');
  }
  selectedBoard = [];
  save(); renderBoard();
}

/* ============ 时间线 ============ */
function lockedTimeGroup(start) {
  const found = new Set([start]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of db.timeRelations) {
      if (!r.locked) continue;
      if (found.has(r.a) && !found.has(r.b)) { found.add(r.b); changed = true; }
      if (found.has(r.b) && !found.has(r.a)) { found.add(r.a); changed = true; }
    }
  }
  return found;
}
function selectTimelineNode(pid) {
  if (selectedTimeNodes.includes(pid)) selectedTimeNodes = selectedTimeNodes.filter(x => x !== pid);
  else selectedTimeNodes.push(pid);
  renderTimeline();
}
function highlightRow(pid, on) {
  const row = $(`#timeline-list .passage-row[data-pid="${CSS.escape(pid)}"]`);
  if (row) row.classList.toggle('hl', on);
}
function highlightNode(pid, on) {
  timeNodeEls.get(pid)?.classList.toggle('hl', on);
}

/* --- 节点元素（缓存复用，展开时做位移动画） --- */
function ensureTimeNode(p) {
  let el = timeNodeEls.get(p.id);
  if (el) return el;
  el = document.createElement('button');
  el.type = 'button';
  el.className = 'time-node';
  el.dataset.pid = p.id;
  el.innerHTML = '<span class="node-dot"></span><span class="node-card"><b></b><small></small><em class="node-excerpt"></em></span>';
  attachTimeNodeHandlers(el);
  timeNodeEls.set(p.id, el);
  return el;
}
function attachTimeNodeHandlers(el) {
  const pidOf = () => el.dataset.pid;
  el.addEventListener('mouseenter', () => highlightRow(pidOf(), true));
  el.addEventListener('mouseleave', () => highlightRow(pidOf(), false));
  el.addEventListener('dblclick', () => openPassage(pidOf()));
  let drag = null;
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const p = clip(pidOf()); if (!p) return;
    const group = lockedTimeGroup(p.id); group.delete(p.id);
    drag = {
      startX: e.clientX, startY: e.clientY,
      startPos: Number.isFinite(p.position) ? p.position : 0,
      startLeft: parseFloat(el.style.left) || 0,
      startTop: parseFloat(el.style.top) || 0,
      others: [...group].map(oid => {
        const oel = timeNodeEls.get(oid);
        return [oid, clip(oid)?.position, oel ? parseFloat(oel.style.left) || 0 : 0, oel ? parseFloat(oel.style.top) || 0 : 0];
      }).filter(x => Number.isFinite(x[1])),
      moved: false, curPos: 0, dx: 0
    };
    el.setPointerCapture(e.pointerId);
    $('#timeline-track').classList.add('tl-dragging');   // 拖拽期间全体节点关闭过渡，杜绝延迟拖影
  });
  el.addEventListener('pointermove', e => {
    if (!drag || !el.hasPointerCapture(e.pointerId)) return;
    if (!editUnlocked) return;   // 参观模式：禁止拖动，但保留点击选中/放大
    const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) > 3) { drag.moved = true; el.classList.add('dragging'); }
    if (!drag.moved) return;
    if (tlExpanded) {
      // 展开模式：在整个二维平面内自由移动（无过渡，实时跟随）
      el.style.left = (drag.startLeft + dx) + 'px';
      el.style.top = (drag.startTop + dy) + 'px';
      showGhost(parseFloat(el.style.top) || 0, parseFloat(el.style.left) || 0);
      drag.curPos = drag.startPos;   // 落点由 expandedDropPosition 计算
      drag.others.forEach(([oid, , left, top]) => {
        const oel = timeNodeEls.get(oid);
        if (oel) { oel.style.left = (left + dx) + 'px'; oel.style.top = (top + dy) + 'px'; }
      });
      return;
    }
    const z = tlZoom;
    drag.curPos = Math.max(0, drag.startPos + dx / z);
    drag.dx = drag.curPos - drag.startPos;
    el.style.left = (drag.startLeft + dx) + 'px';
    drag.others.forEach(([oid, , left]) => {
      const oel = timeNodeEls.get(oid);
      if (oel) oel.style.left = (left + dx) + 'px';
    });
  });
  el.addEventListener('pointerup', e => {
    if (!drag) return;
    const d = drag; drag = null;
    el.classList.remove('dragging');
    $('#timeline-track').classList.remove('tl-dragging');
    hideGhost();
    if (!d.moved) {
      const pid = pidOf();
      tlPeekId = tlPeekId === pid ? null : pid;   // 未展开状态：点击卡片放大显示内容预览
      selectTimelineNode(pid);
      return;
    }
    const p = clip(pidOf()); if (!p) return;
    if (tlExpanded) {
      // 展开模式：只移动被拖节点及锁定组，纵向吸附最近行轴线；其余节点坐标保持不变
      const scrollEl = $('#timeline-scroll');
      const rowW = Math.max(420, scrollEl.clientWidth - 120);
      const maxLeft = Math.max(420, scrollEl.clientWidth - 40);
      const dropLeft = clamp(parseFloat(el.style.left) || 0, 40, maxLeft);
      const dropTop = parseFloat(el.style.top) || 0;
      const groupIds = new Set([p.id, ...d.others.map(o => o[0])]);
      const drop = expandedDropPosition(groupIds, dropLeft, dropTop, rowW);
      const dRow = drop.row - Math.round((d.startTop - 120) / ROW_H);
      const dX = dropLeft - d.startLeft;
      const delta = drop.position - d.startPos;
      p.position = drop.position;
      p.exp = { x: dropLeft, row: drop.row };
      d.others.forEach(([oid, pos, left, top]) => {
        const o = clip(oid); if (!o) return;
        o.position = Math.max(0, pos + delta);
        o.exp = { x: clamp(left + dX, 40, maxLeft), row: Math.max(0, Math.round((top - 120) / ROW_H) + dRow) };
      });
      save(); renderTimeline();                  // 松手后带吸附动画滑入槽位
      return;
    }
    const scrollRect = $('#timeline-scroll').getBoundingClientRect();
    if (e.clientY > scrollRect.bottom - 6) {
      p.position = null;                        // 向下拖出轨道 → 移出时间线
      p.exp = null;                             // 展开模式的固化坐标一并失效
      notify('clip 已移出时间线');
    } else {
      p.position = d.curPos;
      d.others.forEach(([oid, pos]) => { const o = clip(oid); if (o) o.position = Math.max(0, pos + d.dx); });
    }
    save(); renderTimeline();
  });
  el.addEventListener('pointercancel', () => {
    drag = null;
    el.classList.remove('dragging');
    $('#timeline-track').classList.remove('tl-dragging');
    hideGhost();
  });
}

/* --- 蛇形展开布局：文字换行式游标推进，距离严格保留，超界折行并从对侧继续 --- */
function serpentineCoords(list, rowW) {
  const coords = new Map();
  if (!list.length) return { coords, rowCount: 0 };
  const scale = tlExpanded ? tlZoom : 1;
  const left = 100, right = 40 + rowW - 100;   // 两侧各留 100px，保证卡片完整显示在浏览器内
  let row = 0, dir = 1, prevX = left, prevPos = list[0].position;
  list.forEach((p, i) => {
    let x;
    if (i === 0) {
      x = left;
    } else {
      x = prevX + dir * (p.position - prevPos) * scale;
      if (dir === 1 && x > right) { row++; dir = -1; x = right - (x - right); }   // 右溢 → 折行，从右端回退溢出量
      else if (dir === -1 && x < left) { row++; dir = 1; x = left + (left - x); } // 左溢 → 折行，从左端前进溢出量
      x = clamp(x, left, right);
    }
    coords.set(p.id, { x, y: row * ROW_H + 120, row });
    prevX = x; prevPos = p.position;
  });
  return { coords, rowCount: row + 1, scale };
}

/* --- 展开模式坐标：已手动摆放的节点用固化坐标（拖拽只动被拖节点与锁定组，其余不变）；未摆放的回落到蛇形自动布局 --- */
function expandedCoords(placed, rowW) {
  const s = serpentineCoords(placed, rowW);
  const coords = new Map();
  let maxRow = s.rowCount - 1;
  placed.forEach(p => {
    if (p.exp && Number.isFinite(p.exp.x) && Number.isFinite(p.exp.row)) {
      const row = Math.max(0, Math.round(p.exp.row));
      coords.set(p.id, { x: p.exp.x, y: row * ROW_H + 120, row });
      maxRow = Math.max(maxRow, row);
    } else {
      const c = s.coords.get(p.id);
      coords.set(p.id, c);
      maxRow = Math.max(maxRow, c.row);
    }
  });
  return { coords, rowCount: maxRow + 1 };
}

/* --- 幽灵行轴线 + 落点预览（展开模式拖拽时提示吸附目标） --- */
function ghostLine() {
  const track = $('#timeline-track');
  let ghost = track.querySelector('.ghost-rowline');
  if (!ghost) { ghost = document.createElement('div'); ghost.className = 'ghost-rowline'; track.appendChild(ghost); }
  let slot = track.querySelector('.ghost-slot');
  if (!slot) { slot = document.createElement('div'); slot.className = 'ghost-slot'; track.appendChild(slot); }
  return { ghost, slot };
}
function showGhost(top, left = null) {
  const { ghost, slot } = ghostLine();
  const rRaw = Math.round((top - 120) / ROW_H);
  const r = clamp(rRaw, 0, tlRowCount);
  ghost.style.top = (r * ROW_H + 120) + 'px';
  ghost.classList.toggle('new-row', rRaw >= tlRowCount);   // 末行之下：提示将排到时间线末尾
  ghost.classList.add('on');
  if (left !== null) {
    slot.style.left = clamp(left, 40, ($('#timeline-scroll').clientWidth - 40)) + 'px';
    slot.style.top = (r * ROW_H + 120) + 'px';
    slot.classList.add('on');
  }
}
function hideGhost() {
  const track = $('#timeline-track');
  track.querySelector('.ghost-rowline')?.classList.remove('on');
  track.querySelector('.ghost-slot')?.classList.remove('on');
}

/* --- 未入线拖入预览：跟随落点的半透明卡片 + 时间轴落点刻度 --- */
function poolGhostEls() {
  const track = $('#timeline-track');
  let g = track.querySelector('.pool-drop-preview');
  if (!g) { g = document.createElement('div'); g.className = 'pool-drop-preview'; track.appendChild(g); }
  let m = track.querySelector('.pool-drop-marker');
  if (!m) { m = document.createElement('div'); m.className = 'pool-drop-marker'; track.appendChild(m); }
  return { g, m };
}
function showPoolGhost(p, x, y) {
  const { g, m } = poolGhostEls();
  g.innerHTML = `<i style="background:${storyColor(p.storyId)}"></i><span><b>${esc(p.title || '未命名 clip')}</b><small>${esc(p.date || '时间待补')} · ${esc(story(p.storyId)?.title || '未归档')}</small></span>`;
  g.style.left = x + 'px';
  g.style.top = (y - 16) + 'px';
  m.style.left = x + 'px';
  m.style.top = y + 'px';
  g.classList.add('on'); m.classList.add('on');
}
function hidePoolGhost() {
  const track = $('#timeline-track');
  track.querySelector('.pool-drop-preview')?.classList.remove('on');
  track.querySelector('.pool-drop-marker')?.classList.remove('on');
  hideGhost();
}

/* --- 展开模式落点：纵向吸附最近的行轴线；横向按落点在两邻居间线性插值为时间位置（邻居取当前实际坐标，排除拖动组） --- */
function expandedDropPosition(excludeIds, dropLeft, dropTop, rowW) {
  const placed = filteredPassages().filter(p => Number.isFinite(p.position)).sort((a, b) => a.position - b.position);
  const { coords, rowCount } = expandedCoords(placed, rowW);
  const tail = () => Math.max(0, (placed.length ? Math.max(...placed.map(p => p.position)) : 0) + 160);
  const rRaw = Math.round((dropTop - 120) / ROW_H);
  if (rRaw >= rowCount) return { position: tail(), row: rowCount };   // 末行之下 → 排到时间线最后（新行）
  const r = clamp(rRaw, 0, rowCount - 1);
  const rowY = r * ROW_H + 120;
  const rowClips = placed
    .filter(p => !excludeIds.has(p.id) && Math.abs(coords.get(p.id).y - rowY) < 1)
    .sort((a, b) => coords.get(a.id).x - coords.get(b.id).x);
  if (!rowClips.length) return { position: tail(), row: r };
  const xs = rowClips.map(p => coords.get(p.id).x);
  const ps = rowClips.map(p => p.position);
  // 找落点两侧（按行内 x 排序）的邻居，线性插值；越界则用最近一对外推
  let i = xs.findIndex(x => x > dropLeft);
  if (i === -1) i = xs.length - 1;
  const i0 = Math.max(0, i - 1), i1 = Math.min(xs.length - 1, i);
  let pos;
  if (xs[i1] === xs[i0]) pos = ps[i0];
  else pos = ps[i0] + (dropLeft - xs[i0]) * (ps[i1] - ps[i0]) / (xs[i1] - xs[i0]);
  pos = Math.round(pos);
  // 不与邻居完全重合：向落点一侧错开 1 个单位
  if (rowClips.some(p => p.position === pos)) {
    const side = i1 < xs.length - 1 ? 1 : -1;
    pos = Math.max(0, pos + side);
    if (rowClips.some(p => p.position === pos)) pos = Math.max(0, pos - 2 * side);
  }
  return { position: pos, row: r };
}

/* --- 时间线渲染 --- */
function renderTimeline() {
  const all = filteredPassages();
  const placed = all.filter(p => Number.isFinite(p.position)).sort((a, b) => a.position - b.position);
  const unplaced = all.filter(p => !Number.isFinite(p.position));
  const track = $('#timeline-track');
  const scroll = $('#timeline-scroll');
  renderPool(unplaced);
  $('#timeline-result').textContent = `显示 ${placed.length} 个 clips` + (unplaced.length ? `，${unplaced.length} 个未入线` : '');
  $('#timeline-range').textContent = placed.length ? (placed[0].date || '未标时间') + ' — ' + (placed.at(-1).date || '未标时间') : 'NO ENTRIES YET';
  $('#tl-zoom').textContent = Math.round(tlZoom * 100) + '%';
  $('#timeline-expand').textContent = tlExpanded ? '收起' : '展开';
  track.classList.toggle('expanded', tlExpanded);
  scroll.style.overflowY = tlExpanded ? 'auto' : 'hidden';
  scroll.style.maxHeight = '';
  scroll.style.height = '';

  if (!placed.length) {
    timeNodeEls.clear();
    track.style.width = '100%'; track.style.height = '100%';
    track.innerHTML = '<div class="time-axis"></div><div class="timeline-empty">还没有符合条件的 clips</div>';
    $('#timeline-list').innerHTML = emptyHTML('时间线上还没有 clips', '在码字页添加一个分节，然后从未入线区域拖入时间线。', '＋');
    $('#interval-panel').classList.add('hidden');
    return;
  }

  const z = tlExpanded ? 1 : tlZoom;
  let coords = new Map(), rowCount = 1, rowW = 0;
  if (tlExpanded) {
    rowW = Math.max(420, scroll.clientWidth - 120);
    const s = expandedCoords(placed, rowW);
    coords = s.coords; rowCount = s.rowCount;
    // 首次进入展开模式：把自动布局结果固化为各节点坐标，之后拖拽只动被拖节点与锁定组
    let dirty = false;
    placed.forEach(p => { if (!p.exp) { const c = coords.get(p.id); p.exp = { x: c.x, row: c.row }; dirty = true; } });
    if (dirty) save();
  } else {
    const midY = (scroll.clientHeight || 230) / 2;   // 视图隐藏时 clientHeight 为 0，用 CSS 高度兜底
    placed.forEach(p => coords.set(p.id, { x: 40 + p.position * z, y: midY }));
  }
  tlRowCount = rowCount;

  // 背景层（轴线 / 刻度 / 蛇形行线）
  let back = track.querySelector('.tl-backdrop');
  if (!back) { back = document.createElement('div'); back.className = 'tl-backdrop'; track.prepend(back); }
  let backHTML = '';
  if (tlExpanded) {
    for (let r = 0; r < rowCount; r++) backHTML += `<div class="time-rowline" style="top:${r * ROW_H + 120}px"></div>`;
  } else {
    backHTML += '<div class="time-axis"></div>';
    const ticks = Math.min(6, placed.length);
    for (let i = 0; i < ticks; i++) {
      const ix = Math.round(i * (placed.length - 1) / Math.max(1, ticks - 1));
      backHTML += `<div class="time-tick" style="left:${coords.get(placed[ix].id).x}px" data-date="${esc(placed[ix].date || '未标时间')}"></div>`;
    }
  }
  back.innerHTML = backHTML;

  // 节点（复用元素 → 展开/收起时产生位移动画）
  const alive = new Set(placed.map(p => p.id));
  [...timeNodeEls.keys()].forEach(pid => { if (!alive.has(pid)) { timeNodeEls.get(pid).remove(); timeNodeEls.delete(pid); } });
  const dotOnly = !tlExpanded && z <= TL_DOT;
  placed.forEach((p, i) => {
    const el = ensureTimeNode(p);
    const c = coords.get(p.id);
    el.style.left = c.x + 'px';
    el.style.top = c.y + 'px';
    el.className = 'time-node ' + (tlExpanded ? 'above' : (i % 2 === 0 ? 'above' : 'below'))
      + (selectedTimeNodes.includes(p.id) ? ' selected' : '') + (dotOnly ? ' dot-only' : '')
      + (tlPeekId === p.id ? ' peek' : '');
    el.title = p.title;
    el.querySelector('.node-dot').style.background = storyColor(p.storyId);
    // 带序号的标题拆成「标题列 + 序号列」（无论长短），竖卡中序号独立成一列、不再随标题折行
    const bEl = el.querySelector('.node-card b');
    const tm = /^(.+)（([0-9０-９]+[\/／][0-9０-９]+)）$/.exec(p.title || '');
    if (tm) {
      bEl.innerHTML = `<span class="t-full">${esc(tm[1])}</span><span class="t-short">${esc(tm[1])}</span><span class="t-num">（${esc(tm[2])}）</span>`;
    } else bEl.textContent = p.title;
    el.querySelector('.node-card small').textContent = (p.date || '时间待补') + ' · ' + (story(p.storyId)?.title || '未归档');
    el.querySelector('.node-excerpt').textContent = (p.body || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    track.appendChild(el);
  });

  const maxX = Math.max(...placed.map(p => coords.get(p.id).x));
  track.style.width = tlExpanded ? '100%' : Math.max(700, maxX + 120) + 'px';
  track.style.height = tlExpanded ? (rowCount * ROW_H + 60) + 'px' : '100%';
  scroll.style.height = tlExpanded ? (rowCount * ROW_H + 70) + 'px' : '';

  // 索引列表：时间轴上有选中节点时只显示选中项；否则显示前 10 条
  renderTimelineList();
  updateIntervalPanel();
}

/* --- 未入线区域 --- */
function renderPool(unplaced) {
  const pool = $('#timeline-pool'), chips = $('#pool-chips');
  pool.classList.toggle('hidden', unplaced.length === 0);
  pool.classList.toggle('floating', tlExpanded);   // 展开模式：未入线池悬浮在右上角，可直接拖入
  chips.innerHTML = unplaced.map(p =>
    `<span class="pool-chip" draggable="true" data-pool="${esc(p.id)}" title="${esc(p.title)}"><i style="background:${storyColor(p.storyId)}"></i>${esc(p.title)}</span>`
  ).join('');
  $$('.pool-chip', chips).forEach(chip => {
    chip.addEventListener('dragstart', e => { poolDragId = chip.dataset.pool; e.dataTransfer.setData('text/plain', chip.dataset.pool); e.dataTransfer.effectAllowed = 'move'; });
    chip.addEventListener('dragend', () => { poolDragId = null; hidePoolGhost(); });
    chip.addEventListener('dblclick', () => openPassage(chip.dataset.pool));
  });
}

/* --- 锁定面板（≥2 个节点：按当前相对位置锁定为一组；单个已锁定节点：可直接解除锁定） --- */
function updateIntervalPanel() {
  const panel = $('#interval-panel');
  const n = selectedTimeNodes.length;
  const singleLocked = n === 1 && lockedTimeGroup(selectedTimeNodes[0]).size > 1;
  if (n < 2 && !singleLocked) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  $('#lock-group').classList.toggle('hidden', n < 2);
  $('#interval-title').textContent = n >= 2 ? `已选 ${n} 个节点` : '该节点已与其他节点锁定';
}
function lockSelectedGroup() {
  const sel = selectedTimeNodes.map(pid => clip(pid)).filter(p => p && Number.isFinite(p.position)).sort((a, b) => a.position - b.position);
  if (sel.length < 2) return;
  // 不改动任何节点位置：按当前实际间隔把相邻节点串成锁定链，原本在哪就在哪
  for (let i = 1; i < sel.length; i++) {
    const prev = sel[i - 1], p = sel[i];
    const gap = Math.max(0, Math.round(p.position - prev.position));
    let r = db.timeRelations.find(x => x.a === prev.id && x.b === p.id || x.a === p.id && x.b === prev.id);
    if (!r) { r = { a: prev.id, b: p.id, distance: gap, locked: true }; db.timeRelations.push(r); }
    r.distance = gap; r.locked = true;
  }
  selectedTimeNodes = [];
  save(); renderTimeline();
  notify(`${sel.length} 个节点已按当前位置锁定为一组`);
}
function unlockSelectedGroup() {
  const set = new Set(selectedTimeNodes);
  if (!set.size) return;
  // 解除所有触及所选节点的锁定关系：单个节点即脱离整组，其余成员之间的锁定保留
  db.timeRelations = db.timeRelations.filter(r => !(set.has(r.a) || set.has(r.b)));
  selectedTimeNodes = [];
  save(); renderTimeline();
  notify('所选节点的锁定已解除');
}

/* ============ 线索板 ============ */
function boardPassages() { return filteredPassages('board').sort(dateSort); }
function updateBoardMode() {
  const list = boardPassages();
  $('#board-mode').textContent = list.length ? (selectedBoard.length === 1 ? '已选 1 张卡片，请再选一张' : '选择两张卡片建立关联') : '添加 clips 后即可整理线索';
}
/* 选中态局部打补丁：只改受影响卡片的 class 与「前往CLIP」按钮，DOM 与 renderBoard 全量重建的产物完全一致 */
function patchBoardSelection(changedIds) {
  updateBoardMode();
  changedIds.forEach(pid => {
    const node = $(`#board-nodes .board-card[data-id="${CSS.escape(pid)}"]`);
    const p = clip(pid);
    if (!node || !p) return;
    const selected = selectedBoard.includes(pid);
    node.classList.toggle('selected', selected);
    const existing = node.querySelector('.board-card-foot');
    if (selected && !existing) {
      const foot = document.createElement('div');
      foot.className = 'board-card-foot';
      foot.innerHTML = `<button type="button" class="text-button" data-board-goto="${esc(p.id)}">前往CLIP →</button>`;
      foot.querySelector('button').addEventListener('click', e => { e.stopPropagation(); gotoLibrary('passages', p.id); });
      node.appendChild(foot);
    } else if (!selected && existing) existing.remove();
  });
}
function renderBoard() {
  const canvas = $('#board-canvas'), root = $('#board-nodes'), svg = $('#connections');
  const list = boardPassages();
  root.innerHTML = ''; svg.innerHTML = '';
  $('#board-empty').classList.toggle('hidden', list.length > 0);
  updateBoardMode();
  if (!list.length) { applyBoardZoom(780, 560); return; }
  const W = Math.max(canvas.clientWidth, 780), H = Math.max(canvas.clientHeight, 560);
  const cols = Math.max(2, Math.ceil(Math.sqrt(list.length * W / H)));
  const gapX = Math.min(270, (W - 255) / (cols - 1 || 1)), gapY = 195;
  let contentW = 0, contentH = 0;
  list.forEach((p, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const jitter = (i * 37) % 25;
    const def = { x: 25 + col * gapX + jitter, y: 26 + row * gapY + ((i * 29) % 22) };
    const pos = p.boardPosition || def;
    const node = document.createElement('article');
    node.className = 'board-card' + (selectedBoard.includes(p.id) ? ' selected' : '');
    node.dataset.id = p.id;
    node.style.left = pos.x + 'px'; node.style.top = pos.y + 'px';
    node.innerHTML = `<div class="card-meta"><span>${esc(p.date || '时间待补')}</span><span>${esc(p.timeline || '未分类')}</span></div><h3>${esc(p.title)}</h3><p>${esc(p.body || '记录还没有正文…')}</p><div class="card-tags">${charsFor(p).map(c => `<span class="tag ${kindClass(c.role)}">${esc(c.name)}</span>`).join('')}${cluesFor(p).slice(0, 2).map(c => `<span class="tag clue"># ${esc(c.name)}</span>`).join('')}</div>${selectedBoard.includes(p.id) ? `<div class="board-card-foot"><button type="button" class="text-button" data-board-goto="${esc(p.id)}">前往CLIP →</button></div>` : ''}`;
    node.querySelector('[data-board-goto]')?.addEventListener('click', e => {
      e.stopPropagation();
      gotoLibrary('passages', p.id);
    });
    if (boardZoom <= BD_DOT) {
      node.classList.add('as-dot');
      node.style.background = storyColor(p.storyId);
      node.title = `${p.title} · ${story(p.storyId)?.title || '未归档'}`;
    }
    attachBoardCardHandlers(node, p);
    root.appendChild(node);
    contentW = Math.max(contentW, pos.x + 270);
    contentH = Math.max(contentH, pos.y + 230);
  });
  const totalRows = Math.ceil(list.length / cols);
  contentW = Math.max(W, contentW, cols * gapX + 270);
  contentH = Math.max(H, contentH, totalRows * gapY + 40);
  root.style.width = contentW + 'px'; root.style.height = contentH + 'px';
  canvas.style.minHeight = Math.max(H, totalRows * gapY + 40) + 'px';
  applyBoardZoom(contentW, contentH);
  requestAnimationFrame(drawConnections);
}
function applyBoardZoom(w, h) {
  const inner = $('#board-inner'), spacer = $('#board-spacer');
  inner.style.width = w + 'px';    // 容器与内容同尺寸：连线与卡片共用同一坐标系，杜绝错位
  inner.style.height = h + 'px';
  inner.style.transform = `scale(${boardZoom})`;
  spacer.style.width = (w * boardZoom + 40) + 'px';
  spacer.style.height = (h * boardZoom + 40) + 'px';
  $('#board-zoom').textContent = Math.round(boardZoom * 100) + '%';
}
function attachBoardCardHandlers(node, p) {
  node.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('button')) return;   // 访客也可拖拽卡片（不落盘，刷新即还原）
    const start = { x: e.clientX, y: e.clientY };
    const orig = p.boardPosition || { x: parseFloat(node.style.left) || 0, y: parseFloat(node.style.top) || 0 };
    let moved = false;
    node.setPointerCapture(e.pointerId);
    node.classList.add('dragging');
    const onMove = ev => {
      const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) > 3) moved = true;
      if (!moved) return;
      let x = Math.max(0, orig.x + dx / boardZoom), y = Math.max(0, orig.y + dy / boardZoom);
      if (ev.ctrlKey) { x = Math.round(x / 22) * 22; y = Math.round(y / 22) * 22; }
      node.style.left = x + 'px'; node.style.top = y + 'px';
      node.dataset.dragMoved = '1';
      scheduleDrawConnections();   // 拖拽中逐帧合并，避免每个 pointermove 都重绘全部连线
    };
    const onUp = () => {
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerup', onUp);
      node.removeEventListener('pointercancel', onUp);
      node.classList.remove('dragging');
      if (moved) {
        p.boardPosition = { x: parseFloat(node.style.left), y: parseFloat(node.style.top) };
        save(); drawConnections();
      }
    };
    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerup', onUp);
    node.addEventListener('pointercancel', onUp);
  });
  node.addEventListener('click', e => {
    if (node.dataset.dragMoved) { delete node.dataset.dragMoved; e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (!selectedBoard.length) { selectedBoard = [p.id]; patchBoardSelection([p.id]); return; }
    if (selectedBoard[0] === p.id) { selectedBoard = []; patchBoardSelection([p.id]); return; }
    if (!editUnlocked) { const prev = selectedBoard[0]; selectedBoard = [p.id]; patchBoardSelection([prev, p.id]); return; }   // 访客：只换选中，不建关联
    toggleBoardLink(selectedBoard[0], p.id);
  });
  node.addEventListener('dblclick', () => openPassage(p.id));
}
/* 拖拽中逐帧合并连线重绘：一帧内多次触发只画一次 */
let drawConnectionsScheduled = false;
function scheduleDrawConnections() {
  if (drawConnectionsScheduled) return;
  drawConnectionsScheduled = true;
  requestAnimationFrame(() => { drawConnectionsScheduled = false; drawConnections(); });
}
function drawConnections() {
  const svg = $('#connections'), root = $('#board-nodes');
  // 直接用卡片在 board-nodes 内的布局坐标（offsetLeft/Top），与缩放、滚动、视口完全解耦
  const w = parseFloat(root.style.width) || root.scrollWidth, h = parseFloat(root.style.height) || root.scrollHeight;
  svg.setAttribute('width', w); svg.setAttribute('height', h);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.style.width = w + 'px'; svg.style.height = h + 'px';
  svg.innerHTML = '';
  visibleLinks().forEach(link => {
    const a = root.querySelector(`.board-card[data-id="${CSS.escape(link.a)}"]`), b = root.querySelector(`.board-card[data-id="${CSS.escape(link.b)}"]`);
    if (!a || !b) return;
    const ax = a.offsetLeft + a.offsetWidth / 2, ay = a.offsetTop + a.offsetHeight / 2;
    const bx = b.offsetLeft + b.offsetWidth / 2, by = b.offsetTop + b.offsetHeight / 2;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', ax); line.setAttribute('y1', ay);
    line.setAttribute('x2', bx); line.setAttribute('y2', by);
    if (link.auto) line.classList.add('auto');
    line.style.pointerEvents = 'stroke';
    line.addEventListener('click', () => {
      if (!editUnlocked) return;   // 参观模式：不允许删关联
      const key = pairKey(link.a, link.b);
      db.links = db.links.filter(l => pairKey(l.a, l.b) !== key);
      if (link.auto && !db.hiddenLinks.includes(key)) db.hiddenLinks.push(key);
      save(); renderBoard(); notify('已移除这条关联');
    });
    svg.appendChild(line);
  });
}

/* ============ 故事与 clips 库 ============ */
function rowHTML(p) {
  return `<article class="passage-row" data-pid="${esc(p.id)}"><span class="row-date">${esc(p.date || '时间待补')}</span><span class="row-main"><b>${esc(p.title || '未命名 clip')}</b><small>${esc(p.timeline || '未设时间线')} · ${charsFor(p).map(c => esc(c.name)).join('、') || '尚无角色'}</small></span>${p.section === 'outline' ? '<span class="tag">大纲</span>' : '<span class="tag god">正文</span>'}<div class="row-full">${p.html ? sanitizeClipHtml(p.html) : writerBodyMarkup(p.body || '')}<div class="row-full-foot"><button type="button" class="text-button" data-tl-goto>跳转到对应故事 →</button></div></div></article>`;
}
/* --- 时间线 CLIPS 索引：悬浮只高亮节点，点击就地展开全文；选中节点时最新选择排最上 --- */
function renderTimelineList() {
  const all = filteredPassages();
  const placed = all.filter(p => Number.isFinite(p.position)).sort((a, b) => a.position - b.position);
  let indexRows = selectedTimeNodes.length ? placed.filter(p => selectedTimeNodes.includes(p.id)) : placed.slice(0, 10);
  if (selectedTimeNodes.length && tlIndexSort === 'select') {
    indexRows = [...indexRows].sort((a, b) => selectedTimeNodes.indexOf(b.id) - selectedTimeNodes.indexOf(a.id));   // 最新选择在最上
  }
  const sortBtn = $('#tl-index-sort');
  if (sortBtn) {
    sortBtn.classList.toggle('hidden', selectedTimeNodes.length < 2);
    sortBtn.textContent = tlIndexSort === 'select' ? '按时间排序' : '按选择排序';
  }
  const root = $('#timeline-list');
  root.innerHTML = indexRows.map(rowHTML).join('');
  $$('.passage-row', root).forEach(row => {
    const pid = row.dataset.pid, key = 'tl:' + pid;
    row.classList.toggle('expanded', expandedCards.has(key));
    row.addEventListener('mouseenter', () => highlightNode(pid, true));
    row.addEventListener('mouseleave', () => highlightNode(pid, false));
    row.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      if (expandedCards.has(key)) return;   // 已展开：点击不收起，用悬浮收起键
      expandedCards.add(key);
      renderTimelineList(); updateCollapseUI();
    });
    row.querySelector('[data-tl-goto]').addEventListener('click', e => {
      e.stopPropagation();
      const p = clip(pid);
      if (p?.storyId) gotoLibrary('stories', p.storyId);
      else notify('这个 clip 尚未归入任何故事');
    });
  });
}
function renderLibrary() {
  const root = $('#library-content'), query = $('#library-search').value.trim().toLowerCase();
  if (libraryTab === 'stories') {
    const rows = db.stories.filter(s => !query || [s.title, s.description].join(' ').toLowerCase().includes(query));
    root.innerHTML = rows.length ? rows.map(s => {
      const clips = storyClips(s.id);
      const src = [(s.description || ''), ...clips.map(c => c.body || '')].join(' ').replace(/\s+/g, ' ').trim();
      const preview = src.slice(0, 160);
      const open = expandedCards.has('ls:' + s.id);
      const full = clips.length ? clips.map((c, i) =>
        `<div class="story-clip-block"><b>${String(i + 1).padStart(2, '0')} · ${esc(c.title || '未命名 clip')}</b><div class="story-clip-body">${c.html ? sanitizeClipHtml(c.html) : writerBodyMarkup(c.body || '')}</div></div>`
      ).join('') : '<div class="story-clip-block">这个故事还没有 clips。</div>';
      return `<article class="story-card ${open ? 'expanded' : ''}" data-story-open="${esc(s.id)}"><h3>${esc(s.title)}</h3><p>${esc(preview || '点击展开阅读')}${src.length > 160 ? '…' : ''}</p><div class="story-count"><b>${clips.length}</b>clips</div><div class="story-full">${full}</div></article>`;
    }).join('') : emptyHTML('还没有故事', '先新建一篇故事，再把多个 clips 收进来。', '▤');
    $$('[data-story-open]', root).forEach(el => {
      const sid = el.dataset.storyOpen, key = 'ls:' + sid;
      el.addEventListener('click', e => {
        if (e.target.closest('button')) return;
        if (expandedCards.has(key)) return;   // 已展开：用悬浮收起键
        expandedCards.add(key);
        renderLibrary(); updateCollapseUI();
      });
    });
    return;
  }
  const rows = db.passages.filter(p => {
    const text = [p.title, p.body, story(p.storyId)?.title, ...charsFor(p).map(c => c.name), ...cluesFor(p).map(c => c.name), ...(p.clueIds || [])].join(' ').toLowerCase();
    return !query || text.includes(query);
  }).sort(dateSort);
  root.innerHTML = rows.length ? rows.map(p =>
    `<article class="library-card ${expandedCards.has('lc:' + p.id) ? 'expanded' : ''}" data-edit="${esc(p.id)}"><div class="library-card-head"><div><h3>${esc(p.title)}</h3><div class="story-name">${esc(story(p.storyId)?.title || '未归档')}</div></div><div class="date-chip">${esc(p.date || '时间待补')}</div></div>${p.body ? `<p class="excerpt">${esc(p.body.slice(0, 240))}${p.body.length > 240 ? '…' : ''}</p>` : ''}<div class="library-full">${p.html ? sanitizeClipHtml(p.html) : writerBodyMarkup(p.body || '')}</div><div class="library-meta"><span class="tag">${esc(p.timeline || '未设时间线')}</span>${p.section === 'outline' ? '<span class="tag god">大纲</span>' : ''}${charsFor(p).map(c => `<span class="tag ${kindClass(c.role)}">${esc(c.name)} · ${kindLabel(c.role)}</span>`).join('')}${cluesFor(p).map(c => `<span class="tag clue"># ${esc(c.name)}</span>`).join('')}</div></article>`
  ).join('') : emptyHTML('没有找到 clips', '试试调整关键词，或新建一个 clips。', '⌕');
  $$('[data-edit]', root).forEach(el => {
    const key = 'lc:' + el.dataset.edit;
    el.onclick = () => {   // 单击：就地展开/收起全文（两种模式一致）
      expandedCards.has(key) ? expandedCards.delete(key) : expandedCards.add(key);
      renderLibrary(); updateCollapseUI();
    };
    el.ondblclick = () => { if (editUnlocked) openPassage(el.dataset.edit); };   // 双击：去码字页编辑
  });
}

/* ============ 码字 ============ */
function storyClips(sid) {
  return db.passages.filter(p => p.storyId === sid).sort((a, b) =>
    Number.isFinite(a.order) && Number.isFinite(b.order) ? a.order - b.order : db.passages.indexOf(a) - db.passages.indexOf(b));
}
function writerBodyMarkup(text = '') {
  if (!text) return '';
  return String(text).split(/\n/).map(line => `<div>${esc(line) || '<br>'}</div>`).join('');
}
function sanitizeClipHtml(html) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const rootEl = doc.body.firstElementChild;
  const allowed = new Set(['DIV', 'BR', 'B', 'STRONG']);
  const clean = node => {
    [...node.childNodes].forEach(child => {
      if (child.nodeType === Node.ELEMENT_NODE) {
        if (!allowed.has(child.tagName)) { child.replaceWith(...child.childNodes); clean(node); }
        else { [...child.attributes].forEach(a => child.removeAttribute(a.name)); clean(child); }
      }
    });
  };
  clean(rootEl);
  return rootEl.innerHTML;
}
function caretTextOffset(editor, selection) {
  const text = editor.innerText.replace(/\r/g, '');
  if (!selection?.rangeCount || !editor.contains(selection.anchorNode)) return text.length;
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.setEnd(selection.anchorNode, selection.anchorOffset);
  const measure = document.createElement('div');
  measure.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;white-space:pre-wrap';
  measure.append(range.cloneContents());
  document.body.append(measure);
  const offset = measure.innerText.replace(/\r/g, '').length;
  measure.remove();
  return Math.min(offset, text.length);
}
function setWriterSpacing() {
  const prefs = db.writerPrefs || {};
  $('#line-spacing').value = String(prefs.line || 1.8);
  $('#paragraph-spacing').value = String(prefs.paragraph || 16);
  document.documentElement.style.setProperty('--writer-line', $('#line-spacing').value);
  document.documentElement.style.setProperty('--writer-paragraph-gap', $('#paragraph-spacing').value + 'px');
}
function markWriterDirty() {
  const state = $('.save-state');
  if (state) state.innerHTML = '<i></i> 有未保存的更改';
  clearTimeout(writerSaveTimer);
  writerSaveTimer = setTimeout(() => save(), 700);
}
function saveWriterText(p, editor) {
  const html = sanitizeClipHtml(editor.innerHTML);
  if (html !== editor.innerHTML) editor.innerHTML = html;
  p.html = html;
  p.body = editor.innerText.replace(/\r/g, '');
  markWriterDirty();
}
function normalizeClipNames(sid) {
  const clips = storyClips(sid), name = story(sid)?.title?.trim() || '未命名故事';
  let changed = false;
  clips.forEach((p, i) => {
    p.order = i;
    const next = `${name}（${fwNum(i + 1)}/${fwNum(clips.length)}）`;
    if (p.title !== next) { p.title = next; changed = true; }
  });
  return changed;
}
function renderWriter(focusClipId = null) {
  const select = $('#writer-story-select'), title = $('#writer-story-title'), root = $('#writer-sections'), add = $('#writer-add-section');
  select.innerHTML = db.stories.map(s => `<option value="${esc(s.id)}">${esc(s.title || '未命名故事')}</option>`).join('');
  if (!activeStoryId || !story(activeStoryId)) activeStoryId = db.stories[0]?.id || null;
  select.value = activeStoryId || '';
  setWriterSpacing();
  const noStory = !activeStoryId;
  title.disabled = noStory || !editUnlocked; select.disabled = noStory; add.disabled = noStory;
  $('#writer-delete-story').disabled = noStory;
  if (noStory) {
    title.value = '';
    root.innerHTML = `<div class="writer-no-story"><b>先创建一篇故事</b><p>故事是完整文档；之后可在文档中分节，形成各自带有时间与角色标注的 clips。</p><button class="button button-dark" id="writer-create-first">＋ 新建故事</button></div>`;
    $('#writer-create-first').onclick = createStoryInWriter;
    return;
  }
  const renamed = normalizeClipNames(activeStoryId);
  title.value = story(activeStoryId).title || '';
  const clips = storyClips(activeStoryId).filter(p => writerSectionFilter === 'all' || (p.section || 'body') === writerSectionFilter);
  root.innerHTML = clips.length ? clips.map((p, i) => {
    const meta = [
      p.date ? `<span class="tag">${esc(p.date)}</span>` : '',
      p.timeline ? `<span class="tag">${esc(p.timeline)}</span>` : '',
      p.section === 'outline' ? '<span class="tag god">大纲</span>' : '',
      ...charsFor(p).map(c => `<span class="tag ${kindClass(c.role)}">${esc(c.name)} · ${kindLabel(c.role)}</span>`),
      ...cluesFor(p).map(c => `<span class="tag clue"># ${esc(c.name)}</span>`)
    ].join('');
    return `<div class="writer-section-row" data-clip-row="${esc(p.id)}"><article class="writer-section ${p.collapsed ? 'is-collapsed' : ''} ${p.section === 'outline' ? 'is-outline' : ''}" data-clip-section="${esc(p.id)}"><header class="writer-section-head"><button type="button" class="clip-drag-handle" draggable="true" title="拖拽调整 clip 顺序" aria-label="拖拽调整 clip 顺序">⠿</button><span class="writer-section-index">CLIP ${String(i + 1).padStart(2, '0')}</span><span class="writer-clip-name">${esc(p.title)}</span><span class="tag ${p.section === 'outline' ? 'god' : ''}">${p.section === 'outline' ? '大纲' : '正文'}</span><button type="button" class="writer-collapse-button" data-clip-collapse="${esc(p.id)}" aria-expanded="${!p.collapsed}">${p.collapsed ? '展开' : '收起'}</button></header><div class="clip-writing" data-clip-body="${esc(p.id)}" data-placeholder="从这里开始写作…" contenteditable="${editUnlocked}" spellcheck="false">${p.html ? sanitizeClipHtml(p.html) : writerBodyMarkup(p.body || '')}</div><div class="writer-section-meta">${meta || '<span class="tag">尚未添加时间或角色标注</span>'}</div><div class="writer-clip-preview" aria-hidden="true"></div></article><div class="writer-outside-actions"><button class="writer-mini-button" data-add-below="${esc(p.id)}">↓ 下方添加 clip</button><button class="writer-mini-button" data-clip-meta="${esc(p.id)}">时间与角色</button><button class="writer-mini-button" data-detect="${esc(p.id)}">识别角色</button><button class="writer-mini-button" data-toggle-section="${esc(p.id)}">${p.section === 'outline' ? '转为正文' : '转为大纲'}</button><button class="writer-mini-button writer-clip-delete" data-delete-clip="${esc(p.id)}">删除</button></div></div>`;
  }).join('') : `<div class="writer-empty"><b>故事文档还没有 clip</b><p>在下方新增 clip。每个 clip 会作为「未入线」圆点出现在时间线旁，手动拖入时间线。</p></div>`;
  if (renamed) { save(); renderTimeline(); renderLibrary(); renderBoard(); }
  // 折叠预览文本
  $$('.writer-section', root).forEach(section => {
    const p = clip(section.dataset.clipSection);
    const preview = section.querySelector('.writer-clip-preview');
    let text = p?.body || '';
    if (!text && p?.html) { const tmp = document.createElement('div'); tmp.innerHTML = sanitizeClipHtml(p.html); text = tmp.textContent || ''; }
    preview.textContent = text.replace(/\s+/g, ' ').trim();
  });
  updateCollapseAllLabel();
  if (focusClipId) requestAnimationFrame(() => {
    $(`#clip-${CSS.escape(focusClipId)}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    $(`[data-clip-body="${CSS.escape(focusClipId)}"]`)?.focus();
  });
}
function updateCollapseAllLabel() {
  const clips = storyClips(activeStoryId);
  $('#writer-collapse-all').textContent = clips.length && clips.every(c => c.collapsed) ? '全部展开' : '全部收起';
}
function addWriterClip(afterId = null) {
  if (!activeStoryId) { createStoryInWriter(); return null; }
  const clips = storyClips(activeStoryId);
  clips.forEach((p, i) => p.order = i);
  const after = afterId ? clips.find(p => p.id === afterId) : null;
  const index = after ? clips.indexOf(after) + 1 : clips.length;
  clips.forEach((p, i) => { if (i >= index) p.order = i + 1; });
  const p = { id: id(), storyId: activeStoryId, title: '', body: '', html: '', date: '', timeline: '', section: 'outline', characters: [], clueIds: [], order: index, position: null, collapsed: false };
  db.passages.push(p);
  normalizeClipNames(activeStoryId);
  save(); render();
  switchView('writer');
  renderWriter(p.id);
  return p;
}
function splitClipAtCursor(pid) {
  const p = clip(pid), editor = $(`[data-clip-body="${CSS.escape(pid)}"]`);
  if (!p || !editor) return;
  const selection = getSelection(), text = editor.innerText.replace(/\r/g, '');
  const offset = caretTextOffset(editor, selection);
  const left = text.slice(0, offset).trimEnd(), right = text.slice(offset).trimStart();
  p.body = left; p.html = writerBodyMarkup(left);
  // 新 clip 排在当前 clip 之后（往后创建），内容为光标后的部分
  const clips = storyClips(activeStoryId);
  clips.forEach((c, i) => c.order = i);
  const index = clips.indexOf(p) + 1;
  clips.forEach((c, i) => { if (i >= index) c.order = i + 1; });
  const next = {
    id: id(), storyId: p.storyId, title: '', body: right, html: writerBodyMarkup(right),
    date: p.date || '', timeline: p.timeline || '', section: p.section || 'body',
    characters: [], clueIds: [], order: index, position: null, collapsed: false
  };
  db.passages.push(next);
  normalizeClipNames(activeStoryId);
  save(); render();
  renderWriter(next.id);
  notify('已在当前 clip 之后创建新 clip');
}
function detectCharactersInClip(p) {
  const text = ((p.body || '') + ' ' + (p.html || '')).toLowerCase();
  let added = 0;
  db.characters.forEach(c => {
    // 中文名、英文名命中任意一个即识别为同一角色，显示以中文名为准
    const names = [c.name, c.enName].filter(x => x && x.trim()).map(x => x.trim().toLowerCase());
    if (!names.length) return;
    if ((p.characters || []).some(x => x.id === c.id)) return;
    if (names.some(n => text.includes(n))) { (p.characters ||= []).push({ id: c.id, role: c.kind }); added++; }
  });
  return added;
}
function detectAllCharacters() {
  let added = 0;
  db.passages.forEach(p => added += detectCharactersInClip(p));
  save(); render();
  notify(added ? `已从全文识别出 ${added} 处角色出场` : '没有发现新的角色出场');
}
/* --- 合并同名角色：保留每组最早条目，其余删除，clip 标注改指保留条目并去重 --- */
function mergeDuplicateCharacters() {
  const groups = new Map();
  db.characters.forEach(c => {
    const key = (c.name || '').trim().toLowerCase();
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  });
  const dups = [...groups.values()].filter(g => g.length > 1);
  if (!dups.length) { notify('没有同名角色需要合并'); return; }
  const names = dups.map(g => g[0].name.trim()).join('、');
  if (!confirm(`发现同名角色：${names}\n\n将保留每组最早创建的条目（以其当前身份为准），其余删除；相关 clip 的标注全部改指保留条目。继续？`)) return;
  let removed = 0;
  dups.forEach(g => {
    const keeper = g[0];
    keeper.name = (keeper.name || '').trim();
    const loserIds = new Set(g.slice(1).map(c => c.id));
    db.passages.forEach(p => {
      const seen = new Set();
      p.characters = (p.characters || [])
        .map(x => loserIds.has(x.id) ? { id: keeper.id, role: keeper.kind } : x)
        .filter(x => { if (seen.has(x.id)) return false; seen.add(x.id); return true; });
    });
    db.characters = db.characters.filter(c => !loserIds.has(c.id));
    removed += loserIds.size;
  });
  save(); fillFilters(); render(); renderCharacterDB();
  notify(`已合并 ${dups.length} 组同名角色，删除 ${removed} 个重复条目`);
}
function deleteClip(pid) {
  const p = clip(pid);
  if (!p) return;
  if (!confirm(`删除 ${p.title}？此操作会同时移除与它的线索连线和时间间隔。`)) return;
  const sid = p.storyId;
  db.passages = db.passages.filter(x => x.id !== pid);
  db.links = db.links.filter(x => x.a !== pid && x.b !== pid);
  db.hiddenLinks = db.hiddenLinks.filter(k => !k.split('|').includes(pid));
  db.timeRelations = db.timeRelations.filter(x => x.a !== pid && x.b !== pid);
  selectedBoard = selectedBoard.filter(x => x !== pid);
  selectedTimeNodes = selectedTimeNodes.filter(x => x !== pid);
  normalizeClipNames(sid);
  save(); render();
  activeStoryId = sid;
  renderWriter();
  notify('Clip 已删除');
}
function deleteStory() {
  const s = story(activeStoryId);
  if (!s) return;
  const ids = new Set(storyClips(s.id).map(p => p.id));
  if (!confirm(`删除故事「${s.title}」及其中的 ${ids.size} 个 clips？相关线索连线和时间间隔也会移除。`)) return;
  db.stories = db.stories.filter(x => x.id !== s.id);
  db.passages = db.passages.filter(p => p.storyId !== s.id);
  db.links = db.links.filter(l => !ids.has(l.a) && !ids.has(l.b));
  db.hiddenLinks = db.hiddenLinks.filter(k => { const [a, b] = k.split('|'); return !ids.has(a) && !ids.has(b); });
  db.timeRelations = db.timeRelations.filter(l => !ids.has(l.a) && !ids.has(l.b));
  activeStoryId = db.stories[0]?.id || null;
  save(); render();
  switchView('writer'); renderWriter();
  notify('故事已删除');
}
function createStoryInWriter() {
  const title = prompt('故事标题');
  if (!title?.trim()) return;
  const s = { id: id(), title: title.trim(), description: '' };
  db.stories.push(s);
  activeStoryId = s.id;
  save(); render();
  switchView('writer'); renderWriter();
  addWriterClip();
}
function openStoryInWriter(sid) {
  if (!story(sid)) return;
  activeStoryId = sid;
  switchView('writer'); renderWriter();
}
function openPassage(pid = null) {
  if (pid) {
    const p = clip(pid);
    if (!p) return;
    activeStoryId = p.storyId;
    switchView('writer'); renderWriter(pid);
    return;
  }
  if (!activeStoryId && db.stories.length) activeStoryId = db.stories[0].id;
  switchView('writer'); renderWriter();
  if (activeStoryId) addWriterClip();
}

/* ============ 角色数据库 ============ */
/* 相关树：一级故事列表，点故事展开该故事下的 clips（角色/线索卡片共用） */
function relMatrixHTML(list) {
  if (!list.length) return '<div class="rel-tree rel-empty">尚无关联的 clip</div>';
  const byStory = new Map();
  list.forEach(p => {
    const k = p.storyId || '_none';
    if (!byStory.has(k)) byStory.set(k, []);
    byStory.get(k).push(p);
  });
  const items = [...byStory.entries()].map(([sid, ps]) => {
    const s = story(sid);
    return `<div class="rel-story" data-rel-story><span>${esc(s?.title || '未归档')}</span><span class="rel-count">${ps.length}</span></div><div class="rel-clips hidden">${ps.sort(dateSort).map(p => `<div class="rel-clip" data-goto-clip="${esc(p.id)}">${esc(p.title || '未命名 clip')}</div>`).join('')}</div>`;
  }).join('');
  return `<div class="rel-tree">${items}</div>`;
}
/* 跳到「故事与 clips」并定位高亮 */
function gotoLibrary(tab, targetId) {
  libraryTab = tab;
  $('#library-search').value = '';
  $$('.library-tab').forEach(x => x.classList.toggle('active', x.dataset.tab === tab));
  switchView('library');
  renderLibrary();
  const sel = tab === 'passages' ? `[data-edit="${CSS.escape(targetId)}"]` : `[data-story-open="${CSS.escape(targetId)}"]`;
  const el = document.querySelector(sel);
  if (el) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('flash-hl');
    setTimeout(() => el.classList.remove('flash-hl'), 1800);
  }
}
/* 卡片点击：展开/收起相关树；点故事展开其 clips，点 clip 跳转 */
function bindRelCards(root) {
  $$('.character-card', root).forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      const gc = e.target.closest('[data-goto-clip]');
      if (gc) { e.stopPropagation(); return gotoLibrary('passages', gc.dataset.gotoClip); }
      const rs = e.target.closest('[data-rel-story]');
      if (rs) { e.stopPropagation(); rs.nextElementSibling?.classList.toggle('hidden'); return; }
      card.classList.toggle('show-rel');
    });
  });
}
function renderCharacterDB() {
  const root = $('#character-list');
  if (!root) return;
  const query = $('#character-search').value.trim().toLowerCase();
  const kindF = $('#character-kind-filter')?.value || 'all';
  const chars = db.characters.filter(c =>
    (kindF === 'all' || kindClass(c.kind) === kindF) &&
    (!query || [c.name, c.enName, c.description].join(' ').toLowerCase().includes(query)));
  $('#character-count').textContent = `${db.characters.length} 位角色`;
  root.innerHTML = chars.length ? chars.map(c => {
    const featured = db.passages.filter(p => (p.characters || []).some(x => x.id === c.id));
    return `<article class="character-card"><div class="character-card-head"><span class="character-avatar">${esc((c.name || '?').slice(0, 1))}</span><div><h3>${esc(c.name)}</h3>${c.enName ? `<small class="char-en">${esc(c.enName)}</small>` : ''}<span class="character-kind ${kindClass(c.kind)}">${kindLabel(c.kind)}</span></div><div class="character-card-actions"><button type="button" class="text-button" data-character-edit="${esc(c.id)}">编辑</button><button type="button" class="text-button character-remove" data-character-delete="${esc(c.id)}">删除</button></div></div><p>${esc(c.description || '还没有角色简介。')}</p><div class="character-card-foot"><span>出现在 ${featured.length} 个 clips · 点击查看</span></div><div class="rel-panel">${relMatrixHTML(featured)}</div></article>`;
  }).join('') : emptyHTML(query ? '没有找到匹配角色' : '角色数据库还是空的', query ? '试试其他关键词。' : '添加角色后，就能在 clip 设置中标记他们的出场，或用「识别角色」自动标注。', '♙');
  bindRelCards(root);
  $$('[data-character-edit]', root).forEach(btn => btn.onclick = () => {
    const c = charObj(btn.dataset.characterEdit); if (!c) return;
    $('#character-id').value = c.id; $('#character-name').value = c.name || '';
    $('#character-enname').value = c.enName || '';
    $('#character-kind').value = kindClass(c.kind); $('#character-description').value = c.description || '';
    $('#character-form-title').textContent = '编辑角色'; $('#character-form-eyebrow').textContent = 'EDIT CHARACTER';
    $('#character-cancel-edit').classList.remove('hidden'); $('#character-name').focus();
  });
  $$('[data-character-delete]', root).forEach(btn => btn.onclick = () => deleteCharacter(btn.dataset.characterDelete));
}
function resetCharacterForm() {
  $('#character-form').reset();
  $('#character-id').value = ''; $('#character-kind').value = 'human';
  $('#character-form-title').textContent = '添加角色'; $('#character-form-eyebrow').textContent = 'NEW CHARACTER';
  $('#character-cancel-edit').classList.add('hidden');
}
function deleteCharacter(cid) {
  const c = charObj(cid); if (!c) return;
  const count = db.passages.filter(p => (p.characters || []).some(x => x.id === cid)).length;
  if (!confirm(`删除角色「${c.name}」？这会从 ${count} 个 clips 的出场标注中移除该角色。`)) return;
  db.characters = db.characters.filter(x => x.id !== cid);
  db.passages.forEach(p => p.characters = (p.characters || []).filter(x => x.id !== cid));
  save(); fillFilters(); render(); renderCharacterDB();
  notify('角色已删除');
}

/* ============ 线索库 ============ */
function renderClueDB() {
  const root = $('#clue-list');
  if (!root) return;
  const query = $('#clue-search').value.trim().toLowerCase();
  const clues = db.clues.filter(c => !query || [c.name, c.description].join(' ').toLowerCase().includes(query));
  $('#clue-dir-count').textContent = `${db.clues.length} 条线索`;
  root.innerHTML = clues.length ? clues.map(c => {
    const linked = db.passages.filter(p => (p.clueIds || []).includes(c.id));
    return `<article class="character-card"><div class="character-card-head"><span class="character-avatar">⬡</span><div><h3>${esc(c.name)}</h3><span class="character-kind god">线索</span></div><div class="character-card-actions"><button type="button" class="text-button" data-clue-edit="${esc(c.id)}">编辑</button><button type="button" class="text-button character-remove" data-clue-delete="${esc(c.id)}">删除</button></div></div><p>${esc(c.description || '还没有线索简介。')}</p><div class="character-card-foot"><span>关联 ${linked.length} 个 clips · 点击查看</span></div><div class="rel-panel">${relMatrixHTML(linked)}</div></article>`;
  }).join('') : emptyHTML(query ? '没有找到匹配线索' : '还没有线索', query ? '试试其他关键词。' : '添加线索后，在 clip 设置中标注，相同线索的 clips 会在线索板自动关联。', '⬡');
  bindRelCards(root);
  $$('[data-clue-edit]', root).forEach(btn => btn.onclick = () => {
    const c = clueObj(btn.dataset.clueEdit); if (!c) return;
    $('#clue-id').value = c.id; $('#clue-name').value = c.name || ''; $('#clue-description').value = c.description || '';
    $('#clue-form-title').textContent = '编辑线索'; $('#clue-form-eyebrow').textContent = 'EDIT CLUE';
    $('#clue-cancel-edit').classList.remove('hidden'); $('#clue-name').focus();
  });
  $$('[data-clue-delete]', root).forEach(btn => btn.onclick = () => deleteClue(btn.dataset.clueDelete));
}
function resetClueForm() {
  $('#clue-form').reset();
  $('#clue-id').value = '';
  $('#clue-form-title').textContent = '添加线索'; $('#clue-form-eyebrow').textContent = 'NEW CLUE';
  $('#clue-cancel-edit').classList.add('hidden');
}
function deleteClue(cid) {
  const c = clueObj(cid); if (!c) return;
  const count = db.passages.filter(p => (p.clueIds || []).includes(cid)).length;
  if (!confirm(`删除线索「${c.name}」？这会从 ${count} 个 clips 中移除该线索，相关自动关联也会消失。`)) return;
  db.clues = db.clues.filter(x => x.id !== cid);
  db.passages.forEach(p => p.clueIds = (p.clueIds || []).filter(x => x !== cid));
  save(); render(); renderClueDB();
  notify('线索已删除');
}

/* ============ Clip 设置弹窗 ============ */
function drawCharPicks(p) {
  const chosen = new Map((p?.characters || []).map(c => [c.id, c.role]));
  $('#character-picks').innerHTML = db.characters.length ? db.characters.map(c =>
    `<label class="character-pick"><input type="checkbox" value="${esc(c.id)}" ${chosen.has(c.id) ? 'checked' : ''}><span>${esc(c.name)}</span><em class="${kindClass(c.kind)}">${kindLabel(c.kind)}</em></label>`
  ).join('') : '<small>还没有角色。可在下方添加。</small>';
}
function drawCluePicks(p) {
  const chosen = new Set(p?.clueIds || []);
  $('#clue-picks').innerHTML = db.clues.length ? db.clues.map(c =>
    `<label class="character-pick"><input type="checkbox" value="${esc(c.id)}" ${chosen.has(c.id) ? 'checked' : ''}><span>${esc(c.name)}</span><em class="god">线索</em></label>`
  ).join('') : '<small>还没有线索。可在下方添加。</small>';
}
function addCharacterFromModal() {
  const inp = $('#new-character'), name = inp.value.trim();
  if (!name) return;
  let c = db.characters.find(x => x.name === name);
  if (!c) { c = { id: id(), name, kind: $('#new-character-role').value, description: '' }; db.characters.push(c); }
  inp.value = '';
  const checked = new Set($$('#character-picks input:checked').map(x => x.value));
  checked.add(c.id);
  drawCharPicks({ characters: [...checked].map(cid => ({ id: cid, role: charObj(cid)?.kind })) });
  save();
}
function addClueFromModal() {
  const inp = $('#new-clue'), name = inp.value.trim();
  if (!name) return;
  let c = db.clues.find(x => x.name === name);
  if (!c) { c = { id: id(), name, description: '' }; db.clues.push(c); }
  inp.value = '';
  const checked = new Set($$('#clue-picks input:checked').map(x => x.value));
  checked.add(c.id);
  drawCluePicks({ clueIds: [...checked] });
  save();
}
function openClipMetadata(pid) {
  const p = clip(pid); if (!p) return;
  $('#entry-id').value = p.id;
  $('#entry-story').innerHTML = db.stories.map(s => `<option value="${esc(s.id)}">${esc(s.title)}</option>`).join('');
  $('#entry-story').value = p.storyId;
  $('#entry-title').value = p.title || '';
  $('#entry-title').readOnly = true;
  $('#entry-body').value = p.body || '';
  $('#entry-date').value = p.date || '';
  $('#entry-timeline').value = p.timeline || '';
  $('#entry-section').value = p.section === 'outline' ? 'outline' : 'body';
  drawCharPicks(p); drawCluePicks(p);
  $('#entry-story-field').classList.add('hidden');
  $('#entry-body-field').classList.add('hidden');
  $('#modal-title').textContent = 'Clip 设置';
  $('#delete-entry').classList.remove('hidden');
  $('#modal-backdrop').classList.remove('hidden');
}
function closeModal() {
  $('#modal-backdrop').classList.add('hidden');
  $('#entry-title').readOnly = false;
  $('#entry-story-field').classList.remove('hidden');
  $('#entry-body-field').classList.remove('hidden');
}

/* ============ 视图切换 ============ */
const CRUMBS = { timeline: '时间线', writer: '码字', board: '线索关系板', library: '故事与 clips', characters: '角色数据库', clues: '线索' };
function switchView(name) {
  if (name === 'writer' && !editUnlocked) return;   // 参观模式不开放码字页
  activeView = name;
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  $('#crumb-current').textContent = CRUMBS[name] || name;
  if (name === 'timeline') renderTimeline();   // 回到时间线时重算几何（隐藏时渲染会拿到 0 高，导致节点挤作一团）
  if (name === 'board') requestAnimationFrame(drawConnections);
  updateCollapseUI();
  if (name === 'writer') renderWriter();
  if (name === 'characters') renderCharacterDB();
  if (name === 'clues') renderClueDB();
}

/* --- 主题：默认 / 古希腊 --- */
let themeAnimTimer;
function applyTheme() {
  const greek = db.prefs.theme === 'greek';
  document.body.classList.add('theme-anim');   // 切换动画：颜色平滑过渡 + 主区淡入
  clearTimeout(themeAnimTimer);
  themeAnimTimer = setTimeout(() => document.body.classList.remove('theme-anim'), 520);
  document.body.classList.toggle('greek', greek);
  document.documentElement.classList.toggle('greek', greek);   // 让最外层视口滚动条也能套主题
  const btn = $('#theme-toggle');
  if (btn) btn.innerHTML = `<span class="nav-icon">${greek ? '⚱' : '🏛'}</span>${greek ? '恢复默认风格' : '忒洛波利斯'}`;
}

/* --- 云端保存：用 GitHub PAT 把数据写回仓库 archive.json（令牌只存本机） --- */
/* 从 GitHub Pages 网址推断仓库：username.github.io/repo → username/repo；用户页 → username/username.github.io */
function guessRepo() {
  const host = location.hostname;
  if (host.endsWith('.github.io')) {
    const owner = host.slice(0, -'.github.io'.length);
    const seg = location.pathname.split('/').filter(Boolean)[0];
    return seg ? `${owner}/${seg}` : `${owner}/${owner}.github.io`;
  }
  return null;
}
async function cloudSave() {
  if (!editUnlocked) return;
  let repo = localStorage.getItem('tpl_gh_repo') || guessRepo();
  let token = localStorage.getItem('tpl_gh_token');
  if (!repo) {
    repo = prompt('GitHub 仓库（形如 username/repo）：');
    if (!repo) return;
    localStorage.setItem('tpl_gh_repo', repo.trim());
  }
  if (!token) {
    token = prompt('GitHub 个人令牌（PAT，只授本仓库 contents 写权限；仅保存在此浏览器）：');
    if (!token) return;
    localStorage.setItem('tpl_gh_token', token.trim());
  }
  notify('正在保存到云端…');
  try {
    const api = `https://api.github.com/repos/${repo.trim()}/contents/archive.json`;
    const head = { Authorization: `Bearer ${token.trim()}`, Accept: 'application/vnd.github+json' };
    let sha;
    const cur = await fetch(api, { headers: head });
    if (cur.ok) sha = (await cur.json()).sha;
    else if (cur.status === 401) { localStorage.removeItem('tpl_gh_token'); throw new Error('401：令牌无效或已过期'); }
    else if (cur.status === 403) { localStorage.removeItem('tpl_gh_token'); throw new Error('403：令牌没有这个仓库的访问权限（Contents 需设为 Read and write）'); }
    else if (cur.status !== 404) throw new Error(`读取仓库信息失败（HTTP ${cur.status}）`);   // 404 = archive.json 还没创建过，属正常
    const pub = { ...db, prefs: { ...db.prefs, unlocked: undefined } };
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(pub, null, 1))));
    const res = await fetch(api, { method: 'PUT', headers: head, body: JSON.stringify({ message: '更新故事档案', content, ...(sha ? { sha } : {}) }) });
    if (!res.ok) throw new Error(await res.text());
    notify(`已保存到 ${repo.trim()}，GitHub Pages 正在重新部署（几分钟后访客可见）`);
  } catch (e) {
    console.error(e);
    const detail = String(e?.message || e).slice(0, 300);
    // 失败后可重设：清掉已存的仓库名与令牌，下次重新输入（仓库留空则按网址自动推断）
    if (confirm(`云端保存失败：${detail}\n\n点「确定」重新设置仓库与令牌；点「取消」稍后再试。`)) {
      localStorage.removeItem('tpl_gh_repo');
      localStorage.removeItem('tpl_gh_token');
      const r = prompt('GitHub 仓库（形如 username/repo；留空则按当前网址自动推断）：');
      if (r && r.trim()) localStorage.setItem('tpl_gh_repo', r.trim());
      cloudSave();
    } else notify('云端保存失败');
  }
}

/* 云端设置：随时修改仓库名与令牌 */
function cloudSettings() {
  if (!editUnlocked) return;
  const curRepo = localStorage.getItem('tpl_gh_repo') || guessRepo() || '未设置';
  const hasToken = !!localStorage.getItem('tpl_gh_token');
  const r = prompt(`云端仓库（当前：${curRepo}）\n修改后点确定；清空则恢复为按网址自动推断：`, localStorage.getItem('tpl_gh_repo') || '');
  if (r === null) return;
  if (r.trim()) localStorage.setItem('tpl_gh_repo', r.trim());
  else localStorage.removeItem('tpl_gh_repo');
  const t = prompt(`访问令牌（当前：${hasToken ? '已保存' : '未设置'}）\n输入新令牌则替换；留空保持不变；输入一个空格则清除：`);
  if (t === null) return;
  if (t === ' ') localStorage.removeItem('tpl_gh_token');
  else if (t.trim()) localStorage.setItem('tpl_gh_token', t.trim());
  notify('云端设置已更新');
}

/* --- 本地备份：导出 / 导入 JSON --- */
function exportData() {
  if (!editUnlocked) return;
  const pub = { ...db, prefs: { ...db.prefs, unlocked: undefined } };
  const blob = new Blob([JSON.stringify(pub, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `忒洛波利斯-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  notify('已导出备份文件');
}
function importData(file) {
  if (!editUnlocked || !file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const d = JSON.parse(reader.result);
      if (!Array.isArray(d.stories) || !Array.isArray(d.passages)) throw new Error('bad');
      d.prefs = { ...(d.prefs || {}), unlocked: true };
      localStorage.setItem(KEY, JSON.stringify(d));
      location.reload();
    } catch { notify('导入失败：不是有效的档案文件'); }
  };
  reader.readAsText(file);
}

/* --- 字号三档（小 / 标准 / 大） --- */
const FONT_ZOOM = { s: '', m: '1.12', l: '1.26' };   // 整体上移一档：原标准→小、原大→标准、大更大
function applyFontSize() {
  const fs = FONT_ZOOM[db.prefs.fontSize] !== undefined ? db.prefs.fontSize : 'm';
  document.body.style.zoom = FONT_ZOOM[fs];
  $$('#font-size-switch button').forEach(b => b.classList.toggle('on', b.dataset.fs === fs));
}

/* ============ 事件绑定 ============ */
function bindEvents() {
  // 导航
  $$('.nav-item').forEach(b => b.onclick = () => switchView(b.dataset.view));
  $('#theme-toggle').onclick = () => {
    db.prefs.theme = db.prefs.theme === 'greek' ? '' : 'greek';
    save(); applyTheme();
    notify(db.prefs.theme === 'greek' ? '已切换为忒洛波利斯主题' : '已恢复默认风格');
  };
  $$('#font-size-switch button').forEach(b => b.onclick = () => {
    db.prefs.fontSize = b.dataset.fs;
    save(); applyFontSize();
  });

  // 访问权限与数据管理
  $('#auth-toggle').onclick = () => editUnlocked ? lockDown() : tryUnlock();
  $('#side-toggle').onclick = () => {
    const collapsed = document.body.classList.toggle('side-collapsed');
    db.prefs.sideCollapsed = collapsed;
    $('#side-toggle .nav-icon').textContent = collapsed ? '▸' : '◂';
    save();
  };
  $('#cloud-save').onclick = cloudSave;
  $('#cloud-settings').onclick = cloudSettings;
  $('#export-data').onclick = exportData;
  $('#import-data').onclick = () => $('#import-file').click();
  $('#import-file').onchange = e => { importData(e.target.files[0]); e.target.value = ''; };
  $('#collapse-all-float').onclick = () => {
    viewExpandKeys().forEach(k => expandedCards.delete(k));   // 只收起当前页面的展开
    updateCollapseUI();
    renderLibrary(); renderTimelineList();
    notify('已全部收起');
  };
  $('#tl-index-sort')?.addEventListener('click', () => {
    tlIndexSort = tlIndexSort === 'select' ? 'time' : 'select';
    renderTimelineList();
  });
  $$('[data-switch="library"]').forEach(b => b.onclick = () => switchView('library'));
  $('#add-passage-top').onclick = () => openPassage();
  $('#add-story').onclick = createStoryInWriter;

  // 时间线
  $('#timeline-reset').onclick = () => {
    $('#filter-story').value = $('#filter-character').value = $('#filter-timeline').value = $('#filter-clue').value = 'all';
    renderTimeline();
  };
  ['filter-story', 'filter-character', 'filter-timeline', 'filter-clue'].forEach(x => $('#' + x).onchange = renderTimeline);
  $('#timeline-expand').onclick = () => { tlExpanded = !tlExpanded; renderTimeline(); };
  $('#timeline-clear-sel').onclick = () => {
    if (!selectedTimeNodes.length) { notify('当前没有选中的节点'); return; }
    selectedTimeNodes = []; renderTimeline(); notify('已清除选择');
  };
  $('#cancel-interval').onclick = () => { selectedTimeNodes = []; renderTimeline(); };
  $('#lock-group').onclick = lockSelectedGroup;
  $('#unlock-group').onclick = unlockSelectedGroup;
  const scroll = $('#timeline-scroll');
  scroll.addEventListener('wheel', e => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const oldZ = tlZoom;
    tlZoom = clamp(tlZoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), TL_MIN, TL_MAX);
    if (tlExpanded && tlZoom !== oldZ) {   // 展开模式：同步缩放已固化的横坐标，保持相对布局
      const ratio = tlZoom / oldZ;
      const maxLeft = Math.max(420, scroll.clientWidth - 40);
      db.passages.forEach(p => { if (p.exp) p.exp.x = clamp(100 + (p.exp.x - 100) * ratio, 40, maxLeft); });
    }
    save(); renderTimeline();
  }, { passive: false });
  scroll.addEventListener('dragover', e => {
    if (![...(e.dataTransfer?.types || [])].includes('text/plain')) return;
    e.preventDefault();
    // 未入线拖入：实时预览落点卡片与轴上位置
    if (!poolDragId || !editUnlocked) return;
    const p = clip(poolDragId); if (!p) return;
    const rect = $('#timeline-track').getBoundingClientRect();
    const left = clamp(e.clientX - rect.left, 40, Math.max(420, scroll.clientWidth - 40));
    if (tlExpanded) {
      const top = e.clientY - rect.top;
      const rowW = Math.max(420, scroll.clientWidth - 120);
      const drop = expandedDropPosition(new Set([p.id]), left, top, rowW);
      showGhost(top, left);   // 复用行轴线吸附提示
      showPoolGhost(p, left, drop.row * ROW_H + 120);
    } else {
      const pos = Math.max(0, Math.round((e.clientX - rect.left - 40) / tlZoom));
      const x = 40 + pos * tlZoom;
      const midY = (scroll.clientHeight || 230) / 2;
      showPoolGhost(p, x, midY);
    }
  });
  scroll.addEventListener('dragleave', e => { if (!scroll.contains(e.relatedTarget)) hidePoolGhost(); });
  scroll.addEventListener('drop', e => {
    if (!editUnlocked) return;   // 参观模式：不允许拖入时间线
    hidePoolGhost();
    const pid = e.dataTransfer.getData('text/plain');
    const p = clip(pid);
    if (!p) return;
    e.preventDefault();
    if (Number.isFinite(p.position)) return;
    const rect = $('#timeline-track').getBoundingClientRect();
    if (tlExpanded) {
      // 展开模式：按落点吸附最近行轴线，直接放入（未入线池悬浮在旁）
      const rowW = Math.max(420, scroll.clientWidth - 120);
      const left = clamp(e.clientX - rect.left, 40, Math.max(420, scroll.clientWidth - 40));
      const top = e.clientY - rect.top;
      const drop = expandedDropPosition(new Set([pid]), left, top, rowW);
      p.position = drop.position;
      p.exp = { x: left, row: drop.row };
    } else {
      p.position = Math.max(0, Math.round((e.clientX - rect.left - 40) / tlZoom));
    }
    save(); renderTimeline();
    notify('clip 已放入时间线');
  });

  // 线索板
  $('#board-filter-toggle').onclick = () => $('#board-filter').classList.toggle('hidden');
  $('#clear-selection').onclick = () => { const prev = [...selectedBoard]; selectedBoard = []; patchBoardSelection(prev); };
  ['board-story-filter', 'board-character-filter', 'board-timeline-filter'].forEach(x => $('#' + x).onchange = renderBoard);
  $('#board-canvas').addEventListener('wheel', e => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    boardZoom = clamp(boardZoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), BD_MIN, BD_MAX);
    save(); renderBoard();
  }, { passive: false });
  // 按住 Ctrl 拖动平移整个板
  const bcanvas = $('#board-canvas');
  bcanvas.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !e.ctrlKey || e.target.closest('.board-card')) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, sl = bcanvas.scrollLeft, st = bcanvas.scrollTop;
    bcanvas.classList.add('panning');
    const mv = ev => { bcanvas.scrollLeft = sl - (ev.clientX - sx); bcanvas.scrollTop = st - (ev.clientY - sy); };
    const up = () => {
      bcanvas.classList.remove('panning');
      bcanvas.removeEventListener('pointermove', mv);
      bcanvas.removeEventListener('pointerup', up);
      bcanvas.removeEventListener('pointercancel', up);
    };
    bcanvas.addEventListener('pointermove', mv);
    bcanvas.addEventListener('pointerup', up);
    bcanvas.addEventListener('pointercancel', up);
  });

  // 库（搜索输入防抖 150ms：快速连续敲键只渲染最后一次）
  let librarySearchTimer = null;
  $('#library-search').oninput = () => {
    clearTimeout(librarySearchTimer);
    librarySearchTimer = setTimeout(renderLibrary, 150);
  };
  $$('.library-tab').forEach(b => b.onclick = () => {
    libraryTab = b.dataset.tab;
    $$('.library-tab').forEach(x => x.classList.toggle('active', x === b));
    renderLibrary();
  });

  // 码字
  $('#writer-story-select').onchange = e => { activeStoryId = e.target.value; renderWriter(); };
  $('#writer-story-title').oninput = e => {
    const s = story(activeStoryId); if (!s) return;
    s.title = e.target.value;
    normalizeClipNames(activeStoryId);
    $$('.writer-clip-name').forEach((el, i) => el.textContent = `${s.title || '未命名故事'}（${fwNum(i + 1)}/${fwNum(storyClips(activeStoryId).length)}）`);
    markWriterDirty();
  };
  $('#writer-story-title').onblur = () => {
    const option = $('#writer-story-select').selectedOptions[0];
    if (option) option.textContent = story(activeStoryId)?.title || '';
    fillFilters(); renderTimeline(); renderLibrary(); renderBoard();
  };
  $('#writer-new-story').onclick = createStoryInWriter;
  $('#writer-delete-story').onclick = deleteStory;
  $('#writer-add-section').onclick = () => addWriterClip();
  $('#writer-save').onclick = () => { clearTimeout(writerSaveTimer); save(); notify('已保存到此浏览器'); };
  $('#writer-section-filter').onchange = e => { writerSectionFilter = e.target.value; renderWriter(); };
  $('#line-spacing').onchange = $('#paragraph-spacing').onchange = () => {
    db.writerPrefs = { line: Number($('#line-spacing').value), paragraph: Number($('#paragraph-spacing').value) };
    setWriterSpacing(); save();
  };
  $('#writer-collapse-all').onclick = () => {
    const clips = storyClips(activeStoryId), collapse = clips.some(c => !c.collapsed);
    clips.forEach(c => c.collapsed = collapse);
    save(); renderWriter();
  };
  // 码字区（事件委托，重渲染后依然有效）
  const root = $('#writer-sections');
  root.addEventListener('focusin', e => {
    const ed = e.target.closest?.('[data-clip-body]');
    if (ed) { lastWriterEditor = ed; $('#writer-split-float').disabled = false; }
  });
  root.addEventListener('input', e => {
    const ed = e.target.closest?.('[data-clip-body]');
    if (!ed) return;
    const p = clip(ed.dataset.clipBody);
    if (p) saveWriterText(p, ed);
  });
  root.addEventListener('keydown', e => {
    const ed = e.target.closest?.('[data-clip-body]');
    if (ed && (e.ctrlKey || e.metaKey) && ['i', 'u'].includes(e.key.toLowerCase())) e.preventDefault();
  });
  root.addEventListener('paste', e => {
    const ed = e.target.closest?.('[data-clip-body]');
    if (!ed) return;
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
  });
  root.addEventListener('click', e => {
    const collapseBtn = e.target.closest('[data-clip-collapse]');
    if (collapseBtn) {
      const p = clip(collapseBtn.dataset.clipCollapse);
      if (!p) return;
      p.collapsed = !p.collapsed;
      save(); renderWriter();
      return;
    }
    const addBelow = e.target.closest('[data-add-below]');
    if (addBelow) { addWriterClip(addBelow.dataset.addBelow); return; }
    const secBtn = e.target.closest('[data-toggle-section]');
    if (secBtn) {
      const p = clip(secBtn.dataset.toggleSection);
      if (!p) return;
      p.section = p.section === 'outline' ? 'body' : 'outline';
      save(); renderTimeline(); renderLibrary(); renderWriter();
      notify(p.section === 'outline' ? '已标记为大纲' : '已标记为正文');
      return;
    }
    const metaBtn = e.target.closest('[data-clip-meta]');
    if (metaBtn) { openClipMetadata(metaBtn.dataset.clipMeta); return; }
    const detectBtn = e.target.closest('[data-detect]');
    if (detectBtn) {
      const p = clip(detectBtn.dataset.detect);
      if (!p) return;
      const added = detectCharactersInClip(p);
      if (added) { save(); render(); renderWriter(); }
      notify(added ? `识别到 ${added} 位角色` : '没有发现新的角色');
      return;
    }
    const delBtn = e.target.closest('[data-delete-clip]');
    if (delBtn) deleteClip(delBtn.dataset.deleteClip);
  });
  // 拖拽排序
  root.addEventListener('dragstart', e => {
    const handle = e.target.closest('.clip-drag-handle');
    if (!handle) return;
    const row = handle.closest('.writer-section-row');
    writerDragStartOrder = $$('.writer-section-row', root).map(x => x.dataset.clipRow);
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', row.dataset.clipRow);
  });
  root.addEventListener('dragover', e => {
    const target = e.target.closest('.writer-section-row'), dragged = $('.writer-section-row.dragging', root);
    if (!target || !dragged || target === dragged) return;
    e.preventDefault();
    root.querySelectorAll('.drop-target').forEach(x => x.classList.remove('drop-target'));
    target.classList.add('drop-target');
    const rect = target.getBoundingClientRect();
    root.insertBefore(dragged, e.clientY < rect.top + rect.height / 2 ? target : target.nextSibling);
  });
  root.addEventListener('dragleave', e => {
    const row = e.target.closest('.writer-section-row');
    if (row && !row.contains(e.relatedTarget)) row.classList.remove('drop-target');
  });
  root.addEventListener('drop', e => { if (e.target.closest('.writer-section-row')) e.preventDefault(); root.querySelectorAll('.drop-target').forEach(x => x.classList.remove('drop-target')); });
  root.addEventListener('dragend', () => {
    const rows = $$('.writer-section-row', root), ids = rows.map(r => r.dataset.clipRow);
    const changed = writerDragStartOrder.length === ids.length && ids.some((x, i) => x !== writerDragStartOrder[i]);
    rows.forEach(r => r.classList.remove('dragging', 'drop-target'));
    if (changed) {
      ids.forEach((pid, i) => { const p = clip(pid); if (p) p.order = i; });
      normalizeClipNames(activeStoryId);
      save(); render(); renderWriter();
      notify('Clip 顺序已更新，编号已同步');
    }
    writerDragStartOrder = [];
  });
  // Ctrl+Enter 在光标处下方新增 clip
  document.addEventListener('keydown', e => {
    if (activeView !== 'writer' || !(e.ctrlKey || e.metaKey) || e.key !== 'Enter') return;
    if (!$('#view-writer').contains(e.target)) return;
    e.preventDefault();
    const section = e.target.closest('[data-clip-section]');
    addWriterClip(section?.dataset.clipSection || lastWriterEditor?.dataset.clipBody || null);
  });
  // 加粗
  $('#writer-bold').onpointerdown = e => e.preventDefault();
  $('#writer-bold').onclick = () => {
    if (!lastWriterEditor) return notify('请先点击正文，再选择要加粗的文字');
    lastWriterEditor.focus();
    document.execCommand('bold', false);
    lastWriterEditor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'formatBold' }));
  };
  // 悬浮「从光标处断开」
  $('#writer-split-float').onclick = () => {
    if (!lastWriterEditor) return notify('请先点击正文，把光标放到要断开的位置');
    splitClipAtCursor(lastWriterEditor.dataset.clipBody);
  };

  // 角色库
  $('#character-form').onsubmit = e => {
    e.preventDefault();
    const cid = $('#character-id').value, name = $('#character-name').value.trim();
    if (!name) return;
    const dup = db.characters.find(c => c.id !== cid && c.name.trim().toLowerCase() === name.toLowerCase());
    if (dup) { notify('角色数据库中已有同名角色'); return; }
    let c = charObj(cid);
    if (!c) { c = { id: id() }; db.characters.push(c); }
    c.name = name; c.enName = $('#character-enname').value.trim(); c.kind = $('#character-kind').value; c.description = $('#character-description').value.trim();
    save(); fillFilters(); render(); renderCharacterDB(); resetCharacterForm();
    notify(cid ? '角色资料已更新' : '角色已加入数据库');
  };
  $('#character-cancel-edit').onclick = resetCharacterForm;
  $('#character-search').oninput = renderCharacterDB;
  $('#merge-duplicates').onclick = mergeDuplicateCharacters;
  $('#character-kind-filter').onchange = renderCharacterDB;
  $('#detect-all-characters').onclick = detectAllCharacters;

  // 线索库
  $('#clue-form').onsubmit = e => {
    e.preventDefault();
    const cid = $('#clue-id').value, name = $('#clue-name').value.trim();
    if (!name) return;
    const dup = db.clues.find(c => c.id !== cid && c.name.trim().toLowerCase() === name.toLowerCase());
    if (dup) { notify('已有同名线索'); return; }
    let c = clueObj(cid);
    if (!c) { c = { id: id() }; db.clues.push(c); }
    c.name = name; c.description = $('#clue-description').value.trim();
    save(); render(); renderClueDB(); resetClueForm();
    notify(cid ? '线索已更新' : '线索已创建');
  };
  $('#clue-cancel-edit').onclick = resetClueForm;
  $('#clue-search').oninput = renderClueDB;

  // Clip 弹窗
  $('#add-character').onclick = addCharacterFromModal;
  $('#new-character').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); addCharacterFromModal(); } };
  $('#add-clue').onclick = addClueFromModal;
  $('#new-clue').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); addClueFromModal(); } };
  $('#modal-close').onclick = $('#cancel-entry').onclick = closeModal;
  $('#modal-backdrop').onclick = e => { if (e.target === $('#modal-backdrop')) closeModal(); };
  document.addEventListener('keydown', e => {
    if (e.key === 'Control') document.body.classList.add('ctrl-held');
    if (e.key !== 'Escape') return;
    if (tlExpanded) { tlExpanded = false; renderTimeline(); return; }
    closeModal();
  });
  document.addEventListener('keyup', e => { if (e.key === 'Control') document.body.classList.remove('ctrl-held'); });
  $('#entry-form').onsubmit = e => {
    e.preventDefault();
    if (!editUnlocked) return notify('参观模式，无法保存');
    const pid = $('#entry-id').value, prior = pid ? clip(pid) : null;
    const title = $('#entry-title').value.trim();
    if (!title && !prior) return;
    const metaMode = $('#entry-body-field').classList.contains('hidden');
    const characters = $$('#character-picks input:checked').map(inp => {
      const c = charObj(inp.value);
      return c ? { id: c.id, role: c.kind } : null;
    }).filter(Boolean);
    const clueIds = $$('#clue-picks input:checked').map(inp => inp.value);
    if (prior) {
      prior.title = title || prior.title;
      prior.date = $('#entry-date').value.trim();
      prior.timeline = $('#entry-timeline').value.trim();
      prior.section = $('#entry-section').value === 'outline' ? 'outline' : 'body';
      prior.characters = characters;
      prior.clueIds = clueIds;
      if (!metaMode) {
        prior.storyId = $('#entry-story').value;
        prior.body = $('#entry-body').value.trim();
        prior.html = '';
      }
      normalizeClipNames(prior.storyId);
    } else {
      db.passages.push({
        id: id(), storyId: $('#entry-story').value || db.stories[0]?.id, title: title || '未命名 clip',
        body: $('#entry-body').value.trim(), html: '', date: $('#entry-date').value.trim(), timeline: $('#entry-timeline').value.trim(),
        section: $('#entry-section').value === 'outline' ? 'outline' : 'body', characters, clueIds,
        order: db.passages.length, position: null, collapsed: false
      });
    }
    save(); closeModal(); render();
    if (activeView === 'writer') renderWriter();
    notify(prior ? 'clip 设置已保存' : 'clip 已创建');
  };
  $('#delete-entry').onclick = () => {
    const pid = $('#entry-id').value;
    closeModal();
    if (pid) deleteClip(pid);
  };

  // 全局
  window.addEventListener('resize', () => { if (activeView === 'board') drawConnections(); });
}

/* ============ 启动 ============ */
boot();
