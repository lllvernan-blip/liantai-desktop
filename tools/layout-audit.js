/*
 * 布局审计：在真浏览器里量几何，找「看得见的问题」。
 *
 *   const r = layoutAudit()          // 跑当前这一屏
 *
 * 为什么要单独有它：`tests/assertions.js` 跑在 jsdom 里，没有布局引擎，
 * getBoundingClientRect 一律返回 0——文字压住文字、胶囊溢到下一组、
 * 内容撑破容器，这些它一条都测不出来。而「看着乱」恰恰全是几何问题。
 *
 * 判据是「两个东西真的叠在一起」和「该看见的字看不见」，不是「值等于几号档」。
 * 前面几次踩过的坑都写进注释，别把它们改回去：
 *
 *   1. 纸面有缩放（--paper-scale）。rect 是缩放后的值，offsetHeight 是布局值。
 *      拿 rect 去比 30/36/48/64，64 会读成 71，全是假警报。
 *   2. 收起的 details 用 content-visibility 藏内容，computed display 仍是 block，
 *      rect 还有尺寸；只有 checkVisibility() 认得出来。光看 display 会把
 *      「已经藏好的内容」当成溢出。
 *   3. 弹层底下的页面元素仍然有 rect；它们在 elementFromPoint 里被盖住了，
 *      不算重叠。不排掉的话，每开一次设置就报十几条。
 *   4. 清单行（.mrow / .navrow）靠 border-bottom 画分隔线，兄弟贴死是设计，
 *      不是粘在一起。它们的高度由内容决定，也不在控件四档的管束范围。
 */
