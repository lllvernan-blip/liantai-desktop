'use strict';

/* 应用身份与仓库位置的单一真源：壳（main.js）、更新链（update.js）、发布工具都从这里取，
   免得同一个 owner/repo 在仓库里各写一份、改一处漏一处。
   为什么不直接读 package.json：打包时 electron-builder 会把 build 段剥掉
   （实测 dist 里那份 app.asar 里没有 build / appId 字段），运行期读不到 appId 与 publish。
   所以常量写在这里，package.json 那份是给 electron-builder 上传用的；
   两边是否对得上由测试盯着（tests/shell.mjs 里拿 package.json 逐字段比），对不上就红。 */
const APP = {
  name: 'liantai-desktop',         // 内部 id：userData 目录名、安装目录名、产物名前缀都按它来，永远不改
  appId: 'com.lllvernan.liantai',  // 与 package.json 的 build.appId 一致（换包时要核包身份）
  owner: 'lllvernan-blip',
  repo: 'liantai-desktop',
};

APP.slug = APP.owner + '/' + APP.repo;
APP.releasesUrl = 'https://github.com/' + APP.slug + '/releases';
APP.apiReleases = 'https://api.github.com/repos/' + APP.slug + '/releases';
APP.userAgent = APP.name + '-updater';

module.exports = APP;
