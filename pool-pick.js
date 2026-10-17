'use strict';

/*
 * 从材料池里取一篇。纯函数：不碰磁盘、不碰 electron，各种池子形态都能直接拿它量。
 *
 * 两条要求，缺一条这条路就废：
 *   1. **没用过的优先**——同一个人不该重复拿到同一篇；
 *   2. **都用过了也要给得出一篇**——只在池子真的空的时候才返回 null。原来是「都用过就回 null，
 *      由界面回落编材料」，结果是答满一轮之后有据模式永远熄掉。材料的供给是滚动的（池子会随
 *      发布更新变大），取材不该比供给更早熄火。
 *
 * 重放怎么算「隔了一段」：history 本身就是使用次序（末尾是最新的），按它的位置排队，
 * 越靠前越久没用过；排掉最近 RECENT 次用过的，从剩下的里挑。池子比 RECENT 还小的时候窗口
 * 自动收窄（收窄到「排掉 1 篇」），保证池子多大都能给出一篇、能一直转下去。
 */

const RECENT = 20;   // 同一篇至少隔这么多道题才会再出现（池子比它小就按比例收窄）

function pickOne(all, history, topics, rand) {
  const list = (Array.isArray(all) ? all : []).filter((x) => x && x.name);
  if (!list.length) return null;
  const hist = (Array.isArray(history) ? history : []).filter((x) => typeof x === 'string');
  const want = Array.isArray(topics) ? topics : [];
  const rnd = (typeof rand === 'function') ? rand : Math.random;

  /* 「最久没用过」看的是**最后一次**用的位置：调用方按理会把重放的一篇从原处摘掉再压末尾，
     但这里不指望它——名单里万一留了同名两次，用 indexOf 会把刚用过的那篇当成最旧的。 */
  const at = (n) => hist.lastIndexOf(n);
  /* 主题对得上的优先，但不强求：对不上也得给一篇，否则弱项主题一冷门就取不到材料 */
  const preferTopic = (arr) => {
    const hit = arr.filter((x) => want.length && (Array.isArray(x.topics) ? x.topics : []).some((t) => want.indexOf(t) >= 0));
    return hit.length ? hit : arr;
  };
  /* 同一档里随机挑，不按固定顺序取——否则每次都是同一份材料的固定轮转，读起来像排好的 */
  const one = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];

  const fresh = list.filter((x) => at(x.name) < 0);
  if (fresh.length) return one(preferTopic(fresh));

  const queue = list.slice().sort((a, b) => at(a.name) - at(b.name));
  const keep = Math.max(1, Math.min(RECENT, queue.length - 1));
  const aged = queue.filter((x) => at(x.name) < hist.length - keep);
  if (aged.length) return one(preferTopic(aged));
  return one(preferTopic(queue));
}

/* ============ 材料骨架的头部解析 ============
   池子里每篇的头几行固定是「# 标题 / 来源：URL / 发布：日期 / 主题：a、b」。
   抽成纯函数是为了能拿真文件直接断言——main.js 是 electron 入口，测试 require 不进来。 */

/* 域名 → 媒体名。只认得出来的；认不出来的原样返回域名，不假装认识。 */
function mediaName(host){
  const h = String(host || "").toLowerCase();
  if(!h) return "";
  if(h === "paper.people.com.cn") return "人民日报";
  if(/(^|\.)people\.com\.cn$/.test(h)) return "人民网";
  return h;
}
function sourceHost(url){
  const m = /^https?:\/\/([^\/?#]+)/i.exec(String(url || "").trim());
  return m ? m[1].toLowerCase() : "";
}
function parsePoolHead(text){
  const head = String(text || "").slice(0, 400);
  const grab = (re)=> (((head.match(re) || [])[1] || "")).trim();
  const sourceUrl = grab(/^来源：(.+)$/m);
  const host = sourceHost(sourceUrl);
  return {
    title: grab(/^# (.+)$/m),
    topics: grab(/^主题：(.+)$/m).split("、").map(s=>s.trim()).filter(Boolean),
    media: mediaName(host),
    date: grab(/^发布：(.+)$/m),
    sourceUrl,
    host,
  };
}

module.exports = { pickOne: pickOne, RECENT: RECENT, parsePoolHead: parsePoolHead, mediaName: mediaName, sourceHost: sourceHost };
