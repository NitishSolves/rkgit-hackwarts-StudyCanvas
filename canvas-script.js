// ============================================================
//  StudyCanvas – canvas-script.js  v2.1
//  FIXES: real CSS-transform zoom · board-dark on outer div
// ============================================================

/* ── URL PARAM ── */
const params  = new URLSearchParams(location.search);
const NOTE_ID = params.get('id');

/* ── SUBJECTS ── */
const SUBJECTS = [
  {id:'math',   label:'Mathematics', color:'#ef4444'},
  {id:'physics',label:'Physics',     color:'#f97316'},
  {id:'chem',   label:'Chemistry',   color:'#eab308'},
  {id:'bio',    label:'Biology',     color:'#22c55e'},
  {id:'english',label:'English',     color:'#3b82f6'},
  {id:'history',label:'History',     color:'#8b5cf6'},
  {id:'cs',     label:'Comp. Sci',   color:'#06b6d4'},
  {id:'other',  label:'Other',       color:'#64748b'},
];
const getSub = id => SUBJECTS.find(s=>s.id===id)||SUBJECTS[SUBJECTS.length-1];

/* ── IndexedDB ── */
const DB_NAME='studycanvas_db', DB_VER=1;
let db=null;

function openDB(){
  return new Promise((res,rej)=>{
    const req=indexedDB.open(DB_NAME,DB_VER);
    req.onupgradeneeded=e=>{
      const d=e.target.result;
      if(!d.objectStoreNames.contains('notes'))    d.createObjectStore('notes',{keyPath:'id'});
      if(!d.objectStoreNames.contains('canvases')) d.createObjectStore('canvases',{keyPath:'id'});
    };
    req.onsuccess=e=>{db=e.target.result;res(db)};
    req.onerror=()=>rej(req.error);
  });
}
const dbGet=(store,key)=>new Promise((res,rej)=>{
  const r=db.transaction(store,'readonly').objectStore(store).get(key);
  r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error);
});
const dbPut=(store,val)=>new Promise((res,rej)=>{
  const r=db.transaction(store,'readwrite').objectStore(store).put(val);
  r.onsuccess=()=>res(); r.onerror=()=>rej(r.error);
});

/* ── DOM ELEMENTS ── */
const canvasOuter = document.getElementById('canvas-outer');  // bg colour + clip
const canvasInner = document.getElementById('canvas-inner');  // CSS scale transform
const wrap        = document.getElementById('canvas-wrap');   // outermost, for cursor rect
const gridCanvas  = document.getElementById('grid-canvas');
const drawCanvas  = document.getElementById('draw-canvas');
const tempCanvas  = document.getElementById('temp-canvas');
const gCtx = gridCanvas.getContext('2d');
const dCtx = drawCanvas.getContext('2d');
const tCtx = tempCanvas.getContext('2d');
const textBox = document.getElementById('text-box');

/* ── STATE ── */
let tool      = 'pen';
let color     = '#0f172a';
let strokeSz  = parseInt(localStorage.getItem('sc_pen')||'3');
let boardDark = false;
let showGrid  = false;
let isDrawing = false;
let points    = [];
let sx=0, sy=0;
let undoStack = [];
let redoStack = [];
let pages     = [];
let curPage   = 0;
let isDirty   = false;
let saveTimer = null;
let cpOpen    = false;

/* ── ZOOM STATE ── */
let zoomLevel = 1;          // current scale
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 5;

/* ── SELECTOR STATE ── */
let selActive=false, selMoving=false;
let selX=0,selY=0,selW=0,selH=0;
let selOX=0,selOY=0,selDX=0,selDY=0;
let selImg=null;

const SHAPE_TOOLS = new Set(['line','arrow','rect','circle','triangle']);

/* ═════════════════════════════════════
   RESIZE  — sizes canvases, redraws
════════════════════════════════════ */
function resize(){
  // Canvas dimensions = the UNSCALED viewport of canvas-outer
  const W = canvasOuter.clientWidth;
  const H = canvasOuter.clientHeight;

  [gridCanvas,drawCanvas,tempCanvas].forEach(c=>{
    c.width  = Math.round(W * devicePixelRatio);
    c.height = Math.round(H * devicePixelRatio);
    c.style.width  = W + 'px';
    c.style.height = H + 'px';
  });
  [gCtx,dCtx,tCtx].forEach(ctx=>
    ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0)
  );
  drawGrid();
  restorePage(curPage);
}
window.addEventListener('resize',()=>{ if(selActive) commitSelection(); resize(); });

/* ═════════════════════════════════════
   ZOOM  — CSS transform on canvas-inner
   Pointer coordinates are divided by zoomLevel to convert
   screen-space → canvas-space
════════════════════════════════════ */
function applyZoom(){
  canvasInner.style.transform = `scale(${zoomLevel})`;
  document.getElementById('btn-zoom-reset').textContent = Math.round(zoomLevel*100)+'%';
}

