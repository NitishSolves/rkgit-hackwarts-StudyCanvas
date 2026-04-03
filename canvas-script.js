// ============================================================
//  StudyCanvas  — canvas-script.js
//  Ziteboard-style engine: multi-page, auto-save, PDF export
// ============================================================

/* ── PARAMS ── */
const params  = new URLSearchParams(location.search);
const NOTE_ID = params.get('id');

/* ── SUBJECTS ── */
const SUBJECTS = [
  {id:'math',label:'Mathematics',color:'#ef4444'},
  {id:'physics',label:'Physics',color:'#f97316'},
  {id:'chem',label:'Chemistry',color:'#eab308'},
  {id:'bio',label:'Biology',color:'#22c55e'},
  {id:'english',label:'English',color:'#3b82f6'},
  {id:'history',label:'History',color:'#8b5cf6'},
  {id:'cs',label:'Computer Sci',color:'#06b6d4'},
  {id:'other',label:'Other',color:'#64748b'},
];
const getSub = id => SUBJECTS.find(s=>s.id===id)||SUBJECTS[SUBJECTS.length-1];

/* ── CANVAS ELEMENTS ── */
const wrap       = document.getElementById('canvas-wrap');
const gridCanvas = document.getElementById('grid-canvas');
const drawCanvas = document.getElementById('draw-canvas');
const tempCanvas = document.getElementById('temp-canvas');
const gCtx = gridCanvas.getContext('2d');
const dCtx = drawCanvas.getContext('2d');
const tCtx = tempCanvas.getContext('2d');
const textBox  = document.getElementById('text-box');
const imageInput = document.getElementById('import-image-input');

/* ── STATE ── */
let tool      = 'pen';
let color     = '#000000';
let strokeSz  = 3;
let boardDark = false;
let showGrid  = false;
let isDrawing = false;
let points    = [];
let sx=0,sy=0;
let undoStack = [];
let redoStack = [];
let pages     = [];   // array of dataURLs
let curPage   = 0;
let isDirty   = false;
let saveTimer = null;
let colorPanelOpen = false;

const SHAPE_TOOLS = new Set(['line','arrow','rect','circle','triangle']);

/* ════════════════════════════════════
   RESIZE
════════════════════════════════════ */
function resize(){
  const W = wrap.clientWidth, H = wrap.clientHeight;
  [gridCanvas,drawCanvas,tempCanvas].forEach(c=>{
    c.width  = Math.round(W * devicePixelRatio);
    c.height = Math.round(H * devicePixelRatio);
    c.style.width  = W+'px';
    c.style.height = H+'px';
  });
  [gCtx,dCtx,tCtx].forEach(ctx=>ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0));
  drawGrid();
  restorePage(curPage);
}
window.addEventListener('resize',()=>{ resize(); });

/* ════════════════════════════════════
   GRID
════════════════════════════════════ */
function drawGrid(){
  const W=gridCanvas.clientWidth, H=gridCanvas.clientHeight;
  gCtx.clearRect(0,0,W,H);
  if(!showGrid)return;
  gCtx.strokeStyle = boardDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)';
  gCtx.lineWidth=1;
  const step=40;
  for(let x=0;x<=W;x+=step){gCtx.beginPath();gCtx.moveTo(x,0);gCtx.lineTo(x,H);gCtx.stroke();}
  for(let y=0;y<=H;y+=step){gCtx.beginPath();gCtx.moveTo(0,y);gCtx.lineTo(W,y);gCtx.stroke();}
}

/* ════════════════════════════════════
   DATA  LOAD / SAVE
════════════════════════════════════ */
function loadNote(){
  if(!NOTE_ID)return;
  const notes = JSON.parse(localStorage.getItem('sc_notes')||'[]');
  const note  = notes.find(n=>n.id===NOTE_ID);
  if(note){
    document.getElementById('board-title').value = note.title;
    document.title = note.title+' – StudyCanvas';
    const sub = getSub(note.subject);
    const pill = document.getElementById('subject-pill');
    pill.textContent = sub.label;
    pill.style.background = sub.color+'22';
    pill.style.color = sub.color;
  }
  try{
    const data = JSON.parse(localStorage.getItem('sc_canvas_'+NOTE_ID)||'null');
    if(data && Array.isArray(data.pages) && data.pages.length){
      pages   = data.pages;
      curPage = Math.min(data.curPage||0, pages.length-1);
    } else {
      pages=[null]; curPage=0;
    }
  }catch(e){pages=[null];curPage=0;}
  renderTabs();
  restorePage(curPage);
}

