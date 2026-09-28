// ---------- video-kit timeline ----------
// Scene files define:
//   S     {name(lt, t, o) -> html}   scene renderers (lt = time since scene start)
//   LINES [{t, hl, caps:[{t,hl,f:[from,to],y,size,red}], nocap}]  one per voice line
//   SPEC  [[sceneName, [firstLine,lastLine], opts]]  opts.sfx = {event: o => [times]}
// Cues (from cues.json): L = [[start,end]] per line, D = total duration, kw = named marks,
// W = per line [[start,end,word]] (TTS word timing; scenes get it scene-relative as o.w).
let TL=[], EV={};
function build(L,D){
  TL=[];EV={cut:[],ok:[],skip:[],pop:[],impact:[],dm:[],price:[],cta:[]};
  const starts=SPEC.map(([,[f]],i)=>i===0?0:Math.max(0,L[f][0]-.12));
  SPEC.forEach(([name,[f,l],opts={}],i)=>{
    const a=starts[i], b=i+1<SPEC.length?starts[i+1]:D;
    const lr=[];for(let k=f;k<=l;k++) lr.push([L[k][0]-a,L[k][1]-a]);
    const caps=[];
    for(let k=f;k<=l;k++){
      const [s,e]=[L[k][0]-a,L[k][1]-a], nxt=(k+1<L.length?L[k+1][0]:D)-a;
      const parts=LINES[k].caps||[{t:LINES[k].t,hl:LINES[k].hl||[]}];
      parts.forEach((p,j)=>{
        const f0=p.f?p.f[0]:j/parts.length, f1=p.f?p.f[1]:(j+1)/parts.length;
        const cs=s+(e-s)*f0, ce=j===parts.length-1?Math.min(e+.35,nxt-.02,b-a):s+(e-s)*f1;
        if(!LINES[k].nocap) caps.push([Math.max(0,cs-.05),ce,p.t,{y:p.y||opts.capY||H*.729,hl:p.hl||[],size:p.size||opts.capSize||84,red:p.red||[]}]);
      });
    }
    const M={};for(const [k,v] of Object.entries(window.MK||{})) M[k]=v-a;
    const w=[];for(let k=f;k<=l;k++) w.push(((window.WD||[])[k]||[]).map(([s,e,x])=>[s-a,e-a,x]));
    const o={...opts,l:lr,caps,dur:b-a,M,w};
    TL.push([name,a,b,o]);
    EV.cut.push(a);
    if(opts.sfx) for(const [k,fn] of Object.entries(opts.sfx)) for(const x of fn(o)) (EV[k]||=[]).push(a+x);
  });
}
window.setCues=function(L,D,mk,wd){window.MK=mk&&!Array.isArray(mk)?mk:{};window.WD=wd||[];window.DUR=D;build(L,D)};
window.events=function(){return EV};
// scene list for the preview UI: [{name, start, end}]
window.scenes=function(){return TL.map(([name,a,b])=>({name,start:a,end:b}))};
// the page for time t (a pure function of t)
function frameHtml(t){
  let sc=TL[TL.length-1];
  for(const s of TL){if(t>=s[1]&&t<s[2]){sc=s;break}}
  const [name,a,,o]=sc;
  if(!S[name]) return `<div class="cap" style="top:${H/2-60}px;color:var(--red)">missing scene: ${esc(name)}</div>`;
  let h=S[name](t-a,t,o);
  h=h.replace(/(\p{Extended_Pictographic})️?/gu,(m,e)=>`<img src="node_modules/@twemoji/svg/${e.codePointAt(0).toString(16)}.svg" style="height:1em;width:1em;vertical-align:-0.12em;margin:0 .06em">`);
  return h+grain(t);
}
// the CLI renderer: draw now, then it waits for the images itself before each screenshot
window.render=function(t){ LIVE.shown=++LIVE.seq; $.innerHTML=frameHtml(t); };

// ---------- live preview (web player) ----------
// Faithful to the final MP4: time snaps to the same frames the render uses (i/fps), and a frame is built
// off-screen and swapped in only once its images (clip frames, photos, logos, emoji) are decoded, so the
// player holds the previous frame instead of flashing blank. Upcoming frames' images are preloaded.
const LIVE={seq:0,shown:0,frame:-1,warm:new Map(),ahead:0};
const FPS=()=>(window.VK&&VK.format&&VK.format.fps)||30;
const SRC=/<img\b[^>]*?\ssrc="([^"]+)"/g;
function warmUrl(u){
  if(LIVE.warm.has(u)) { const im=LIVE.warm.get(u); LIVE.warm.delete(u); LIVE.warm.set(u,im); return im; }
  const im=new Image(); im.decoding='async'; im.src=u; im.ok=false;
  im.ready=im.decode().then(()=>{im.ok=true},()=>{im.ok=true});
  LIVE.warm.set(u,im);
  // keep ~4 s of clip frames decoded (a 720p frame is ~3.5 MB decoded; more than this starves the main thread)
  while(LIVE.warm.size>140) LIVE.warm.delete(LIVE.warm.keys().next().value);
  return im;
}
// look ahead a few frames per call (up to 1.5 s past t), so preloading never stalls a frame
function prefetch(t,maxFrames){
  const f=FPS(), end=Math.min(window.DUR||0,t+1.5);
  if(LIVE.ahead<t||LIVE.ahead>end+1) LIVE.ahead=t;
  for(let k=0;k<maxFrames&&LIVE.ahead<end;k++){
    LIVE.ahead+=1/f;
    let h; try{ h=frameHtml(LIVE.ahead); }catch{ continue; }
    for(const m of h.matchAll(SRC)) warmUrl(m[1]);
  }
}
window.renderLive=function(t){
  // the same frames the MP4 has: 0 … ceil(fps·D)-1
  const f=FPS(), last=Math.max(0,Math.ceil(f*(window.DUR||0))-1), i=Math.min(last,Math.max(0,Math.floor(t*f+1e-6)));
  if(i!==LIVE.frame){
    LIVE.frame=i;
    const ft=i/f, seq=++LIVE.seq;
    const next=document.createElement('div');
    next.innerHTML=frameHtml(ft);
    const warm=[...next.querySelectorAll('img')].map(im=>warmUrl(im.getAttribute('src')));
    const swap=()=>{ if(seq<LIVE.shown) return; LIVE.shown=seq; $.replaceChildren(...next.childNodes); };
    // every image already decoded in memory: paint now; otherwise hold the previous frame until they are
    if(warm.every(w=>w.ok)) swap();
    else Promise.race([Promise.all(warm.map(w=>w.ready)),new Promise(r=>setTimeout(r,1500))]).then(swap);
  }
  prefetch(i/f,4);
};
// after load / a seek: warm the next 2 s right away
window.warmFrom=function(t){ LIVE.frame=-1; LIVE.ahead=Math.max(0,t-1/FPS()); prefetch(LIVE.ahead,Math.ceil(2*FPS())); };
window.warm=function(){ $.innerHTML=`<div class="display">${esc(VK.brand.name||'')}</div><div>${STR.warm||''}</div>`; };
window.setLight=function(on){window.LIGHT=!!on;document.body.classList.toggle('light',!!on)};
