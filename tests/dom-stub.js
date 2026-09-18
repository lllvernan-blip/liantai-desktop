/* ---- minimal DOM stub so the single-file app can boot under node ---- */
function makeEl(sel){
  const store = { innerHTML:"", textContent:"", value:"", disabled:false, open:false,
                  dataset:{}, style:{ setProperty(k,v){ this[k]=v; } }, onclick:null, onchange:null,
                  classList:{ toggle(){}, add(){}, remove(){}, contains(){ return false; } } };
  const noop = ()=>{};
  return new Proxy(store, {
    get(t,p){
      if(p in t) return t[p];
      if(p==="querySelectorAll"||p==="querySelector") return ()=>[];
      return noop;
    },
    set(t,p,v){ t[p]=v; return true; }
  });
}
const __els = {};
globalThis.document = {
  querySelector: s => __els[s] || (__els[s] = makeEl(s)),
  querySelectorAll: () => [],
  addEventListener: () => {},
  removeEventListener: () => {},
  createElement: () => makeEl("a"),
  documentElement: makeEl("html"),
  body: makeEl("body")
};
const __ls = {};
globalThis.localStorage = {
  getItem: k => Object.prototype.hasOwnProperty.call(__ls,k) ? __ls[k] : null,
  setItem: (k,v) => { __ls[k] = String(v); },
  removeItem: k => { delete __ls[k]; },
  clear: () => { for(const k in __ls) delete __ls[k]; },
  get length(){ return Object.keys(__ls).length; }
};
globalThis.location = { host:"localhost:8080", pathname:"/x.html", protocol:"http:", href:"http://localhost:8080/x.html" };
globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};
globalThis.setTimeout = () => 0;
globalThis.clearTimeout = () => {};
globalThis.URL.createObjectURL = () => "blob:stub";
globalThis.__els = __els;
globalThis.__ls = __ls;