function changeZoom(newZ, pivotX, pivotY){
  // newZ clamped
  const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newZ));
  zoomLevel = z;
  applyZoom();
}

document.getElementById('btn-zoom-in').addEventListener('click',()=>{
  changeZoom(zoomLevel * 1.25);
  toast('Zoom: '+Math.round(zoomLevel*100)+'%');
});
document.getElementById('btn-zoom-out').addEventListener('click',()=>{
  changeZoom(zoomLevel / 1.25);
  toast('Zoom: '+Math.round(zoomLevel*100)+'%');
});
document.getElementById('btn-zoom-reset').addEventListener('click',()=>{
  changeZoom(1);
  toast('Zoom reset to 100%');
});

// Mouse-wheel zoom (Ctrl + scroll or plain scroll on canvas)
canvasOuter.addEventListener('wheel', e=>{
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.1 : 0.9;
  changeZoom(zoomLevel * factor);
}, {passive:false});

/* ═════════════════════════════════════
   BOARD BACKGROUND  — toggle on canvasOuter
   CSS: .zb-canvas-outer.board-dark { background:#1a1d27 }
════════════════════════════════════ */
document.getElementById('btn-theme').addEventListener('click',()=>{
  boardDark = !boardDark;
  // Set background directly on canvasOuter (CSS class + inline both, for guaranteed override)
  canvasOuter.classList.toggle('board-dark', boardDark);
  canvasOuter.style.background = boardDark ? '#1a1d27' : '#ffffff';
  // Active state on button
  document.getElementById('btn-theme').classList.toggle('active', boardDark);
  // Refresh grid with correct colour
  drawGrid();
  // Refresh tab thumbnails so they show correct background
  renderTabs();
  toast(boardDark ? '🌙 Dark board' : '☀️ Light board');
});

/* ═════════════════════════════════════
   GRID
════════════════════════════════════ */
function drawGrid(){
  const W=gridCanvas.clientWidth, H=gridCanvas.clientHeight;
  gCtx.clearRect(0,0,W,H);
  if(!showGrid) return;
  gCtx.strokeStyle = boardDark
    ? 'rgba(255,255,255,0.06)'
    : 'rgba(0,0,0,0.07)';
  gCtx.lineWidth=1;
  const step=40;
  for(let x=0;x<=W;x+=step){ gCtx.beginPath();gCtx.moveTo(x,0);gCtx.lineTo(x,H);gCtx.stroke(); }
  for(let y=0;y<=H;y+=step){ gCtx.beginPath();gCtx.moveTo(0,y);gCtx.lineTo(W,y);gCtx.stroke(); }
}

document.getElementById('btn-grid').addEventListener('click',function(){
  showGrid=!showGrid; this.classList.toggle('active',showGrid); drawGrid();
});

/* ═════════════════════════════════════
   GET CANVAS POSITION
   With transform-origin:top-left, canvas top-left stays fixed on screen.
   getBoundingClientRect reflects the scaled visual rect, so dividing
   the offset by zoomLevel converts screen pixels → canvas pixels exactly.
════════════════════════════════════ */
function getPos(e){
  const r = drawCanvas.getBoundingClientRect();
  const t = e.touches ? e.touches[0] : e;
  return {
    x: (t.clientX - r.left) / zoomLevel,
    y: (t.clientY - r.top)  / zoomLevel
  };
}

/* ═════════════════════════════════════
   IndexedDB LOAD / SAVE
════════════════════════════════════ */
async function loadNote(){
  if(!NOTE_ID) return;
  try{
    const note=await dbGet('notes', NOTE_ID);
    if(note){
      document.getElementById('board-title').value=note.title;
      document.title=note.title+' – StudyCanvas';
      const sub=getSub(note.subject);
      const pill=document.getElementById('subject-pill');
      pill.textContent=sub.label;
      pill.style.background=sub.color+'22';
      pill.style.color=sub.color;
    }
    const rec=await dbGet('canvases', NOTE_ID);
    if(rec && Array.isArray(rec.data?.pages) && rec.data.pages.length){
      pages  =rec.data.pages;
      curPage=Math.min(rec.data.curPage||0, pages.length-1);
    } else {
      pages=[null]; curPage=0;
    }
  }catch(e){ pages=[null]; curPage=0; }
  renderTabs();
  restorePage(curPage);
  applySize(parseInt(localStorage.getItem('sc_pen')||'3'));
}

function markDirty(){
  isDirty=true;
  setSaveStatus('saving');
  clearTimeout(saveTimer);
  saveTimer=setTimeout(saveAll, 1500);
}

async function saveAll(){
  if(!NOTE_ID) return;
  pages[curPage]=snapDataURL();
  try{
    await dbPut('canvases',{id:NOTE_ID,data:{pages,curPage}});
    const note=await dbGet('notes',NOTE_ID);
    if(note){
      note.modified=new Date().toISOString();
      note.pages=pages.length;
      await dbPut('notes',note);
    }
  }catch(e){ console.warn('Save failed',e); }
  isDirty=false;
  setSaveStatus('saved');
}

