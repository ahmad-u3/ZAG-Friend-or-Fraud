(function(){
  const CATEGORIES = [
    { name:"Background Check", icon:"🔍", desc:"Stay safe and keep it broad — the basics, the vanilla, the general stuff about them." },
    { name:"The Psyche", icon:"🧠", desc:"A personality check. Get personal — how they think, how they feel, how they behave." },
    { name:"The Norm", icon:"☕", desc:"Good habits, bad habits, daily routines — how they carry themselves day to day." },
    { name:"The Social", icon:"👥", desc:"Friends, closeness, and how they connect with the people around them." },
    { name:"Between Me & You", icon:"💬", desc:"Puts you two in the spotlight — questions that test you against each other. Skip this one in Alternative Mode." }
  ];

  const state = {
    numPlayers: null,
    mode: 'team',     // 'team' (4+ players, paired up) or 'solo' (exactly 2, individual)
    units: [],        // { label, score } — a pair-team in team mode, a single player in solo mode
    currentIndex: 0,  // team mode: whose turn it is
    askerIndex: 0,    // solo mode: who currently answers for real (the other one guesses)
    turnCount: 1,
    lastCategoryIndex: null,
    revealVisible: false,
    wheelRotation: 0,
    spinning: false,
    screen: 'count',
    settings: { guessSecs: 0, targetScore: 0 },   // 0 = off / no limit
    history: []                                   // { cat, unit, matched }
  };

  const STORAGE_KEY = 'friendOrFraud_save_v1';
  const SETTINGS_KEY = 'friendOrFraud_settings_v1';

  // Settings persist between games so you don't re-pick them every time.
  function loadSettings(){
    try{
      const raw = localStorage.getItem(SETTINGS_KEY);
      if(raw){
        const s = JSON.parse(raw);
        state.settings.guessSecs  = Number(s.guessSecs)  || 0;
        state.settings.targetScore = Number(s.targetScore) || 0;
      }
    }catch(e){}
  }
  function persistSettings(){
    try{ localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); }catch(e){}
  }

  const OFF_SEGS = [
    ['segGuessOff',  'guessSecs',   [[0,'Off'],[10,'10s'],[15,'15s'],[30,'30s']]],
    ['segTargetOff', 'targetScore', [[0,'∞'],[5,'5'],[10,'10'],[15,'15']]]
  ];

  function buildOfflineSettings(){
    OFF_SEGS.forEach(([id, field, opts])=>{
      const wrap = document.getElementById(id);
      if(!wrap) return;
      wrap.innerHTML = '';
      opts.forEach(([val, label])=>{
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'seg-btn';
        b.dataset.val = String(val);
        b.textContent = label;
        b.addEventListener('click', ()=>{
          state.settings[field] = val;
          persistSettings();
          renderOfflineSettings();
        });
        wrap.appendChild(b);
      });
    });
  }

  function renderOfflineSettings(){
    OFF_SEGS.forEach(([id, field])=>{
      const wrap = document.getElementById(id);
      if(!wrap) return;
      wrap.querySelectorAll('.seg-btn').forEach(b=>{
        b.classList.toggle('on', Number(b.dataset.val) === state.settings[field]);
      });
    });
  }

  // ---------- answer countdown ----------
  let offTimer = null;
  function stopOffTimer(){
    if(offTimer){ clearInterval(offTimer); offTimer = null; }
  }
  function startOffTimer(){
    stopOffTimer();
    const wrap = document.getElementById('offTimerWrap');
    const bar  = document.getElementById('offTimerBar');
    const num  = document.getElementById('offTimerNum');
    const secs = state.settings.guessSecs;
    if(!wrap) return;
    if(!secs){ wrap.classList.add('hidden'); return; }
    wrap.classList.remove('hidden');
    const deadline = Date.now() + secs*1000;
    const tick = ()=>{
      const left = Math.max(0, deadline - Date.now());
      num.textContent = left > 0 ? Math.ceil(left/1000) : "Time's up!";
      bar.style.width = Math.max(0, Math.min(100, (left/(secs*1000))*100)) + '%';
      bar.classList.toggle('warn', left <= 5000);
      // the timer only nudges — the players still decide if it matched
      if(left <= 0) stopOffTimer();
    };
    tick();
    offTimer = setInterval(tick, 200);
  }

  function saveGame(){
    try{
      if(state.screen === 'game'){
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    }catch(e){ /* storage unavailable (private mode etc.) — game still works, just won't survive a refresh */ }
  }

  function loadSavedGame(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return null;
      const saved = JSON.parse(raw);
      if(saved && Array.isArray(saved.units) && saved.units.length > 0) return saved;
      return null;
    }catch(e){ return null; }
  }

  function clearSavedGame(){
    try{ localStorage.removeItem(STORAGE_KEY); }catch(e){}
  }

  // ---------- element refs ----------
  const screens = {
    menu: document.getElementById('screen-menu'),
    onlineChoice: document.getElementById('screen-online-choice'),
    hostSetup: document.getElementById('screen-host-setup'),
    join: document.getElementById('screen-join'),
    joinWaiting: document.getElementById('screen-join-waiting'),
    onlineGame: document.getElementById('screen-online-game'),
    onlineResults: document.getElementById('screen-online-results'),
    count: document.getElementById('screen-count'),
    names: document.getElementById('screen-names'),
    game: document.getElementById('screen-game'),
    results: document.getElementById('screen-results'),
    howto: document.getElementById('screen-howto')
  };
  const endGameTopBtn = document.getElementById('endGameTopBtn');
  const toast = document.getElementById('toast');
    // ---------- keep screen awake during play ----------
  let wakeLock = null;
  async function requestWakeLock(){
    if(!('wakeLock' in navigator)) return;
    try{
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', ()=>{ wakeLock = null; });
    }catch(e){}
  }
  function releaseWakeLock(){
    if(wakeLock){ wakeLock.release().catch(()=>{}); wakeLock = null; }
  }
  document.addEventListener('visibilitychange', ()=>{
    if(document.visibilityState === 'visible' && isPlayScreen(state.screen)) requestWakeLock();
  });

  function isPlayScreen(name){ return name === 'game' || name === 'onlineGame'; }

  function showScreen(name){
    if(!screens[name]){
      console.error('showScreen: unknown screen name "' + name + '"');
      return;
    }
    Object.values(screens).forEach(s=>s.classList.add('hidden'));
    screens[name].classList.remove('hidden');
    endGameTopBtn.classList.toggle('hidden', name !== 'game');
    state.screen = name;
    if(isPlayScreen(name)) requestWakeLock(); else releaseWakeLock();
    saveGame();
  }

  function showToast(msg){
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(()=> toast.classList.remove('show'), 1400);
  }

  // ---------- SCREEN 0: menu + generic back buttons ----------
  document.getElementById('goSoloBtn').addEventListener('click', ()=> showScreen('count'));
  document.getElementById('goHowToBtn').addEventListener('click', ()=> showScreen('howto'));

  // build the category list on the How to Play screen from the real deck
  (function fillHowToCats(){
    const wrap = document.getElementById('howtoCats');
    if(!wrap) return;
    CATEGORIES.forEach(cat=>{
      const row = document.createElement('div');
      row.className = 'howto-cat';
      row.innerHTML = `<span class="howto-cat-icon">${cat.icon}</span>` +
                      `<div><b>${cat.name}</b><p>${cat.desc}</p></div>`;
      wrap.appendChild(row);
    });
  })();
  document.getElementById('goOnlineBtn').addEventListener('click', ()=>{
    if(window.FFOnline && typeof window.FFOnline.enterOnline === 'function'){
      window.FFOnline.enterOnline();
    } else {
      showToast('Online mode is still loading — try again in a second');
    }
  });
  document.querySelectorAll('.back-btn[data-back]').forEach(btn=>{
    btn.addEventListener('click', ()=> showScreen(btn.dataset.back));
  });

  // ---------- SCREEN 1 ----------
  const countGrid = document.getElementById('countGrid');
  const toNamesBtn = document.getElementById('toNamesBtn');
  [2,4,6,8,10,12].forEach(n=>{
    const b = document.createElement('button');
    b.className = 'count-btn';
    b.innerHTML = `${n}<span>${n===2? 'player':'players'}</span>`;
    b.addEventListener('click', ()=>{
      document.querySelectorAll('.count-btn').forEach(x=>x.classList.remove('selected'));
      b.classList.add('selected');
      state.numPlayers = n;
      state.mode = (n === 2) ? 'solo' : 'team';
      state.history = [];
      toNamesBtn.disabled = false;
    });
    countGrid.appendChild(b);
  });

  toNamesBtn.addEventListener('click', ()=>{
    buildNameInputs();
    showScreen('names');
  });

  // ---------- SCREEN 2 ----------
  const pairInputsEl = document.getElementById('pairInputs');
  function buildNameInputs(){
    pairInputsEl.innerHTML = '';
    if(state.mode === 'solo'){
      document.getElementById('namesTitle').textContent = 'Name the players';
      document.getElementById('namesSub').textContent = 'Just the two of you — you\'ll take turns being the one who answers and the one who guesses.';
      for(let i=0;i<2;i++){
        const div = document.createElement('div');
        div.className = 'pair-card';
        div.innerHTML = `
          <span class="pair-label">Player ${i+1}</span>
          <div class="name-inputs">
            <input type="text" maxlength="18" placeholder="Player ${i+1}" id="solo-${i}">
          </div>`;
        pairInputsEl.appendChild(div);
      }
    } else {
      document.getElementById('namesTitle').textContent = 'Name your pairs';
      document.getElementById('namesSub').textContent = 'Each pair shares one dry-erase card and tries to match answers.';
      const pairCount = state.numPlayers / 2;
      for(let i=0;i<pairCount;i++){
        const div = document.createElement('div');
        div.className = 'pair-card';
        div.innerHTML = `
          <span class="pair-label">Pair ${i+1}</span>
          <div class="name-inputs">
            <input type="text" maxlength="16" placeholder="Player ${i*2+1}" id="p${i}-a">
            <span class="amp">&amp;</span>
            <input type="text" maxlength="16" placeholder="Player ${i*2+2}" id="p${i}-b">
          </div>`;
        pairInputsEl.appendChild(div);
      }
    }
  }

  function getNameInputs(){
    if(state.mode === 'solo'){
      return [document.getElementById('solo-0'), document.getElementById('solo-1')];
    }
    const pairCount = state.numPlayers / 2;
    const inputs = [];
    for(let i=0;i<pairCount;i++){
      inputs.push(document.getElementById(`p${i}-a`), document.getElementById(`p${i}-b`));
    }
    return inputs;
  }

  function validateNameInputs(){
    const inputs = getNameInputs();
    let firstInvalid = null;
    inputs.forEach(inp=>{
      const empty = inp.value.trim() === '';
      inp.classList.toggle('invalid', empty);
      if(empty && !firstInvalid) firstInvalid = inp;
    });
    return firstInvalid; // null if all valid
  }

  pairInputsEl.addEventListener('input', (e)=>{
    if(e.target.tagName === 'INPUT' && e.target.value.trim() !== ''){
      e.target.classList.remove('invalid');
    }
  });

  document.getElementById('startGameBtn').addEventListener('click', ()=>{
    const firstInvalid = validateNameInputs();
    if(firstInvalid){
      showToast('Please enter a name for every player');
      firstInvalid.focus();
      return;
    }
    state.units = [];
    if(state.mode === 'solo'){
      for(let i=0;i<2;i++){
        const name = document.getElementById(`solo-${i}`).value.trim();
        state.units.push({ label:name, score:0 });
      }
      state.askerIndex = 0;
    } else {
      const pairCount = state.numPlayers / 2;
      for(let i=0;i<pairCount;i++){
        const a = document.getElementById(`p${i}-a`).value.trim();
        const b = document.getElementById(`p${i}-b`).value.trim();
        state.units.push({ label:`${a} & ${b}`, score:0 });
      }
      state.currentIndex = 0;
    }
    state.turnCount = 1;
    buildWheel();
    renderScoreboard();
    renderTurnBanner();
    showScreen('game');
  });

  // ---------- SCREEN 3: wheel ----------
  const wheelInner = document.getElementById('wheelInner');
  function buildWheel(){
    wheelInner.innerHTML = '';
    const R = 82;
    CATEGORIES.forEach((cat, k)=>{
      const angle = k*72 + 36;
      const rad = (angle * Math.PI)/180;
      const x = Math.sin(rad)*R;
      const y = -Math.cos(rad)*R;
      const el = document.createElement('div');
      el.className = 'seg-icon';
      el.style.transform = `translate(${x}px, ${y}px)`;
      el.textContent = cat.icon;
      wheelInner.appendChild(el);
    });
  }

  function renderScoreboard(){
    const el = document.getElementById('scoreboard');
    el.innerHTML = '';
    state.units.forEach((unit, i)=>{
      const chip = document.createElement('div');
      let isActive, roleTag = '';
      if(state.mode === 'solo'){
        isActive = (i === state.askerIndex);
        roleTag = i === state.askerIndex ? '🎙️ ' : '🤔 ';
      } else {
        isActive = (i === state.currentIndex);
      }
      chip.className = 'chip' + (isActive ? ' active' : '');
      chip.innerHTML = `${roleTag}${unit.label}<b>${unit.score}</b>`;
      el.appendChild(chip);
    });
  }

  function renderTurnBanner(){
    document.getElementById('turnCountLabel').textContent = `Turn ${state.turnCount}`;
    const turnSub = document.getElementById('turnSub');
    if(state.mode === 'solo'){
      const asker = state.units[state.askerIndex];
      const guesser = state.units[1 - state.askerIndex];
      document.getElementById('turnPairName').textContent = `${asker.label} vs ${guesser.label}`;
      turnSub.textContent = `🎙️ ${asker.label} answers for real · 🤔 ${guesser.label} guesses`;
      turnSub.classList.remove('hidden');
    } else {
      const unit = state.units[state.currentIndex];
      document.getElementById('turnPairName').textContent = unit.label;
      turnSub.classList.add('hidden');
    }
    document.getElementById('categoryReveal').classList.add('hidden');
    stopOffTimer();
    const tw = document.getElementById('offTimerWrap');
    if(tw) tw.classList.add('hidden');
    document.getElementById('spinBtn').disabled = false;
    document.getElementById('spinBtn').textContent = '🎡 Spin for a category';
    state.revealVisible = false;
    saveGame();
  }

  const spinBtn = document.getElementById('spinBtn');
  spinBtn.addEventListener('click', spinWheel);

  function spinWheel(){
    if(state.spinning) return;
    state.spinning = true;
    spinBtn.disabled = true;
    spinBtn.textContent = 'Spinning…';
    document.getElementById('categoryReveal').classList.add('hidden');

    const i = Math.floor(Math.random()*CATEGORIES.length);
    state.lastCategoryIndex = i;
    const segCenter = i*72 + 36;
    let targetMod = ((-segCenter) % 360 + 360) % 360;
    const jitter = (Math.random()*30 - 15);
    targetMod = ((targetMod + jitter) % 360 + 360) % 360;

    const extraSpins = 4 + Math.floor(Math.random()*2);
    const minRotation = state.wheelRotation + extraSpins*360;
    const remainder = ((targetMod - minRotation) % 360 + 360) % 360;
    const finalRotation = minRotation + remainder;
    state.wheelRotation = finalRotation;
    wheelInner.style.transform = `rotate(${finalRotation}deg)`;

    setTimeout(()=>{
      revealCategory(i);
      state.spinning = false;
      saveGame();
    }, 4300);
  }

  function revealCategory(i, noTimer){
    const cat = CATEGORIES[i];
    document.getElementById('revealIcon').textContent = cat.icon;
    document.getElementById('revealName').textContent = cat.name;
    document.getElementById('revealDesc').textContent = cat.desc;
    state.revealVisible = true;
    if(noTimer){
      stopOffTimer();
      const w = document.getElementById('offTimerWrap');
      if(w) w.classList.add('hidden');
    } else {
      startOffTimer();
    }

    const hintEl = document.getElementById('revealHint');
    const matchBtn = document.getElementById('matchBtn');
    if(state.mode === 'solo'){
      const asker = state.units[state.askerIndex];
      const guesser = state.units[1 - state.askerIndex];
      hintEl.textContent = `📇 ${asker.label} draws a card & answers honestly — ${guesser.label} writes a guess`;
      matchBtn.textContent = `✅ ${guesser.label} guessed right (+1)`;
    } else {
      hintEl.textContent = '📇 Draw a card from this category & ask away';
      matchBtn.textContent = "✅ It's a Match (+1)";
    }

    document.getElementById('categoryReveal').classList.remove('hidden');
    spinBtn.textContent = '🎡 Spin for a category';
  }

  document.getElementById('matchBtn').addEventListener('click', ()=> resolveTurn(true));
  document.getElementById('noMatchBtn').addEventListener('click', ()=> resolveTurn(false));

  function resolveTurn(isMatch){
    stopOffTimer();
    const scoring = state.mode === 'solo'
      ? state.units[1 - state.askerIndex]
      : state.units[state.currentIndex];
    if(!Array.isArray(state.history)) state.history = [];
    state.history.push({
      cat: state.lastCategoryIndex == null ? -1 : state.lastCategoryIndex,
      unit: scoring ? scoring.label : '',
      matched: !!isMatch
    });

    if(state.mode === 'solo'){
      const guesserIndex = 1 - state.askerIndex;
      const guesser = state.units[guesserIndex];
      if(isMatch){
        guesser.score += 1;
        showToast(`✅ Point for ${guesser.label}!`);
      } else {
        showToast('❌ No match — card goes to the bottom of the deck');
      }
    } else {
      const unit = state.units[state.currentIndex];
      if(isMatch){
        unit.score += 1;
        showToast(`✅ Point for ${unit.label}!`);
      } else {
        showToast('❌ No match — card goes to the bottom of the deck');
      }
    }
    renderScoreboard();
    document.getElementById('spinBtn').disabled = true;
    saveGame();

    // first to the target score ends it
    const target = state.settings.targetScore;
    if(target && state.units.some(u => (u.score || 0) >= target)){
      setTimeout(endGame, 900);
      return;
    }

    setTimeout(()=>{
      if(state.mode === 'solo'){
        state.askerIndex = 1 - state.askerIndex;
      } else {
        state.currentIndex = (state.currentIndex + 1) % state.units.length;
      }
      state.turnCount += 1;
      renderScoreboard();
      renderTurnBanner();
    }, 900);
  }

  // ---------- END GAME ----------
  let pendingEnd = false;
  endGameTopBtn.addEventListener('click', ()=>{
    if(!pendingEnd){
      pendingEnd = true;
      endGameTopBtn.textContent = 'Sure? Tap again';
      setTimeout(()=>{ pendingEnd = false; endGameTopBtn.textContent = 'End Game'; }, 2500);
      return;
    }
    pendingEnd = false;
    endGameTopBtn.textContent = 'End Game';
    endGame();
  });

  function endGame(){
    const sorted = [...state.units].sort((a,b)=> b.score - a.score);
    const topScore = sorted.length ? sorted[0].score : 0;
    const el = document.getElementById('leaderboard');
    el.innerHTML = '';
    sorted.forEach((unit, idx)=>{
      const isWinner = unit.score === topScore && topScore > 0;
      const row = document.createElement('div');
      row.className = 'lb-row' + (isWinner ? ' winner' : '');
      row.innerHTML = `
        <span class="lb-rank">${isWinner ? '🏆' : (idx+1)}</span>
        <span class="lb-name">${unit.label}</span>
        <span class="lb-score">${unit.score} pt${unit.score===1?'':'s'}</span>`;
      el.appendChild(row);
    });
    const winners = sorted.filter(u=>u.score===topScore && topScore>0).map(u=>u.label);
    document.getElementById('resultsSub').textContent = winners.length
      ? (winners.length>1 ? `It's a tie between ${winners.join(' and ')}!` : `${winners[0]} knows their people best!`)
      : 'No points scored this round — rematch?';
    renderOfflineStats();
    showScreen('results');
    clearSavedGame();
    if(winners.length) launchConfetti();
  }

  function escHtml(v){
    return (v == null ? '' : String(v))
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  // ---------- offline end-game stats ----------
  function renderOfflineStats(){
    const wrap  = document.getElementById('statsWrapOff');
    const list  = document.getElementById('awardListOff');
    const table = document.getElementById('statTableOff');
    const note  = document.getElementById('statNoteOff');
    if(!wrap) return;
    const history = Array.isArray(state.history) ? state.history : [];
    list.innerHTML = ''; table.innerHTML = ''; note.textContent = '';
    if(history.length < 2){ wrap.classList.add('hidden'); return; }
    wrap.classList.remove('hidden');

    const U = {};
    const slot = name => (U[name] = U[name] || { name, turns:0, hits:0, run:0, bestRun:0 });
    const catStats = {};

    history.forEach(h=>{
      const u = slot(h.unit || '—');
      u.turns++;
      if(h.matched){
        u.hits++; u.run++;
        if(u.run > u.bestRun) u.bestRun = u.run;
      } else {
        u.run = 0;
      }
      const c = catStats[h.cat] = catStats[h.cat] || { hits:0, total:0 };
      c.total++; if(h.matched) c.hits++;
    });

    const units = Object.values(U);
    const rate = u => u.turns ? u.hits / u.turns : 0;
    const awards = [];

    const eligible = units.filter(u=>u.turns >= 2);
    if(eligible.length){
      const best = eligible.slice().sort((a,b)=> b.hits - a.hits || rate(b) - rate(a))[0];
      if(best.hits > 0){
        awards.push(['🎯','Sharpest read', `${best.name} — ${best.hits} of ${best.turns} matched`]);
      }
      if(eligible.length > 1){
        const worst = eligible.slice().sort((a,b)=> rate(a) - rate(b))[0];
        if(worst.name !== best.name && rate(worst) < 0.5){
          awards.push(['🕵️','Total frauds', `${worst.name} — only ${worst.hits}/${worst.turns}`]);
        }
      }
    }

    const streaker = units.slice().sort((a,b)=> b.bestRun - a.bestRun)[0];
    if(streaker && streaker.bestRun >= 2){
      awards.push(['🔥','Hot streak', `${streaker.name} — ${streaker.bestRun} in a row`]);
    }

    const perfect = units.filter(u=>u.turns >= 3 && u.hits === u.turns);
    perfect.forEach(u=>{
      awards.push(['💯','Flawless', `${u.name} — matched every single time`]);
    });

    awards.forEach(([icon, title, line])=>{
      const card = document.createElement('div');
      card.className = 'award';
      card.innerHTML = `<span class="award-icon">${icon}</span>` +
                       `<div><b>${escHtml(title)}</b><p>${escHtml(line)}</p></div>`;
      list.appendChild(card);
    });

    units.slice().sort((a,b)=> rate(b) - rate(a) || b.hits - a.hits).forEach(u=>{
      const pct = Math.round(rate(u) * 100);
      const row = document.createElement('div');
      row.className = 'stat-row';
      row.innerHTML =
        `<span class="stat-name">${escHtml(u.name)}</span>
         <span class="stat-bar"><i style="width:${pct}%"></i></span>
         <span class="stat-val">${u.hits}/${u.turns}</span>`;
      table.appendChild(row);
    });

    const cats = Object.keys(catStats).filter(k=>catStats[k].total >= 2);
    if(cats.length){
      const tough = cats.sort((a,b)=>
        (catStats[a].hits/catStats[a].total) - (catStats[b].hits/catStats[b].total))[0];
      const cat = CATEGORIES[tough];
      if(cat){
        note.textContent = `Toughest category: ${cat.icon} ${cat.name} — ` +
                           `${catStats[tough].hits} of ${catStats[tough].total} matched`;
      }
    }
  }

  function launchConfetti(){
    const colors = ['#1B2A4C','#FF6B57','#FFFCF2','#AEC220'];
    for(let i=0;i<40;i++){
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.left = Math.random()*100 + 'vw';
      piece.style.background = colors[Math.floor(Math.random()*colors.length)];
      piece.style.animationDuration = (2.2 + Math.random()*1.6) + 's';
      piece.style.animationDelay = (Math.random()*0.4) + 's';
      document.body.appendChild(piece);
      setTimeout(()=> piece.remove(), 4200);
    }
  }

  document.getElementById('playAgainBtn').addEventListener('click', ()=>{
    state.numPlayers = null;
    state.mode = 'team';
    state.units = [];
    state.currentIndex = 0;
    state.askerIndex = 0;
    state.turnCount = 1;
    state.wheelRotation = 0;
    state.history = [];
    stopOffTimer();
    renderOfflineSettings();
    document.querySelectorAll('.count-btn').forEach(x=>x.classList.remove('selected'));
    toNamesBtn.disabled = true;
    showScreen('count');
  });

  function restoreOrInit(){
    const saved = loadSavedGame();
    if(saved && saved.screen === 'game'){
      const wasRevealVisible = !!saved.revealVisible;
      const savedCategoryIndex = saved.lastCategoryIndex;
      Object.assign(state, saved);
      buildWheel();
      wheelInner.style.transition = 'none';
      wheelInner.style.transform = `rotate(${state.wheelRotation || 0}deg)`;
      void wheelInner.offsetWidth; // force reflow so the transition-none takes effect
      wheelInner.style.transition = '';
      renderScoreboard();
      renderTurnBanner();
      if(wasRevealVisible && savedCategoryIndex !== null && savedCategoryIndex !== undefined){
        revealCategory(savedCategoryIndex, true);
        spinBtn.disabled = true;
      }
      showScreen('game');
      showToast('Welcome back — picked up right where you left off');
    } else {
      showScreen('menu');
    }
  }

  restoreOrInit();

  // Shared interface for online.js
  loadSettings();
  buildOfflineSettings();
  renderOfflineSettings();

  window.FF = { CATEGORIES, showToast, showScreen, screens, endGameTopBtn, launchConfetti, requestWakeLock, releaseWakeLock };
})();