function markDirty(){
  isDirty=true;
  setBadge('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveAll, 1800);
}

function saveAll(){
  if(!NOTE_ID)return;
  pages[curPage] = snapPageDataURL();
  try{ localStorage.setItem('sc_canvas_'+NOTE_ID, JSON.stringify({pages,curPage})); }catch(e){}
  const notes = JSON.parse(localStorage.getItem('sc_notes')||'[]');
  const note  = notes.find(n=>n.id===NOTE_ID);
  if(note){note.modified=new Date().toISOString();note.pages=pages.length;localStorage.setItem('sc_notes',JSON.stringify(notes));}
  isDirty=false;
  setBadge('saved');
}

function setBadge(state){
  const el=document.getElementById('save-badge');
  const tx=document.getElementById('save-text');
  el.className='zb-save-badge '+state;
  tx.textContent = state==='saving'?'Saving…':'Saved';
}

function snapPageDataURL(){
  const off=document.createElement('canvas');
  off.width=drawCanvas.width; off.height=drawCanvas.height;
  const octx=off.getContext('2d');
  octx.fillStyle = boardDark ? '#1a1d27' : '#ffffff';
  octx.fillRect(0,0,off.width,off.height);
  octx.drawImage(drawCanvas,0,0);
  return off.toDataURL('image/jpeg',0.6);
}

function restorePage(idx){
  dCtx.clearRect(0,0,drawCanvas.clientWidth,drawCanvas.clientHeight);
  const url=pages[idx];
  if(!url)return;
  const img=new Image();
  img.onload=()=>{
    dCtx.globalAlpha=1;dCtx.globalCompositeOperation='source-over';
    dCtx.drawImage(img,0,0,drawCanvas.clientWidth,drawCanvas.clientHeight);
  };
  img.src=url;
}

/* ════════════════════════════════════
   UNDO / REDO
════════════════════════════════════ */
function pushUndo(){
  undoStack.push(dCtx.getImageData(0,0,Math.round(drawCanvas.clientWidth),Math.round(drawCanvas.clientHeight)));
  if(undoStack.length>50)undoStack.shift();
  redoStack=[];
}
function undo(){
  if(!undoStack.length)return;
  redoStack.push(dCtx.getImageData(0,0,Math.round(drawCanvas.clientWidth),Math.round(drawCanvas.clientHeight)));
  dCtx.putImageData(undoStack.pop(),0,0);
  markDirty();
}
function redo(){
  if(!redoStack.length)return;
  undoStack.push(dCtx.getImageData(0,0,Math.round(drawCanvas.clientWidth),Math.round(drawCanvas.clientHeight)));
  dCtx.putImageData(redoStack.pop(),0,0);
  markDirty();
}
document.getElementById('btn-undo').addEventListener('click',undo);
document.getElementById('btn-redo').addEventListener('click',redo);

/* ════════════════════════════════════
   PAGES
════════════════════════════════════ */
function renderTabs(){
  const tabsEl=document.getElementById('page-tabs');
  tabsEl.innerHTML=pages.map((_,i)=>`
    <button class="zb-page-tab ${i===curPage?'active':''}" data-idx="${i}">
      <img class="zb-page-tab__thumb" src="${pages[i]||''}" onerror="this.style.display='none'"/>
      Page ${i+1}
      ${pages.length>1
        ?`<span class="zb-page-tab__del" data-del="${i}" title="Delete page">×</span>`
        :''}
    </button>`).join('');

  tabsEl.querySelectorAll('.zb-page-tab').forEach(tab=>{
    tab.addEventListener('click',e=>{
      if(e.target.dataset.del!==undefined)return;
      switchPage(parseInt(tab.dataset.idx));
    });
  });
  tabsEl.querySelectorAll('[data-del]').forEach(btn=>{
    btn.addEventListener('click',e=>{e.stopPropagation();deletePage(parseInt(btn.dataset.del));});
  });

  // scroll active tab into view
  const activeTab=tabsEl.querySelector('.zb-page-tab.active');
  if(activeTab)activeTab.scrollIntoView({block:'nearest',inline:'center'});
}

function switchPage(idx){
  if(idx===curPage)return;
  pages[curPage]=snapPageDataURL();
  curPage=idx;
  dCtx.clearRect(0,0,drawCanvas.clientWidth,drawCanvas.clientHeight);
  undoStack=[];redoStack=[];
  restorePage(curPage);
  renderTabs();
  saveAll();
}

document.getElementById('btn-add-page').addEventListener('click',()=>{
  pages[curPage]=snapPageDataURL();
  pages.push(null);
  curPage=pages.length-1;
  dCtx.clearRect(0,0,drawCanvas.clientWidth,drawCanvas.clientHeight);
  undoStack=[];redoStack=[];
  renderTabs();
  saveAll();
  toast('📄 Page '+pages.length+' added');
});

function deletePage(idx){
  if(pages.length===1){toast('⚠️ Cannot delete the only page');return;}
  showConfirm('Delete Page '+(idx+1)+'?','This page will be permanently removed.',()=>{
    pages.splice(idx,1);
    curPage=Math.min(curPage,pages.length-1);
    dCtx.clearRect(0,0,drawCanvas.clientWidth,drawCanvas.clientHeight);
    undoStack=[];redoStack=[];
    restorePage(curPage);
    renderTabs();
    saveAll();
    toast('🗑️ Page deleted');
  });
}

/* ════════════════════════════════════
   DRAWING
════════════════════════════════════ */
function getPos(e){
  const r=drawCanvas.getBoundingClientRect();
  const t=e.touches?e.touches[0]:e;
  return{x:t.clientX-r.left, y:t.clientY-r.top};
}

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
  if(pts.length<2)return;
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
    case 'line':
      ctx.moveTo(x0,y0); ctx.lineTo(x1,y1); ctx.stroke(); break;
    case 'arrow':{
      ctx.moveTo(x0,y0); ctx.lineTo(x1,y1); ctx.stroke();
      const ang=Math.atan2(y1-y0,x1-x0), hl=14+strokeSz*1.2;
      ctx.beginPath();
      ctx.moveTo(x1,y1);
      ctx.lineTo(x1-hl*Math.cos(ang-Math.PI/6),y1-hl*Math.sin(ang-Math.PI/6));
      ctx.lineTo(x1-hl*Math.cos(ang+Math.PI/6),y1-hl*Math.sin(ang+Math.PI/6));
      ctx.closePath(); ctx.fillStyle=color; ctx.fill(); break;
    }
    case 'rect':  ctx.strokeRect(x0,y0,x1-x0,y1-y0); break;
    case 'circle':{
      const rx=Math.abs(x1-x0)/2,ry=Math.abs(y1-y0)/2;
      ctx.ellipse(Math.min(x0,x1)+rx,Math.min(y0,y1)+ry,rx,ry,0,0,Math.PI*2); ctx.stroke(); break;
    }
    case 'triangle':{
      ctx.moveTo((x0+x1)/2,y0); ctx.lineTo(x1,y1); ctx.lineTo(x0,y1); ctx.closePath(); ctx.stroke(); break;
    }
  }
}