function setSaveStatus(s){
  const dot=document.getElementById('save-dot');
  const txt=document.getElementById('save-text');
  dot.className='zb-save-dot'+(s==='saving'?' saving':'');
  txt.textContent=s==='saving'?'Saving…':'Saved locally';
}

/* snapDataURL — stores ONLY strokes (transparent PNG).
   canvas-outer background shows through, so dark/light toggle always works. */
function snapDataURL(){
  return drawCanvas.toDataURL('image/png');
}

/* snapComposite — composites board background + strokes.
   Used ONLY for PDF export and page-tab thumbnails. */
function snapComposite(){
  const off=document.createElement('canvas');
  off.width=drawCanvas.width; off.height=drawCanvas.height;
  const octx=off.getContext('2d');
  octx.fillStyle=boardDark?'#1a1d27':'#ffffff';
  octx.fillRect(0,0,off.width,off.height);
  octx.drawImage(drawCanvas,0,0);
  return off.toDataURL('image/jpeg',0.72);
}

function restorePage(idx){
  dCtx.clearRect(0,0,drawCanvas.clientWidth,drawCanvas.clientHeight);
  const url=pages[idx]; if(!url)return;
  const img=new Image();
  img.onload=()=>{
    dCtx.globalAlpha=1; dCtx.globalCompositeOperation='source-over';
    dCtx.drawImage(img,0,0,drawCanvas.clientWidth,drawCanvas.clientHeight);
  };
  img.src=url;
}

/* ═════════════════════════════════════
   UNDO / REDO
════════════════════════════════════ */
function pushUndo(){
  const W=Math.round(drawCanvas.clientWidth),H=Math.round(drawCanvas.clientHeight);
  undoStack.push(dCtx.getImageData(0,0,W,H));
  if(undoStack.length>50) undoStack.shift();
  redoStack=[];
}
function undo(){
  if(!undoStack.length) return;
  const W=Math.round(drawCanvas.clientWidth),H=Math.round(drawCanvas.clientHeight);
  redoStack.push(dCtx.getImageData(0,0,W,H));
  dCtx.putImageData(undoStack.pop(),0,0);
  markDirty();
}
function redo(){
  if(!redoStack.length) return;
  const W=Math.round(drawCanvas.clientWidth),H=Math.round(drawCanvas.clientHeight);
  undoStack.push(dCtx.getImageData(0,0,W,H));
  dCtx.putImageData(redoStack.pop(),0,0);
  markDirty();
}
document.getElementById('btn-undo').addEventListener('click',undo);
document.getElementById('btn-redo').addEventListener('click',redo);

/* ═════════════════════════════════════
   PAGES
════════════════════════════════════ */
function renderTabs(){
  const el=document.getElementById('page-tabs');
  el.innerHTML=pages.map((_,i)=>`
    <button class="zb-page-tab ${i===curPage?'active':''}" data-idx="${i}">
      <img class="zb-page-tab__thumb" id="tab-thumb-${i}" src="" loading="lazy" alt="" style="display:${pages[i]?'block':'none'}"/>
      Page ${i+1}
      ${pages.length>1
        ?`<span class="zb-page-tab-del" data-del="${i}" title="Delete page" aria-label="Delete page ${i+1}">×</span>`
        :''}
    </button>`).join('');

  // Generate composited thumbnails asynchronously (bg + strokes)
  pages.forEach((url,i)=>{
    if(!url) return;
    const imgEl=document.getElementById('tab-thumb-'+i);
    if(!imgEl) return;
    const W=80, H=56;
    const off=document.createElement('canvas');
    off.width=W; off.height=H;
    const octx=off.getContext('2d');
    octx.fillStyle=boardDark?'#1a1d27':'#ffffff';
    octx.fillRect(0,0,W,H);
    const img=new Image();
    img.onload=()=>{
      octx.drawImage(img,0,0,W,H);
      imgEl.src=off.toDataURL('image/jpeg',0.7);
      imgEl.style.display='block';
    };
    img.src=url;
  });

  el.querySelectorAll('.zb-page-tab').forEach(tab=>{
    tab.addEventListener('click',e=>{
      if(e.target.dataset.del!==undefined) return;
      switchPage(parseInt(tab.dataset.idx));
    });
  });
  el.querySelectorAll('[data-del]').forEach(btn=>{
    btn.addEventListener('click',e=>{
      e.stopPropagation();
      deletePage(parseInt(btn.dataset.del));
    });
  });
  const active=el.querySelector('.zb-page-tab.active');
  if(active) active.scrollIntoView({block:'nearest',inline:'center'});
}

