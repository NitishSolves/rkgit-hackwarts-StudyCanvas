// ============================================================
//  StudyCanvas – notes-script.js  v2.0
//  IndexedDB storage · Lazy loading · Backup/Restore
// ============================================================

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
const getSub = id => SUBJECTS.find(s=>s.id===id) || SUBJECTS[SUBJECTS.length-1];

/* ── STATE ── */
let allNotes     = [];
let shownCount   = 0;
const PAGE_SIZE  = 12;
let currentTheme = localStorage.getItem('sc_theme') || 'light';
let penWidth     = parseInt(localStorage.getItem('sc_pen') || '3');
let textSize     = parseInt(localStorage.getItem('sc_text_size') || '15');
let activeFilter = 'all';
let currentSearch= '';
let selectedSub  = 'other';
let pendingDeleteId = null;

/* ── IndexedDB ── */
let db = null;
const DB_NAME    = 'studycanvas_db';
const DB_VERSION = 1;
const NOTES_STORE  = 'notes';
const CANVAS_STORE = 'canvases';

function openDB(){
  return new Promise((res,rej)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if(!db.objectStoreNames.contains(NOTES_STORE))
        db.createObjectStore(NOTES_STORE, {keyPath:'id'});
      if(!db.objectStoreNames.contains(CANVAS_STORE))
        db.createObjectStore(CANVAS_STORE, {keyPath:'id'});
    };
    req.onsuccess = e => { db = e.target.result; res(db); };
    req.onerror   = () => rej(req.error);
  });
}

