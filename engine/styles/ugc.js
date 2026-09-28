// ---------- style: UGC (user-generated content, realistic characters) ----------
// Sells "shot on a phone by a real person": handheld talking-head footage (subtle
// breathing sway, never a cinematic push), native app chrome (status bar, Stories
// progress bar, REC badge), bold native-style captions with a heavy stroke, chat
// bubbles, floating reactions and a swipe-up CTA. Font: project body font (no
// display override — real apps don't use a display face for their UI chrome).
const UGC=(()=>{
  document.head.insertAdjacentHTML('beforeend',`<style>
  .ugc-cap{position:absolute;left:70px;right:70px;text-align:center;font-weight:800;line-height:1.15;color:#fff;
    text-shadow:-3px -3px 0 #000,3px -3px 0 #000,-3px 3px 0 #000,3px 3px 0 #000,0 6px 14px rgba(0,0,0,.4)}
  .ugc-cap .w{display:inline-block;margin:0 .1em}
  .ugc-cap .hl{background:var(--brand);color:#fff;padding:.02em .22em;border-radius:10px;text-shadow:none;box-shadow:0 4px 0 rgba(0,0,0,.3)}
  .ugc-bubble{position:absolute;max-width:640px;padding:22px 30px;border-radius:34px;font:600 40px var(--font);line-height:1.25;box-shadow:0 10px 30px rgba(0,0,0,.25)}
  .ugc-bubble.them{background:#fff;color:#111;border-bottom-left-radius:10px}
  .ugc-bubble.me{background:var(--brand);color:#fff;border-bottom-right-radius:10px;margin-left:auto}
  .ugc-pill{position:absolute;display:flex;align-items:center;gap:12px;background:rgba(0,0,0,.55);backdrop-filter:blur(6px);color:#fff;font:700 30px var(--font);padding:10px 22px;border-radius:999px}
  </style>`);

  // ---- footage ----
  // full-bleed talking-head shot: continuous handheld sway (breathing scale + tiny pan),
  // never a directional push, so it reads as held-in-hand rather than a cinematic camera move.
  function face(name,lt,{x=0,y=0,w=W,h=H,pos='50% 32%',fit='cover',dark=.1,grad=.45,jitter=1}={}){
    const s=1.045+Math.sin(lt*.55)*.013*jitter;
    const tx=Math.sin(lt*.47+1.1)*1.0*jitter, ty=Math.cos(lt*.4)*.8*jitter;
    const xform=`transform:scale(${s.toFixed(4)}) translate(${tx.toFixed(2)}%,${ty.toFixed(2)}%);object-position:${pos}`;
    const inner=assetInfo(name).frames
      ? clip(name,lt,{x:0,y:0,w,h,fit,style:xform})
      : image(name,{x:0,y:0,w,h,fit,style:xform});
    return `<div class="abs" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;overflow:hidden">${inner}
      <div class="abs" style="inset:0;background:linear-gradient(180deg,rgba(0,0,0,${grad*.5}) 0%,transparent 22%,transparent 60%,rgba(0,0,0,${grad}) 100%),rgba(0,0,0,${dark})"></div></div>`;
  }
  // soft blurred brand wash for beats with no footage yet (intro card, CTA end card)
  function bg(t,{tone='dark'}={}){
    const a=Math.sin(t*.9)*60;
    const base=tone==='light'?'var(--paper)':'var(--ink)';
    return `<div class="abs" style="inset:0;background:radial-gradient(65% 50% at ${50+a/25}% 35%,${mix('var(--brand)',tone==='light'?14:26)},transparent 70%),radial-gradient(55% 40% at ${50-a/20}% 90%,${mix('var(--brand2)',tone==='light'?10:16)},transparent 70%),${base}"></div>`;
  }

  // ---- native app chrome ----
  // fake iOS-style status bar: sells "this is a phone screen recording"
  function statusbar(t,{time='9:41',dark=false}={}){
    const c=dark?'#111':'#fff';
    return `<div class="abs" style="left:0;right:0;top:0;height:110px;display:flex;align-items:center;justify-content:space-between;padding:0 56px;color:${c};font:700 34px -apple-system,var(--font)">
      <span>${time}</span>
      <span style="display:flex;align-items:center;gap:10px;font-size:26px">▂▄▆█ 5G 🔋</span></div>`;
  }
  // Stories/Reels-style segmented progress bar. active = which segment is filling (0-based), lt/dur = progress inside it
  function storyBar(lt,dur,n,active){
    const segs=Array.from({length:n},(_,i)=>{
      const p=i<active?1:i>active?0:clamp(lt/Math.max(.01,dur));
      return `<div style="flex:1;height:6px;border-radius:999px;background:rgba(255,255,255,.35);overflow:hidden">
        <div style="height:100%;width:${p*100}%;background:#fff;border-radius:999px"></div></div>`;
    }).join('');
    return `<div class="abs" style="left:24px;right:24px;top:${H*.066}px;display:flex;gap:8px">${segs}</div>`;
  }
  // pulsing "● REC 00:14" badge, top-right — raw-footage signal
  function record(t,{x=W-220,y=H*.078,label}={}){
    const on=Math.sin(t*6)>-.3;
    const m=Math.floor(t/60), s=Math.floor(t%60);
    const clock=label??`${m}:${String(s).padStart(2,'0')}`;
    return `<div class="ugc-pill" style="left:${x}px;top:${y}px"><span style="width:16px;height:16px;border-radius:50%;background:var(--red);opacity:${on?1:.25}"></span>REC ${clock}</div>`;
  }

  // ---- caption ----
  // bold native-style caption for o.caps: heavy stroke, one word gets a brand box (hl)
  function caption(lt,c,{y=H*.760,size=78}={}){
    const [s,e,text,o]=c; if(lt<s||lt>=e) return '';
    const hl=(o&&o.hl)||[];
    const words=text.split(' ').map((word,i)=>{
      const p=pop(lt,s+i*.06,.16);
      const cls='w'+(hl.includes(i)?' hl':'');
      return `<span class="${cls}" style="transform:scale(${.5+.5*p});opacity:${clamp(p*3)}">${esc(word)}</span>`;
    }).join(' ');
    return `<div class="ugc-cap" style="top:${y}px;font-size:${size}px">${words}</div>`;
  }

  // ---- reacting to people ----
  // chat/DM bubble. side: 'me' | 'them'
  function bubble(lt,at,text,{x=90,y=H*.469,side='them',w=640}={}){
    if(lt<at) return '';
    const p=pop(lt,at,.22);
    const align=side==='me'?'right':'left';
    return `<div class="ugc-bubble ${side}" style="left:${x}px;top:${y}px;max-width:${w}px;transform-origin:${align} center;transform:scale(${.5+.5*p});opacity:${clamp(p*3)}">${esc(text)}</div>`;
  }
  // floating reaction emoji burst, rising and fading (double-tap-to-like feel)
  function reactionBurst(lt,at,emoji='❤️',{x=W/2,y=H*.677,n=5,spread=140,size=64}={}){
    if(lt<at) return '';
    let out='';
    for(let i=0;i<n;i++){
      const delay=i*.09, k=lin(lt,at+delay,at+delay+1.1);
      if(k<=0||k>=1) continue;
      const dx=(i-(n-1)/2)*(spread/n)+Math.sin(i*2.1)*10;
      const dy=-260*eo(k);
      const op=k<.15?k/.15:1-lin(k,.7,1);
      const rot=(i%2?-1:1)*12*k;
      out+=`<div class="abs" style="left:${x+dx}px;top:${y+dy}px;font-size:${size}px;opacity:${clamp(op)};transform:translate(-50%,-50%) rotate(${rot}deg) scale(${.7+.5*Math.min(1,k*3)})">${emoji}</div>`;
    }
    return out;
  }
  // tap ripple, for "look here" / CTA moments
  function handTap(lt,at,{x=W/2,y=H/2,d=.6}={}){
    if(lt<at||lt>at+d) return '';
    const k=lin(lt,at,at+d);
    return `<div class="abs" style="left:${x}px;top:${y}px;width:${140*(.3+k)}px;height:${140*(.3+k)}px;margin:-${70*(.3+k)}px 0 0 -${70*(.3+k)}px;border-radius:50%;border:6px solid #fff;opacity:${1-k}"></div>`;
  }
  // bouncing "swipe up" / "link in bio" CTA
  function swipeUp(lt,at,{label='Desliza hacia arriba',y=H*.865}={}){
    if(lt<at) return '';
    const p=pop(lt,at,.3), bounce=Math.abs(Math.sin(lt*3.2))*14;
    return `<div class="abs" style="left:0;right:0;top:${y-bounce}px;text-align:center;opacity:${clamp(p*3)};transform:scale(${.6+.4*p})">
      <div style="font-size:44px;line-height:1;color:#fff;text-shadow:0 4px 10px rgba(0,0,0,.4)">︿</div>
      <div style="margin-top:6px;font:800 34px var(--font);color:#fff;text-shadow:0 2px 8px rgba(0,0,0,.5)">${esc(label)}</div></div>`;
  }

  return {face,bg,statusbar,storyBar,record,caption,bubble,reactionBurst,handTap,swipeUp};
})();