function switchPage(idx){
  if(idx===curPage) return;
  if(selActive) commitSelection();
  pages[curPage]=snapDataURL();
  curPage=idx;
  dCtx.clearRect(0,0,drawCanvas.clientWidth,drawCanvas.clientHeight);
  undoStack=[];redoStack=[];
  restorePage(curPage);
  renderTabs();
  saveAll();
}

document.getElementById('btn-add-page').addEventListener('click',()=>{
  if(selActive) commitSelection();
  pages[curPage]=snapDataURL();
  pages.push(null);
  curPage=pages.length-1;
  dCtx.clearRect(0,0,drawCanvas.clientWidth,drawCanvas.clientHeight);
  undoStack=[];redoStack=[];
  renderTabs(); saveAll();
  toast('📄 Page '+pages.length+' added');
});

function deletePage(idx){
  if(pages.length===1){ toast('⚠️ Cannot delete the only page'); return; }
  showConfirm('Delete Page '+(idx+1)+'?','All drawings on this page will be removed.',()=>{
    if(selActive) commitSelection();
    pages.splice(idx,1);
    curPage=Math.min(curPage,pages.length-1);
    dCtx.clearRect(0,0,drawCanvas.clientWidth,drawCanvas.clientHeight);
    undoStack=[];redoStack=[];
    restorePage(curPage);
    renderTabs(); saveAll();
    toast('Page deleted');
  });
}

/* ═════════════════════════════════════
   DRAWING UTILS
════════════════════════════════════ */
function applyCtx(ctx){
  ctx.lineCap='round'; ctx.lineJoin='round';
  if(tool==='highlighter'){
    ctx.globalAlpha=0.35; ctx.globalCompositeOperation='source-over';
    ctx.strokeStyle=color; ctx.lineWidth=strokeSz*6;
  } else if(tool==='eraser'){
    ctx.globalAlpha=1; ctx.globalCompositeOperation='destination-out';
    ctx.strokeStyle='rgba(0,0,0,1)'; ctx.lineWidth=strokeSz*4;
  } else {
    ctx.globalAlpha=1; ctx.globalCompositeOperation='source-over';
    ctx.strokeStyle=color; ctx.fillStyle=color; ctx.lineWidth=strokeSz;
  }
}
function resetCtx(ctx){
  ctx.globalAlpha=1; ctx.globalCompositeOperation='source-over';
}

function drawSmooth(ctx,pts){
  if(pts.length<2) return;
  ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y);
  for(let i=1;i<pts.length-1;i++){
    const mx=(pts[i].x+pts[i+1].x)/2, my=(pts[i].y+pts[i+1].y)/2;
    ctx.quadraticCurveTo(pts[i].x,pts[i].y,mx,my);
  }
  ctx.lineTo(pts[pts.length-1].x,pts[pts.length-1].y);
  ctx.stroke();
}

function drawShape(ctx,x0,y0,x1,y1){
  ctx.beginPath();
  switch(tool){
    case 'line':  ctx.moveTo(x0,y0);ctx.lineTo(x1,y1);ctx.stroke(); break;
    case 'arrow':{
      ctx.moveTo(x0,y0);ctx.lineTo(x1,y1);ctx.stroke();
      const ang=Math.atan2(y1-y0,x1-x0), hl=14+strokeSz*1.2;
      ctx.beginPath();
      ctx.moveTo(x1,y1);
      ctx.lineTo(x1-hl*Math.cos(ang-Math.PI/6),y1-hl*Math.sin(ang-Math.PI/6));
      ctx.lineTo(x1-hl*Math.cos(ang+Math.PI/6),y1-hl*Math.sin(ang+Math.PI/6));
      ctx.closePath(); ctx.fillStyle=color; ctx.fill(); break;
    }
    case 'rect': ctx.strokeRect(x0,y0,x1-x0,y1-y0); break;
    case 'circle':{
      const rx=Math.abs(x1-x0)/2,ry=Math.abs(y1-y0)/2;
      ctx.ellipse(Math.min(x0,x1)+rx,Math.min(y0,y1)+ry,rx,ry,0,0,Math.PI*2);
      ctx.stroke(); break;
    }
    case 'triangle':{
      ctx.moveTo((x0+x1)/2,y0);ctx.lineTo(x1,y1);ctx.lineTo(x0,y1);
      ctx.closePath();ctx.stroke(); break;
    }
  }
}

/* ═════════════════════════════════════
   SELECTOR TOOL
════════════════════════════════════ */
function insideSel(px,py){
  const ox=Math.min(selX,selX+selW)+selOX;
  const oy=Math.min(selY,selY+selH)+selOY;
  return px>=ox&&px<=ox+Math.abs(selW)&&py>=oy&&py<=oy+Math.abs(selH);
}

function captureSelection(){
  const ox=Math.min(selX,selX+selW), oy=Math.min(selY,selY+selH);
  const ow=Math.max(1,Math.abs(selW)), oh=Math.max(1,Math.abs(selH));
  const sx2=drawCanvas.width/drawCanvas.clientWidth;
  const sy2=drawCanvas.height/drawCanvas.clientHeight;
  selImg=dCtx.getImageData(
    Math.round(ox*sx2),Math.round(oy*sy2),
    Math.round(ow*sx2),Math.round(oh*sy2)
  );
  dCtx.clearRect(ox,oy,ow,oh);
}

