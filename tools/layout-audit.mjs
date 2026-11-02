/*
 * 布局审计的驱动：把每一屏直接摆出来量一遍。不点按钮，不走真流程，不需要 API Key。
 *
 *   npm run audit:layout                    全量：每个模块 × 每个文种 × 三个阶段
 *   npm run audit:layout -- --quick         只跑约 24 个关键屏（十几秒，已挂进 npm run check）
 *   npm run audit:layout -- --fast          只跑 1280 一个宽度（快扫）
 *   npm run audit:layout -- --only=作答     只测名字里带「作答」的
 *   npm run audit:layout -- --widths=1280,960
 *   npm run audit:layout -- --data=real     带上你真实的历史记录
 *   npm run audit:layout -- --update-baseline   把当前软项登记成基线（改了布局、认定新软项是故意的）
 *
 * 输出契约：成功一行，失败才展开。
 *   软项（间距 / 圆角越档）跟 tools/layout-baseline.json 比，只说新增和消失的——
 *   那 8 处是这一版认定的取舍，不是问题，每次刷一遍等于没有信息。
 *   改布局后如果确实要改软项，跑一次 --update-baseline，不要靠在输出里读。
 *
 * 为什么不点按钮：页面是函数式渲染，每一屏都有一个 `renderXxx()` 在 window 上，
 * `state` / `current` / `MODULES` 这些也都在同一个全局词法作用域里读得到。
 * 点按钮要经过状态机、要网络、还要真 API Key；直接调渲染函数一步到位，覆盖反而更全。
 * 作答页和批改页就这么来的——给 `state.history` 塞一条假记录，`openHistRecord()` 就渲染成批改页；
 * 直接给 `current` 赋值再 `renderZyPage()`，就是作答页。都是页面自己的入口，不是绕过去改 DOM。
 *
 * 默认用临时 userData（/tmp/liantai-audit），跑完不碰你的真实数据。
 * --data=real 才读 ~/Library/Application Support/liantai-desktop，那时只读不写。
 *
 * 退出码：有任何一类计数大于 0 就 exit 1，方便挂进 npm run。
 * 「间距越档」「圆角越档」两类不计入退出码——它们登记的是「不统一」，不是「坏了」。
 */
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { app, BrowserWindow } = require('electron')

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DETECT = readFileSync(join(ROOT, 'tools', 'layout-audit.js'), 'utf8') + '\n;void 0'

const args = process.argv.slice(2)
const useReal = args.includes('--data=real')
const fast = args.includes('--fast')
const quick = args.includes('--quick')
const updateBaseline = args.includes('--update-baseline')
const only = (args.find(a => a.startsWith('--only=')) || '').slice(7)
const widthsArg = (args.find(a => a.startsWith('--widths=')) || '').slice(9)
const WIDE = quick ? [1280] : widthsArg ? widthsArg.split(',').map(Number) : (fast ? [1280] : [1280, 960, 780])
const NARROW = [1280]   // 大量文种只用一个宽度扫结构，宽度差异留给关键屏

const sleep = ms => new Promise(r => setTimeout(r, ms))

const Q = (title, theme) => `({
  title: ${JSON.stringify(title)},
  background: "某市近期连续发生三起生产安全事故，市政府要求各区县在入冬前完成一次全面排查，重点覆盖建筑施工、燃气管道、人员密集场所三类。各区县需在12月10日前上报排查结果，并将整改台账同步报送市安委办。部分老旧小区燃气立管超期服役，需同步纳入改造计划。",
  requirements: "一、紧扣材料，要点全面；二、条理清晰，语言简练；三、字数不超过500字。",
  point: "①明确检查范围与重点 ②落实责任分工 ③限定完成时限 ④提出整改要求",
  score: 20, suggestedFormat: "通知", difficulty: "中", theme: ${JSON.stringify(theme)}
})`

