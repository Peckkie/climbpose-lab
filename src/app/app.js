// v0.2 UI, drawing, export, route info, environment and history — moved here unchanged except that
// analysis now goes through src/pose (+ media, camera) and src/core/pipeline.
// Next: split into src/render, src/export, src/route, src/environment, src/history, src/ui (ROADMAP Phase 1.6–1.7).
import { createLandmarker } from '../pose';
import { extractTrack } from '../pose/extract';
import { seekTo } from '../media';
import { runPipeline } from '../core/pipeline';
import { ANGLES } from '../core/kinematics';
import { ENDS } from '../core/segmentation';
import { runs } from '../core/signal';

(function(){
'use strict';
const BONES_L=[[11,13],[13,15],[15,19],[23,25],[25,27],[27,29],[29,31],[27,31],[11,23]];
const BONES_R=[[12,14],[14,16],[16,20],[24,26],[26,28],[28,30],[30,32],[28,32],[12,24]];
const BONES_C=[[11,12],[23,24]];
const JOINTS=[11,12,13,14,15,16,23,24,25,26,27,28];
const STYLES={
  neon:{dim:.45,desat:.55,L:'#00F0FF',R:'#FF2BD6',C:'#FFFFFF',joint:'#FFFFFF',accent:'#C6FF00',text:'#FFFFFF',mute:'rgba(255,255,255,.55)',glow:16,hand:'#C6FF00',foot:'#FF2BD6',trail:'grad'},
  chalk:{dim:.18,desat:1,L:'#FFFFFF',R:'#FFFFFF',C:'#FFFFFF',joint:'#FF5A1F',accent:'#FF5A1F',text:'#FFFFFF',mute:'rgba(255,255,255,.6)',glow:0,hand:'#FF5A1F',foot:'#FFFFFF',trail:'mono'},
  thermal:{dim:.5,desat:1,L:'#FFD400',R:'#FF7A00',C:'#FFE680',joint:'#FFFFFF',accent:'#FFD400',text:'#FFFFFF',mute:'rgba(255,255,255,.55)',glow:10,hand:'#FFD400',foot:'#00C2FF',trail:'turbo'}
};

const $=s=>document.querySelector(s);
const video=$('#vid'), cv=$('#cv'), ctx=cv.getContext('2d');
const S={mp:null,lmk:null,lmkKind:null,ts:0,raw:null,D:null,style:'neon',routePhoto:null,holdEdits:{add:[],remove:[]},
  show:{skel:1,com:1,limbs:1,holds:1,angles:1,hud:1,crux:1,load:1},frame:'orig',zoom:0,busy:false,exporting:false,endCard:0,livePose:null,srcName:'clip'};

/* ---------- ui helpers ---------- */
function setStatus(msg,cls){const s=$('#status');s.className=cls||'';s.querySelector('span').textContent=msg;}
function fmt(t){if(!isFinite(t))t=0;const m=Math.floor(t/60),s=t-m*60;return String(m).padStart(2,'0')+':'+s.toFixed(1).padStart(4,'0');}
const clamp01=v=>Math.max(0,Math.min(1,v));
const lerp=(a,b,t)=>a+(b-a)*t;

/* ---------- loading video ---------- */
function loadSrc(src,name,cors){
  S.attemptResult={};S.raw=null;S.cache={};S.D=null;S.livePose=null;S.routePhoto=null;S.holdEdits={add:[],remove:[]};updatePhotoInfo();renderStats();
  video.removeAttribute('crossorigin');
  if(cors)video.crossOrigin='anonymous';
  video.src=src;S.srcFile=(name||'clip').split(/[\\/]/).pop().slice(0,60);S.srcName=(name||'clip').replace(/\.[^.]+$/,'').replace(/[^\w\-]+/g,'_').slice(0,40);
  setStatus('Loading video…','busy');
  video.onloadedmetadata=()=>{
    $('#empty').style.display='none';
    layoutCanvas();
    $('#analyze').disabled=false;
    $('#t0').value=0;$('#t1').value=Math.min(video.duration,60).toFixed(1);$('#t1').max=video.duration.toFixed(1);
    setStatus(`Video ${video.videoWidth}×${video.videoHeight} · ${video.duration.toFixed(1)} s — set a range and press "Analyze climb"`,'ok');
    S.envDetected=null;applyEnv();detectEnv();
  };
  video.onerror=()=>setStatus('Could not open the video (a URL must allow CORS)','err');
}
$('#drop').onclick=()=>$('#file').click();
$('#file').onchange=e=>{const f=e.target.files[0];if(f)loadSrc(URL.createObjectURL(f),f.name,false);};
$('#loadUrl').onclick=()=>{const u=$('#url').value.trim();if(u)loadSrc(u,u.split('/').pop(),true);};
for(const el of [$('#drop'),$('#wrap')]){
  el.addEventListener('dragover',e=>{e.preventDefault();$('#drop').classList.add('over');});
  el.addEventListener('dragleave',()=>$('#drop').classList.remove('over'));
  el.addEventListener('drop',e=>{e.preventDefault();$('#drop').classList.remove('over');const f=e.dataTransfer.files[0];if(f&&f.type.startsWith('video'))loadSrc(URL.createObjectURL(f),f.name,false);});
}

/* ---------- canvas layout & view transform ---------- */
function layoutCanvas(){
  const vw=video.videoWidth||1280,vh=video.videoHeight||720;
  if(S.frame==='reel'){cv.width=1080;cv.height=1920;}
  else{const k=Math.min(1920/Math.max(vw,vh),Math.max(1,1080/Math.min(vw,vh)));cv.width=Math.round(vw*k/2)*2;cv.height=Math.round(vh*k/2)*2;}
}
function viewAt(i,a){
  const W=cv.width,H=cv.height,vw=video.videoWidth,vh=video.videoHeight;
  const base=S.frame==='reel'?Math.max(W/vw,H/vh):W/vw;
  const D=S.D;const follow=S.zoom>0&&D;
  const s=base*(follow?S.zoom:1);
  let cx=vw/2,cy=vh/2;
  if(follow){cx=lerp(D.camX[i],D.camX[Math.min(i+1,D.N-1)],a);cy=lerp(D.camY[i],D.camY[Math.min(i+1,D.N-1)],a);}
  let ox=W/2-cx*s,oy=H/2-cy*s;
  ox=vw*s>=W?Math.min(0,Math.max(W-vw*s,ox)):(W-vw*s)/2;
  oy=vh*s>=H?Math.min(0,Math.max(H-vh*s,oy)):(H-vh*s)/2;
  return {s,ox,oy};
}

/* ---------- analysis pass (M01 media, M02 pose, M03 camera) ---------- */
async function analyze(){
  if(S.busy)return;S.busy=true;lockUI(true);
  try{
    const kind=$('#model').value;
    setStatus('Loading pose model ('+kind+')…','busy');
    const landmarker=await createLandmarker(kind);
    video.pause();$('#bar').style.display='block';
    const tStart=performance.now(),vw=video.videoWidth,vh=video.videoHeight;
    const {raw,found}=await extractTrack({video,landmarker,fps:+$('#fps').value,t0:+$('#t0').value||0,t1:+$('#t1').value||video.duration,camera:$('#camcomp').checked,
      onFrame:(i,N,found,lm)=>{
        S.livePose=lm?lm.map(p=>({x:p.x*vw,y:p.y*vh,v:p.visibility??1})):null;
        if(i%2===0){
          drawFrame(-1);
          $('#bar i').style.width=(100*(i+1)/N).toFixed(1)+'%';
          const el=(performance.now()-tStart)/1000,eta=el/(i+1)*(N-i-1);
          setStatus(`Analyzing frame ${i+1}/${N} · climber found ${Math.round(100*found/(i+1))}% · ~${Math.ceil(eta)} s left`,'busy');
        }
      }});
    S.livePose=null;
    S.raw=raw;S.cache={};
    const N=raw.N;
    if(found<N*0.2){setStatus('Climber found in very few frames ('+Math.round(100*found/N)+'%). Try the Heavy model or a clip where the climber is larger.','err');}
    else setStatus('Done · climber found in '+Math.round(100*found/N)+'% of frames — press play','ok');
    process();
    await seekTo(video,raw.t0);
  }catch(e){console.error(e);setStatus('Analysis failed: '+e.message,'err');}
  $('#bar').style.display='none';S.busy=false;lockUI(false);
}
function lockUI(on){for(const id of ['#analyze','#rec','#csv','#json','#fixture','#play','#seek'])$(id).disabled=on||(['#rec','#csv','#json','#fixture'].includes(id)&&!S.D);document.querySelectorAll('#styles .chip,#frame,#zoom,#file,#loadUrl,[data-show]').forEach(el=>el.disabled=on);}
$('#analyze').onclick=analyze;

/* ---------- analysis core (src/core/pipeline) ---------- */
function settings(){const w=+$('#weight').value;return {heightCm:+$('#height').value||170,weightKg:w>0?w:null,wallDeg:+$('#wall').value||0,lrFix:$('#lrfix').checked};}
function process(){
  if(!S.raw)return;
  if(!S.cache)S.cache={};
  S.D=runPipeline({raw:S.raw,settings:settings(),env:envMode(),cache:S.cache,
    edits:{add:S.holdEdits.add,remove:S.holdEdits.remove,attemptResult:S.attemptResult||{}}});
  renderStats();
  for(const id of ['#rec','#csv','#json','#fixture'])$(id).disabled=false;
}

/* ---------- sidebar report ---------- */
function renderStats(){
  const el=$('#stats');const D=S.D;
  if(!D){el.innerHTML='<div class="note">Analyze a video and the efficiency metrics will appear here</div>';return;}
  const M=D.M,sc=D.sc,f=(v,d=1)=>isFinite(v)?v.toFixed(d):'–';
  const card=(k,v,score,desc)=>`<div class="m"><div class="k"><span>${k}</span>${score!=null?`<span>${Math.round(score*100)}</span>`:''}</div><div class="v">${v}</div>${score!=null?`<div class="meter"><i style="width:${Math.round(score*100)}%"></i></div>`:''}<p>${desc}</p></div>`;
  el.innerHTML=`<div class="score"><div class="big">${M.flow}</div><div><b>FLOW SCORE</b><br><small>2D video estimate · climber tracked ${Math.round(M.coverage*100)}%</small></div></div>
  <div class="metrics">
  ${card('Fluency · LDLJ',f(M.ldlj,2),sc.fluency,'Smoothness of the centre of mass; closer to 0 = less jerky')}
  ${card('Path entropy · GIE',f(M.gie,2),sc.path,'How much the CoM path wanders; lower = more direct climbing')}
  ${card('Straight-arm rest',isFinite(M.straightArm)?Math.round(M.straightArm*100)+'%':'–',sc.arms,'Share of rest time on a straight arm — hanging on bone, saving energy')}
  ${card('Foot : Hand',`${M.footHolds} : ${M.handHolds}  (${f(M.footHand,2)})`,sc.feet,'Foot placements per hand move; strong climbers move their feet a lot')}
  ${card('Attempts',`${M.attempts} · ${M.sends} sent`,null,D.attempts.length?D.attempts.map(a=>`#${a.n} · ${fmt(D.t0+a.i0/D.fps)} · ${a.dur.toFixed(1)} s · <b style="color:${a.sent?'#FFD23F':'var(--bad)'}">${a.sent?envText().sent:'not sent'}</b>${a.lastHold?` · ${a.sent?'top':'last'} hold #${a.lastHold.n}${isFinite(a.lastHoldM)?' ('+a.lastHoldM.toFixed(1)+' m)':''}`:''} · ${a.end}
    <select data-att="${a.n}" style="margin-left:6px;background:var(--panel2);border:1px solid var(--line);border-radius:6px;font-size:11px"><option value="auto"${a.override==='auto'?' selected':''}>Auto${a.sentAuto?' (sent)':' (not sent)'}</option><option value="sent"${a.override==='sent'?' selected':''}>Sent</option><option value="fail"${a.override==='fail'?' selected':''}>Not sent</option></select>`).join('<br>'):'No attempt found (both feet never left the floor for 1.5 s)')}
  ${card('High point',`feet ${f(M.highFootM,2)} m · CoM +${f(M.ascentM,2)} m · ${f(M.vSpeed,1)} m/min`,null,'Best attempt: highest foot above the floor, CoM height gained and vertical speed to the high point')}
  ${card('Body load',isFinite(M.handShare)?`${Math.round(M.handShare*100)}% on hands · peak ${Math.round(M.peakHandKg)} kg/hand · shoulder ${Math.round(M.peakShoulderNm)} Nm`:'–',isFinite(M.handShare)?clamp01(1-(M.handShare-0.25)/0.5):null,`Static estimate for ${M.bodyKg} kg${M.bodyKgAssumed?' (ASSUMED — enter body weight for real kg/Nm)':''} on a ${M.wallDeg>0?M.wallDeg+'° overhang':M.wallDeg<0?'slab':'vertical wall'}. Less weight on the hands = feet doing the work. High one-hand load (>50% BW) ${isFinite(M.highLoadPct)?Math.round(M.highLoadPct*100)+'% of wall time':'–'}.`)}
  ${card('Move / Rest',`${Math.round((1-M.immobility)*100)}% / ${Math.round(M.immobility*100)}% · ${M.moves} moves`,null,'Time moving vs. still (reading the route, resting, chalking)')}
  ${card('Path straightness',f(M.straightness,2),null,'Net displacement ÷ distance travelled by the CoM (1 = perfectly straight)')}
  </div>
  <h3 style="margin-top:18px"><span>✕</span> CRUX BREAKDOWN</h3>
  ${D.cruxes.length?D.cruxes.map((c,k)=>`<div class="m"><div class="k"><span>Attempt ${c.att} · ${fmt(D.t0+c.i/D.fps)}</span><button class="btn small" data-crux="${k}">Go to crux ▸</button></div>
    <p>${c.cues.map(q=>`<span style="color:${q.bad?'var(--bad)':'#3DDC97'}">●</span> ${q.t}`).join('<br>')}</p>${c.tips.length?`<p style="color:var(--text)">${c.tips.map(t=>`<b style="color:var(--accent)">TRY →</b> ${t}`).join('<br>')}</p>`:''}</div>`).join(''):'<div class="note">No failed attempt found — crux breakdown needs an attempt that did not top out.</div>'}
  <div class="note">Crux = the frame where the hand reached highest just before coming off. Thresholds (knee &lt;155°, hips &lt;38%, elbow &lt;150°, reach &lt;88%) are a first guess.</div>`;
  el.insertAdjacentHTML('beforeend','<h3 style="margin-top:18px"><span>⟲</span> HISTORY</h3><button class="btn small" id="saveSess">Save this session</button><div id="hist"></div>');
  $('#saveSess').onclick=saveSession;renderHistory();
  el.querySelectorAll('[data-crux]').forEach(b=>b.onclick=()=>gotoCrux(+b.dataset.crux));
  el.querySelectorAll('[data-att]').forEach(sel=>sel.onchange=()=>{S.attemptResult=S.attemptResult||{};if(sel.value==='auto')delete S.attemptResult[sel.dataset.att];else S.attemptResult[sel.dataset.att]=sel.value;process();});
}
async function gotoCrux(k){
  const D=S.D,c=D&&D.cruxes[k];if(!c)return;
  video.pause();S.endCard=0;S.show.crux=1;const cb=document.querySelector('[data-show=crux]');if(cb)cb.checked=true;
  await seekTo(video,D.t0+(c.i+0.25)/D.fps);
}

/* ---------- drawing ---------- */
function turbo(t){t=clamp01(t);const r=Math.round(255*clamp01(1.5-Math.abs(4*t-3))),g=Math.round(255*clamp01(1.5-Math.abs(4*t-2))),b=Math.round(255*clamp01(1.5-Math.abs(4*t-1)));return `rgb(${r},${g},${b})`;}
function trailColor(st,sp,alpha){
  if(st.trail==='turbo')return turbo(sp).replace('rgb','rgba').replace(')',`,${alpha})`);
  if(st.trail==='mono')return `rgba(255,255,255,${alpha})`;
  const r=Math.round(lerp(0,255,sp)),g=Math.round(lerp(240,43,sp)),b=Math.round(lerp(255,214,sp));return `rgba(${r},${g},${b},${alpha})`;
}
function drawBackground(v,src,sw,sh){
  const W=cv.width,H=cv.height,st=STYLES[S.style];
  ctx.fillStyle='#000';ctx.fillRect(0,0,W,H);
  if(src&&src!==video)ctx.drawImage(src,v.ox,v.oy,sw*v.s,sh*v.s);
  else if(video.readyState>=2)ctx.drawImage(video,v.ox,v.oy,video.videoWidth*v.s,video.videoHeight*v.s);
  ctx.save();
  ctx.globalCompositeOperation='saturation';ctx.fillStyle=`hsla(0,0%,50%,${st.desat})`;ctx.fillRect(0,0,W,H);
  ctx.globalCompositeOperation='source-over';ctx.fillStyle=`rgba(0,0,0,${st.dim})`;ctx.fillRect(0,0,W,H);
  ctx.restore();
}
function line(x1,y1,x2,y2){ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();}
function drawSkeleton(P,u,st){ // P(k) -> [x,y,vis]
  ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
  const pass=(bones,col)=>{
    for(const [a,b] of bones){const p=P(a),q=P(b);if(!p||!q||Math.min(p[2],q[2])<0.3)continue;
      ctx.strokeStyle=col;ctx.globalAlpha=0.25;ctx.lineWidth=11*u;ctx.shadowBlur=st.glow*u;ctx.shadowColor=col;line(p[0],p[1],q[0],q[1]);
      ctx.globalAlpha=1;ctx.lineWidth=3.4*u;ctx.shadowBlur=st.glow*0.6*u;line(p[0],p[1],q[0],q[1]);}
  };
  pass(BONES_C,st.C);pass(BONES_L,st.L);pass(BONES_R,st.R);
  // head
  const n=P(0),e1=P(7),e2=P(8);
  if(n&&e1&&e2&&n[2]>0.3){const hx=(n[0]+e1[0]+e2[0])/3,hy=(n[1]+e1[1]+e2[1])/3,r=Math.max(9*u,Math.hypot(e1[0]-e2[0],e1[1]-e2[1])*0.75);
    ctx.strokeStyle=st.C;ctx.lineWidth=2.6*u;ctx.shadowBlur=st.glow*u;ctx.shadowColor=st.C;ctx.beginPath();ctx.arc(hx,hy,r,0,Math.PI*2);ctx.stroke();}
  ctx.shadowBlur=0;
  for(const k of JOINTS){const p=P(k);if(!p||p[2]<0.3)continue;ctx.fillStyle='#000';ctx.beginPath();ctx.arc(p[0],p[1],5.2*u,0,7);ctx.fill();ctx.fillStyle=st.joint;ctx.beginPath();ctx.arc(p[0],p[1],3.4*u,0,7);ctx.fill();}
  ctx.restore();
}
function drawFrame(tOverride){
  const W=cv.width,H=cv.height,u=Math.min(W,H)/1080,st=STYLES[S.style],D=S.D;
  if(!video.videoWidth){ctx.fillStyle='#050506';ctx.fillRect(0,0,W,H);return;}
  // live preview during analysis
  if(tOverride===-1||!D){
    const v=viewAt(0,0);drawBackground(v);
    if(S.livePose){const lp=S.livePose;drawSkeleton(k=>[v.ox+lp[k].x*v.s,v.oy+lp[k].y*v.s,lp[k].v],u,st);}
    if(S.busy){ctx.fillStyle=st.accent;ctx.font=`700 ${26*u}px "Space Grotesk"`;ctx.fillText('SCANNING…',28*u,48*u);}
    return;
  }
  // end of clip: ROUTE MAP card, then the score card (on top of the finished route)
  const ph=endPhase();
  if(ph.route!=null){drawRoute(ph.route,u,st);return;}
  if(ph.summary>0&&routeAttempt()){drawRoute(1,u,st);drawSummary(ph.summary,u,st);return;}
  const t=tOverride!=null?tOverride:video.currentTime;
  if(t<D.t0-0.05||t>D.t1+0.05){const v=viewAt(0,0);drawBackground(v);return;}
  const f=Math.max(0,Math.min(D.N-1.001,(t-D.t0)*D.fps-0.25));const i=Math.floor(f),a=f-i,i1=Math.min(i+1,D.N-1);
  const v=viewAt(i,a);const T=(x,y)=>[v.ox+x*v.s,v.oy+y*v.s];
  const cox=lerp(D.oX[i],D.oX[i1],a),coy=lerp(D.oY[i],D.oY[i1],a);const Tw=(x,y)=>T(x+cox,y+coy); // wall → current image
  drawBackground(v);
  const P=k=>{const x=lerp(D.X[k][i],D.X[k][i1],a),y=lerp(D.Y[k][i],D.Y[k][i1],a);if(!isFinite(x)||!isFinite(y))return null;const q=T(x,y);return [q[0],q[1],lerp(D.V[k][i],D.V[k][i1],a)];};
  // holds (beta map)
  if(S.show.holds){
    ctx.save();ctx.textAlign='center';ctx.textBaseline='middle';
    for(const h of D.holds){
      if(h.i0>f)break;
      const [x,y]=Tw(h.x,h.y),age=(f-h.i0)/D.fps,active=f<=h.i1,pop=1+0.8*Math.exp(-age*7);
      const col=h.kind==='hand'?st.hand:st.foot;
      ctx.globalAlpha=active?1:0.45;ctx.strokeStyle=col;ctx.lineWidth=(active?3:2)*u;ctx.shadowBlur=active?st.glow*u:0;ctx.shadowColor=col;
      if(h.kind==='hand'){const r=15*u*pop;ctx.beginPath();ctx.arc(x,y,r,0,7);ctx.stroke();
        ctx.shadowBlur=0;ctx.fillStyle=col;ctx.font=`700 ${13*u}px "JetBrains Mono"`;ctx.fillText(h.n,x+r+9*u,y-r*0.6);}
      else{const r=10*u*pop;ctx.beginPath();ctx.moveTo(x,y-r);ctx.lineTo(x+r,y);ctx.lineTo(x,y+r);ctx.lineTo(x-r,y);ctx.closePath();ctx.stroke();}
    }
    ctx.restore();
  }
  // CoM trail
  if(S.show.com){
    ctx.save();ctx.lineCap='round';
    const tail=Math.round(D.fps*5),j0=Math.max(1,i-tail);
    // old path: one faint batched stroke
    ctx.strokeStyle=trailColor(st,0.3,0.18);ctx.lineWidth=2*u;ctx.beginPath();let pen=false;
    for(let j=0;j<=j0;j++){const p=Tw(D.comX[j],D.comY[j]);if(!isFinite(p[0])){pen=false;continue;}if(pen)ctx.lineTo(p[0],p[1]);else{ctx.moveTo(p[0],p[1]);pen=true;}}
    ctx.stroke();
    // glow underlay for the recent tail: one blurred stroke instead of one per segment
    if(st.glow){ctx.save();ctx.shadowBlur=st.glow*u;ctx.shadowColor=trailColor(st,0.5,1);ctx.strokeStyle=trailColor(st,0.5,0.35);ctx.lineWidth=7*u;ctx.beginPath();pen=false;
      for(let j=j0-1;j<=i;j++){if(j<0)continue;const p=Tw(D.comX[j],D.comY[j]);if(!isFinite(p[0])){pen=false;continue;}if(pen)ctx.lineTo(p[0],p[1]);else{ctx.moveTo(p[0],p[1]);pen=true;}}
      ctx.stroke();ctx.restore();}
    // recent tail: per-segment speed colour, no blur
    ctx.lineWidth=4.5*u;
    for(let j=j0;j<=i;j++){
      const p0=Tw(D.comX[j-1],D.comY[j-1]),p1=Tw(D.comX[j],D.comY[j]);if(!isFinite(p0[0])||!isFinite(p1[0]))continue;
      const sp=clamp01(D.speed[j]/D.vmax);ctx.strokeStyle=trailColor(st,sp,lerp(1,0.25,(i-j)/tail));
      line(p0[0],p0[1],p1[0],p1[1]);
    }
    ctx.restore();
  }
  // limb trails
  if(S.show.limbs){
    ctx.save();ctx.lineCap='round';const tail=Math.round(D.fps*0.6);
    for(const [,ids,kind] of ENDS){const col=kind==='hand'?st.hand:st.foot;
      for(let j=Math.max(1,i-tail);j<=i;j++){
        const pt=jj=>{let x=0,y=0;for(const k of ids){x+=D.XW[k][jj];y+=D.YW[k][jj];}return Tw(x/ids.length,y/ids.length);};
        const p0=pt(j-1),p1=pt(j);if(!isFinite(p0[0])||!isFinite(p1[0]))continue;
        ctx.strokeStyle=col;ctx.globalAlpha=0.7*(1-(i-j)/tail);ctx.lineWidth=(2+4*(1-(i-j)/tail))*u;line(p0[0],p0[1],p1[0],p1[1]);}
    }
    ctx.restore();
  }
  if(S.show.skel)drawSkeleton(P,u,st);
  // joint angles
  if(S.show.angles&&!S.show.load){
    ctx.save();ctx.font=`600 ${13*u}px "JetBrains Mono"`;ctx.textAlign='center';ctx.textBaseline='middle';
    ANGLES.forEach(([ka,kb,kc],n)=>{
      const A=P(ka),B=P(kb),C=P(kc);if(!A||!B||!C||B[2]<0.5)return;
      const deg=lerp(D.ang[n][i],D.ang[n][i1],a);if(!isFinite(deg))return;
      const a1=Math.atan2(A[1]-B[1],A[0]-B[0]),a2=Math.atan2(C[1]-B[1],C[0]-B[0]);
      let d=a2-a1;while(d>Math.PI)d-=2*Math.PI;while(d<-Math.PI)d+=2*Math.PI;
      const r=20*u;ctx.strokeStyle=st.accent;ctx.globalAlpha=.9;ctx.lineWidth=2*u;ctx.beginPath();ctx.arc(B[0],B[1],r,a1,a1+d,d<0);ctx.stroke();
      const mA=a1+d/2+Math.PI,tx=B[0]+Math.cos(mA)*r*2.1,ty=B[1]+Math.sin(mA)*r*2.1;
      const label=Math.round(deg)+'°',tw=ctx.measureText(label).width+10*u;
      ctx.globalAlpha=1;ctx.fillStyle='rgba(0,0,0,.65)';ctx.fillRect(tx-tw/2,ty-10*u,tw,20*u);
      ctx.fillStyle=(n<2&&deg>150)?st.accent:st.text;ctx.fillText(label,tx,ty);
    });
    ctx.restore();
  }
  // CoM marker
  if(S.show.com){const cx=lerp(D.comX[i],D.comX[i1],a),cy=lerp(D.comY[i],D.comY[i1],a);
    if(isFinite(cx)){const [x,y]=Tw(cx,cy);ctx.save();ctx.strokeStyle=st.accent;ctx.fillStyle=st.accent;ctx.lineWidth=2*u;ctx.shadowBlur=st.glow*u;ctx.shadowColor=st.accent;
      ctx.beginPath();ctx.arc(x,y,9*u,0,7);ctx.stroke();ctx.beginPath();ctx.arc(x,y,3*u,0,7);ctx.fill();
      line(x-16*u,y,x-11*u,y);line(x+11*u,y,x+16*u,y);line(x,y-16*u,x,y-11*u);line(x,y+11*u,x,y+16*u);
      ctx.shadowBlur=0;ctx.font=`600 ${11*u}px "JetBrains Mono"`;ctx.fillText('CoM',x+14*u,y-14*u);ctx.restore();}}
  // CRUX breakdown: frozen in export, or when the video is paused on the crux frame
  const sd=S.sendFreeze||(video.paused&&!S.busy&&D.sends&&D.sends.find(x=>Math.abs(f-x.i)<=1.5));
  if(sd&&!S.cruxFreeze){drawSend(sd,Tw,u,st);}
  const cx=S.cruxFreeze||(S.show.crux&&video.paused&&!S.busy&&D.cruxes.find(c=>Math.abs(f-c.i)<=1.5));
  if(S.show.load&&D.load&&!cx)drawLoad(D,i,a,P,u);
  if(cx)drawCrux(cx,P,Tw,u,st);
  if(S.show.hud)drawHUD(t,i,u,st);
  // end card
  if(ph.summary>0)drawSummary(ph.summary,u,st);
}
function pill(x,y,text,bg,fg,u){ctx.font=`700 ${15*u}px "Space Grotesk"`;const w=ctx.measureText(text).width+24*u;ctx.fillStyle=bg;ctx.beginPath();ctx.roundRect(x,y,w,28*u,14*u);ctx.fill();ctx.fillStyle=fg;ctx.textBaseline='middle';ctx.fillText(text,x+12*u,y+14*u);return w;}
function drawHUD(t,i,u,st){
  const W=cv.width,H=cv.height,D=S.D,pad=28*u;
  ctx.save();ctx.textBaseline='alphabetic';
  // wordmark + timecode
  ctx.fillStyle=st.text;ctx.font=`700 ${30*u}px "Space Grotesk"`;ctx.fillText('CLIMB',pad,pad+26*u);
  const w1=ctx.measureText('CLIMB').width;ctx.fillStyle=st.accent;ctx.fillText('/',pad+w1,pad+26*u);
  const w2=ctx.measureText('/').width;ctx.fillStyle=st.text;ctx.fillText('POSE',pad+w1+w2,pad+26*u);
  {const w3=ctx.measureText('POSE').width,E=envText(),bx0=pad+w1+w2+w3+12*u;ctx.save();ctx.font=`700 ${12*u}px "JetBrains Mono"`;const bwid=ctx.measureText(E.badge).width+14*u;
   ctx.fillStyle=E.rock?'#B07A4A':'rgba(255,255,255,.18)';ctx.beginPath();ctx.roundRect(bx0,pad+8*u,bwid,22*u,11*u);ctx.fill();ctx.fillStyle='#FFFFFF';ctx.textBaseline='middle';ctx.fillText(E.badge,bx0+7*u,pad+19*u);ctx.restore();}
  ctx.font=`500 ${15*u}px "JetBrains Mono"`;ctx.fillStyle=st.mute;ctx.fillText(fmt(Math.max(0,t-D.t0))+'  /  '+fmt(D.N/D.fps),pad,pad+52*u);
  // state pill
  const mv=D.moving[i],sp=D.speed[i];
  const pw=pill(pad,pad+66*u,mv?'● MOVING':'■ REST',mv?st.accent:'rgba(255,255,255,.14)',mv?'#000':st.text,u);
  ctx.textBaseline='middle';ctx.font=`500 ${15*u}px "JetBrains Mono"`;ctx.fillStyle=st.text;ctx.fillText(isFinite(sp)?sp.toFixed(2)+' m/s':'–',pad+pw+10*u,pad+80*u);
  const att=D.attempts.find(a=>i>=a.i0&&i<a.i1),done=D.attempts.filter(a=>a.i0<=i).length;
  ctx.textBaseline='alphabetic';
  const ri=routeInfo(),E0=envText(),nhR=D.holds.filter(h=>h.kind==='hand'&&h.i0<=i).length;
  const place=/^any (gym|crag)|^example/i.test(ri.gym)?'':ri.gym;
  const rl=[routeLabel()||'Route: grade not set',place,`${nhR} hand holds`].filter(Boolean).join(' · ');
  {ctx.save();ctx.font=`700 ${15*u}px "Space Grotesk"`;const tw=ctx.measureText(rl).width;const x=pad,y=pad+138*u;ctx.fillStyle='rgba(0,0,0,.55)';ctx.beginPath();ctx.roundRect(x,y,tw+46*u,28*u,14*u);ctx.fill();
    ctx.fillStyle=ri.tagHex||st.accent;ctx.beginPath();ctx.arc(x+15*u,y+14*u,7*u,0,7);ctx.fill();ctx.strokeStyle='rgba(255,255,255,.6)';ctx.lineWidth=1.2*u;ctx.stroke();
    ctx.fillStyle=st.text;ctx.textBaseline='middle';ctx.textAlign='left';ctx.fillText(rl,x+30*u,y+15*u);ctx.restore();}
  ctx.textBaseline='alphabetic';
  const prevA=!att&&done?D.attempts.filter(a=>a.i1<=i).slice(-1)[0]:null;
  const sentNow=att&&att.sent&&att.sendI!=null&&i>=att.sendI;
  pill(pad,pad+102*u,att?(sentNow?`ATTEMPT ${att.n} · ${envText().sent}`:`ATTEMPT ${att.n} / ${D.attempts.length}`):(prevA?`A${prevA.n} ${prevA.sent?envText().sent:'NOT SENT'} · OFF ${envText().rock?'ROCK':'WALL'}`:'OFF WALL'),
    sentNow||prevA&&prevA.sent?'#FFD23F':att?'rgba(255,255,255,.92)':prevA?'rgba(255,77,94,.85)':'rgba(255,255,255,.14)',att||prevA?'#000':st.text,u);
  // height gauge (right)
  const gy=D.footH[i];
  ctx.textAlign='right';ctx.textBaseline='alphabetic';
  ctx.font=`500 ${13*u}px "JetBrains Mono"`;ctx.fillStyle=st.mute;ctx.fillText(envText().floor,W-pad,pad+12*u);
  ctx.font=`700 ${44*u}px "Space Grotesk"`;ctx.fillStyle=st.text;ctx.fillText(isFinite(gy)?Math.max(0,gy).toFixed(1)+' m':'–',W-pad,pad+56*u);
  ctx.font=`500 ${13*u}px "JetBrains Mono"`;ctx.fillStyle=st.mute;
  const nh=D.holds.filter(h=>h.i0<=i);ctx.fillText(`HOLDS ✋${nh.filter(h=>h.kind==='hand').length}  🦶${nh.filter(h=>h.kind==='foot').length}`,W-pad,pad+80*u);
  if(S.show.load&&D.M.bodyKg){ctx.fillStyle=D.M.bodyKgAssumed?'#FFB020':st.mute;ctx.fillText(D.M.bodyKgAssumed?`LOAD @ ${D.M.bodyKg} kg (ASSUMED)`:`LOAD @ ${D.M.bodyKg} kg`,W-pad,pad+102*u);}
  // source file name, small, above the timeline
  if(S.srcFile){ctx.save();ctx.textAlign='left';ctx.font=`600 ${14*u}px "JetBrains Mono"`;const tw=ctx.measureText(S.srcFile).width+20*u,fy=H-pad-54*u-62*u;
    ctx.fillStyle='rgba(0,0,0,.55)';ctx.beginPath();ctx.roundRect(pad-10*u,fy-14*u,tw,26*u,8*u);ctx.fill();ctx.fillStyle=st.text;ctx.textBaseline='middle';ctx.fillText(S.srcFile,pad,fy-1*u);ctx.restore();}
  // speed timeline (bottom)
  const bh=54*u,bx=pad,by=H-pad-bh,bw=W-2*pad;
  ctx.fillStyle='rgba(0,0,0,.45)';ctx.beginPath();ctx.roundRect(bx-10*u,by-26*u,bw+20*u,bh+36*u,12*u);ctx.fill();
  ctx.textAlign='left';ctx.font=`600 ${11*u}px "JetBrains Mono"`;ctx.fillStyle=st.mute;ctx.fillText('CoM SPEED',bx,by-10*u);
  ctx.textAlign='right';ctx.fillText(`FLOW ${D.M.flow}`,bx+bw,by-10*u);
  const N=D.N,xs=k=>bx+bw*k/(N-1),ys=v=>by+bh-bh*clamp01(v/D.vmax);
  ctx.fillStyle='rgba(255,255,255,.06)';
  for(const [p,q] of runs(D.moving))ctx.fillRect(xs(p),by,xs(q)-xs(p),bh);
  ctx.lineWidth=1.6*u;ctx.strokeStyle=st.mute;ctx.beginPath();let started=false;
  for(let k=0;k<N;k++){const v=D.speed[k];if(!isFinite(v)){started=false;continue;}if(!started){ctx.moveTo(xs(k),ys(v));started=true;}else ctx.lineTo(xs(k),ys(v));}
  ctx.stroke();
  if(S.show.load&&D.handShare){ctx.strokeStyle='rgba(255,122,0,.85)';ctx.lineWidth=1.6*u;ctx.setLineDash([4*u,3*u]);ctx.beginPath();started=false;
    for(let k=0;k<N;k++){const v=D.handShare[k];if(!isFinite(v)){started=false;continue;}const yy=by+bh-bh*v;if(!started){ctx.moveTo(xs(k),yy);started=true;}else ctx.lineTo(xs(k),yy);}
    ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='rgba(255,122,0,.95)';ctx.textAlign='left';ctx.font=`600 ${11*u}px "JetBrains Mono"`;ctx.fillText('- - % WEIGHT ON HANDS',bx+90*u,by-10*u);}
  ctx.strokeStyle=st.accent;ctx.lineWidth=2.4*u;ctx.beginPath();started=false;
  for(let k=0;k<=i;k++){const v=D.speed[k];if(!isFinite(v)){started=false;continue;}if(!started){ctx.moveTo(xs(k),ys(v));started=true;}else ctx.lineTo(xs(k),ys(v));}
  ctx.stroke();
  ctx.font=`700 ${10*u}px "JetBrains Mono"`;ctx.textAlign='left';
  for(const at of D.attempts){ctx.fillStyle=at.i0<=i?st.accent:'rgba(255,255,255,.35)';ctx.fillRect(xs(at.i0),by+bh+3*u,Math.max(2*u,xs(at.i1)-xs(at.i0)),3*u);ctx.fillText('A'+at.n,xs(at.i0),by+bh+16*u);}
  ctx.fillStyle=st.accent;ctx.fillRect(xs(i)-1*u,by-4*u,2*u,bh+8*u);
  ctx.restore();
}
// BODY LOAD overlay: kg at each supporting hand/foot, Nm at the loaded joints (green → yellow → red)
function loadColor(t){t=clamp01(t);const a=[61,220,151],b=[245,217,10],c=[255,77,94];const [p,q,k]=t<0.5?[a,b,t*2]:[b,c,(t-0.5)*2];return `rgb(${Math.round(lerp(p[0],q[0],k))},${Math.round(lerp(p[1],q[1],k))},${Math.round(lerp(p[2],q[2],k))})`;}
function drawLoad(D,i,a,P,u){
  const i1=Math.min(i+1,D.N-1),bw=D.M.bodyKg||60,L=(arr)=>{const v0=arr[i],v1=arr[i1];return isFinite(v0)&&isFinite(v1)?lerp(v0,v1,a):isFinite(v0)?v0:NaN;};
  const REF={sh:120,el:70,hip:160,kn:130};
  ctx.save();ctx.textAlign='center';ctx.textBaseline='middle';
  const tag=(x,y,text,col,big)=>{ctx.font=`700 ${(big?17:13)*u}px "JetBrains Mono"`;const w=ctx.measureText(text).width+12*u,h=(big?26:20)*u;ctx.fillStyle='rgba(0,0,0,.72)';ctx.beginPath();ctx.roundRect(x-w/2,y-h/2,w,h,6*u);ctx.fill();ctx.strokeStyle=col;ctx.lineWidth=1.5*u;ctx.stroke();ctx.fillStyle=col;ctx.fillText(text,x,y+1*u);};
  for(const [k,end,joints] of [['LH',15,[['shL',11,'sh'],['elL',13,'el']]],['RH',16,[['shR',12,'sh'],['elR',14,'el']]],['LF',27,[['hipL',23,'hip'],['knL',25,'kn']]],['RF',28,[['hipR',24,'hip'],['knR',26,'kn']]]]){
    const kg=L(D.load[k]);if(!isFinite(kg)||kg<0.5)continue;
    const pe=P(end);if(!pe)continue;const col=loadColor(kg/(0.5*bw));
    ctx.fillStyle=col;ctx.globalAlpha=0.35;ctx.beginPath();ctx.arc(pe[0],pe[1],(10+kg/bw*30)*u,0,7);ctx.fill();ctx.globalAlpha=1;
    tag(pe[0],pe[1]+(k[1]==='H'?-30:30)*u,`${Math.round(kg)} kg`,col,true);
    for(const [jn,jk,ref] of joints){const nm=L(D.tq[jn]);const pj=P(jk);if(!pj||!isFinite(nm)||nm<3)continue;const c2=loadColor(nm/REF[ref]);
      ctx.strokeStyle=c2;ctx.lineWidth=3*u;ctx.beginPath();ctx.arc(pj[0],pj[1],14*u,0,7);ctx.stroke();tag(pj[0]+(pj[0]<cv.width/2?-46:46)*u,pj[1],`${Math.round(nm)} Nm`,c2,false);}
  }
  ctx.restore();
}
// SENT card: the attempt was finished — mark the top / last hold
function drawSend(sd,Tw,u,st){
  const D=S.D,W=cv.width,H=cv.height,GOLD='#FFD23F';
  ctx.save();ctx.textBaseline='middle';
  if(sd.hold){const [x,y]=Tw(sd.hold.x,sd.hold.y);
    ctx.strokeStyle=GOLD;ctx.lineWidth=5*u;ctx.shadowBlur=18*u;ctx.shadowColor=GOLD;ctx.beginPath();ctx.arc(x,y,34*u,0,7);ctx.stroke();ctx.shadowBlur=0;
    ctx.font=`700 ${18*u}px "JetBrains Mono"`;const t=envText().top,w=ctx.measureText(t).width+18*u,tx=Math.max(w/2+8*u,Math.min(W-w/2-8*u,x));
    ctx.fillStyle='rgba(0,0,0,.8)';ctx.beginPath();ctx.roundRect(tx-w/2,y-78*u,w,30*u,8*u);ctx.fill();ctx.fillStyle=GOLD;ctx.textAlign='center';ctx.fillText(t,tx,y-62*u);}
  const a=D.attempts.find(x=>x.n===sd.att),pw=Math.min(W-40*u,560*u),ph=150*u,px=(W-pw)/2,py=H-150*u-ph;
  ctx.fillStyle='rgba(8,9,11,.88)';ctx.beginPath();ctx.roundRect(px,py,pw,ph,18*u);ctx.fill();ctx.strokeStyle=GOLD;ctx.lineWidth=2*u;ctx.stroke();
  ctx.textAlign='left';ctx.fillStyle=GOLD;ctx.font=`700 ${40*u}px "Space Grotesk"`;ctx.fillText(envText().sent,px+24*u,py+44*u);
  ctx.fillStyle=st.mute;ctx.font=`500 ${15*u}px "JetBrains Mono"`;ctx.textAlign='right';ctx.fillText(`ATTEMPT ${sd.att} · ${fmt(D.t0+sd.i/D.fps)}`,px+pw-24*u,py+40*u);
  ctx.textAlign='left';ctx.fillStyle=st.text;ctx.font=`500 ${19*u}px "JetBrains Mono"`;
  const nh=D.holds.filter(h=>h.kind==='hand'&&a&&h.i0>=a.i0&&h.i0<=a.i1).length;
  ctx.fillText(`Top hold ${sd.hold?'#'+sd.hold.n:''}${a&&isFinite(a.lastHoldM)?` · ${a.lastHoldM.toFixed(1)} m up`:''} · ${sd.how}`,px+24*u,py+90*u);
  ctx.fillText(`${a?a.dur.toFixed(1)+' s on the wall · ':''}${nh} hand moves`,px+24*u,py+122*u);
  ctx.restore();
}
// CRUX breakdown overlay at the frame of max reach before coming off
function drawCrux(c,P,Tw,u,st){
  const D=S.D,W=cv.width,H=cv.height,BAD='#FF4D5E',GOOD='#3DDC97';
  const hw=P(15+c.hand),he=P(13+c.hand),hs=P(11+c.hand),kn=P(25+c.leg),an=P(27+c.leg),hp=P(23+c.leg),h1=P(23),h2=P(24);
  ctx.save();ctx.lineCap='round';ctx.textBaseline='middle';
  const tag=(x,y,text,col)=>{ctx.font=`700 ${16*u}px "JetBrains Mono"`;const w=ctx.measureText(text).width+16*u;x=Math.max(w/2+6*u,Math.min(W-w/2-6*u,x));ctx.fillStyle='rgba(0,0,0,.78)';ctx.beginPath();ctx.roundRect(x-w/2,y-14*u,w,28*u,8*u);ctx.fill();ctx.fillStyle=col;ctx.textAlign='center';ctx.fillText(text,x,y+1*u);};
  // foot → hand extension line
  if(hw&&an){ctx.setLineDash([10*u,8*u]);ctx.strokeStyle='rgba(255,255,255,.75)';ctx.lineWidth=2.5*u;line(an[0],an[1],hw[0],hw[1]);ctx.setLineDash([]);
    tag((an[0]+hw[0])/2+40*u,(an[1]+hw[1])/2,`${Math.round(c.ext*100)}% reach`,c.ext<0.88?BAD:GOOD);}
  // target hold + gap
  if(c.target&&hw){const [tx,ty]=Tw(c.target.x,c.target.y);
    ctx.strokeStyle=BAD;ctx.lineWidth=3*u;ctx.setLineDash([6*u,6*u]);line(hw[0],hw[1],tx,ty);ctx.setLineDash([]);
    ctx.beginPath();ctx.arc(tx,ty,22*u,0,7);ctx.stroke();tag(tx,ty-38*u,`${Math.round(c.target.distM*100)} cm`,BAD);}
  // joint highlights
  const joint=(p,deg,bad,label)=>{if(!p||!isFinite(deg))return;ctx.strokeStyle=bad?BAD:GOOD;ctx.lineWidth=4*u;ctx.beginPath();ctx.arc(p[0],p[1],26*u,0,7);ctx.stroke();tag(p[0]+(p[0]<W/2?-70:70)*u,p[1],`${label} ${Math.round(deg)}°`,bad?BAD:GOOD);};
  // last hold reached = high point of this attempt
  if(c.lastHold){const [lx,ly]=Tw(c.lastHold.x,c.lastHold.y);ctx.setLineDash([6*u,5*u]);ctx.strokeStyle='#FFFFFF';ctx.lineWidth=3*u;ctx.beginPath();ctx.arc(lx,ly,28*u,0,7);ctx.stroke();ctx.setLineDash([]);
    tag(lx,ly+46*u,`LAST HOLD #${c.lastHold.n}${isFinite(c.lastHoldM)?' · '+c.lastHoldM.toFixed(1)+' m':''}`,'#FFFFFF');}
  // both knees: the push leg is judged, the other is shown for context
  const ok=P(26-c.leg),oDeg=D.ang[3-c.leg][c.i];
  if(ok&&isFinite(oDeg)){ctx.strokeStyle='rgba(255,255,255,.6)';ctx.lineWidth=3*u;ctx.beginPath();ctx.arc(ok[0],ok[1],22*u,0,7);ctx.stroke();tag(ok[0]+(ok[0]<W/2?-70:70)*u,ok[1]+30*u,`${c.leg?'L':'R'} KNEE ${Math.round(oDeg)}°`,'#FFFFFF');}
  joint(kn,c.knee,c.knee<155,(c.leg?'R':'L')+' KNEE');joint(he,c.elbow,c.elbow<150,'ELBOW');
  // hip level
  if(h1&&h2){const y=(h1[1]+h2[1])/2,x=(h1[0]+h2[0])/2,bad=c.hipPct<0.38;ctx.strokeStyle=bad?BAD:GOOD;ctx.lineWidth=3*u;line(x-60*u,y,x+60*u,y);
    tag(x+(x<W/2?-110:110)*u,y,`HIP ${Math.round(c.hipPct*100)}%`,bad?BAD:GOOD);}
  // panel
  // panel goes wherever the body is not: top if the hips/knees are in the lower part of the frame
  // tips are word-wrapped (not truncated); panel sits top or bottom, whichever covers fewer key points
  const pw=Math.min(W-40*u,680*u),lh=34*u,px=(W-pw)/2;
  ctx.font=`600 ${17*u}px "JetBrains Mono"`;
  const wrap=t=>{const out=[];let cur='';for(const w of t.split(' ')){const nx=cur?cur+' '+w:w;if(ctx.measureText(nx).width>pw-120*u&&cur){out.push(cur);cur=w;}else cur=nx;}if(cur)out.push(cur);return out;};
  const tipLines=c.tips.map(wrap),nTip=tipLines.reduce((a2,l)=>a2+l.length,0);
  const tlh=26*u,tipH=c.tips.length?24*u+nTip*tlh+(c.tips.length-1)*8*u:0,ph=70*u+c.cues.length*lh+tipH;
  const keys=[hw,he,kn,ok,h1,h2,c.target?Tw(c.target.x,c.target.y):null].filter(Boolean);
  const cover=y=>keys.filter(q=>q[0]>px-30*u&&q[0]<px+pw+30*u&&q[1]>y-40*u&&q[1]<y+ph+40*u).length;
  const topY=175*u,botY=H-150*u-ph,py=cover(topY)<=cover(botY)?topY:botY;
  ctx.fillStyle='rgba(8,9,11,.86)';ctx.beginPath();ctx.roundRect(px,py,pw,ph,18*u);ctx.fill();
  ctx.strokeStyle='rgba(255,255,255,.12)';ctx.lineWidth=1.5*u;ctx.stroke();
  ctx.textAlign='left';ctx.fillStyle=st.accent;ctx.font=`700 ${26*u}px "Space Grotesk"`;ctx.fillText(`NOT SENT · CRUX · ATTEMPT ${c.att}`,px+22*u,py+34*u);
  ctx.fillStyle=st.mute;ctx.font=`500 ${15*u}px "JetBrains Mono"`;ctx.textAlign='right';ctx.fillText(`${fmt(D.t0+c.i/D.fps)} · ${c.end}`,px+pw-22*u,py+34*u);
  ctx.textAlign='left';ctx.font=`500 ${19*u}px "JetBrains Mono"`;
  c.cues.forEach((q,k)=>{const y=py+72*u+k*lh;ctx.fillStyle=q.bad?BAD:GOOD;ctx.beginPath();ctx.arc(px+30*u,y,6*u,0,7);ctx.fill();ctx.fillStyle=st.text;ctx.fillText(q.t,px+48*u,y);});
  if(c.tips.length){const y0=py+72*u+c.cues.length*lh+10*u;ctx.strokeStyle='rgba(255,255,255,.12)';line(px+22*u,y0-14*u,px+pw-22*u,y0-14*u);
    ctx.font=`600 ${17*u}px "JetBrains Mono"`;let y=y0+10*u;
    tipLines.forEach(lines=>{ctx.fillStyle=st.accent;ctx.fillText('TRY →',px+22*u,y);ctx.fillStyle=st.text;lines.forEach(l=>{ctx.fillText(l,px+96*u,y);y+=tlh;});y+=8*u;});}
  ctx.restore();
}
const ROUTE_SEC=4.5,ROUTE_BUILD=2.5;
// longest attempt that has holds: the route the map shows
function routeAttempt(){
  const D=S.D;if(!D||!D.holds.length)return null;
  let best=null;for(const a of D.attempts)if(!best||a.i1-a.i0>best.i1-best.i0)best=a;
  return best||{i0:0,i1:D.N};
}
function endPhase(){
  if(S.routeProg!=null)return{route:S.routeProg,summary:0};
  if(S.endCardAlpha!=null)return{route:null,summary:S.endCardAlpha};
  if(!S.endCard||!S.D)return{route:null,summary:0};
  const dt=(performance.now()-S.endCard)/1000,hasRoute=!!routeAttempt();
  if(hasRoute&&dt<ROUTE_SEC)return{route:clamp01(dt/ROUTE_BUILD),summary:0};
  return{route:null,summary:clamp01((dt-(hasRoute?ROUTE_SEC:0))/0.5)};
}
// ROUTE MAP: every hand / foot placement on the rock, joined in order, with time-coloured ghost
// skeletons and the CoM path, framed on the route. p (0..1) builds it up in climbing order.
function drawRoute(p,u,st){
  const D=S.D,W=cv.width,H=cv.height,vw=D.vw,vh=D.vh,at=routeAttempt();
  const i0=at.i0,i1=Math.min(at.i1,D.N-1),iCut=i0+(i1-i0)*p;
  // background source: route photo (upload / picked frame) or the video frame where the attempt starts
  const ib=S.routeBg!=null?S.routeBg:Math.min(D.N-1,Math.max(0,Math.round((video.currentTime-D.t0)*D.fps)));
  const ph=S.routePhoto;let srcEl=video,sw=vw,sh=vh,M;
  if(ph&&ph.kind==='upload'){srcEl=ph.el;sw=ph.w;sh=ph.h;const k=sw/vw;M=(x,y)=>[x*k,(y-vh/2)*k+sh/2];} // same camera position: wall coords = first analysed frame
  else if(ph&&ph.kind==='frame'){srcEl=ph.el;const cxk=D.oX[ph.k]||0,cyk=D.oY[ph.k]||0;M=(x,y)=>[x+cxk,y+cyk];}
  else{const cx=D.oX[ib]||0,cy=D.oY[ib]||0;M=(x,y)=>[x+cx,y+cy];}
  // frame the route: bounding box of holds + CoM path (in the background image's coords)
  let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;const ext=(x,y)=>{if(!isFinite(x)||!isFinite(y))return;[x,y]=M(x,y);x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);};
  for(const h of D.holds)if(h.i0>=i0&&h.i0<=i1)ext(h.x,h.y);
  for(let i=i0;i<=i1;i+=3)ext(D.comX[i],D.comY[i]);
  const kS=sw/vw,base=S.frame==='reel'?Math.max(W/sw,H/sh):W/sw;
  let s=base;
  if(x1>x0){const bw=(x1-x0)*1.12+D.torsoPx*kS*1.4,bh=(y1-y0)*1.08+D.torsoPx*kS*1.6;s=Math.max(base,Math.min(W/bw,H*0.8/bh));}
  const mx=(x0+x1)/2,my=(y0+y1)/2;
  let ox=W/2-(isFinite(mx)?mx:sw/2)*s,oy=H*0.53-(isFinite(my)?my:sh/2)*s;
  ox=sw*s>=W?Math.min(0,Math.max(W-sw*s,ox)):(W-sw*s)/2;
  oy=sh*s>=H?Math.min(0,Math.max(H-sh*s,oy)):(H-sh*s)/2;
  const T=(x,y)=>{const q=M(x,y);return [ox+q[0]*s,oy+q[1]*s];};
  drawBackground({s,ox,oy},srcEl,sw,sh);
  ctx.save();ctx.fillStyle='rgba(0,0,0,.25)';ctx.fillRect(0,0,W,H);ctx.lineCap='round';ctx.lineJoin='round';
  // ghost skeletons (chronophotography), coloured start → finish
  const step=Math.max(1,Math.round(D.fps*1.2));
  for(let i=i0;i<=iCut;i+=step){
    const k=(i-i0)/Math.max(1,i1-i0);ctx.strokeStyle=trailColor(st,k,0.42);ctx.lineWidth=2.4*u;
    for(const [a,b] of BONES_C.concat(BONES_L,BONES_R)){const pa=T(D.XW[a][i],D.YW[a][i]),pb=T(D.XW[b][i],D.YW[b][i]);if(isFinite(pa[0])&&isFinite(pb[0]))line(pa[0],pa[1],pb[0],pb[1]);}
  }
  // CoM path: one blurred underlay stroke (glow), then speed-coloured segments without blur
  const comPath=()=>{ctx.beginPath();let pen=false;for(let i=i0;i<=iCut;i++){const q=T(D.comX[i],D.comY[i]);if(!isFinite(q[0])){pen=false;continue;}if(pen)ctx.lineTo(q[0],q[1]);else{ctx.moveTo(q[0],q[1]);pen=true;}}};
  if(st.glow){ctx.save();ctx.shadowBlur=st.glow*u;ctx.shadowColor=trailColor(st,0.5,1);ctx.strokeStyle=trailColor(st,0.5,0.3);ctx.lineWidth=7*u;comPath();ctx.stroke();ctx.restore();}
  ctx.lineWidth=3*u;
  for(let i=i0+1;i<=iCut;i++){const pa=T(D.comX[i-1],D.comY[i-1]),pb=T(D.comX[i],D.comY[i]);if(!isFinite(pa[0])||!isFinite(pb[0]))continue;
    ctx.strokeStyle=trailColor(st,clamp01(D.speed[i]/D.vmax),0.9);line(pa[0],pa[1],pb[0],pb[1]);}
  // placements in order, joined per limb kind
  const hs=D.holds.filter(h=>h.i0>=i0&&h.i0<=iCut);
  if(at.lastHold&&p>=1){const [lx,ly]=T(at.lastHold.x,at.lastHold.y),txt=at.sent?(envText().rock?'TOP-OUT ✓':'TOP ✓'):'HIGH POINT',col=at.sent?'#FFD23F':'#FFFFFF';
    ctx.save();ctx.strokeStyle=col;ctx.lineWidth=4*u;ctx.beginPath();ctx.arc(lx,ly,30*u,0,7);ctx.stroke();ctx.font=`700 ${17*u}px "JetBrains Mono"`;const tw=ctx.measureText(txt).width+16*u;
    ctx.fillStyle='rgba(0,0,0,.8)';ctx.beginPath();ctx.roundRect(lx-tw/2,ly-70*u,tw,28*u,8*u);ctx.fill();ctx.fillStyle=col;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(txt,lx,ly-55*u);ctx.restore();}
  for(const kind of ['foot','hand']){
    const list=hs.filter(h=>h.kind===kind),col=kind==='hand'?st.hand:st.foot;
    ctx.strokeStyle=col;ctx.globalAlpha=0.55;ctx.lineWidth=2*u;ctx.setLineDash([8*u,7*u]);ctx.beginPath();
    list.forEach((h,j)=>{const [x,y]=T(h.x,h.y);if(j)ctx.lineTo(x,y);else ctx.moveTo(x,y);});ctx.stroke();ctx.setLineDash([]);ctx.globalAlpha=1;
    const drawn=[];
    list.forEach((h,j)=>{
      if(drawn.some(q=>Math.hypot(q.x-h.x,q.y-h.y)*D.mpp<0.08))return; // re-grip of the same hold
      drawn.push(h);
      const [x,y]=T(h.x,h.y),age=(iCut-h.i0)/D.fps,pop=1+0.7*Math.exp(-age*6);
      ctx.strokeStyle=col;ctx.lineWidth=3*u;if(st.glow){ctx.shadowBlur=st.glow*u;ctx.shadowColor=col;}
      if(kind==='hand'){const r=17*u*pop;ctx.fillStyle='rgba(0,0,0,.55)';ctx.beginPath();ctx.arc(x,y,r,0,7);ctx.fill();ctx.stroke();
        ctx.shadowBlur=0;ctx.fillStyle=col;ctx.font=`700 ${15*u}px "JetBrains Mono"`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(j+1,x,y+1*u);}
      else{const r=11*u*pop;ctx.beginPath();ctx.moveTo(x,y-r);ctx.lineTo(x+r,y);ctx.lineTo(x,y+r);ctx.lineTo(x-r,y);ctx.closePath();ctx.stroke();ctx.shadowBlur=0;}
    });
  }
  // title
  const pad=36*u;ctx.textAlign='left';ctx.textBaseline='alphabetic';
  ctx.fillStyle='rgba(0,0,0,.55)';ctx.fillRect(0,0,W,150*u);
  ctx.fillStyle=st.text;ctx.font=`700 ${44*u}px "Space Grotesk"`;const MT=envText().map;ctx.fillText(MT[0],pad,pad+44*u);
  const rw=ctx.measureText(MT[0]+' ').width;ctx.fillStyle=st.accent;ctx.fillText(MT[1],pad+rw,pad+44*u);
  const rl=routeLabel();if(rl){const ri=routeInfo();ctx.textAlign='right';ctx.font=`700 ${24*u}px "Space Grotesk"`;ctx.fillStyle=ri.tagHex||st.accent;ctx.fillText(rl,W-pad,pad+40*u);ctx.textAlign='left';}
  const nh=hs.filter(h=>h.kind==='hand').length,nf=hs.length-nh;
  ctx.fillStyle=st.mute;ctx.font=`500 ${17*u}px "JetBrains Mono"`;
  ctx.fillText(`✋ ${nh} hand  ·  🦶 ${nf} foot placements  ·  ${fmt((i1-i0)/D.fps)}${at.highFootM?`  ·  top ${at.highFootM.toFixed(1)} m`:''}`,pad,pad+80*u);
  ctx.restore();
}
function drawSummary(alpha,u,st){
  const W=cv.width,H=cv.height,D=S.D,M=D.M;
  ctx.save();ctx.globalAlpha=alpha;
  ctx.fillStyle='rgba(6,7,9,.86)';ctx.fillRect(0,0,W,H);
  const pw=Math.min(W-60*u,860*u),ph=Math.min(H-60*u,820*u),px=(W-pw)/2,py=(H-ph)/2,pad=36*u;
  ctx.strokeStyle='rgba(255,255,255,.12)';ctx.lineWidth=1.5*u;ctx.beginPath();ctx.roundRect(px,py,pw,ph,24*u);ctx.stroke();
  ctx.textBaseline='alphabetic';ctx.textAlign='left';
  ctx.fillStyle=st.mute;ctx.font=`600 ${15*u}px "JetBrains Mono"`;ctx.fillText(`SEND REPORT  ·  ${envText().badge}  ·  ${S.srcFile||'CLIMB/POSE'}`,px+pad,py+pad+10*u);
  ctx.fillStyle=st.accent;ctx.font=`700 ${150*u}px "Space Grotesk"`;ctx.fillText(String(M.flow),px+pad-6*u,py+pad+150*u);
  const sw=ctx.measureText(String(M.flow)).width;
  ctx.fillStyle=st.text;ctx.font=`700 ${26*u}px "Space Grotesk"`;ctx.fillText('FLOW SCORE',px+pad+sw+14*u,py+pad+110*u);
  ctx.fillStyle=st.mute;ctx.font=`500 ${15*u}px "JetBrains Mono"`;
  ctx.fillText(`${M.attempts} attempt${M.attempts===1?'':'s'}  ·  ${fmt(M.time)}  ·  ${M.moves} moves`,px+pad+sw+14*u,py+pad+142*u);
  const rl=routeLabel();if(rl){ctx.fillStyle=routeInfo().tagHex||st.accent;ctx.font=`700 ${20*u}px "Space Grotesk"`;ctx.fillText(rl,px+pad+sw+14*u,py+pad+72*u);}
  // mini path
  const mx=px+pw-pad-200*u,my=py+pad+10*u,ms=200*u;
  const ids=[];for(let k=0;k<D.N;k++)if(D.valid[k])ids.push(k);
  if(ids.length>2){let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;for(const k of ids){x0=Math.min(x0,D.cxs[k]);x1=Math.max(x1,D.cxs[k]);y0=Math.min(y0,D.cys[k]);y1=Math.max(y1,D.cys[k]);}
    const k2=ms/Math.max(x1-x0,y1-y0,1),ox=mx+(ms-(x1-x0)*k2)/2,oy=my+(ms-(y1-y0)*k2)/2;
    ctx.lineWidth=3*u;ctx.lineCap='round';
    for(let n=1;n<ids.length;n++){const p=ids[n-1],q=ids[n];if(q-p>2)continue;ctx.strokeStyle=trailColor(st,clamp01(D.speed[q]/D.vmax),.95);line(ox+(D.cxs[p]-x0)*k2,oy+(D.cys[p]-y0)*k2,ox+(D.cxs[q]-x0)*k2,oy+(D.cys[q]-y0)*k2);}
    ctx.fillStyle=st.mute;ctx.font=`500 ${11*u}px "JetBrains Mono"`;ctx.textAlign='center';ctx.fillText('CoM PATH',mx+ms/2,my+ms+18*u);ctx.textAlign='left';}
  // bars
  const items=[['FLUENCY',D.sc.fluency,isFinite(M.ldlj)?'LDLJ '+M.ldlj.toFixed(1):''],['PATH',D.sc.path,isFinite(M.gie)?'GIE '+M.gie.toFixed(2):''],['STRAIGHT ARMS',D.sc.arms,isFinite(M.straightArm)?Math.round(M.straightArm*100)+'% of rest':''],['FOOTWORK',D.sc.feet,`${M.footHolds} feet : ${M.handHolds} hands`]];
  let y=py+pad+300*u;const bw=pw-2*pad;
  for(const [k,v,sub] of items){
    if(y+60*u>py+ph)break;
    ctx.fillStyle=st.text;ctx.font=`700 ${19*u}px "Space Grotesk"`;ctx.fillText(k,px+pad,y);
    ctx.textAlign='right';ctx.fillStyle=st.mute;ctx.font=`500 ${14*u}px "JetBrains Mono"`;ctx.fillText(sub+'   '+Math.round(v*100),px+pad+bw,y);ctx.textAlign='left';
    ctx.fillStyle='rgba(255,255,255,.1)';ctx.beginPath();ctx.roundRect(px+pad,y+12*u,bw,10*u,5*u);ctx.fill();
    ctx.fillStyle=st.accent;ctx.beginPath();ctx.roundRect(px+pad,y+12*u,Math.max(10*u,bw*v*alpha),10*u,5*u);ctx.fill();
    y+=Math.min(110*u,(ph-340*u)/4);
  }
  ctx.restore();
}

/* ---------- main loop & player ---------- */
function tick(){
  if(S.D&&!video.paused&&video.currentTime>=S.D.t1){video.pause();S.endCard=performance.now();if(S.onClipEnd){const f=S.onClipEnd;S.onClipEnd=null;f();}}
  if(!S.busy||S.exporting)drawFrame();
  const d=video.duration||0;
  if(!S.dragging&&d)$('#seek').value=Math.round(1000*video.currentTime/d);
  $('#time').textContent=fmt(video.currentTime)+' / '+fmt(d);
  $('#play').textContent=video.paused?'▶':'❚❚';
  requestAnimationFrame(tick);
}
$('#play').onclick=()=>{if(!video.src)return;if(video.paused){const D=S.D;if(video.ended||(D&&(video.currentTime>=D.t1-0.05||video.currentTime<D.t0)))video.currentTime=D?D.t0:0;S.endCard=0;video.play();}else video.pause();};
$('#seek').oninput=e=>{S.dragging=true;S.endCard=0;if(video.duration)video.currentTime=video.duration*e.target.value/1000;};
$('#seek').onchange=()=>{S.dragging=false;};
const stepFrame=d=>{if(!video.src)return;video.pause();S.endCard=0;const fps=S.D?S.D.fps:30;video.currentTime=Math.max(0,Math.min(video.duration-0.01,video.currentTime+d/fps));};
$('#stepB').onclick=()=>stepFrame(-1);$('#stepF').onclick=()=>stepFrame(1);
$('#rate').onchange=e=>{video.playbackRate=+e.target.value;};
document.addEventListener('keydown',e=>{if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return;
  if(e.key===','){stepFrame(-1);e.preventDefault();}else if(e.key==='.'){stepFrame(1);e.preventDefault();}else if(e.key===' '){$('#play').click();e.preventDefault();}});
video.addEventListener('ended',()=>{if(S.D)S.endCard=performance.now();});
document.querySelectorAll('#styles .chip').forEach(b=>b.onclick=()=>{document.querySelectorAll('#styles .chip').forEach(x=>x.classList.remove('on'));b.classList.add('on');S.style=b.dataset.style;});
document.querySelectorAll('[data-show]').forEach(c=>c.onchange=()=>{S.show[c.dataset.show]=c.checked?1:0;});
$('#frame').onchange=e=>{S.frame=e.target.value;if(S.frame==='reel'&&!S.zoom){S.zoom=1;$('#zoom').value='1';}layoutCanvas();};
$('#zoom').onchange=e=>{S.zoom=+e.target.value;};
$('#height').onchange=()=>{if(S.raw)process();};
$('#weight').onchange=()=>{if(S.raw)process();};$('#wall').onchange=()=>{if(S.raw)process();};
$('#lrfix').onchange=()=>{if(S.raw)process();};


/* ---------- ROUTE info: gym, grade system, grade, tag colour, route photo ---------- */
const TAGS=[['Yellow','#F5D90A'],['Green','#30A46C'],['Blue','#3E63DD'],['Red','#E5484D'],['Black','#111111'],['White','#F2F2F2'],['Purple','#8E4EC6'],['Orange','#F76B15'],['Pink','#E93D82'],['Grey','#8B8D98'],['Teal','#12A594'],['Brown','#AD7F58']];
const GRADES={V:Array.from({length:13},(_,k)=>'V'+k),Font:['4','5','5+','6A','6A+','6B','6B+','6C','6C+','7A','7A+','7B','7B+','7C','7C+','8A','8A+','8B','8B+','8C']};
const DEFAULT_GYMS=[{name:'Any gym · V-scale',sys:'V'},{name:'Any gym · Font',sys:'Font'},{name:'Example · colour circuit',sys:'Color',colors:'Yellow=V0-V1, Green=V1-V2, Blue=V2-V4, Red=V4-V5, Black=V6+'},{name:'Any crag · Font',sys:'Font',env:'rock'},{name:'Any crag · V-scale',sys:'V',env:'rock'}];
const store={get(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d;}catch(e){return d;}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}};
let GYMS=store.get('climbpose.gyms',null)||DEFAULT_GYMS.slice();
if(!GYMS.some(g=>g.env==='rock'))GYMS=GYMS.concat(DEFAULT_GYMS.filter(g=>g.env==='rock'));
const parseColors=t=>(t||'').split(',').map(x=>x.split('=').map(y=>y.trim())).filter(x=>x[0]&&x[1]).map(([c,g])=>({color:c,grade:g}));
function fillGyms(sel){
  const env=typeof envMode==='function'?envMode():'gym',g=$('#gym');
  g.innerHTML=GYMS.map((x,k)=>((x.env||'gym')===env?`<option value="${k}">${x.name.replace(/</g,'&lt;')}</option>`:'')).join('')+`<option value="add">+ Add ${env==='rock'?'crag':'gym'}…</option>`;
  const want=String(sel!=null?sel:store.get('climbpose.gymSel',0));g.value=want;if(!g.value||g.value==='add'){const first=g.querySelector('option');g.value=first?first.value:'add';}
  fillGrades();updateGymPin();
}
function fillGrades(){
  const gym=GYMS[+$('#gym').value]||GYMS[0];
  if(gym.sys==='Color'){const cs=parseColors(gym.colors);$('#grade').innerHTML=cs.map(c=>`<option value="${c.grade}" data-color="${c.color}">${c.color} · ${c.grade}</option>`).join('')||'<option value="">–</option>';}
  else $('#grade').innerHTML='<option value="">–</option>'+GRADES[gym.sys].map(g=>`<option>${g}</option>`).join('');
  $('#tag').innerHTML='<option value="">–</option>'+TAGS.map(([n])=>`<option>${n}</option>`).join('');
  syncTagFromGrade();
}
function syncTagFromGrade(){const o=$('#grade').selectedOptions[0];if(o&&o.dataset.color){const t=TAGS.find(([n])=>n.toLowerCase()===o.dataset.color.toLowerCase());if(t)$('#tag').value=t[0];}}
function routeInfo(){
  const gym=GYMS[+$('#gym').value]||GYMS[0],tag=TAGS.find(([n])=>n===$('#tag').value);
  const rock=envMode()==='rock';
  return {environment:rock?'rock':'gym',gym:gym.name,gym_map:gym.map||null,system:gym.sys,grade:$('#grade').value||'',tag:!rock&&tag?tag[0]:'',tagHex:!rock&&tag?tag[1]:null,name:$('#rname').value.trim()};
}
function routeLabel(){const r=routeInfo();return [r.grade,r.tag,r.name].filter(Boolean).join(' · ');}
// Google Maps link → gym name + coordinates. Full links (google.com/maps/place/NAME/@lat,lng…) carry
// both; short links (maps.app.goo.gl/…) can't be expanded from the page (cross-origin), so the
// link is kept and the name is typed.
function parseMapsLink(u){
  const out={url:u.trim()};if(!out.url)return null;
  let m=out.url.match(/\/maps\/place\/([^/@?]+)/);if(m)out.name=decodeURIComponent(m[1].replace(/\+/g,' ')).trim();
  if(!out.name){m=out.url.match(/[?&](?:q|query)=([^&]+)/);if(m&&!/^-?\d+(\.\d+)?,-?\d+/.test(decodeURIComponent(m[1])))out.name=decodeURIComponent(m[1].replace(/\+/g,' ')).trim();}
  m=out.url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/)||out.url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/)||out.url.match(/[?&](?:q|query|ll)=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if(m){out.lat=+m[1];out.lng=+m[2];}
  out.short=/goo\.gl|maps\.app/.test(out.url);
  return out;
}
$('#gymMap').oninput=()=>{const r=parseMapsLink($('#gymMap').value),info=$('#gymMapInfo');
  if(!r){info.style.display='none';return;}info.style.display='block';
  if(r.name&&!$('#gymName').value.trim())$('#gymName').value=r.name;
  info.textContent=r.name?`📍 ${r.name}${r.lat!=null?` · ${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}`:''}`:r.short?'📍 Short link saved — type the gym name below (short links can’t be read from the page).':r.lat!=null?`📍 ${r.lat.toFixed(5)}, ${r.lng.toFixed(5)} — type the gym name below.`:'Not a Google Maps link?';};