function drawFloatingSel(){
  if(!selImg) return;
  tCtx.clearRect(0,0,tempCanvas.clientWidth,tempCanvas.clientHeight);
  const ox=Math.min(selX,selX+selW)+selOX;
  const oy=Math.min(selY,selY+selH)+selOY;
  const ow=Math.abs(selW), oh=Math.abs(selH);
  const off=document.createElement('canvas');
  off.width=selImg.width; off.height=selImg.height;
  off.getContext('2d').putImageData(selImg,0,0);
  tCtx.drawImage(off,ox,oy,ow,oh);
  // Dashed border on temp
  tCtx.setLineDash([6,4]);
  tCtx.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue('--accent')||'#0ea5e9';
  tCtx.lineWidth=1.5/zoomLevel;
  tCtx.strokeRect(ox,oy,ow,oh);
  tCtx.setLineDash([]);
}

function commitSelection(){
  if(!selImg) return;
  const ox=Math.min(selX,selX+selW)+selOX;
  const oy=Math.min(selY,selY+selH)+selOY;
  const ow=Math.abs(selW), oh=Math.abs(selH);
  const off=document.createElement('canvas');
  off.width=selImg.width; off.height=selImg.height;
  off.getContext('2d').putImageData(selImg,0,0);
  dCtx.drawImage(off,ox,oy,ow,oh);
  tCtx.clearRect(0,0,tempCanvas.clientWidth,tempCanvas.clientHeight);
  selActive=false; selMoving=false; selImg=null; selOX=0; selOY=0;
  markDirty();
}

function handleSelectDown(pos){
  if(selActive&&insideSel(pos.x,pos.y)){
    selMoving=true;
    selDX=pos.x-(Math.min(selX,selX+selW)+selOX);
    selDY=pos.y-(Math.min(selY,selY+selH)+selOY);
  } else {
    if(selActive) commitSelection();
    sx=pos.x; sy=pos.y; selOX=0; selOY=0;
    isDrawing=true; selActive=false; selImg=null;
  }
}
function handleSelectMove(pos){
  if(selMoving){
    selOX=(pos.x-selDX)-Math.min(selX,selX+selW);
    selOY=(pos.y-selDY)-Math.min(selY,selY+selH);
    drawFloatingSel();
  } else if(isDrawing){
    selW=pos.x-sx; selH=pos.y-sy;
    tCtx.clearRect(0,0,tempCanvas.clientWidth,tempCanvas.clientHeight);
    tCtx.setLineDash([6,4]);
    tCtx.strokeStyle='#0ea5e9';
    tCtx.lineWidth=1.5/zoomLevel;
    tCtx.strokeRect(sx,sy,selW,selH);
    tCtx.setLineDash([]);
  }
}
function handleSelectUp(pos){
  if(selMoving){ selMoving=false; return; }
  if(!isDrawing) return;
  isDrawing=false;
  selX=sx; selY=sy; selW=pos.x-sx; selH=pos.y-sy;
  tCtx.clearRect(0,0,tempCanvas.clientWidth,tempCanvas.clientHeight);
  if(Math.abs(selW)<8||Math.abs(selH)<8){ selActive=false; selImg=null; return; }
  pushUndo();
  captureSelection();
  selActive=true; selOX=0; selOY=0;
  drawFloatingSel();
  toast('Selection captured · Drag to move · Escape to place',3000);
}

/* ═════════════════════════════════════
   MAIN POINTER EVENTS
════════════════════════════════════ */
function onDown(e){
  if(e.touches&&e.touches.length===2) return;
  const pos=getPos(e);
  if(tool==='select'){ handleSelectDown(pos); e.preventDefault(); return; }
  if(tool==='text')  { handleText(e);         e.preventDefault(); return; }
  if(selActive) commitSelection();
  isDrawing=true; sx=pos.x; sy=pos.y; points=[pos];
  pushUndo();
  if(!SHAPE_TOOLS.has(tool)){
    applyCtx(dCtx); dCtx.beginPath(); dCtx.moveTo(pos.x,pos.y);
  }
  e.preventDefault();
}

function onMove(e){
  if(e.touches&&e.touches.length===2) return;
  const pos=getPos(e);
  updateCursor(e);
  if(tool==='select'){ if(isDrawing||selMoving) handleSelectMove(pos); return; }
  if(!isDrawing) return;
  points.push(pos);
  if(SHAPE_TOOLS.has(tool)){
    tCtx.clearRect(0,0,tempCanvas.clientWidth,tempCanvas.clientHeight);
    applyCtx(tCtx); drawShape(tCtx,sx,sy,pos.x,pos.y); resetCtx(tCtx);
  } else {
    applyCtx(dCtx); drawSmooth(dCtx,points);
  }
  e.preventDefault();
}