function layoutAudit(root) {
  const scope = (root && root.querySelectorAll) ? root : document;
  const cls = e => {
    let c = e.className;
    if (typeof c !== 'string') c = (c && c.baseVal) || '';
    c = String(c).trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.');
    return e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (c ? '.' + c : '');
  };
  const R = e => e.getBoundingClientRect();
  const inSvg = e => !!e.closest('svg');
  const skip = e => !!e.closest('.tour-hole,.tour-bubble,.tstep,[data-tour]');   // 引导层是覆盖层，不参与
  const ownText = e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
  const LIST_ROW = '.mrow,.navrow,table tr,.swatch';

  const vis = e => {
    const s = getComputedStyle(e);
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false;
    if (e.checkVisibility && !e.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true, contentVisibilityAuto: true })) return false;
    const b = R(e);
    return b.width > 0.5 && b.height > 0.5;
  };
  // 被挡住的元素分两种，必须分开看：
  //   弹层/遮罩压在你身上——那块内容本来就不在视野里，不该算重叠。
  //   同级的另一个文字块压在你身上——这就是要报的重叠，恰恰因为被挡才该报。
  // 所以判据是「挡住它的那个是不是浮层」，不是「有没有被挡」。只按后者会把真重叠全排掉。
  const isOverlay = el => {
    for (let p = el; p && p !== document.documentElement; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.position === 'fixed') return true;
      const cn = typeof p.className === 'string' ? p.className : '';
      if (/(^|[-_])(overlay|mask|scrim|modal|dialog|sheet|tour|pop|layer)([-_]|$)/i.test(cn)) return true;
    }
    return false;
  };
  const covered = e => {
    const r = R(e);
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
    const top = document.elementFromPoint(x, y);
    if (!top || top === e || e.contains(top) || top.contains(e)) return false;
    return isOverlay(top);
  };

  const all = [...scope.querySelectorAll('body *, .wrap *')].filter(e => vis(e) && !inSvg(e) && !skip(e));
  const textEls = all.filter(ownText).filter(e => !covered(e));
  const out = { 文字重叠: [], 文字被裁: [], 收起却占位: [], 控件高度: [], 字号越档: [], 渗出: [], 间距越档: [], 圆角越档: [] };

  // ---- 1. 文字重叠：两块各自带文字的区域相交，且互不为祖先
  // inline 元素跨行时 getBoundingClientRect 返回的是各行盒的并集，两个相邻 span 一旦换行，
  // 并集必然相交，那不是重叠。所以取多行盒的改用 getClientRects 逐行比，任意一行盒相交才算。
  // （批改页 960px 下答案区收成 389px 后「一、立即开展排查。」与下一个 span 各跨两行，就是这一条假报。）
  const rectsOf = e => {
    const rs = e.getClientRects ? [...e.getClientRects()] : [];
    return rs.length > 1 ? rs : [R(e)];
  };
  const hitOf = (ra, rb) => {
    const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
    const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    return (ox > 1 && oy > 1) ? { ox, oy } : null;
  };
  for (let i = 0; i < textEls.length; i++) {
    const a = textEls[i], ras = rectsOf(a);
    for (let j = i + 1; j < textEls.length; j++) {
      const b = textEls[j], rbs = rectsOf(b);
      if (a.contains(b) || b.contains(a)) continue;
      let w = null;
      search: for (const ra of ras) for (const rb of rbs) { w = hitOf(ra, rb); if (w) break search; }
      if (w) {
        out.文字重叠.push({ a: cls(a), 甲: a.textContent.trim().slice(0, 12), b: cls(b), 乙: b.textContent.trim().slice(0, 12), 横: Math.round(w.ox), 纵: Math.round(w.oy) });
      }
    }
  }

  // ---- 1.5 收起却占位：比「重叠」更直指根因的一类
  // 收起的 <details> 里，内容如果自己写了 display:flex，就压过了浏览器默认的
  // `details:not([open])>*{display:none}`（UA 选择器特异性更低），于是 checkVisibility 报 false（认为看不见）
  // 而 getBoundingClientRect 仍有尺寸（它真的占着地方）。结果就是下一组被一个看不见的块顶下去。
  // 只能整块按 <details> 看，不能靠 vis() 筛——vis() 在这一步恰好会把它当成「不在画面里」排掉。
  for (const d of scope.querySelectorAll('details:not([open])')) {
    // 不看 details 自己的 checkVisibility：收起的折叠件里，浏览器会把内部内容整块当成「不可见」，
    // 但那不代表它没画出来。真正的判据只有下面那个 elementFromPoint。
    const dr = R(d);
    if (dr.width < 3) continue;
    for (const c of [...d.children]) {
      if (c.tagName === 'SUMMARY') continue;
      const r = R(c);
      if (r.width < 3 || r.height < 3) continue;
      // rect 不能全信：折叠件里的子元素常常留着上次展开时的尺寸，但它并没有真的画到屏幕上。
      // 能区分两者的只有 elementFromPoint——能点到它（或它的后代）才是真占位，否则只是残留 rect。
      const px = Math.round(r.left + Math.min(20, r.width / 2));
      const py = Math.round(r.top + Math.min(10, r.height / 2));
      if (px < 0 || py < 0 || px >= innerWidth || py >= innerHeight) continue;
      const hit = document.elementFromPoint(px, py);
      if (!hit || (hit !== c && !c.contains(hit))) continue;
      out.收起却占位.push({ 卡片: cls(d), 子: cls(c), 宽: Math.round(r.width), 高: Math.round(r.height), 显示: getComputedStyle(c).display });
    }
  }

  // ---- 2. 文字被裁：只有 overflow 会裁；visible 时字溢出去也看得见，不算
  for (const e of textEls) {
    const s = getComputedStyle(e);
    if (s.textOverflow === 'ellipsis') continue;                        // 省略号是显式选择
    if (/^(auto|scroll|visible)$/.test(s.overflowX)) continue;
    const dw = e.scrollWidth - e.clientWidth;
    if (dw > 1) out.文字被裁.push({ el: cls(e), 差: dw, 宽: e.clientWidth, 需要: e.scrollWidth, 文: e.textContent.trim().slice(0, 20) });
  }

  // ---- 3. 控件高度：只查真控件
  // textarea 不收：它的高度跟着内容长、还能被用户往下拖（resize:vertical），不是四档能锁住的东西。
  // 行和色板的同理，高度由内容决定。
  const H_OK = [30, 36, 48, 64];
  for (const e of all) {
    if (e.matches(LIST_ROW) || e.closest(LIST_ROW)) continue;
    const tag = e.tagName.toLowerCase();
    if (!['button', 'select', 'input', 'a'].includes(tag)) continue;
    const h = Math.round(e.offsetHeight);
    if (!H_OK.includes(h)) out.控件高度.push({ el: cls(e), 高: h, 文: (e.textContent || '').trim().slice(0, 12) });
  }

  // ---- 4. 字号：落在五档之内（13 / 15 / 17 / 28 / 32，加纸上的 16 与红头 30）
  const F_OK = [13, 15, 16, 17, 28, 30, 32];
  for (const e of textEls) {
    const fs = Math.round(parseFloat(getComputedStyle(e).fontSize) * 10) / 10;
    if (!F_OK.includes(fs)) out.字号越档.push({ el: cls(e), 字号: fs, 文: e.textContent.trim().slice(0, 14) });
  }

  // ---- 5. 渗出：子元素横向顶出父容器（纵向允许，纸面里内容本来就会往下长）
  for (const p of all) {
    if (R(p).width < 40) continue;
    for (const c of [...p.children]) {
      if (!vis(c) || skip(c) || inSvg(c)) continue;
      const l = Math.round(R(p).left - R(c).left), r = Math.round(R(c).right - R(p).right);
      if (l > 2 || r > 2) out.渗出.push({ 父: cls(p), 子: cls(c), 左出: l, 右出: r });
    }
  }

  // ---- 6. 间距越档 + 贴死：只看同一父容器下、相邻两个块级兄弟
  // 间距档是 0 / 4 / 8 / 12 / 16 / 24 / 32（与 CSS 里实际在用的那七个数一致）。
  // 行内元素（span / a / b …）不算：它们的 top/bottom 是行盒边缘，量出来的 17 / 19 是行高不是间距，
  // 拿它去卡间距档只会把每一段正文都报一遍。清单行（.mrow / .navrow / tr / .swatch）贴死也不算粘，
  // 它们靠 border 画分隔线，贴死是设计。
  const G_OK = [0, 4, 8, 12, 16, 24, 32];
  const BLOCKY = ['block', 'flex', 'grid', 'list-item', 'table', 'flow-root'];
  for (const p of all) {
    const ps = getComputedStyle(p);
    if (!BLOCKY.includes(ps.display)) continue;
    const kids = [...p.children].filter(c => {
      if (!vis(c) || skip(c) || inSvg(c)) return false;
      return BLOCKY.includes(getComputedStyle(c).display) || c.tagName === 'DETAILS';
    });
    if (kids.length < 2) continue;
    for (let i = 1; i < kids.length; i++) {
      // 只算真兄弟：过滤掉隐藏元素后，kids[i-1] 和 kids[i] 中间可能还夹着一个 display:none 的东西，
      // 那样量出来的距离是那个隐藏元素的高度，不是间距（52 / 40 不少是这么来的假数）。
      if (kids[i - 1].nextElementSibling !== kids[i]) continue;
      const a = R(kids[i - 1]), b = R(kids[i]);
      if (a.width < 2 || b.width < 2) continue;
      const gap = Math.round(b.top - a.bottom);
      if (gap < 0) continue;                     // 负的是重叠，上面已经报过了
      const sa = getComputedStyle(kids[i - 1]), sb = getComputedStyle(kids[i]);
      // 一个元素的 padding 算不算“与隔壁的间距”，看它自己是不是一张独立的表面：
      //   有背景色或有边框 → 它是卡片，padding 是卡片内边距，不该计进间距（两个 .setgrp 之间的真空白就是那个 24 的 gap）；
      //   全透明无框 → 它是擦背的容器，padding 就是在给隔壁留白，要算。
      // 不区分的话，两个 setgrp 的 24 会被读成 56，然后你去改一个根本不存在的间距。
      const hasSurface = st => {
        const bg = st.backgroundColor;
        const opaque = !!bg && bg !== 'transparent' && !/rgba\(0,\s*0,\s*0,\s*0\)/.test(bg);
        const border = (parseFloat(st.borderTopWidth) || 0) > 0 || (parseFloat(st.borderBottomWidth) || 0) > 0;
        return opaque || border;
      };
      const pPad = hasSurface(sa) ? 0 : (parseFloat(sa.paddingBottom) || 0);
      const nPad = hasSurface(sb) ? 0 : (parseFloat(sb.paddingTop) || 0);
      // 视觉间距 = 两个边框盒之间的空 + 擦背容器两侧的内边距。
      const visual = gap + pPad + nPad;
      const isRow = kids[i].matches(LIST_ROW) || kids[i - 1].matches(LIST_ROW);
      if (isRow) continue;                       // 清单行靠 border 画线，贴死是设计
      if (visual === 0) {
        out.间距越档.push({ 类型: '贴死', 父: cls(p), 前: cls(kids[i - 1]), 后: cls(kids[i]), 间距: 0 });
      } else if (!G_OK.includes(Math.round(visual)) && visual < 60) {
        out.间距越档.push({ 类型: '越档', 父: cls(p), 前: cls(kids[i - 1]), 后: cls(kids[i]), 间距: Math.round(visual) });
      }
    }
  }

  // ---- 7. 圆角越档：全站只许 0 / 6 / 8 / 12 / 16 / 999
  const R_OK = [0, 6, 8, 12, 16, 999];
  for (const e of all) {
    const br = getComputedStyle(e).borderTopLeftRadius;
    if (!br || br === 'auto') continue;
    const n = br.endsWith('%') ? 999 : Math.round(parseFloat(br));
    if (Number.isNaN(n)) continue;
    if (!R_OK.includes(n)) out.圆角越档.push({ el: cls(e), 圆角: br });
  }

  const trim = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.slice(0, 10)]));
  const counts = Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length]));
  return { 屏宽: innerWidth, 屏高: innerHeight, 计数: counts, 明细: trim(out), 总计: Object.values(counts).reduce((a, b) => a + b, 0) };
}
/* 交卷出口的真实几何：长答卷、窗口压到 900×600 时，只要作答框还在视口里，
   提交按钮就必须也在视口里。源码里写着 sticky 不等于它吸得住。 */