function updateGymPin(){const g=GYMS[+$('#gym').value],a=$('#gymPin');if(g&&g.map){a.href=g.map.url;a.style.display='inline-block';}else a.style.display='none';}
$('#gym').onchange=()=>{if($('#gym').value==='add'){$('#gymForm').style.display='block';$('#gymMap').focus();updateGymPin();return;}store.set('climbpose.gymSel',+$('#gym').value);fillGrades();updateGymPin();};
$('#gymSys').onchange=()=>{$('#gymColorsRow').style.display=$('#gymSys').value==='Color'?'flex':'none';};
$('#gymCancel').onclick=()=>{$('#gymForm').style.display='none';fillGyms();};
$('#gymSave').onclick=()=>{const name=$('#gymName').value.trim();if(!name){$('#gymName').focus();return;}const g={name,sys:$('#gymSys').value,env:envMode()};if(g.sys==='Color')g.colors=$('#gymColors').value;
  const mp=parseMapsLink($('#gymMap').value);if(mp)g.map={url:mp.url,lat:mp.lat??null,lng:mp.lng??null};
  $('#gymMap').value='';$('#gymName').value='';$('#gymMapInfo').style.display='none';
  GYMS.push(g);store.set('climbpose.gyms',GYMS);$('#gymForm').style.display='none';fillGyms(GYMS.length-1);store.set('climbpose.gymSel',GYMS.length-1);};