function onDown(e){
  if(e.touches&&e.touches.length===2)return;
  if(tool==='select')return;
  if(tool==='text'){handleText(e);return;}
  const pos=getPos(e);
  isDrawing=true; sx=pos.x; sy=pos.y; points=[pos];
  pushUndo();
  if(!SHAPE_TOOLS.has(tool)){applyCtx(dCtx);dCtx.beginPath();dCtx.moveTo(pos.x,pos.y);}
  e.preventDefault();
}

function onMove(e){
  if(e.touches&&e.touches.length===2)return;
  const pos=getPos(e);
  updateCursor(pos.x,pos.y);
  if(!isDrawing)return;
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
  if(!isDrawing)return;
  isDrawing=false;
  const src = e.changedTouches ? {clientX:e.changedTouches[0].clientX,clientY:e.changedTouches[0].clientY} : e;
  const pos  = getPos(src);
  if(SHAPE_TOOLS.has(tool)){
    applyCtx(dCtx); drawShape(dCtx,sx,sy,pos.x,pos.y);
    tCtx.clearRect(0,0,tempCanvas.clientWidth,tempCanvas.clientHeight);
  } else {
    applyCtx(dCtx); drawSmooth(dCtx,points);
  }
  resetCtx(dCtx); markDirty();
  e.preventDefault();
}