function onUp(e){
  const src=e.changedTouches
    ? {clientX:e.changedTouches[0].clientX,clientY:e.changedTouches[0].clientY}
    : e;
  const pos=getPos(src);
  if(tool==='select'){ handleSelectUp(pos); e.preventDefault(); return; }
  if(!isDrawing) return;
  isDrawing=false;
  if(SHAPE_TOOLS.has(tool)){
    applyCtx(dCtx); drawShape(dCtx,sx,sy,pos.x,pos.y);
    tCtx.clearRect(0,0,tempCanvas.clientWidth,tempCanvas.clientHeight);
  } else {
    applyCtx(dCtx); drawSmooth(dCtx,points);
  }
  resetCtx(dCtx); markDirty();
  e.preventDefault();
}

// Attach to draw-canvas (inside canvas-inner so coordinates are in canvas space)
drawCanvas.addEventListener('pointerdown', onDown);
drawCanvas.addEventListener('pointermove', onMove);
drawCanvas.addEventListener('pointerup',   onUp);
drawCanvas.addEventListener('pointerleave',onUp);
drawCanvas.addEventListener('touchstart',  onDown, {passive:false});
drawCanvas.addEventListener('touchmove',   onMove, {passive:false});
drawCanvas.addEventListener('touchend',    onUp,   {passive:false});

/* ═════════════════════════════════════
   TEXT TOOL
════════════════════════════════════ */
let textX=0, textY=0;

function handleText(e){
  if(textBox.style.display==='block'&&textBox.value.trim()) commitText();
  const pos=getPos(e);
  textX=pos.x; textY=pos.y;
  // Position text-box in screen space (it lives outside canvas-inner)
  const r=drawCanvas.getBoundingClientRect();
  const wrapR=wrap.getBoundingClientRect();
  textBox.style.display='block';
  textBox.style.left=(r.left - wrapR.left + pos.x * zoomLevel)+'px';
  textBox.style.top =(r.top  - wrapR.top  + pos.y * zoomLevel - 4)+'px';
  textBox.style.color=color;
  textBox.style.fontSize=Math.max(16, strokeSz*4*zoomLevel)+'px';
  textBox.value='';
  setTimeout(()=>textBox.focus(),40);
}

function commitText(){
  if(!textBox.value.trim()){ textBox.style.display='none'; return; }
  pushUndo();
  const fs=Math.max(16,strokeSz*4), lh=fs*1.5;
  dCtx.globalAlpha=1; dCtx.globalCompositeOperation='source-over';
  dCtx.fillStyle=color;
  dCtx.font=`${fs}px -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif`;
  textBox.value.split('\n').forEach((line,i)=>dCtx.fillText(line,textX,textY+fs+i*lh));
  textBox.style.display='none'; textBox.value='';
  markDirty();
}

textBox.addEventListener('keydown',e=>{
  if(e.key==='Escape'){ textBox.style.display='none'; textBox.value=''; }
  if(e.key==='Enter'&&(e.ctrlKey||e.shiftKey)) commitText();
});
drawCanvas.addEventListener('click',()=>{
  if(tool==='text'&&textBox.style.display==='block') commitText();
});

/* ═════════════════════════════════════
   TOOL BUTTONS
════════════════════════════════════ */
function activateTool(t){
  tool=t;
  document.querySelectorAll('.zb-tool').forEach(b=>b.classList.toggle('active',b.dataset.tool===t));
  if(textBox.style.display==='block'){ textBox.style.display='none'; textBox.value=''; }
  canvasInner.style.cursor = t==='select'?'default' : t==='eraser'?'cell' : 'crosshair';
  if(t!=='select'&&selActive) commitSelection();
}
document.querySelectorAll('.zb-tool').forEach(btn=>
  btn.addEventListener('click',()=>activateTool(btn.dataset.tool))
);

/* ═════════════════════════════════════
   COLOR PANEL
════════════════════════════════════ */
const cpanel=document.getElementById('color-panel');

function setColor(c){
  color=c;
  document.getElementById('color-chip-inner').style.background=c;
  document.querySelectorAll('.zb-sw').forEach(s=>s.classList.toggle('active',s.dataset.color===c));
  if(textBox.style.display==='block') textBox.style.color=c;
}

function openCP(){
  cpOpen=true;
  cpanel.classList.add('open');
  cpanel.setAttribute('aria-hidden','false');
  document.getElementById('color-chip').setAttribute('aria-expanded','true');
  requestAnimationFrame(()=>cpanel.classList.add('visible'));
}
function closeCP(){
  cpOpen=false;
  cpanel.classList.remove('visible');
  document.getElementById('color-chip').setAttribute('aria-expanded','false');
  setTimeout(()=>{ cpanel.classList.remove('open'); cpanel.setAttribute('aria-hidden','true'); },180);
}
function toggleCP(){ cpOpen?closeCP():openCP(); }