function dbGet(store, key){
  return new Promise((res,rej)=>{
    const tx = db.transaction(store,'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

function dbPut(store, value){
  return new Promise((res,rej)=>{
    const tx = db.transaction(store,'readwrite');
    const req = tx.objectStore(store).put(value);
    req.onsuccess = () => res();
    req.onerror   = () => rej(req.error);
  });
}

function dbDelete(store, key){
  return new Promise((res,rej)=>{
    const tx = db.transaction(store,'readwrite');
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => res();
    req.onerror   = () => rej(req.error);
  });
}

function dbGetAll(store){
  return new Promise((res,rej)=>{
    const tx = db.transaction(store,'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

async function loadAllNotes(){
  allNotes = await dbGetAll(NOTES_STORE);
  allNotes.sort((a,b) => new Date(b.modified||b.date) - new Date(a.modified||a.date));
}

async function saveNote(note){
  await dbPut(NOTES_STORE, note);
}

async function deleteNoteData(id){
  await dbDelete(NOTES_STORE, id);
  await dbDelete(CANVAS_STORE, id);
}

/* ── MIGRATE from old localStorage ── */
async function migrateFromLocalStorage(){
  const lsNotes = JSON.parse(localStorage.getItem('sc_notes')||'[]');
  if(!lsNotes.length) return;
  for(const note of lsNotes){
    await dbPut(NOTES_STORE, note);
    const canvasData = localStorage.getItem('sc_canvas_'+note.id);
    if(canvasData){
      try{
        await dbPut(CANVAS_STORE, {id:note.id, data: JSON.parse(canvasData)});
      }catch(e){}
    }
  }
  localStorage.removeItem('sc_notes');
  lsNotes.forEach(n=>localStorage.removeItem('sc_canvas_'+n.id));
}

/* ── DOM REFS ── */
const body         = document.body;
const pages        = document.querySelectorAll('.page');
const navItems     = document.querySelectorAll('.nav-item');
const themeToggle  = document.getElementById('theme-toggle');
const emptyState   = document.getElementById('empty-state');
const notesGrid    = document.getElementById('notes-grid');
const fabBtn       = document.getElementById('fab-btn');
const searchInput  = document.getElementById('search-input');
const searchClear  = document.getElementById('search-clear');
const loadMoreBtn  = document.getElementById('load-more');
const settingsBack = document.getElementById('settings-back');
const themeRadios  = document.querySelectorAll('input[name="theme"]');
const penSlider    = document.getElementById('pen-slider');
const penLabelEl   = document.getElementById('pen-label');
const clearBtn     = document.getElementById('clear-btn');
const storageText  = document.getElementById('storage-text');
const storageDot   = document.getElementById('storage-dot');

/* ── ROUTING ── */
function showPage(name){
  pages.forEach(p=>p.classList.remove('active'));
  document.getElementById('page-'+name).classList.add('active');
  if(name==='settings') updateStorageInfo();
}
navItems.forEach(item=>item.addEventListener('click',()=>{
  const t=item.dataset.page; showPage(t);
  navItems.forEach(n=>n.classList.toggle('active',n.dataset.page===t));
}));
settingsBack.addEventListener('click',()=>showPage('home'));

/* ── THEME ── */
function applyTheme(theme){
  currentTheme=theme;
  if(theme==='system') theme=window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';
  body.className=theme==='dark'?'dark-theme':'light-theme';
  localStorage.setItem('sc_theme',currentTheme);
  themeRadios.forEach(r=>{r.checked=r.value===currentTheme;});
  updateAllSliderFills();
}
themeToggle.addEventListener('click',()=>{
  const next=currentTheme==='dark'?'light':'dark';
  applyTheme(next);
});
themeRadios.forEach(r=>r.addEventListener('change',()=>{
  if(r.checked) applyTheme(r.value);
}));

/* ── TEXT SIZE ── */
const textSizeSlider = document.getElementById('text-size-slider');
const textSizeVal    = document.getElementById('text-size-val');
function applyTextSize(sz){
  textSize=sz;
  document.documentElement.style.setProperty('--app-text-size', sz+'px');
  localStorage.setItem('sc_text_size', sz);
  textSizeSlider.value=sz;
  textSizeVal.textContent=sz+'px';
  updateSliderFill(textSizeSlider);
}
textSizeSlider.addEventListener('input',()=>applyTextSize(+textSizeSlider.value));

/* ── PEN SLIDER ── */
function updateSliderFill(slider){
  const min=+slider.min,max=+slider.max,val=+slider.value;
  const pct=((val-min)/(max-min))*100;
  const a=body.classList.contains('dark-theme')?'#38bdf8':'#0ea5e9';
  const t=body.classList.contains('dark-theme')?'#334155':'#e2e8f0';
  slider.style.background=`linear-gradient(to right,${a} 0%,${a} ${pct}%,${t} ${pct}%)`;
}
function updateAllSliderFills(){
  document.querySelectorAll('.settings-slider').forEach(updateSliderFill);
}

penSlider.value=penWidth; penLabelEl.textContent=penWidth;
penSlider.addEventListener('input',()=>{
  penWidth=+penSlider.value;
  penLabelEl.textContent=penWidth;
  localStorage.setItem('sc_pen',penWidth);
  updateSliderFill(penSlider);
});
document.getElementById('pen-reset').addEventListener('click',()=>{
  penWidth=3; penSlider.value=3; penLabelEl.textContent=3;
  localStorage.setItem('sc_pen',3); updateSliderFill(penSlider);
  toast('Pen width reset to 3px');
});

/* ── STORAGE INFO ── */
function updateStorageInfo(){
  try{
    let total=0;
    for(let k in localStorage){ if(localStorage.hasOwnProperty(k)) total+=localStorage[k].length*2; }
    const kb=Math.round(total/1024);
    document.getElementById('storage-detail').textContent=
      `${allNotes.length} note${allNotes.length!==1?'s':''} · ~${kb}KB used locally on this device`;
  }catch(e){}
}

function updateStorageBar(){
  storageText.textContent=`Saved locally on this device · ${allNotes.length} note${allNotes.length!==1?'s':''}`;
}

/* ── UTILS ── */
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function fmtDate(iso){
  const d=new Date(iso),now=new Date(),diff=now-d;
  if(diff<60000)return'Just now';
  if(diff<3600000)return Math.floor(diff/60000)+'m ago';
  if(diff<86400000)return Math.floor(diff/3600000)+'h ago';
  if(diff<604800000)return Math.floor(diff/86400000)+'d ago';
  return d.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
}

/* ── FILTER & SEARCH ── */
function getFiltered(){
  let list=[...allNotes];
  if(activeFilter!=='all') list=list.filter(n=>n.subject===activeFilter);
  if(currentSearch) list=list.filter(n=>
    n.title.toLowerCase().includes(currentSearch)||
    getSub(n.subject).label.toLowerCase().includes(currentSearch)
  );
  return list;
}

/* ── RENDER ── */
function renderNotes(reset=true){
  const filtered=getFiltered();
  if(reset) shownCount=0;

  if(!filtered.length){
    emptyState.style.display='flex';
    notesGrid.innerHTML='';
    loadMoreBtn.style.display='none';
    return;
  }
  emptyState.style.display='none';

  const slice=filtered.slice(shownCount, shownCount+PAGE_SIZE);
  if(reset) notesGrid.innerHTML='';

  slice.forEach(n=>{
    const sub=getSub(n.subject);
    const card=document.createElement('div');
    card.className='note-card';
    card.dataset.id=n.id;
    card.tabIndex=0;
    card.setAttribute('role','button');
    card.setAttribute('aria-label',`Open note: ${n.title}`);

    // Lazy-load thumb from IndexedDB
    const thumbId=`thumb-${n.id}`;
    card.innerHTML=`
      <div class="note-card__thumb" style="border-top:3px solid ${sub.color}">
        <div class="note-card__thumb-empty" id="${thumbId}"></div>
        <div class="note-card__actions">
          <button class="nca-btn nca-rename" data-id="${n.id}" title="Rename" aria-label="Rename note">✏️</button>
          <button class="nca-btn nca-delete" data-id="${n.id}" title="Delete" aria-label="Delete note">🗑️</button>
        </div>
      </div>
      <div class="note-card__body">
        <span class="note-card__sub" style="background:${sub.color}1a;color:${sub.color}">${sub.label}</span>
        <p class="note-card__title">${esc(n.title)}</p>
        <p class="note-card__meta">${fmtDate(n.modified||n.date)} · ${n.pages||1} page${(n.pages||1)!==1?'s':''}</p>
      </div>`;

    // Lazy-load thumbnail from IndexedDB
    dbGet(CANVAS_STORE, n.id).then(rec=>{
      const el=document.getElementById(thumbId); if(!el)return;
      if(rec && rec.data && rec.data.pages && rec.data.pages[0]){
        const img=document.createElement('img');
        img.src=rec.data.pages[0]; img.alt='preview'; img.loading='lazy';
        el.replaceWith(img);
      }
    }).catch(()=>{});

    // Click to open
    card.addEventListener('click',e=>{
      if(e.target.closest('.note-card__actions'))return;
      window.location.href='canvas.html?id='+n.id;
    });
    card.addEventListener('keydown',e=>{
      if(e.key==='Enter'&&!e.target.closest('.note-card__actions'))
        window.location.href='canvas.html?id='+n.id;
    });

    // Rename
    card.querySelector('.nca-rename').addEventListener('click',e=>{
      e.stopPropagation();
      const t=prompt('Rename note:',n.title);
      if(t&&t.trim()){
        n.title=t.trim(); n.modified=new Date().toISOString();
        saveNote(n).then(()=>{ renderNotes(); toast('Note renamed'); });
      }
    });

    // Delete
    card.querySelector('.nca-delete').addEventListener('click',e=>{
      e.stopPropagation();
      openDeleteConfirm(n.id, n.title);
    });

    notesGrid.appendChild(card);
  });

  shownCount+=slice.length;
  loadMoreBtn.style.display=shownCount<filtered.length?'block':'none';
}

loadMoreBtn.addEventListener('click',()=>renderNotes(false));

/* ── DELETE CONFIRM ── */
function openDeleteConfirm(id,title){
  pendingDeleteId=id;
  document.getElementById('del-note-name').textContent=title;
  document.getElementById('delete-modal').classList.add('show');
}
document.getElementById('del-cancel').addEventListener('click',()=>{
  document.getElementById('delete-modal').classList.remove('show');
  pendingDeleteId=null;
});
document.getElementById('del-confirm').addEventListener('click',async()=>{
  if(!pendingDeleteId)return;
  await deleteNoteData(pendingDeleteId);
  allNotes=allNotes.filter(n=>n.id!==pendingDeleteId);
  pendingDeleteId=null;
  document.getElementById('delete-modal').classList.remove('show');
  renderNotes(); updateStorageBar();
  toast('Note deleted permanently');
});

/* ── NEW NOTE MODAL ── */
function selSubject(sid){
  selectedSub=sid;
  document.querySelectorAll('.subject-chip').forEach(c=>c.classList.toggle('active',c.dataset.sid===sid));
}
document.querySelectorAll('.subject-chip').forEach(c=>c.addEventListener('click',()=>selSubject(c.dataset.sid)));
selSubject('other');

fabBtn.addEventListener('click',()=>{
  document.getElementById('nn-title').value='';
  selSubject('other');
  document.getElementById('new-note-modal').classList.add('show');
  setTimeout(()=>document.getElementById('nn-title').focus(),120);
});
document.getElementById('nn-cancel').addEventListener('click',()=>
  document.getElementById('new-note-modal').classList.remove('show')
);
document.getElementById('nn-create').addEventListener('click',createNote);
document.getElementById('nn-title').addEventListener('keydown',e=>{
  if(e.key==='Enter')createNote();
  if(e.key==='Escape')document.getElementById('new-note-modal').classList.remove('show');
});

async function createNote(){
  const title=document.getElementById('nn-title').value.trim()||'Untitled Note';
  const now=new Date().toISOString();
  const note={id:Date.now().toString(),title,subject:selectedSub,date:now,modified:now,pages:1};
  await saveNote(note);
  allNotes.unshift(note);
  document.getElementById('new-note-modal').classList.remove('show');
  updateStorageBar();
  window.location.href='canvas.html?id='+note.id;
}

/* ── SEARCH ── */
searchInput.addEventListener('input',()=>{
  currentSearch=searchInput.value.toLowerCase().trim();
  searchClear.style.display=currentSearch?'block':'none';
  renderNotes();
});
searchClear.addEventListener('click',()=>{
  searchInput.value=''; currentSearch='';
  searchClear.style.display='none';
  renderNotes();
});

/* ── FILTER CHIPS ── */
document.getElementById('filter-chips').addEventListener('click',e=>{
  const chip=e.target.closest('.chip'); if(!chip)return;
  document.querySelectorAll('.chip').forEach(c=>c.classList.remove('active'));
  chip.classList.add('active');
  activeFilter=chip.dataset.sub;
  renderNotes();
});

/* ── BACKUP & EXPORT ── */
document.getElementById('backup-btn').addEventListener('click',()=>
  document.getElementById('backup-modal').classList.add('show')
);
document.getElementById('bk-close').addEventListener('click',()=>
  document.getElementById('backup-modal').classList.remove('show')
);

// Export JSON
async function exportJSON(){
  const canvases=await dbGetAll(CANVAS_STORE);
  const backup={version:'2.0',exported:new Date().toISOString(),notes:allNotes,canvases};
  const blob=new Blob([JSON.stringify(backup)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=`studycanvas_backup_${Date.now()}.json`;
  a.click(); URL.revokeObjectURL(url);
  toast('✅ Backup exported successfully');
}

document.getElementById('bk-json').addEventListener('click',exportJSON);
document.getElementById('export-json-btn').addEventListener('click',exportJSON);

// Import JSON
async function importJSON(file){
  try{
    const text=await file.text();
    const data=JSON.parse(text);
    if(!data.notes||!Array.isArray(data.notes)) throw new Error('Invalid backup file');
    let count=0;
    for(const note of data.notes){
      await dbPut(NOTES_STORE,note);
      count++;
    }
    if(data.canvases){
      for(const canvas of data.canvases){
        await dbPut(CANVAS_STORE,canvas);
      }
    }
    await loadAllNotes();
    renderNotes(); updateStorageBar();
    toast(`✅ Restored ${count} notes from backup`);
    document.getElementById('backup-modal').classList.remove('show');
  }catch(e){
    toast('❌ Invalid backup file');
  }
}

document.getElementById('bk-import-input').addEventListener('change',function(){
  if(this.files[0]) importJSON(this.files[0]);
  this.value='';
});
document.getElementById('import-json-input').addEventListener('change',function(){
  if(this.files[0]) importJSON(this.files[0]);
  this.value='';
});

/* ── CLEAR ALL ── */
clearBtn.addEventListener('click',()=>document.getElementById('clear-modal').classList.add('show'));
document.getElementById('modal-cancel').addEventListener('click',()=>
  document.getElementById('clear-modal').classList.remove('show')
);
document.getElementById('modal-confirm').addEventListener('click',async()=>{
  for(const n of allNotes){
    await dbDelete(NOTES_STORE,n.id);
    await dbDelete(CANVAS_STORE,n.id);
  }
  allNotes=[];
  renderNotes(); updateStorageBar(); updateStorageInfo();
  document.getElementById('clear-modal').classList.remove('show');
  toast('All data cleared');
});

/* ── TOAST ── */
const toastEl=document.getElementById('sc-toast');
let toastT;
function toast(msg,dur=2500){
  toastEl.textContent=msg;
  toastEl.classList.add('show');
  clearTimeout(toastT);
  toastT=setTimeout(()=>toastEl.classList.remove('show'),dur);
}

/* ── REFRESH ON RETURN ── */
document.addEventListener('visibilitychange',async()=>{
  if(document.visibilityState==='visible'){
    await loadAllNotes();
    renderNotes(); updateStorageBar();
  }
});

/* ── INIT ── */
async function init(){
  await openDB();
  await migrateFromLocalStorage();
  await loadAllNotes();
  applyTheme(currentTheme);
  applyTextSize(textSize);
  penSlider.value=penWidth; penLabelEl.textContent=penWidth;
  updateAllSliderFills();
  renderNotes();
  updateStorageBar();
}

init().catch(console.error);