drawCanvas.addEventListener('pointerdown',onDown);
drawCanvas.addEventListener('pointermove',onMove);
drawCanvas.addEventListener('pointerup',onUp);
drawCanvas.addEventListener('pointerleave',onUp);
drawCanvas.addEventListener('touchstart',onDown,{passive:false});
drawCanvas.addEventListener('touchmove',onMove,{passive:false});
drawCanvas.addEventListener('touchend',onUp,{passive:false});

/* ════════════════════════════════════
   TEXT TOOL
════════════════════════════════════ */
let textX=0,textY=0;
function handleText(e){
  if(textBox.style.display==='block'&&textBox.value.trim())commitText();
  const pos=getPos(e);
  textX=pos.x; textY=pos.y;
  textBox.style.display='block';
  textBox.style.left=pos.x+'px';
  textBox.style.top=(pos.y-4)+'px';
  textBox.style.color=color;
  textBox.style.fontSize=Math.max(16,strokeSz*4)+'px';
  textBox.value='';
  setTimeout(()=>textBox.focus(),40);
}
function commitText(){
  if(!textBox.value.trim()){textBox.style.display='none';return;}
  pushUndo();
  const fs=Math.max(16,strokeSz*4), lh=fs*1.5;
  dCtx.globalAlpha=1; dCtx.globalCompositeOperation='source-over';
  dCtx.fillStyle=color; dCtx.font=`${fs}px 'Segoe UI',sans-serif`;
  textBox.value.split('\n').forEach((line,i)=>dCtx.fillText(line,textX,textY+fs+i*lh));
  textBox.style.display='none'; textBox.value='';
  markDirty();
}
textBox.addEventListener('keydown',e=>{
  if(e.key==='Escape'){textBox.style.display='none';textBox.value='';}
  if(e.key==='Enter'&&(e.ctrlKey||e.shiftKey))commitText();
});
drawCanvas.addEventListener('click',()=>{if(tool==='text'&&textBox.style.display==='block')commitText();});

/* ════════════════════════════════════
   TOOL BUTTONS
════════════════════════════════════ */
function activateTool(t){
  tool=t;
  document.querySelectorAll('.zb-tool').forEach(b=>b.classList.toggle('active',b.dataset.tool===t));
  if(textBox.style.display==='block'){textBox.style.display='none';textBox.value='';}
}
document.querySelectorAll('.zb-tool').forEach(btn=>{
  btn.addEventListener('click',()=>activateTool(btn.dataset.tool));
});

/* ════════════════════════════════════
   COLOR PANEL
════════════════════════════════════ */
const colorPanel = document.getElementById('color-panel');
const colorChip  = document.getElementById('color-chip');

function setColor(c){
  color=c;
  document.getElementById('color-chip-inner').style.background=c;
  document.querySelectorAll('.zb-swatch').forEach(s=>s.classList.toggle('active',s.dataset.color===c));
  if(textBox.style.display==='block')textBox.style.color=c;
}

function toggleColorPanel(){
  colorPanelOpen=!colorPanelOpen;
  if(colorPanelOpen){
    colorPanel.classList.add('open');
    requestAnimationFrame(()=>colorPanel.classList.add('visible'));
  } else {
    colorPanel.classList.remove('visible');
    setTimeout(()=>colorPanel.classList.remove('open'),180);
  }
}

colorChip.addEventListener('click',e=>{e.stopPropagation();toggleColorPanel();});
document.getElementById('size-chip').addEventListener('click',e=>{e.stopPropagation();toggleColorPanel();});