document.getElementById('color-chip').addEventListener('click',e=>{e.stopPropagation();toggleCP();});
document.getElementById('size-chip').addEventListener('click', e=>{e.stopPropagation();toggleCP();});

document.querySelectorAll('.zb-sw[data-color]').forEach(sw=>
  sw.addEventListener('click',()=>setColor(sw.dataset.color))
);
document.getElementById('custom-color').addEventListener('input',function(){setColor(this.value);});

document.addEventListener('click',e=>{
  if(cpOpen &&
     !cpanel.contains(e.target) &&
     e.target!==document.getElementById('color-chip') &&
     e.target!==document.getElementById('size-chip'))
    closeCP();
});

/* ── Stroke size ── */
function applySize(sz){
  strokeSz=sz;
  const dot=document.getElementById('size-dot');
  const s=Math.max(4,Math.min(22,sz*1.5));
  dot.style.width=s+'px'; dot.style.height=s+'px';
  document.getElementById('size-slider').value=sz;
  updateSzSlider();
  document.querySelectorAll('.zb-sz-btn').forEach(b=>b.classList.toggle('active',+b.dataset.sz===sz));
}
function updateSzSlider(){
  const sl=document.getElementById('size-slider');
  const pct=((sl.value-sl.min)/(sl.max-sl.min))*100;
  sl.style.background=`linear-gradient(to right,var(--accent) 0%,var(--accent) ${pct}%,var(--panel-bdr) ${pct}%)`;
}
document.querySelectorAll('.zb-sz-btn').forEach(btn=>
  btn.addEventListener('click',()=>applySize(+btn.dataset.sz))
);
document.getElementById('size-slider').addEventListener('input',function(){applySize(+this.value);});

/* ═════════════════════════════════════
   CURSOR  (screen-space, not canvas-space)
════════════════════════════════════ */
const cursor=document.getElementById('zb-cursor');

function updateCursor(e){
  const r=wrap.getBoundingClientRect();
  const t=e.touches?e.touches[0]:e;
  const cx=t.clientX-r.left, cy=t.clientY-r.top;
  let sz=Math.max(8,strokeSz*zoomLevel+4);
  let bg=color, border='none';
  if(tool==='eraser')  { sz=Math.max(16,strokeSz*zoomLevel*4); bg='transparent'; border='2px solid rgba(0,0,0,.4)'; }
  if(tool==='select')  { sz=14; bg='rgba(14,165,233,.3)'; border='2px solid rgba(14,165,233,.7)'; }
  cursor.style.width=sz+'px'; cursor.style.height=sz+'px';
  cursor.style.left=(r.left+cx)+'px'; cursor.style.top=(r.top+cy)+'px';
  cursor.style.background=bg; cursor.style.border=border;
  cursor.style.opacity='0.75';
}

wrap.addEventListener('mousemove',e=>updateCursor(e));
wrap.addEventListener('mouseleave',()=>cursor.style.opacity='0');
wrap.addEventListener('mouseenter',()=>cursor.style.opacity='0.75');

/* ═════════════════════════════════════
   CLEAR PAGE
════════════════════════════════════ */
document.getElementById('btn-clear').addEventListener('click',()=>{
  showConfirm('Clear Page?','All drawings on this page will be permanently erased.',()=>{
    if(selActive) commitSelection();
    pushUndo();
    dCtx.clearRect(0,0,drawCanvas.clientWidth,drawCanvas.clientHeight);
    markDirty(); toast('Page cleared');
  });
});

/* ═════════════════════════════════════
   PDF EXPORT
════════════════════════════════════ */
document.getElementById('btn-export-pdf').addEventListener('click',async()=>{
  if(selActive) commitSelection();
  // Save current page strokes first (transparent PNG)
  pages[curPage]=snapDataURL();
  await saveAll();
  toast('📄 Generating PDF…',4000);

  if(!window.jspdf){
    await new Promise((res,rej)=>{
      const s=document.createElement('script');
      s.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      s.onload=res; s.onerror=rej;
      document.head.appendChild(s);
    });
  }

  const {jsPDF}=window.jspdf;
  const W=drawCanvas.clientWidth, H=drawCanvas.clientHeight;
  const orient=W>=H?'landscape':'portrait';
  const pdf=new jsPDF({orientation:orient,unit:'px',format:[W,H],compress:true});

  // For each page, render a composited (bg + strokes) image for PDF
  for(let i=0;i<pages.length;i++){
    if(i>0) pdf.addPage([W,H],orient);
    // Fill background
    pdf.setFillColor(boardDark?'#1a1d27':'#ffffff');
    pdf.rect(0,0,W,H,'F');
    // Composite strokes over background into JPEG for PDF
    if(pages[i]){
      const composite = await compositePageForExport(pages[i], W, H);
      pdf.addImage(composite,'JPEG',0,0,W,H,undefined,'FAST');
    }
  }

  const title=document.getElementById('board-title').value.trim()||'board';
  pdf.save(`${title}.pdf`);
  toast(`✅ PDF saved — ${pages.length} page${pages.length>1?'s':''}`);
});

