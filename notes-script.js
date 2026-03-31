// ============================================================
//  StudyCanvas – notes-script.js
// ============================================================

let notes        = JSON.parse(localStorage.getItem('sc_notes') || '[]');
let currentTheme = localStorage.getItem('sc_theme') || 'light';
let penWidth     = parseInt(localStorage.getItem('sc_pen') || '3');

/* ── Subjects ── */
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

/* ── DOM ── */
const body        = document.body;
const pages       = document.querySelectorAll('.page');
const navItems    = document.querySelectorAll('.bottom-nav__item');
const themeToggle = document.getElementById('theme-toggle');
const emptyState  = document.getElementById('empty-state');
const notesGrid   = document.getElementById('notes-grid');
const fabBtn      = document.getElementById('fab-btn');
const searchInput = document.getElementById('search-input');
const settingsBack= document.getElementById('settings-back');
const themeRadios = document.querySelectorAll('input[name="theme"]');
const penSlider   = document.getElementById('pen-slider');
const penLabel    = document.getElementById('pen-label');
const clearBtn    = document.getElementById('clear-btn');

/* ── PAGE ROUTING ── */
function showPage(name){
  pages.forEach(p=>p.classList.remove('active'));
  document.getElementById('page-'+name).classList.add('active');
}
navItems.forEach(item=>item.addEventListener('click',()=>{
  const t=item.dataset.page; showPage(t);
  navItems.forEach(n=>n.classList.toggle('active',n.dataset.page===t));
}));
settingsBack.addEventListener('click',()=>showPage('home'));