document.querySelectorAll('.zb-swatch').forEach(sw=>{
  sw.addEventListener('click',()=>{setColor(sw.dataset.color);});
});
document.getElementById('custom-color').addEventListener('input',function(){setColor(this.value);});

/* Stroke size */
function applySize(sz){
  strokeSz=sz;
  const dot=document.getElementById('size-dot');
  const s=Math.max(4,Math.min(22,sz*1.6));
  dot.style.width=s+'px'; dot.style.height=s+'px';
  document.getElementById('size-slider').value=sz;
  updateSliderFill();
  document.querySelectorAll('.zb-size-preset').forEach(b=>b.classList.toggle('active',parseInt(b.dataset.sz)===sz));
}
function updateSliderFill(){
  const sl=document.getElementById('size-slider');
  const pct=((sl.value-sl.min)/(sl.max-sl.min))*100;
  sl.style.background=`linear-gradient(to right,var(--accent) 0%,var(--accent) ${pct}%,var(--ui-border) ${pct}%)`;
}
document.querySelectorAll('.zb-size-preset').forEach(btn=>{
  btn.addEventListener('click',()=>applySize(parseInt(btn.dataset.sz)));
});
document.getElementById('size-slider').addEventListener('input',function(){applySize(parseInt(this.value));});

// Close panel on outside click
document.addEventListener('click',e=>{
  if(colorPanelOpen && !colorPanel.contains(e.target) && e.target!==colorChip && e.target!==document.getElementById('size-chip')){
    colorPanelOpen=false;
    colorPanel.classList.remove('visible');
    setTimeout(()=>colorPanel.classList.remove('open'),180);
  }
  // close export dropdown
  if(!document.getElementById('export-wrap').contains(e.target)){
    document.getElementById('export-menu').classList.remove('open');
  }
});

/* ════════════════════════════════════
   ZOOM
════════════════════════════════════ */
let zoom=1;
const zoomEl=document.getElementById('btn-zoom-reset');

function setZoom(z){
  zoom=Math.max(0.25,Math.min(5,z));
  zoomEl.textContent=Math.round(zoom*100)+'%';
}
document.getElementById('btn-zoom-in').addEventListener('click',()=>setZoom(zoom*1.25));
document.getElementById('btn-zoom-out').addEventListener('click',()=>setZoom(zoom/1.25));
document.getElementById('btn-zoom-reset').addEventListener('click',()=>{setZoom(1);toast('Zoom reset');});
wrap.addEventListener('wheel',e=>{
  e.preventDefault();
  setZoom(zoom*(e.deltaY<0?1.1:0.9));
},{passive:false});

/* ════════════════════════════════════
   GRID
════════════════════════════════════ */
document.getElementById('btn-grid').addEventListener('click',function(){
  showGrid=!showGrid;
  this.classList.toggle('active',showGrid);
  drawGrid();
});

/* ════════════════════════════════════
   THEME
════════════════════════════════════ */
document.getElementById('btn-theme').addEventListener('click',()=>{
  boardDark=!boardDark;
  wrap.classList.toggle('board-dark',boardDark);
  drawGrid();
});

/* ════════════════════════════════════
   CLEAR PAGE
════════════════════════════════════ */
document.getElementById('btn-clear').addEventListener('click',()=>{
  showConfirm('Clear Page?','All drawings on this page will be erased.',()=>{
    pushUndo();
    dCtx.clearRect(0,0,drawCanvas.clientWidth,drawCanvas.clientHeight);
    markDirty(); toast('Page cleared');
  });
});