$('#grade').onchange=syncTagFromGrade;
fillGyms();

// route photo: an uploaded photo (assumed shot from the camera position, framed like the video),
// a frame picked from the video, or Auto (frame where the attempt starts)
function updatePhotoInfo(){const r=S.routePhoto;$('#photoInfo').textContent=!r?'Auto: the route map uses the frame where the attempt starts. Best results: take the route photo from the same spot as the camera, camera on a tripod.':r.kind==='upload'?`Photo ${r.w}×${r.h} — mapped assuming it was shot from the camera position (same framing as the video).`:`Using the video frame at ${fmt(r.t)} as the route photo.`;}
$('#photoBtn').onclick=()=>$('#photoFile').click();
$('#photoFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{const bmp=await createImageBitmap(f,{imageOrientation:'from-image'});S.routePhoto={kind:'upload',el:bmp,w:bmp.width,h:bmp.height};updatePhotoInfo();}catch(err){setStatus('Could not read that photo','err');}};
$('#photoFrame').onclick=()=>{if(!video.videoWidth)return;const c=document.createElement('canvas');c.width=video.videoWidth;c.height=video.videoHeight;c.getContext('2d').drawImage(video,0,0);
  const D=S.D,k=D?Math.min(D.N-1,Math.max(0,Math.round((video.currentTime-D.t0)*D.fps))):0;S.routePhoto={kind:'frame',el:c,w:c.width,h:c.height,k,t:video.currentTime};updatePhotoInfo();};
$('#photoAuto').onclick=()=>{S.routePhoto=null;updatePhotoInfo();};

// manual hold tagging: click the video while paused (or playing) to add/remove holds in wall coordinates
function canvasToWall(e){
  const D=S.D;if(!D)return null;const r=cv.getBoundingClientRect();
  const cx=(e.clientX-r.left)*cv.width/r.width,cy=(e.clientY-r.top)*cv.height/r.height;
  const f=Math.max(0,Math.min(D.N-1.001,(video.currentTime-D.t0)*D.fps-0.25)),i=Math.floor(f),a=f-i,i1=Math.min(i+1,D.N-1);
  const v=viewAt(i,a),ox=lerp(D.oX[i],D.oX[i1],a),oy=lerp(D.oY[i],D.oY[i1],a);
  return {x:(cx-v.ox)/v.s-ox,y:(cy-v.oy)/v.s-oy,i:Math.round(f),pxPerM:v.s/D.mpp};
}
cv.addEventListener('click',e=>{
  if(!$('#tagMode').checked||!S.D||S.busy)return;
  const w=canvasToWall(e);if(!w)return;video.pause();S.endCard=0;
  const D=S.D,near=D.holds.find(h=>Math.hypot(h.x-w.x,h.y-w.y)*D.mpp<0.07);
  if(near){
    const ai=S.holdEdits.add.findIndex(h=>Math.abs(h.x-near.x)<1&&Math.abs(h.y-near.y)<1);
    if(ai>=0)S.holdEdits.add.splice(ai,1);else S.holdEdits.remove.push({x:near.x,y:near.y,kind:near.kind});
    setStatus(`Removed ${near.kind} hold`,'ok');
  }else{
    const kind=e.shiftKey?'foot':'hand';S.holdEdits.add.push({limb:'tag',kind,x:w.x,y:w.y,i0:w.i,i1:Math.min(D.N-1,w.i+Math.round(D.fps*0.5)),manual:true});
    setStatus(`Tagged ${kind} hold at ${fmt(video.currentTime)}`,'ok');
  }
  process();
});
$('#tagMode').onchange=()=>{cv.style.cursor=$('#tagMode').checked?'crosshair':'';};

/* ---------- environment: gym wall vs real rock ---------- */
// Auto-detect from 3 frames. Gym walls: large SMOOTH panels (low local gradient) + VIVID plastic
// holds. Real rock: textured everywhere, muted colours, vegetation. Tested: gyms 0.49–0.69,
// outdoor boulder ≈ 0. Sky-heavy outdoor shots can look smooth — the selector overrides.
function envFeatures(){
  const c=document.createElement('canvas');c.width=128;c.height=Math.round(128*video.videoHeight/video.videoWidth)||128;const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(video,0,0,c.width,c.height);
  const d=x.getImageData(0,0,c.width,c.height).data,W=c.width,H=c.height,L=new Float32Array(W*H);let vivid=0,veg=0;const n=W*H;
  for(let p=0,q=0;p<n;p++,q+=4){const r=d[q]/255,g=d[q+1]/255,b=d[q+2]/255,mx=Math.max(r,g,b),mn=Math.min(r,g,b),sat=mx?(mx-mn)/mx:0;L[p]=0.299*r+0.587*g+0.114*b;
    let h=0;if(mx!==mn){h=mx===r?((g-b)/(mx-mn))%6:mx===g?(b-r)/(mx-mn)+2:(r-g)/(mx-mn)+4;h*=60;if(h<0)h+=360;}
    if(sat>0.55&&mx>0.35)vivid++;if(h>55&&h<165&&sat>0.12&&sat<0.55&&mx<0.8)veg++;}
  let smooth=0,m=0;for(let y=1;y<H-1;y++)for(let xx=1;xx<W-1;xx++){const p=y*W+xx;m++;if(Math.abs(L[p+1]-L[p-1])+Math.abs(L[p+W]-L[p-W])<0.04)smooth++;}
  return {smooth:smooth/m,vivid:vivid/n,veg:veg/n};
}
async function detectEnv(){
  try{const fs=[];for(const fr of [0.1,0.35,0.6]){await seekTo(video,video.duration*fr);fs.push(envFeatures());}
    const avg=k=>fs.reduce((a2,f)=>a2+f[k],0)/fs.length,sm=avg('smooth'),vi=avg('vivid'),ve=avg('veg'),score=sm+2*vi-1.5*ve;
    S.envDetected=score>0.3?'gym':'rock';S.envScores={smooth:+sm.toFixed(2),vivid:+vi.toFixed(2),veg:+ve.toFixed(2),score:+score.toFixed(2)};
    await seekTo(video,0.001);
  }catch(e){S.envDetected=S.envDetected||'gym';}
  applyEnv();
}
function envMode(){const v=$('#env').value;return v==='auto'?(S.envDetected||'gym'):v;}
function envText(){const rock=envMode()==='rock';return {rock,badge:rock?'ROCK':'GYM',sent:rock?'TOPPED OUT ✓':'SENT ✓',floor:rock?'FEET ABOVE GROUND':'FEET ABOVE FLOOR',map:rock?['LINE','MAP']:['ROUTE','MAP'],place:rock?'Crag / area':'Gym',top:rock?'TOP-OUT':'TOP · LAST HOLD'};}
function applyEnv(){
  const E=envText(),v=$('#env').value;
  $('#envInfo').textContent=v==='auto'?(S.envDetected?`Detected: ${E.rock?'real rock':'gym wall'}${S.envScores?` (smooth panels ${Math.round(S.envScores.smooth*100)}% · vivid holds ${Math.round(S.envScores.vivid*100)}% · plants ${Math.round(S.envScores.veg*100)}%)`:''} — change it above if wrong.`:'Detecting…'):'';
  $('#placeLbl').textContent=E.place;$('#tagRow').style.display=E.rock?'none':'flex';
  $('#sysColor').disabled=E.rock;$('#gymName').placeholder=E.rock?'Crag / area name':'Gym name';
  fillGyms();if(S.raw)process();
}
$('#env').onchange=applyEnv;

/* ---------- session history (this browser) ---------- */
const routeKey=r=>[r.environment,r.gym,r.grade,r.tag,r.name].map(x=>(x||'').toLowerCase().trim()).join('|');
function sessionSummary(){
  const D=S.D,M=D.M,r=routeInfo(),gaps=D.cruxes.filter(c=>c.target).map(c=>c.target.distM*100);
  return {id:`${S.srcName}|${D.t0.toFixed(1)}|${D.t1.toFixed(1)}`,date:new Date().toISOString(),src:S.srcName,route:r,key:routeKey(r),
    flow:M.flow,scores:Object.fromEntries(Object.entries(D.sc).map(([k,v])=>[k,Math.round(v*100)])),attempts:M.attempts,tops:D.attempts.filter(a=>a.end==='top-out').length,
    highFootM:isFinite(M.highFootM)?+M.highFootM.toFixed(2):null,handShare:isFinite(M.handShare)?Math.round(M.handShare*100):null,
    cruxGapCm:gaps.length?Math.round(Math.min(...gaps)):null,cruxes:D.cruxes.length};
}
function saveSession(){
  if(!S.D)return;const list=store.get('climbpose.sessions',[]),s1=sessionSummary();
  const k=list.findIndex(x=>x.id===s1.id);if(k>=0)list[k]=s1;else list.unshift(s1);
  store.set('climbpose.sessions',list.slice(0,60));renderHistory();setStatus('Session saved to history (this browser)','ok');
}
function renderHistory(){
  const box=document.getElementById('hist');if(!box)return;
  const list=store.get('climbpose.sessions',[]),key=routeKey(routeInfo()),hasRoute=key.replace(/\|/g,'').length>0&&key!==routeKey({environment:routeInfo().environment,gym:routeInfo().gym});
  if(!list.length){box.innerHTML='<div class="note">No saved sessions yet. Fill in the route (gym, grade, tag) and press Save to track progress on it.</div>';return;}
  const same=hasRoute?list.filter(x=>x.key===key):[],others=list.filter(x=>!same.includes(x)).slice(0,6);
  const row=(x,prev)=>{const d=prev?x.flow-prev.flow:null,lbl=[x.route.grade,x.route.tag,x.route.name].filter(Boolean).join(' · ')||x.src;
    return `<div class="m"><div class="k"><span>${new Date(x.date).toLocaleDateString()} · ${lbl}</span><span>${x.flow}${d!=null?` <b style="color:${d>=0?'#3DDC97':'var(--bad)'}">${d>=0?'+':''}${d}</b>`:''}</span></div>
      <p>${x.attempts} attempt${x.attempts===1?'':'s'}${x.tops?` · ${x.tops} top`:''}${x.handShare!=null?` · ${x.handShare}% on hands`:''}${x.cruxGapCm!=null?` · crux gap ${x.cruxGapCm} cm`:''} · <a href="#" data-del="${x.id}" style="color:var(--mute)">delete</a></p></div>`;};
  let html='';
  if(same.length){const sorted=same.slice().sort((a2,b2)=>a2.date.localeCompare(b2.date));
    html+=`<div class="note" style="margin:6px 0">This route · ${same.length} session${same.length===1?'':'s'} (Δ = Flow vs previous)</div>`+sorted.map((x,k)=>row(x,sorted[k-1])).reverse().join('');}
  if(others.length)html+=`<div class="note" style="margin:10px 0 6px">${same.length?'Other routes':'Recent sessions'}</div>`+others.map(x=>row(x,null)).join('');
  box.innerHTML=html;
  box.querySelectorAll('[data-del]').forEach(a=>a.onclick=e=>{e.preventDefault();store.set('climbpose.sessions',store.get('climbpose.sessions',[]).filter(x=>x.id!==a.dataset.del));renderHistory();});
}
for(const id of ['#gym','#grade','#tag','#rname'])$(id).addEventListener('change',renderHistory);

/* ---------- export ---------- */
function download(blob,name){
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.className='dl';a.textContent='⬇ '+name;
  $('#dlArea').prepend(a);a.click();
}
// Export. Preferred path: render frame by frame (seek → draw → WebCodecs H.264 → MP4).
// It is exact 30 fps, faster than real time and does not care whether the tab is visible.
// Fallback: real-time canvas recording with MediaRecorder.
const MUXER_URL='https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/build/mp4-muxer.mjs';
async function renderOffline(){
  const {Muxer,ArrayBufferTarget}=await import(/* @vite-ignore */ MUXER_URL);
  const W=cv.width,H=cv.height,FPS=30,D=S.D;
  let cfg=null;
  for(const codec of ['avc1.640033','avc1.4d0033','avc1.42003e']){
    const c={codec,width:W,height:H,bitrate:14e6,framerate:FPS};
    try{if((await VideoEncoder.isConfigSupported(c)).supported){cfg=c;break;}}catch(e){}
  }
  if(!cfg)throw new Error('no H.264 encoder available');
  const muxer=new Muxer({target:new ArrayBufferTarget(),video:{codec:'avc',width:W,height:H},fastStart:'in-memory'});
  let encErr=null;
  const enc=new VideoEncoder({output:(chunk,meta)=>muxer.addVideoChunk(chunk,meta),error:e=>{encErr=e;}});
  enc.configure(cfg);
  const ra=routeAttempt(),nRoute=ra?Math.round(ROUTE_SEC*FPS):0;
  const nClip=Math.round((D.t1-D.t0)*FPS),nEnd=Math.round(3.5*FPS),nFreeze=S.show.crux?Math.round(3.5*FPS):0;
  // freeze at each crux: the output pauses on that frame with the breakdown, then the clip continues
  const freezeAt=new Map();if(nFreeze)for(const c of D.cruxes)freezeAt.set(Math.round((c.i+0.25)/D.fps*FPS),c);
  if(nFreeze)for(const sd of D.sends)freezeAt.set(Math.round((sd.i+0.25)/D.fps*FPS),{send:sd,i:sd.i});
  const total=nClip+D.cruxes.filter(()=>nFreeze).length*nFreeze+(nFreeze?D.sends.length*Math.round(2.5*FPS):0)+nRoute+nEnd,tStart=performance.now();
  let n=0;
  const emit=async()=>{
    if(encErr)throw encErr;
    const fr=new VideoFrame(cv,{timestamp:Math.round(n*1e6/FPS),duration:Math.round(1e6/FPS)});
    enc.encode(fr,{keyFrame:n%60===0});fr.close();n++;
    while(enc.encodeQueueSize>6)await new Promise(r=>setTimeout(r,4));
    if(n%15===0){$('#bar i').style.width=(100*n/total).toFixed(1)+'%';const el=(performance.now()-tStart)/1000;
      setStatus(`Rendering frame ${n}/${total} · ~${Math.ceil(el/n*(total-n))} s left`,'busy');}
  };
  $('#bar').style.display='block';
  try{
    for(let k=0;k<nClip;k++){
      // sample a quarter into the frame, exactly like the analysis pass: seeking to a frame boundary
      // can show the PREVIOUS frame, which puts the skeleton one frame ahead of the body
      const t=D.t0+(k+0.25)/FPS;await seekTo(video,Math.min(video.duration-0.01,t));S.endCardAlpha=0;drawFrame(t);await emit();
      const c=freezeAt.get(k);
      if(c){const tc=D.t0+(c.i+0.25)/D.fps;await seekTo(video,Math.min(video.duration-0.01,tc));
        if(c.send){S.sendFreeze=c.send;for(let q=0;q<Math.round(2.5*FPS);q++){drawFrame(tc);await emit();}S.sendFreeze=null;}
        else{S.cruxFreeze=c;for(let q=0;q<nFreeze;q++){drawFrame(tc);await emit();}S.cruxFreeze=null;}}
    }
    for(let q=0;q<nRoute;q++){
      // route map over the frame where the attempt starts (climber at the bottom, route clear above)
      if(q===0){S.routeBg=ra.i0;await seekTo(video,Math.min(video.duration-0.01,D.t0+(ra.i0+0.25)/D.fps));}
      S.routeProg=clamp01(q/(ROUTE_BUILD*FPS));S.endCardAlpha=null;drawFrame(D.t1);await emit();
    }
    for(let q=0;q<nEnd;q++){S.routeProg=null;S.endCardAlpha=clamp01(q/(0.5*FPS));drawFrame(D.t1);await emit();}
    await enc.flush();
  }finally{S.endCardAlpha=null;S.routeProg=null;S.routeBg=null;S.cruxFreeze=null;S.sendFreeze=null;$('#bar').style.display='none';try{enc.close();}catch(e){}}
  muxer.finalize();
  return new Blob([muxer.target.buffer],{type:'video/mp4'});
}
async function recordRealtime(){
  const types=['video/mp4;codecs=avc1.640028','video/mp4','video/webm;codecs=vp9','video/webm'];
  const mime=types.find(t=>window.MediaRecorder&&MediaRecorder.isTypeSupported(t));
  if(!mime)throw new Error('this browser cannot record a canvas — try Chrome');
  S.exporting=true;S.endCard=0;await seekTo(video,S.D.t0);
  const rec=new MediaRecorder(cv.captureStream(30),{mimeType:mime,videoBitsPerSecond:14e6});
  const chunks=[];rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
  const stopped=new Promise(r=>rec.onstop=r);
  rec.start(250);setStatus('Recording in real time… keep this tab visible','busy');
  const clipDone=new Promise(r=>{S.onClipEnd=r;video.addEventListener('ended',()=>{if(S.onClipEnd){S.onClipEnd=null;S.endCard=performance.now();r();}},{once:true});});
  await video.play();await clipDone;await new Promise(r=>setTimeout(r,((routeAttempt()?ROUTE_SEC:0)+3.5)*1000));
  rec.stop();await stopped;S.exporting=false;
  const blob=new Blob(chunks,{type:mime.split(';')[0]});
  if(!blob.size)throw new Error('the recording came out empty (was the tab hidden?)');
  return blob;
}
$('#rec').onclick=async()=>{
  if(!S.D||S.busy||S.exporting)return;
  S.busy=true;lockUI(true);video.pause();
  let blob=null,how='';
  try{
    if(window.VideoEncoder&&window.VideoFrame){try{blob=await renderOffline();how='rendered';}catch(e){console.warn('offline render failed, falling back',e);}}
    if(!blob){S.busy=false;blob=await recordRealtime();how='recorded';}
    const ext=blob.type.includes('mp4')?'mp4':'webm';
    const g=routeInfo().grade;download(blob,`${S.srcName}${g?'_'+g.replace(/[^\w+]/g,''):''}_climbpose_${S.style}_${S.frame}.${ext}`);
    setStatus(`Video ${how} (${(blob.size/1048576).toFixed(0)} MB) — saved to Downloads`,'ok');
  }catch(e){console.error(e);setStatus('Export failed: '+e.message,'err');}
  S.busy=false;S.exporting=false;lockUI(false);await seekTo(video,S.D.t0);
};
$('#csv').onclick=()=>{
  const D=S.D;if(!D)return;
  const head=['frame','t','valid','attempt','com_x_m','com_y_m','feet_above_floor_m','speed_ms','moving','elbow_L','elbow_R','knee_L','knee_R'];
  for(let k=0;k<33;k++)head.push(`lm${k}_x`,`lm${k}_y`,`lm${k}_vis`);
  const rows=[head.join(',')];const r=v=>isFinite(v)?(+v).toFixed(4):'';
  for(let i=0;i<D.N;i++){
    const row=[i,(D.t0+i/D.fps).toFixed(3),D.valid[i],(D.attempts.find(a=>i>=a.i0&&i<a.i1)||{n:0}).n,r(D.cxs[i]*D.mpp),r(D.cys[i]*D.mpp),r(D.footH[i]),r(D.speed[i]),D.moving[i],r(D.ang[0][i]),r(D.ang[1][i]),r(D.ang[2][i]),r(D.ang[3][i])];
    for(let k=0;k<33;k++)row.push(r(D.X[k][i]/D.vw),r(D.Y[k][i]/D.vh),r(D.V[k][i]));
    rows.push(row.join(','));
  }
  download(new Blob([rows.join('\n')],{type:'text/csv'}),`${S.srcName}_climbpose_frames.csv`);
};
$('#json').onclick=()=>{
  const D=S.D;if(!D)return;
  const out={app:'CLIMB/POSE v0.3-dev',environment:envMode(),environment_detected:S.envDetected||null,route:{...routeInfo(),photo:S.routePhoto?S.routePhoto.kind:'auto',manual_hold_edits:{added:S.holdEdits.add.length,removed:S.holdEdits.remove.length}},source:S.srcName,video:{w:D.vw,h:D.vh,fps_analyzed:D.fps,frames:D.N,t_start:D.t0,t_end:D.t1},climber_height_cm:+$('#height').value,meters_per_px:D.mpp,
    metrics:D.M,scores:D.sc,cruxes:D.cruxes.map(c=>({attempt:c.att,t:+(D.t0+c.i/D.fps).toFixed(2),reach_hand:c.hand?'R':'L',push_leg:c.leg?'R':'L',knee_deg:Math.round(c.knee),elbow_deg:Math.round(c.elbow),hip_pct:Math.round(c.hipPct*100),reach_pct:Math.round(c.ext*100),com_up_ms:+(+c.comUp).toFixed(2),gap_to_next_hold_cm:c.target?Math.round(c.target.distM*100):null,cues:c.cues.map(q=>q.t),tips:c.tips,hand_load_share_pct:isFinite(c.handShare)?Math.round(c.handShare*100):null})),attempts:D.attempts.map(a=>({sent:a.sent,result_source:a.override,last_hold:a.lastHold?{n:a.lastHold.n,height_m:+(+a.lastHoldM).toFixed(2)}:null,n:a.n,t_start:+(D.t0+a.i0/D.fps).toFixed(2),t_end:+(D.t0+a.i1/D.fps).toFixed(2),duration_s:+a.dur.toFixed(2),high_foot_m:+a.highFootM.toFixed(2),high_com_m:+a.highComM.toFixed(2),end:a.end})),holds:D.holds.map(h=>({n:h.n,limb:h.limb,kind:h.kind,x:+(h.x/D.vw).toFixed(4),y:+(h.y/D.vh).toFixed(4),t_start:+(h.i0/D.fps).toFixed(2),t_end:+(h.i1/D.fps).toFixed(2)}))};
  download(new Blob([JSON.stringify(out,null,2)],{type:'application/json'}),`${S.srcName}_climbpose_summary.json`);
};

// Developer export: pose fixture (raw pose + camera track, rounded). Put it in tests/fixtures/
// (gzip optional) and run `npm run golden:update` to create its expected results.
$('#fixture').onclick=()=>{
  const R=S.raw;if(!R||!S.D)return;
  const r1=v=>isFinite(v)?Math.round(v*10):null,r3=v=>isFinite(v)?Math.round(v*1000):null;
  const w=+$('#weight').value>0?+$('#weight').value:null;
  const fx={format:'climbpose.pose/1',clip:S.srcFile||S.srcName,createdWith:'v0.3',settings:{heightCm:+$('#height').value||170,fps:R.fps,model:$('#model').value,wallDeg:+$('#wall').value||0,weightKg:w,cameraCompensation:$('#camcomp').checked,lrFix:$('#lrfix').checked},
    env:envMode(),envScores:S.envScores||null,N:R.N,fps:R.fps,t0:R.t0,t1:R.t1,width:R.vw,height:R.vh,scale:{xy:10,vis:1000},
    x:Array.from(R.X,r1),y:Array.from(R.Y,r1),vis:Array.from(R.V,r3),ox:Array.from(R.OX,r1),oy:Array.from(R.OY,r1)};
  download(new Blob([JSON.stringify(fx)],{type:'application/json'}),`${S.srcName}.pose.json`);
  setStatus('Pose fixture saved — put it in tests/fixtures/ and run npm run golden:update','ok');
};

document.fonts&&document.fonts.load('700 20px "Space Grotesk"');
requestAnimationFrame(tick);
window.__climbpose=S;S.reprocess=()=>{if(S.raw){S.cache={};process();}}; // for debugging
})();