/* ── THEME ── */
function applyTheme(theme){
  currentTheme=theme;
  body.className=theme==='dark'?'dark-theme':'light-theme';
  localStorage.setItem('sc_theme',theme);
  themeRadios.forEach(r=>{r.checked=r.value===theme;});
  updateSliderFill();
}
themeToggle.addEventListener('click',()=>applyTheme(currentTheme==='dark'?'light':'dark'));
themeRadios.forEach(r=>r.addEventListener('change',()=>{
  if(r.checked){
    const v=r.value==='system'?(window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light'):r.value;
    applyTheme(v);
  }
}));

/* ── PEN SLIDER ── */
function updateSliderFill(){
  const min=+penSlider.min,max=+penSlider.max,val=+penSlider.value;
  const pct=((val-min)/(max-min))*100;
  const a=currentTheme==='dark'?'#38bdf8':'#0288d1';
  const t=currentTheme==='dark'?'#334155':'#e5e7eb';
  penSlider.style.background=`linear-gradient(to right,${a} 0%,${a} ${pct}%,${t} ${pct}%)`;
}
penSlider.value=penWidth; penLabel.textContent=penWidth; updateSliderFill();
penSlider.addEventListener('input',()=>{
  penWidth=+penSlider.value; penLabel.textContent=penWidth;
  localStorage.setItem('sc_pen',penWidth); updateSliderFill();
});
document.getElementById('pen-reset').addEventListener('click',()=>{
  penSlider.value=3;penWidth=3;penLabel.textContent=3;
  localStorage.setItem('sc_pen',3);updateSliderFill();
});

/* ── NOTES UTILS ── */
function saveNotes(){ localStorage.setItem('sc_notes',JSON.stringify(notes)); }
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function fmtDate(iso){
  const d=new Date(iso), now=new Date(), diff=now-d;
  if(diff<60000)return'Just now';
  if(diff<3600000)return Math.floor(diff/60000)+'m ago';
  if(diff<86400000)return Math.floor(diff/3600000)+'h ago';
  if(diff<604800000)return Math.floor(diff/86400000)+'d ago';
  return d.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
}
function getPageCount(id){
  try{const d=JSON.parse(localStorage.getItem('sc_canvas_'+id)||'null');return(d&&d.pages)?d.pages.length:1;}catch(e){return 1;}
}
function getThumb(id){
  try{const d=JSON.parse(localStorage.getItem('sc_canvas_'+id)||'null');return(d&&d.pages&&d.pages[0])?d.pages[0]:null;}catch(e){return null;}
}

/* ── RENDER NOTES ── */
function renderNotes(filter=''){
  const q=filter.toLowerCase();
  const filtered=notes.filter(n=>
    n.title.toLowerCase().includes(q)||(n.subject&&getSub(n.subject).label.toLowerCase().includes(q))
  );
  if(!filtered.length){emptyState.style.display='flex';notesGrid.innerHTML='';return;}
  emptyState.style.display='none';

  notesGrid.innerHTML=filtered.map(n=>{
    const sub=getSub(n.subject);
    const thumb=getThumb(n.id);
    const pc=getPageCount(n.id);
    return`<div class="note-card" data-id="${n.id}" tabindex="0">
      <div class="note-card__thumb" style="border-top:3px solid ${sub.color}">
        ${thumb?`<img src="${thumb}" alt="preview" loading="lazy"/>`:`<div class="note-card__thumb-empty"></div>`}
        <!-- Action buttons overlay -->
        <div class="note-card__actions">
          <button class="nca-btn nca-rename" data-id="${n.id}" title="Rename">✏️</button>
          <button class="nca-btn nca-delete" data-id="${n.id}" title="Delete">🗑️</button>
        </div>
      </div>
      <div class="note-card__body">
        <span class="note-card__sub" style="background:${sub.color}1a;color:${sub.color}">${sub.label}</span>
        <p class="note-card__title">${esc(n.title)}</p>
        <p class="note-card__meta">${fmtDate(n.modified||n.date)} · ${pc} page${pc!==1?'s':''}</p>
      </div>
    </div>`;
  }).join('');

  // Open note on card click (not on action buttons)
  notesGrid.querySelectorAll('.note-card').forEach(card=>{
    card.addEventListener('click',e=>{
      if(e.target.closest('.note-card__actions'))return;
      window.location.href='canvas.html?id='+card.dataset.id;
    });
    card.addEventListener('keydown',e=>{
      if(e.key==='Enter'&&!e.target.closest('.note-card__actions'))window.location.href='canvas.html?id='+card.dataset.id;
    });
  });

  // Rename buttons
  notesGrid.querySelectorAll('.nca-rename').forEach(btn=>{
    btn.addEventListener('click',e=>{
      e.stopPropagation();
      const id=btn.dataset.id;
      const note=notes.find(n=>n.id===id); if(!note)return;
      const t=prompt('Rename note:',note.title);
      if(t&&t.trim()){note.title=t.trim();note.modified=new Date().toISOString();saveNotes();renderNotes(searchInput.value);}
    });
  });

  // Delete buttons
  notesGrid.querySelectorAll('.nca-delete').forEach(btn=>{
    btn.addEventListener('click',e=>{
      e.stopPropagation();
      const id=btn.dataset.id;
      openDeleteConfirm(id);
    });
  });
}

/* ── DELETE CONFIRM MODAL ── */
function openDeleteConfirm(id){
  const note=notes.find(n=>n.id===id); if(!note)return;
  deleteModal.classList.add('show');
  document.getElementById('del-note-name').textContent=note.title;
  pendingDeleteId=id;
}
let pendingDeleteId=null;
const deleteModal=document.createElement('div');
deleteModal.className='modal-overlay';
deleteModal.id='delete-modal';
deleteModal.innerHTML=`
  <div class="modal-box">
    <p class="modal-box__title">🗑️ Delete Note?</p>
    <p class="modal-box__sub">"<span id="del-note-name"></span>" will be permanently deleted.</p>
    <div class="modal-box__actions">
      <button class="modal-btn-cancel" id="del-cancel">Cancel</button>
      <button class="modal-btn-confirm" id="del-confirm">Delete</button>
    </div>
  </div>`;
document.body.appendChild(deleteModal);
document.getElementById('del-cancel').addEventListener('click',()=>deleteModal.classList.remove('show'));
document.getElementById('del-confirm').addEventListener('click',()=>{
  if(!pendingDeleteId)return;
  notes=notes.filter(n=>n.id!==pendingDeleteId);
  localStorage.removeItem('sc_canvas_'+pendingDeleteId);
  pendingDeleteId=null;
  saveNotes(); renderNotes(searchInput.value);
  deleteModal.classList.remove('show');
});

/* ── NEW NOTE MODAL ── */
let selectedSub='other';
const newNoteModal=document.createElement('div');
newNoteModal.className='modal-overlay';
newNoteModal.id='new-note-modal';
newNoteModal.innerHTML=`
  <div class="modal-box new-note-box">
    <p class="modal-box__title">✏️ New Note</p>
    <input class="modal-input" id="nn-title" type="text" placeholder="Note title…" maxlength="60"/>
    <p class="modal-box__label">Subject</p>
    <div class="subject-grid">
      ${SUBJECTS.map(s=>`<button class="subject-chip" data-sid="${s.id}" style="--cc:${s.color}">${s.label}</button>`).join('')}
    </div>
    <div class="modal-box__actions">
      <button class="modal-btn-cancel" id="nn-cancel">Cancel</button>
      <button class="modal-btn-confirm" id="nn-create">Open Board →</button>
    </div>
  </div>`;
document.body.appendChild(newNoteModal);

function selSub(sid){
  selectedSub=sid;
  document.querySelectorAll('.subject-chip').forEach(c=>c.classList.toggle('active',c.dataset.sid===sid));
}
document.querySelectorAll('.subject-chip').forEach(c=>c.addEventListener('click',()=>selSub(c.dataset.sid)));
selSub('other');

fabBtn.addEventListener('click',()=>{
  document.getElementById('nn-title').value='';
  selSub('other');
  newNoteModal.classList.add('show');
  setTimeout(()=>document.getElementById('nn-title').focus(),120);
});
document.getElementById('nn-cancel').addEventListener('click',()=>newNoteModal.classList.remove('show'));
document.getElementById('nn-create').addEventListener('click',createNote);
document.getElementById('nn-title').addEventListener('keydown',e=>{
  if(e.key==='Enter')createNote();
  if(e.key==='Escape')newNoteModal.classList.remove('show');
});

function createNote(){
  const title=document.getElementById('nn-title').value.trim()||'Untitled Note';
  const now=new Date().toISOString();
  const note={id:Date.now().toString(),title,subject:selectedSub,date:now,modified:now};
  notes.unshift(note);
  saveNotes();
  newNoteModal.classList.remove('show');
  window.location.href='canvas.html?id='+note.id;
}

/* ── CLEAR ALL ── */
document.body.insertAdjacentHTML('beforeend',`
  <div class="modal-overlay" id="clear-modal">
    <div class="modal-box">
      <p class="modal-box__title">Clear All Data?</p>
      <p class="modal-box__sub">Permanently deletes all notes from this device.</p>
      <div class="modal-box__actions">
        <button class="modal-btn-cancel" id="modal-cancel">Cancel</button>
        <button class="modal-btn-confirm" id="modal-confirm">Delete All</button>
      </div>
    </div>
  </div>`);
const clearModal=document.getElementById('clear-modal');
document.getElementById('modal-cancel').addEventListener('click',()=>clearModal.classList.remove('show'));
document.getElementById('modal-confirm').addEventListener('click',()=>{
  notes.forEach(n=>localStorage.removeItem('sc_canvas_'+n.id));
  notes=[];saveNotes();renderNotes();clearModal.classList.remove('show');
});
clearBtn.addEventListener('click',()=>clearModal.classList.add('show'));

/* ── SEARCH ── */
searchInput.addEventListener('input',()=>renderNotes(searchInput.value));

/* ── REFRESH ON RETURN ── */
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible'){
    notes=JSON.parse(localStorage.getItem('sc_notes')||'[]');
    renderNotes(searchInput.value);
  }
});