/* ════════════════════════════════════
   IMAGE IMPORT
════════════════════════════════════ */
function importImageToBoard(file){
  if(!file)return;
  if(!file.type.startsWith('image/')){
    toast('⚠️ Please choose an image file');
    return;
  }

  const url = URL.createObjectURL(file);
  const img = new Image();

  img.onload = ()=>{
    pushUndo();
    const W = drawCanvas.clientWidth;
    const H = drawCanvas.clientHeight;
    const pad = 24;
    const maxW = Math.max(1, W - pad * 2);
    const maxH = Math.max(1, H - pad * 2);
    const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
    const w = Math.max(1, img.naturalWidth * scale);
    const h = Math.max(1, img.naturalHeight * scale);
    const x = (W - w) / 2;
    const y = (H - h) / 2;

    dCtx.globalAlpha = 1;
    dCtx.globalCompositeOperation = 'source-over';
    dCtx.drawImage(img, x, y, w, h);
    resetCtx(dCtx);

    URL.revokeObjectURL(url);
    imageInput.value = '';
    markDirty();
    toast('🖼️ Image imported');
  };

  img.onerror = ()=>{
    URL.revokeObjectURL(url);
    imageInput.value = '';
    toast('⚠️ Could not load image');
  };

  img.src = url;
}

document.getElementById('btn-import-image').addEventListener('click',()=>{
  imageInput.click();
});

imageInput.addEventListener('change',()=>{
  const file = imageInput.files && imageInput.files[0];
  importImageToBoard(file);
});

/* ════════════════════════════════════
   EXPORT — PNG + PDF
════════════════════════════════════ */
document.getElementById('btn-export-toggle').addEventListener('click',e=>{
  e.stopPropagation();
  document.getElementById('export-menu').classList.toggle('open');
});

// PNG — current page
document.getElementById('export-png').addEventListener('click',()=>{
  document.getElementById('export-menu').classList.remove('open');
  const off=document.createElement('canvas');
  off.width=drawCanvas.width; off.height=drawCanvas.height;
  const octx=off.getContext('2d');
  octx.fillStyle=boardDark?'#1a1d27':'#ffffff';
  octx.fillRect(0,0,off.width,off.height);
  if(showGrid){
    octx.strokeStyle=boardDark?'rgba(255,255,255,0.06)':'rgba(0,0,0,0.07)';
    octx.lineWidth=devicePixelRatio;
    const step=40*devicePixelRatio;
    for(let x=0;x<=off.width;x+=step){octx.beginPath();octx.moveTo(x,0);octx.lineTo(x,off.height);octx.stroke();}
    for(let y=0;y<=off.height;y+=step){octx.beginPath();octx.moveTo(0,y);octx.lineTo(off.width,y);octx.stroke();}
  }
  octx.drawImage(drawCanvas,0,0);
  const link=document.createElement('a');
  const title=document.getElementById('board-title').value.trim()||'board';
  link.download=`${title}_page${curPage+1}.png`;
  link.href=off.toDataURL('image/png');
  link.click();
  toast('💾 PNG exported — page '+(curPage+1));
});

// PDF — all pages  (using browser print / jsPDF via CDN)
document.getElementById('export-pdf').addEventListener('click',async()=>{
  document.getElementById('export-menu').classList.remove('open');
  toast('📄 Generating PDF…',3000);

  // Save current page snapshot first
  pages[curPage]=snapPageDataURL();

  // Dynamic load jsPDF
  if(!window.jspdf){
    await new Promise((res,rej)=>{
      const s=document.createElement('script');
      s.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      s.onload=res; s.onerror=rej;
      document.head.appendChild(s);
    });
  }

  const {jsPDF} = window.jspdf;
  const W=drawCanvas.clientWidth, H=drawCanvas.clientHeight;
  const orientation=W>=H?'landscape':'portrait';
  const pdf=new jsPDF({orientation,unit:'px',format:[W,H],compress:true});

  for(let i=0;i<pages.length;i++){
    if(i>0) pdf.addPage([W,H], orientation);
    // draw bg
    pdf.setFillColor(boardDark?'#1a1d27':'#ffffff');
    pdf.rect(0,0,W,H,'F');
    if(pages[i]){
      pdf.addImage(pages[i],'JPEG',0,0,W,H,undefined,'FAST');
    }
  }

  const title=document.getElementById('board-title').value.trim()||'board';
  pdf.save(title+'.pdf');
  toast('✅ PDF saved — '+pages.length+' page'+( pages.length>1?'s':''));
});