/* Composite a stored transparent-PNG page with board background → JPEG string for PDF */
function compositePageForExport(pngDataURL, W, H){
  return new Promise(res=>{
    const off=document.createElement('canvas');
    off.width=Math.round(W*devicePixelRatio);
    off.height=Math.round(H*devicePixelRatio);
    const octx=off.getContext('2d');
    octx.scale(devicePixelRatio,devicePixelRatio);
    octx.fillStyle=boardDark?'#1a1d27':'#ffffff';
    octx.fillRect(0,0,W,H);
    const img=new Image();
    img.onload=()=>{ octx.drawImage(img,0,0,W,H); res(off.toDataURL('image/jpeg',0.8)); };
    img.onerror=()=>res(off.toDataURL('image/jpeg',0.8));
    img.src=pngDataURL;
  });
}

/* ═════════════════════════════════════
   KEYBOARD SHORTCUTS
════════════════════════════════════ */
document.addEventListener('keydown',e=>{
  const active=document.activeElement;
  if(active===textBox||active.tagName==='INPUT') return;

  if(e.ctrlKey||e.metaKey){
    if(e.key==='z'){e.preventDefault();undo();}
    if(e.key==='y'||e.key==='Z'){e.preventDefault();redo();}
    if(e.key==='='||e.key==='+'){e.preventDefault();changeZoom(zoomLevel*1.25);toast('Zoom: '+Math.round(zoomLevel*100)+'%');}
    if(e.key==='-'){e.preventDefault();changeZoom(zoomLevel/1.25);toast('Zoom: '+Math.round(zoomLevel*100)+'%');}
    if(e.key==='0'){e.preventDefault();changeZoom(1);toast('Zoom reset to 100%');}
    return;
  }

  const map={v:'select',p:'pen',h:'highlighter',e:'eraser',t:'text',l:'line',a:'arrow',r:'rect',c:'circle'};
  const t=map[e.key.toLowerCase()]; if(t) activateTool(t);
  if(e.key===']'){const n=Math.min(curPage+1,pages.length-1);if(n!==curPage)switchPage(n);}
  if(e.key==='['){const n=Math.max(curPage-1,0);if(n!==curPage)switchPage(n);}
  if(e.key==='g') document.getElementById('btn-grid').click();
  if(e.key==='Escape'&&selActive) commitSelection();
});

/* ═════════════════════════════════════
   BACK / TITLE
════════════════════════════════════ */
document.getElementById('btn-back').addEventListener('click',async()=>{
  if(selActive) commitSelection();
  if(isDirty) await saveAll();
  window.location.href='notes.html';
});

document.getElementById('board-title').addEventListener('input',async function(){
  try{
    const note=await dbGet('notes',NOTE_ID);
    if(note){ note.title=this.value; note.modified=new Date().toISOString(); await dbPut('notes',note); }
  }catch(e){}
  markDirty();
});

/* ═════════════════════════════════════
   CONFIRM MODAL
════════════════════════════════════ */
let confCb=null;
function showConfirm(title,body,cb){
  document.getElementById('conf-title').textContent=title;
  document.getElementById('conf-body').textContent=body;
  confCb=cb;
  document.getElementById('zb-confirm').classList.add('open');
}
document.getElementById('conf-cancel').addEventListener('click',()=>
  document.getElementById('zb-confirm').classList.remove('open')
);
document.getElementById('conf-ok').addEventListener('click',()=>{
  document.getElementById('zb-confirm').classList.remove('open');
  if(confCb){confCb();confCb=null;}
});

/* ═════════════════════════════════════
   TOAST
════════════════════════════════════ */
const toastEl=document.getElementById('zb-toast');
let toastTimer;
function toast(msg,dur=2400){
  toastEl.textContent=msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>toastEl.classList.remove('show'),dur);
}

/* ═════════════════════════════════════
   AUTO-SAVE ON HIDE / UNLOAD
════════════════════════════════════ */
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='hidden'&&isDirty) saveAll();
});
window.addEventListener('beforeunload',()=>{ if(isDirty) saveAll(); });

/* ═════════════════════════════════════
   INIT
════════════════════════════════════ */
async function init(){
  await openDB();
  // Set board background explicitly on start (light by default)
  canvasOuter.style.background = boardDark ? '#1a1d27' : '#ffffff';
  resize();
  await loadNote();
  applySize(parseInt(localStorage.getItem('sc_pen')||'3'));
  setColor('#0f172a');
  applyZoom();
  updateSzSlider();
  toast('📒 Board ready  ·  V P H E T L A R C = tools  ·  Ctrl+scroll = zoom  ·  [ ] = pages',4500);
}

init().catch(console.error);