/* ── EXTRA CSS injected ── */
const xCSS=`
/* Note card */
.note-card{border-radius:16px;overflow:hidden;background:var(--card-bg);border:1px solid var(--border);cursor:pointer;transition:transform .18s,box-shadow .18s;}
.note-card:hover{transform:translateY(-3px);box-shadow:0 8px 24px rgba(0,0,0,.1);}
.note-card__thumb{width:100%;height:88px;overflow:hidden;position:relative;background:var(--search-bg);}
.note-card__thumb img{width:100%;height:100%;object-fit:cover;display:block;}
.note-card__thumb-empty{width:100%;height:100%;background:linear-gradient(135deg,rgba(255,255,255,.03),transparent);}
/* Action overlay */
.note-card__actions{position:absolute;top:6px;right:6px;display:flex;gap:5px;opacity:0;transition:opacity .15s;}
.note-card:hover .note-card__actions{opacity:1;}
.nca-btn{border:none;border-radius:8px;padding:5px 7px;font-size:13px;cursor:pointer;background:rgba(255,255,255,.92);box-shadow:0 2px 8px rgba(0,0,0,.15);transition:transform .12s;}
.nca-btn:hover{transform:scale(1.1);}
.dark-theme .nca-btn{background:rgba(30,41,59,.92);color:#f1f5f9;}
/* Body */
.note-card__body{padding:10px 12px 14px;}
.note-card__sub{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.06em;padding:2px 8px;border-radius:50px;margin-bottom:5px;text-transform:uppercase;}
.note-card__title{font-size:14px;font-weight:600;color:var(--text-primary);margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.note-card__meta{font-size:11px;color:var(--text-secondary);}

/* New note modal additions */
.new-note-box{max-width:380px;text-align:left;}
.modal-input{width:100%;border:1.5px solid var(--border);border-radius:10px;padding:11px 14px;font-size:15px;background:var(--bg);color:var(--text-primary);outline:none;margin:10px 0 16px;}
.modal-input:focus{border-color:var(--accent);}
.modal-box__label{font-size:11px;font-weight:700;color:var(--text-secondary);margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em;}
.subject-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:20px;}
.subject-chip{border:1.5px solid var(--cc,#64748b);color:var(--cc,#64748b);background:transparent;border-radius:8px;padding:6px 4px;font-size:11px;font-weight:700;cursor:pointer;transition:all .15s;}
.subject-chip.active{background:var(--cc,#64748b);color:#fff;}
`;
const sEl=document.createElement('style');sEl.textContent=xCSS;document.head.appendChild(sEl);

/* ── INIT ── */
applyTheme(currentTheme);
renderNotes();
