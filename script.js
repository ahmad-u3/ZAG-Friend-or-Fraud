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
    screen: 'count'
  };

  const STORAGE_KEY = 'friendOrFraud_save_v1';

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
    results: document.getElementById('screen-results')
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

  function revealCategory(i){
    const cat = CATEGORIES[i];
    document.getElementById('revealIcon').textContent = cat.icon;
    document.getElementById('revealName').textContent = cat.name;
    document.getElementById('revealDesc').textContent = cat.desc;
    state.revealVisible = true;

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
    showScreen('results');
    clearSavedGame();
    if(winners.length) launchConfetti();
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
        revealCategory(savedCategoryIndex);
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
  window.FF = { CATEGORIES, showToast, showScreen, screens, endGameTopBtn, launchConfetti, requestWakeLock, releaseWakeLock };
})();