/* ════════════════════════════════════
   CURSOR
════════════════════════════════════ */
const cursor=document.getElementById('zb-cursor');
function updateCursor(x,y){
  const r=wrap.getBoundingClientRect();
  const sz=tool==='eraser'?Math.max(16,strokeSz*4):Math.max(8,strokeSz+4);
  cursor.style.width=sz+'px'; cursor.style.height=sz+'px';
  cursor.style.left=(r.left+x)+'px'; cursor.style.top=(r.top+y)+'px';
  cursor.style.opacity='0.7';
  if(tool==='eraser'){cursor.style.background='transparent';cursor.style.border='2px solid rgba(255,255,255,.6)';}
  else{cursor.style.background=color;cursor.style.border='none';}
}
wrap.addEventListener('mousemove',e=>{const r=wrap.getBoundingClientRect();updateCursor(e.clientX-r.left,e.clientY-r.top);});
wrap.addEventListener('mouseleave',()=>{cursor.style.opacity='0';});
wrap.addEventListener('mouseenter',()=>{cursor.style.opacity='0.7';});

/* ════════════════════════════════════
   KEYBOARD SHORTCUTS
════════════════════════════════════ */
document.addEventListener('keydown',e=>{
  const active=document.activeElement;
  if(active===textBox||active.tagName==='INPUT')return;
  if(e.ctrlKey||e.metaKey){
    if(e.key==='z'){e.preventDefault();undo();}
    if(e.key==='y'){e.preventDefault();redo();}
    return;
  }
  const map={p:'pen',h:'highlighter',e:'eraser',t:'text',l:'line',a:'arrow',r:'rect',c:'circle',v:'select'};
  const t=map[e.key.toLowerCase()];
  if(t)activateTool(t);
  if(e.key===']'){const n=Math.min(curPage+1,pages.length-1);if(n!==curPage)switchPage(n);}
  if(e.key==='['){const n=Math.max(curPage-1,0);if(n!==curPage)switchPage(n);}
  if(e.key==='g')document.getElementById('btn-grid').click();
});

/* ════════════════════════════════════
   BACK / TITLE
════════════════════════════════════ */
document.getElementById('btn-back').addEventListener('click',()=>{
  if(isDirty)saveAll();
  window.location.href='notes.html';
});

document.getElementById('board-title').addEventListener('input',function(){
  const notes=JSON.parse(localStorage.getItem('sc_notes')||'[]');
  const note=notes.find(n=>n.id===NOTE_ID);
  if(note){note.title=this.value;note.modified=new Date().toISOString();localStorage.setItem('sc_notes',JSON.stringify(notes));}
  markDirty();
});

/* ════════════════════════════════════
   CONFIRM MODAL
════════════════════════════════════ */
let confirmCb=null;
function showConfirm(title,body,cb){
  document.getElementById('conf-title').textContent=title;
  document.getElementById('conf-body').textContent=body;
  confirmCb=cb;
  document.getElementById('zb-confirm').classList.add('open');
}
document.getElementById('conf-cancel').addEventListener('click',()=>document.getElementById('zb-confirm').classList.remove('open'));
document.getElementById('conf-ok').addEventListener('click',()=>{
  document.getElementById('zb-confirm').classList.remove('open');
  if(confirmCb){confirmCb();confirmCb=null;}
});

/* ════════════════════════════════════
   TOAST
════════════════════════════════════ */
const toastEl=document.getElementById('zb-toast');
let toastT;
function toast(msg,dur=2200){
  toastEl.textContent=msg;
  toastEl.classList.add('show');
  clearTimeout(toastT);
  toastT=setTimeout(()=>toastEl.classList.remove('show'),dur);
}

/* ════════════════════════════════════
   VISIBILITY / UNLOAD  AUTO-SAVE
════════════════════════════════════ */
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&isDirty)saveAll();});
window.addEventListener('beforeunload',()=>{if(isDirty)saveAll();});

/* ════════════════════════════════════
   INIT
════════════════════════════════════ */
setColor('#000000');
applySize(3);
resize();
loadNote();
toast('🎨 Board ready  ·  P H E T L A R C = tools  ·  [ ] = pages  ·  Ctrl+Z = undo',4000);