// 「不存在」也算一种屏：它是页面的一部分，但只在没数据时出现
const EMPTY_ANSWER = ''

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false, width: 1280, height: 900,
    webPreferences: { sandbox: true, contextIsolation: true, offscreen: true },
  })
  const js = c => win.webContents.executeJavaScript(c)
  await win.loadFile(join(ROOT, 'app', 'index.html'))
  await sleep(900)
  await js(DETECT)

  const run = () => js('JSON.parse(JSON.stringify(layoutAudit()))')
  const report = []

  // quick：只摆代表屏。门面、每个模块页、公文与一个普通模块的作答、批改两档、抽屉、画像、弹层、整卷。
  const take = async (name, code, widths, isQuick) => {
    if (only && !name.includes(only)) return
    if (quick && !isQuick) return
    try {
      if (code) {
        const err = await js(`(function(){ try{ ${code}; return '' }catch(e){ return (e && e.message) || String(e) } })()`)
        if (err) throw new Error(err)
      }
      await sleep(200)
      for (const w of (widths || WIDE)) {
        win.setSize(w, 900)
        await sleep(150)
        report.push({ 屏: name, ...(await run()) })
      }
    } catch (e) {
      report.push({ 屏: name, 失败: e.message })
    }
  }

  // ---- 先从页面里读出全部模块和文种，不再手写清单
  const meta = await js(`(function(){
    const mods = Object.keys(MODULES).map(k => ({ k, name: MODULES[k].name, subs: MODULES[k].subtypes || null }));
    const gw = (typeof GONGWEN_TYPES !== 'undefined') ? GONGWEN_TYPES.map(x => x.type) : [];
    return { mods, gw };
  })()`)
  const totalSubs = meta.mods.reduce((a, m) => a + (m.subs ? m.subs.length : (m.k === 'zy.gongwen' ? meta.gw.length : 1)), 0)
  console.log(`模块 ${meta.mods.length} 个，文种 ${totalSubs} 个（公文 ${meta.gw.length}）`)

  // ---- 入口与科目（这三个是门面，走全宽度）
  await take('首页', 'renderHome()', null, true)
  await take('科目-综应A', 'renderStart()', null, true)
  await take('科目-申论', 'switchSubject("sl")', null, true)

  // ---- 模块页（公文写作那一屏带折叠分组）
  for (const m of meta.mods) {
    await take(`模块-${m.k}`, `renderModuleLanding(${JSON.stringify(m.k)})`, NARROW, true)
  }

  // ---- 作答页：每个模块 × 每个文种 × 三个阶段
  const quickMods = new Set(['zy.gongwen', meta.mods[0].k])
  for (const m of meta.mods) {
    const subs = m.subs || (m.k === 'zy.gongwen' ? meta.gw : [''])
    for (let si = 0; si < subs.length; si++) {
      const sub = subs[si]
      for (const phase of ['read', 'draft', 'review']) {
        await js(`current = { module:${JSON.stringify(m.k)}, subtype:${JSON.stringify(sub)},
          question:${Q('关于做好冬季安全生产检查工作的通知', '安全生产')}, keyPoints:[], cardPeeks:0, phase:${JSON.stringify(phase)} };
          renderZyPage()`)
        await take(`作答-${m.k}-${sub}-${phase}`, null, NARROW,
          si === 0 && quickMods.has(m.k) && phase !== 'read')
      }
    }
  }

  // ---- 批改页：三档分数 × 有答卷 / 空答卷
  for (const [label, total, ans] of [['高分', 88, true], ['中分', 62, true], ['低分', 31, true], ['零分空卷', 0, false]]) {
    await js(`state.history = [{ module:"zy.gongwen", subtype:"通知",
      question:${Q('关于做好冬季安全生产检查工作的通知', '安全生产')}, keyPoints:[], hits:[],
      answer:${JSON.stringify(ans ? '各区县：\n一、立即开展排查。覆盖建筑施工、燃气管道、人员密集场所三类。\n二、落实责任分工，由分管领导牵头。\n三、12月10日前上报排查结果。\n四、对发现的隐患建立台账，限期整改。' : EMPTY_ANSWER)},
      grade:{ total:${total} }, usedSec:1500, timeLimit:1800 }]; openHistRecord(state.history[0])`)
    await take(`批改-${label}`, null, null, label === '高分' || label === '零分空卷')
  }

  // ---- 学习卡抽屉
  await js(`current = { module:"zy.gongwen", subtype:"通知", question:${Q('关于做好冬季安全生产检查工作的通知', '安全生产')}, keyPoints:[], cardPeeks:0, phase:"draft" }; renderZyPage()`)
  await take('学习卡抽屉', 'document.body.insertAdjacentHTML("beforeend", cardDrawerHtml()); current.cardPeeks=0; openCardDrawer(0)', null, true)

  // ---- 画像：一级 + 每个二级
  await js(`state.history = [{ module:"zy.gongwen", subtype:"通知", question:${Q('关于做好冬季安全生产检查工作的通知','安全生产')}, keyPoints:[], hits:[], answer:"各区县：一、立即开展排查。", grade:{ total:82 }, usedSec:1500, timeLimit:1800 }]`)
  await take('画像-一级', 'renderProfile()', null, true)
  for (const [kind, key] of [['mod', 'zy.gongwen'], ['pd', ''], ['exp', ''], ['hist', '']]) {
    await take(`画像-${kind}`, `profGo(${JSON.stringify(kind)}, ${JSON.stringify(key)})`, null, kind === 'hist')
  }

  // ---- 空态：没有任何历史时的画像和首页
  await js('state.history = []')
  await take('空态-画像', 'renderProfile()')
  await take('空态-首页', 'renderHome()')

  // ---- 两个弹层
  await take('设置弹层', 'renderHome(); openModal("modalSettings")', null, true)
  await take('画像弹层', 'renderHome(); openModal("modalProfile")')

  // ---- 整卷页
  await take('整卷页', 'renderPaper()', null, true)

  // ---- 汇报：成功一行，失败才展开。硬项判退出码，软项跟基线比。
  const HARD = ['文字重叠', '文字被裁', '收起却占位', '控件高度', '字号越档', '渗出']
  const SOFT = ['间距越档', '圆角越档']
  const screenNames = new Set(report.map(r => r.屏))

  const failedNames = [...new Set(report.filter(r => r.失败).map(r => r.屏))]
  const hardRows = report.filter(r => !r.失败 && HARD.some(k => (r.计数 || {})[k] > 0))

  // 软项只记「形状」（哪个容器的哪个子元素差多少），不记是哪一屏出现几次：
  // 记屏名的话，改一个屏名或扩一次覆盖，基线就全废了。
  const shapeOf = (kind, it) => kind + '|' + Object.entries(it).filter(([k]) => k !== '类型').map(([, v]) => v).join('|')
  const softShapes = new Map()   // shape → 次数
  const softSample = new Map()   // shape → 一条原始明细
  for (const r of report) {
    if (r.失败) continue
    for (const k of SOFT) for (const it of (r.明细 || {})[k] || []) {
      const s = shapeOf(k, it)
      softShapes.set(s, (softShapes.get(s) || 0) + 1)
      if (!softSample.has(s)) softSample.set(s, { 类: k, 屏: r.屏, ...it })
    }
  }

  const BASE_FILE = join(ROOT, 'tools', 'layout-baseline.json')
  let base = []
  try { base = JSON.parse(readFileSync(BASE_FILE, 'utf8')).软项 || [] } catch {}
  const baseSet = new Set(base)

  if (updateBaseline) {
    writeFileSync(BASE_FILE, JSON.stringify({
      note: '已知且故意的软项（间距 / 圆角越档）。不是问题，是这一版认定的取舍。改布局后认定新的取舍，跑 --update-baseline 重登记。',
      软项: [...softShapes.keys()].sort(),
    }, null, 2) + '\n')
    console.log(`基线已登记：${softShapes.size} 种软项形状 → tools/layout-baseline.json`)
    app.exit(0)
    return
  }

  if (failedNames.length || hardRows.length) {
    console.log(`✘ 布局 ${screenNames.size} 屏，硬项 ${hardRows.length} 处` + (failedNames.length ? `，${failedNames.length} 屏测量失败` : ''))
    for (const n of failedNames.slice(0, 8)) console.log('  测量失败 ' + n)
    const seen = new Set()
    let printed = 0
    let detailLines = 0
    const MAX_DETAIL = 24   // 明细封顶：186 屏都坏时，没必要把 1800 行搬出来
    for (const r of hardRows) {
      const key = r.屏 + '|' + JSON.stringify(r.计数)
      if (seen.has(key)) continue
      seen.add(key)
      if (printed++ >= 10 || detailLines >= MAX_DETAIL) { console.log('  …还有，单跑 --only=屏名 看全部'); break }
      const nz = Object.fromEntries(Object.entries(r.计数 || {}).filter(([, v]) => v > 0))
      console.log(`  【${r.屏}】${r.屏宽}px ${JSON.stringify(nz)}`)
      detailLines++
      for (const k of HARD) {
        const list = (r.明细 || {})[k] || []
        if (!list.length) continue
        for (const it of list.slice(0, 3)) {
          if (detailLines >= MAX_DETAIL) break
          console.log(`    ${k} ` + JSON.stringify(it))
          detailLines++
        }
        if (list.length > 3) console.log(`    ${k} …还有 ${list.length - 3} 条`)
      }
    }
    app.exit(1)
    return
  }

  const added = [...softShapes.keys()].filter(s => !baseSet.has(s))
  const gone = [...baseSet].filter(s => !softShapes.has(s))
  const softNote = softShapes.size === 0 ? '软项 0'
    : (!added.length && !gone.length) ? `软项 ${softShapes.size} 处（与基线一致）`
    : `软项 ${softShapes.size} 处（新增 ${added.length}，消失 ${gone.length}）`
  console.log(`✔ 布局 ${screenNames.size} 屏 0 问题 · ${softNote}`)
  for (const s of added.slice(0, 10)) console.log('  + ' + JSON.stringify(softSample.get(s)))
  for (const s of gone.slice(0, 10)) console.log('  - ' + s)
  if (added.length) console.log('  新增的如果确实是故意留的，跑 --update-baseline 登记进基线。')
  app.exit(0)
}).catch(e => { console.error('ERR', e && e.stack || e); app.exit(2) })