function submitBarAudit() {
  const bar = document.querySelector('#docBody .actbar');
  const btn = bar && bar.querySelector('#btnSubmit');
  const ans = document.querySelector('#docBody #answer');
  if (!bar || !btn || !ans) return { ok: false, bad: [{ 原因: '找不到作答框或提交按钮' }] };
  const H = innerHeight;
  const doc = document.documentElement;
  const prev = scrollY || 0;
  /* 页面全局有 scroll-behavior:smooth；同步 scrollTo 之后立刻量，量到的是动画起点。
     量几何时临时改回 auto，量完恢复。 */
  const pre = {
    滚动: Math.round(scrollY || 0),
    按钮顶: Math.round(btn.getBoundingClientRect().top),
    作答顶: Math.round(ans.getBoundingClientRect().top),
    滚动行为: getComputedStyle(doc).scrollBehavior,
  };
  const behavior = doc.style.scrollBehavior;
  doc.style.scrollBehavior = 'auto';
  const ansTop = ans.getBoundingClientRect().top + prev;
  const maxY = Math.max(0, doc.scrollHeight - H);
  const points = [...new Set([0, maxY / 2, maxY, ansTop - H / 2]
    .map(y => Math.round(Math.max(0, Math.min(maxY, y)))))];
  const bad = [];
  let checked = 0;
  for (const y of points) {
    scrollTo(0, y);
    const ar = ans.getBoundingClientRect();
    if (!(ar.bottom > 0 && ar.top < H)) continue;   // 作答框不在视口，这一档不适用
    checked++;
    const br = btn.getBoundingClientRect();
    if (br.width < 1 || br.height < 1 || br.top < -1 || br.bottom > H + 1) {
      bad.push({ 滚到: y, 实际: Math.round(scrollY || 0), 按钮顶: Math.round(br.top), 按钮底: Math.round(br.bottom), 视口高: H });
    }
  }
  scrollTo(0, prev);
  doc.style.scrollBehavior = behavior;
  if (!checked) bad.push({ 原因: '作答框始终不在视口，没量到' });
  const cs = getComputedStyle(bar), as = getComputedStyle(ans);
  const bars = [...document.querySelectorAll('.actbar')].map(e => {
    const r = e.getBoundingClientRect();
    return { 顶: Math.round(r.top), 底: Math.round(r.bottom), 高: Math.round(r.height), 定位: getComputedStyle(e).position };
  });
  return { ok: bad.length === 0, bad, checked, debug: {
    视口: [innerWidth, innerHeight], 文档高: doc.scrollHeight, body: document.body.className,
    动作条: { 定位: cs.position, 底: cs.bottom, 顶: Math.round(bar.getBoundingClientRect().top), 底px: Math.round(bar.getBoundingClientRect().bottom) },
    动作条数: bars,
    作答框: { 顶: Math.round(ans.getBoundingClientRect().top), 底: Math.round(ans.getBoundingClientRect().bottom), 溢出: as.overflowY },
    文档: { 缩放: getComputedStyle(doc).zoom, 宽: Math.round(doc.getBoundingClientRect().width), 顶: Math.round(doc.getBoundingClientRect().top) },
    纸栏: (() => { const p = document.querySelector('#docBody .paper-cols'); if (!p) return null;
      const s = getComputedStyle(p); return { 显示: s.display, 变换: s.transform, 动画: s.animationName, 状态: s.animationPlayState }; })(),
    pre,
    档位: points,
  } };
}
if (typeof window !== 'undefined') { window.layoutAudit = layoutAudit; window.submitBarAudit = submitBarAudit; }
// executeJavaScript 会把这段脚本的最后表达式当返回值送出去；补一条 void 0，
// 免得把函数本身丢进 IPC，那边克隆不了对象会直接报「An object could not be cloned」。
if (typeof window !== 'undefined') void 0;
