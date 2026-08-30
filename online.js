(function(){
  const FF = window.FF;
  const CATEGORIES = FF.CATEGORIES;

  // ---------- Firebase setup ----------
  let db = null;
  function dbReady(){ return !!db; }
  try{
    if(typeof firebaseConfig !== 'undefined' && firebaseConfig.apiKey && firebaseConfig.apiKey.indexOf('YOUR_') !== 0){
      firebase.initializeApp(firebaseConfig);
      db = firebase.database();
    }
  }catch(e){ console.error('Firebase init failed:', e); }

  // Keep local time aligned with Firebase so every phone counts the same 15s.
  if(db){
    db.ref('.info/serverTimeOffset').on('value', snap=>{
      online.serverOffset = snap.val() || 0;
    });
  }

  const SESSION_KEY = 'ffOnlineSession';
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no O/0, I/1 — avoids confusion

  const online = {
    role: null,        // 'host' | 'player'
    roomCode: null,
    hostId: null,
    hostPlayerId: null,
    playerId: null,
    playerName: null,
    isHost: false,
    roomListener: null,
    lastSpinSeed: -1,
    wheelInitialized: false,
    hostSpinInProgress: false,
    pendingEndOnline: false,
    lastRoomSnapshot: null,
    serverOffset: 0,
    hostTickTimer: null,
    timerLoop: null,
    judgingSeed: -1,
    lastRoundSeed: -1,
    spinResolvedSeed: -1,
    presenceRef: null,
    connectedRef: null,
    connectedHandler: null
  };

  function randomId(){
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function generateRoomCode(){
    let code = '';
    for(let i=0;i<4;i++) code += CODE_CHARS[Math.floor(Math.random()*CODE_CHARS.length)];
    return code;
  }

  function saveOnlineSession(){
    try{
      if(online.role === 'host'){
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ role:'host', roomCode:online.roomCode, hostId:online.hostId, hostPlayerId:online.hostPlayerId }));
      } else if(online.role === 'player'){
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ role:'player', roomCode:online.roomCode, playerId:online.playerId, playerName:online.playerName }));
      }
    }catch(e){}
  }
  function clearOnlineSession(){
    try{ sessionStorage.removeItem(SESSION_KEY); }catch(e){}
  }
  function loadOnlineSession(){
    try{
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    }catch(e){ return null; }
  }

  function detachRoomListener(){
    if(online.roomListener && online.roomCode && db){
      db.ref('rooms/' + online.roomCode).off('value', online.roomListener);
    }
    online.roomListener = null;
  }

  // Clears only the per-game flags — the room, role and session all survive.
  function resetRoundLocalState(){
    stopTimerLoop();
    online.judgingSeed = -1;
    online.lastRoundSeed = -1;
    online.spinResolvedSeed = -1;
    online.hostSpinInProgress = false;
    online.wheelInitialized = false;
  }

  function resetOnlineLocalState(){
    detachRoomListener();
    stopHostTick();
    stopTimerLoop();
    stopPresence();
    online.judgingSeed = -1;
    online.lastRoundSeed = -1;
    online.spinResolvedSeed = -1;
    online.role = null; online.roomCode = null; online.hostId = null; online.hostPlayerId = null;
    online.playerId = null; online.playerName = null; online.isHost = false;
    online.lastSpinSeed = -1; online.wheelInitialized = false;
    online.lastRoomSnapshot = null;
    document.body.classList.remove('is-guest');
  }

  // ---------- element refs ----------
  const el = {
    countGridOnline: document.getElementById('countGridOnline'),
    hostNameInput: document.getElementById('hostNameInput'),
    createRoomBtn: document.getElementById('createRoomBtn'),
    hostStep1: document.getElementById('hostStep1'),
    hostStep2: document.getElementById('hostStep2'),
    roomCodeDisplay: document.getElementById('roomCodeDisplay'),
    copyLinkBtn: document.getElementById('copyLinkBtn'),
    hostLobbyStatus: document.getElementById('hostLobbyStatus'),
    hostLobbyList: document.getElementById('hostLobbyList'),
    startOnlineGameBtn: document.getElementById('startOnlineGameBtn'),
    joinCodeInput: document.getElementById('joinCodeInput'),
    joinNameInput: document.getElementById('joinNameInput'),
    joinErrorMsg: document.getElementById('joinErrorMsg'),
    submitJoinBtn: document.getElementById('submitJoinBtn'),
    joinLobbyStatus: document.getElementById('joinLobbyStatus'),
    joinLobbyList: document.getElementById('joinLobbyList'),
    scoreboardOnline: document.getElementById('scoreboardOnline'),
    turnCountLabelOnline: document.getElementById('turnCountLabelOnline'),
    turnPairNameOnline: document.getElementById('turnPairNameOnline'),
    turnSubOnline: document.getElementById('turnSubOnline'),
    wheelInnerOnline: document.getElementById('wheelInnerOnline'),
    spinBtnOnline: document.getElementById('spinBtnOnline'),
    categoryRevealOnline: document.getElementById('categoryRevealOnline'),
    revealIconOnline: document.getElementById('revealIconOnline'),
    revealNameOnline: document.getElementById('revealNameOnline'),
    revealDescOnline: document.getElementById('revealDescOnline'),
    revealHintOnline: document.getElementById('revealHintOnline'),
    endGameOnlineBtn: document.getElementById('endGameOnlineBtn'),
    roundAnswering: document.getElementById('roundAnswering'),
    answeringStatus: document.getElementById('answeringStatus'),
    answerInputWrap: document.getElementById('answerInputWrap'),
    answerInput: document.getElementById('answerInput'),
    submitAnswerBtn: document.getElementById('submitAnswerBtn'),
    roundGuessing: document.getElementById('roundGuessing'),
    timerBar: document.getElementById('timerBar'),
    timerNum: document.getElementById('timerNum'),
    guessingStatus: document.getElementById('guessingStatus'),
    guessInputWrap: document.getElementById('guessInputWrap'),
    guessInput: document.getElementById('guessInput'),
    submitGuessBtn: document.getElementById('submitGuessBtn'),
    roundJudging: document.getElementById('roundJudging'),
    judgeReal: document.getElementById('judgeReal'),
    judgeGuess: document.getElementById('judgeGuess'),
    verdictBadge: document.getElementById('verdictBadge'),
    verdictReason: document.getElementById('verdictReason'),
    hostJudgeRow: document.getElementById('hostJudgeRow'),
    judgeTimerWrap: document.getElementById('judgeTimerWrap'),
    judgeTimerBar: document.getElementById('judgeTimerBar'),
    judgeTimerNum: document.getElementById('judgeTimerNum'),
    spectatorNote: document.getElementById('spectatorNote'),
    skipRoundBtn: document.getElementById('skipRoundBtn'),
    recapWrap: document.getElementById('recapWrap'),
    recapList: document.getElementById('recapList'),
    rematchBtn: document.getElementById('rematchBtn'),
    statsWrap: document.getElementById('statsWrap'),
    awardList: document.getElementById('awardList'),
    statTable: document.getElementById('statTable'),
    statNote: document.getElementById('statNote'),
    acceptAnswerBtn: document.getElementById('acceptAnswerBtn'),
    rejectAnswerBtn: document.getElementById('rejectAnswerBtn'),
    resultsSubOnline: document.getElementById('resultsSubOnline'),
    leaderboardOnline: document.getElementById('leaderboardOnline'),
    backToMenuBtn: document.getElementById('backToMenuBtn'),
    goHostBtn: document.getElementById('goHostBtn'),
    goJoinBtn: document.getElementById('goJoinBtn')
  };

  // ---------- wheel build (mirrors offline buildWheel) ----------
  function buildOnlineWheel(){
    el.wheelInnerOnline.innerHTML = '';
    const R = 82;
    CATEGORIES.forEach((cat, k)=>{
      const angle = k*72 + 36;
      const rad = (angle * Math.PI)/180;
      const x = Math.sin(rad)*R;
      const y = -Math.cos(rad)*R;
      const icon = document.createElement('div');
      icon.className = 'seg-icon';
      icon.style.transform = `translate(${x}px, ${y}px)`;
      icon.textContent = cat.icon;
      el.wheelInnerOnline.appendChild(icon);
    });
  }
  buildOnlineWheel();

  // ---------- entry point from main menu ----------
  function enterOnline(){
    if(!dbReady()){
      FF.showToast('Online mode needs Firebase set up first — see the setup guide');
      return;
    }
    FF.showScreen('onlineChoice');
  }
  window.FFOnline = { enterOnline };

  // ---------- host: count selection ----------
  let hostNumPlayers = null;
  [2,4,6,8,10,12].forEach(n=>{
    const b = document.createElement('button');
    b.className = 'count-btn';
    b.innerHTML = `${n}<span>${n===2 ? 'player':'players'}</span>`;
    b.addEventListener('click', ()=>{
      el.countGridOnline.querySelectorAll('.count-btn').forEach(x=>x.classList.remove('selected'));
      b.classList.add('selected');
      hostNumPlayers = n;
      el.createRoomBtn.disabled = false;
    });
    el.countGridOnline.appendChild(b);
  });

  el.goHostBtn.addEventListener('click', ()=>{
    el.hostStep1.classList.remove('hidden');
    el.hostStep2.classList.add('hidden');
    el.createRoomBtn.disabled = true;
    hostNumPlayers = null;
    el.hostNameInput.value = '';
    el.hostNameInput.classList.remove('invalid');
    el.countGridOnline.querySelectorAll('.count-btn').forEach(x=>x.classList.remove('selected'));
    FF.showScreen('hostSetup');
  });

  el.hostNameInput.addEventListener('input', ()=> el.hostNameInput.classList.remove('invalid'));

  el.goJoinBtn.addEventListener('click', ()=>{
    el.joinErrorMsg.classList.remove('show');
    FF.showScreen('join');
  });

  el.createRoomBtn.addEventListener('click', ()=>{
    const hostName = el.hostNameInput.value.trim();
    if(!hostName){
      el.hostNameInput.classList.add('invalid');
      FF.showToast('Enter your name first');
      el.hostNameInput.focus();
      return;
    }
    if(!hostNumPlayers) return;
    el.createRoomBtn.disabled = true;
    el.createRoomBtn.textContent = 'Creating…';
    tryCreateRoom(hostNumPlayers, hostName, 0);
  });

  function sweepOldRooms(){
    const cutoff = Date.now() - 6*60*60*1000; // 6 hours
    db.ref('rooms').orderByChild('createdAt').endAt(cutoff).once('value').then(snap=>{
      snap.forEach(child => child.ref.remove().catch(()=>{}));
    }).catch(()=>{});
  }

  function tryCreateRoom(numPlayers, hostName, attempt){
    const code = generateRoomCode();
    db.ref('rooms/' + code).once('value').then(snap=>{
      if(snap.exists() && attempt < 5){
        tryCreateRoom(numPlayers, hostName, attempt + 1);
        return;
      }
      const hostId = randomId();
      const mode = numPlayers === 2 ? 'solo' : 'team';
      const hostPlayerId = db.ref('rooms/' + code + '/players').push().key;
      db.ref('rooms/' + code).set({
        numPlayers, mode, status:'lobby', hostId, hostPlayerId,
        createdAt: firebase.database.ServerValue.TIMESTAMP,
        players: {
          [hostPlayerId]: { name: hostName, joinedAt: firebase.database.ServerValue.TIMESTAMP }
        }
      }).then(()=>{
        online.role = 'host'; online.roomCode = code; online.hostId = hostId; online.hostPlayerId = hostPlayerId; online.isHost = true;
        saveOnlineSession();
        el.hostStep1.classList.add('hidden');
        el.hostStep2.classList.remove('hidden');
        el.roomCodeDisplay.textContent = code;
        el.createRoomBtn.disabled = false;
        el.createRoomBtn.textContent = 'Create Room →';
        subscribeRoom(code);
        trackPresence();
        sweepOldRooms();
      }).catch(()=>{
        FF.showToast('Could not create room — check your Firebase setup');
        el.createRoomBtn.disabled = false;
        el.createRoomBtn.textContent = 'Create Room →';
      });
    });
  }

  el.copyLinkBtn.addEventListener('click', async ()=>{
    const link = location.origin + location.pathname + '?join=' + online.roomCode;
    const shareData = {
      title: 'Friend or Fraud',
      text: `Join my game! Code: ${online.roomCode}`,
      url: link
    };
    if(navigator.share){
      try{ await navigator.share(shareData); return; }
      catch(e){ if(e.name === 'AbortError') return; }
    }
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(link)
        .then(()=> FF.showToast('Link copied!'))
        .catch(()=> FF.showToast(link));
    } else {
      FF.showToast(link);
    }
  });

  el.startOnlineGameBtn.addEventListener('click', ()=>{
    if(!online.isHost || !online.lastRoomSnapshot) return;
    const room = online.lastRoomSnapshot;
    const keys = room.players ? Object.keys(room.players).sort() : [];
    if(keys.length !== room.numPlayers) return;
    const nameOf = k => room.players[k].name;
    let units = [];
    if(room.mode === 'solo'){
      units = keys.map(k=>({ label:nameOf(k), score:0, memberIds:[k], turnsPlayed:0 }));
    } else {
      for(let i=0;i<keys.length;i+=2){
        units.push({
          label:`${nameOf(keys[i])} & ${nameOf(keys[i+1])}`,
          score:0,
          memberIds:[keys[i], keys[i+1]],
          turnsPlayed:0
        });
      }
    }
    const game = {
      units, currentIndex:0, askerIndex:0, turnCount:1,
      lastCategoryIndex:null, revealVisible:false, wheelRotation:0, spinSeed:0,
      phase:'spinning', spinAt:0, phaseAt:0
    };
    db.ref('rooms/' + online.roomCode).update({ status:'playing', game });
  });

  // ---------- presence ----------
  // Firebase executes the onDisconnect instruction server-side, so a phone that
  // dies or loses signal still gets marked offline without a clean goodbye.
  function trackPresence(){
    if(!db || !online.roomCode) return;
    const myId = myPlayerId();
    if(!myId) return;
    stopPresence();
    online.presenceRef = db.ref('rooms/' + online.roomCode + '/players/' + myId + '/online');
    online.connectedRef = db.ref('.info/connected');
    online.connectedHandler = snap=>{
      if(snap.val() === false) return;
      online.presenceRef.onDisconnect().set(false)
        .then(()=> online.presenceRef.set(true))
        .catch(()=>{});
    };
    online.connectedRef.on('value', online.connectedHandler);
  }

  function stopPresence(){
    if(online.connectedRef && online.connectedHandler){
      online.connectedRef.off('value', online.connectedHandler);
    }
    if(online.presenceRef){
      online.presenceRef.onDisconnect().cancel().catch(()=>{});
    }
    online.connectedRef = null;
    online.connectedHandler = null;
    online.presenceRef = null;
  }

  function isOnline(room, id){
    return !!(room && room.players && room.players[id] && room.players[id].online !== false);
  }

  // ---------- join flow ----------
  // Two players sharing a name makes the lobby, scoreboard and "X is guessing…"
  // prompts ambiguous, so names must be distinct within a room.
  function sameName(a, b){
    const clean = v => (v == null ? '' : String(v)).trim().toLowerCase().replace(/\s+/g, ' ');
    return clean(a) === clean(b) && clean(a) !== '';
  }

  function showJoinError(msg){
    el.joinErrorMsg.textContent = msg;
    el.joinErrorMsg.classList.add('show');
  }
  [el.joinCodeInput, el.joinNameInput].forEach(inp=>{
    inp.addEventListener('input', ()=>{
      inp.classList.remove('invalid');
      el.joinErrorMsg.classList.remove('show');
    });
  });

  el.submitJoinBtn.addEventListener('click', ()=>{
    const code = el.joinCodeInput.value.trim().toUpperCase();
    const name = el.joinNameInput.value.trim();
    let bad = false;
    if(!code){ el.joinCodeInput.classList.add('invalid'); bad = true; }
    if(!name){ el.joinNameInput.classList.add('invalid'); bad = true; }
    if(bad){ showJoinError('Fill in the room code and your name'); return; }

    el.submitJoinBtn.disabled = true;
    el.submitJoinBtn.textContent = 'Joining…';

    db.ref('rooms/' + code).once('value').then(snap=>{
      const room = snap.val();
      if(!room) throw new Error('notfound');
      if(room.status !== 'lobby') throw new Error('started');
      const currentCount = room.players ? Object.keys(room.players).length : 0;
      if(currentCount >= room.numPlayers) throw new Error('full');
      const taken = room.players
        ? Object.keys(room.players).some(k => sameName(room.players[k].name, name))
        : false;
      if(taken) throw new Error('nametaken');
      return db.ref('rooms/' + code + '/players').push({ name, joinedAt: firebase.database.ServerValue.TIMESTAMP });
    }).then(ref=>{
      online.role = 'player'; online.roomCode = code; online.playerId = ref.key; online.playerName = name; online.isHost = false;
      saveOnlineSession();
      subscribeRoom(code);
      trackPresence();
    }).catch(err=>{
      const messages = {
        notfound:'Room not found — check the code',
        started:'That game already started',
        full:'That room is full',
        nametaken:'Someone in the room already has that name — add a letter or a nickname'
      };
      showJoinError(messages[err.message] || 'Something went wrong — try again');
      if(err.message === 'nametaken') el.joinNameInput.classList.add('invalid');
    }).finally(()=>{
      el.submitJoinBtn.disabled = false;
      el.submitJoinBtn.textContent = 'Join →';
    });
  });

  // ---------- leaving a lobby (host or joiner, before game starts) ----------
  function leaveOnlineFlow(){
    if(online.isHost && online.roomCode && online.lastRoomSnapshot && online.lastRoomSnapshot.status === 'lobby'){
      db.ref('rooms/' + online.roomCode).remove().catch(()=>{});
    } else if(online.role === 'player' && online.roomCode && online.playerId && online.lastRoomSnapshot && online.lastRoomSnapshot.status === 'lobby'){
      db.ref('rooms/' + online.roomCode + '/players/' + online.playerId).remove().catch(()=>{});
    }
    clearOnlineSession();
    resetOnlineLocalState();
  }
  document.querySelectorAll('#screen-host-setup .back-btn, #screen-join .back-btn, #screen-join-waiting .back-btn').forEach(btn=>{
    btn.addEventListener('click', leaveOnlineFlow);
  });

  // ---------- room subscription & rendering ----------
  function subscribeRoom(code){
    detachRoomListener();
    online.roomCode = code;
    online.wheelInitialized = false;
    online.roomListener = db.ref('rooms/' + code).on('value', snap=>{
      handleRoomUpdate(snap.val());
    });
  }

  function handleRoomUpdate(room){
    if(!room){
      FF.showToast('That room no longer exists');
      resetOnlineLocalState();
      clearOnlineSession();
      FF.showScreen('menu');
      return;
    }
    online.lastRoomSnapshot = room;

    if(room.status === 'lobby'){
      stopHostTick();
      resetRoundLocalState();
      document.body.classList.remove('is-guest');
      renderLobby(room);
      if(online.isHost){
        el.roomCodeDisplay.textContent = online.roomCode;
        el.hostStep1.classList.add('hidden');
        el.hostStep2.classList.remove('hidden');
        FF.showScreen('hostSetup');
      } else {
        FF.showScreen('joinWaiting');
      }
    } else if(room.status === 'playing'){
      document.body.classList.toggle('is-guest', !online.isHost);
      renderOnlineGame(room);
      FF.showScreen('onlineGame');
      if(online.isHost && !online.hostTickTimer) startHostTick();
    } else if(room.status === 'finished'){
      stopHostTick();
      stopTimerLoop();
      document.body.classList.toggle('is-guest', !online.isHost);
      renderOnlineResults(room);
      FF.showScreen('onlineResults');
    }
  }

  function renderLobby(room){
    const entries = room.players ? Object.keys(room.players).sort().map(k=>({ key:k, name:room.players[k].name })) : [];
    const statusEl = online.isHost ? el.hostLobbyStatus : el.joinLobbyStatus;
    const listEl = online.isHost ? el.hostLobbyList : el.joinLobbyList;
    statusEl.textContent = `${entries.length} of ${room.numPlayers} joined`;
    listEl.innerHTML = '';
    for(let i=0;i<room.numPlayers;i++){
      const filled = i < entries.length;
      const isHostSlot = filled && entries[i].key === room.hostPlayerId;
      const slot = document.createElement('div');
      slot.className = 'lobby-slot ' + (filled ? 'filled' : 'empty');
      const label = filled ? (entries[i].name + (isHostSlot ? ' 🎛️ (Host)' : '')) : 'Waiting for player ' + (i+1) + '…';
      const live = filled && isOnline(room, entries[i].key);
      const dot = filled ? (live ? '🟢' : '⚪') : '⏳';
      const suffix = filled && !live ? ' <i class="slot-off">(offline)</i>' : '';
      slot.innerHTML = `<span class="dot">${dot}</span> ${label}${suffix}`;
      listEl.appendChild(slot);
    }
    if(online.isHost){
      el.startOnlineGameBtn.disabled = entries.length !== room.numPlayers;
    }
  }

  // ---------- game screen rendering (host + joiner, read from room) ----------
  function renderOnlineGame(room){
    const game = room.game;
    if(!game) return;
    const mode = room.mode;

    // scoreboard
    el.scoreboardOnline.innerHTML = '';
    game.units.forEach((unit, i)=>{
      const chip = document.createElement('div');
      let isActive, roleTag = '';
      if(mode === 'solo'){
        isActive = (i === game.askerIndex);
        roleTag = i === game.askerIndex ? '🎙️ ' : '🤔 ';
      } else {
        isActive = (i === game.currentIndex);
      }
      chip.className = 'chip' + (isActive ? ' active' : '');
      chip.innerHTML = `${roleTag}${unit.label}<b>${unit.score}</b>`;
      el.scoreboardOnline.appendChild(chip);
    });

    // turn banner
    el.turnCountLabelOnline.textContent = `Turn ${game.turnCount}`;
    if(mode === 'solo'){
      const asker = game.units[game.askerIndex];
      const guesser = game.units[1 - game.askerIndex];
      el.turnPairNameOnline.textContent = `${asker.label} vs ${guesser.label}`;
      el.turnSubOnline.textContent = `🎙️ ${asker.label} answers for real · 🤔 ${guesser.label} guesses`;
      el.turnSubOnline.classList.remove('hidden');
    } else {
      el.turnPairNameOnline.textContent = game.units[game.currentIndex].label;
      el.turnSubOnline.classList.add('hidden');
    }

    // wheel
    const rotation = game.wheelRotation || 0;
    if(!online.wheelInitialized){
      el.wheelInnerOnline.style.transition = 'none';
      el.wheelInnerOnline.style.transform = `rotate(${rotation}deg)`;
      void el.wheelInnerOnline.offsetWidth;
      el.wheelInnerOnline.style.transition = '';
      online.lastSpinSeed = game.spinSeed || 0;
      online.wheelInitialized = true;
    } else if((game.spinSeed || 0) !== online.lastSpinSeed){
      el.wheelInnerOnline.style.transform = `rotate(${rotation}deg)`;
      online.lastSpinSeed = game.spinSeed || 0;
    }

    // spin button — the asker for this round spins it (host may also step in)
    const phase = game.phase || 'spinning';
    const maySpin = canSpin(room, game);
    el.spinBtnOnline.classList.toggle('hidden', !maySpin);
    el.spinBtnOnline.disabled = !maySpin || online.hostSpinInProgress;
    el.spinBtnOnline.textContent = online.hostSpinInProgress ? 'Spinning…' : '🎡 Spin for a category';

    if(phase === 'spinning' && !maySpin){
      const askerId = upcomingAskerId(room, game);
      const spinning = game.spinAt && serverNow() < game.spinAt + SPIN_MS;
      el.spectatorNote.textContent = spinning
        ? '🎡 Spinning…'
        : (isOnline(room, askerId)
            ? '⏳ ' + playerName(room, askerId) + ' spins this round…'
            : '⚠️ ' + playerName(room, askerId) + ' looks disconnected — the host can step in.');
      el.spectatorNote.classList.remove('hidden');
    } else {
      el.spectatorNote.classList.add('hidden');
    }

    // category reveal
    if(game.revealVisible && game.lastCategoryIndex !== null && game.lastCategoryIndex !== undefined){
      const cat = CATEGORIES[game.lastCategoryIndex];
      el.revealIconOnline.textContent = cat.icon;
      el.revealNameOnline.textContent = cat.name;
      el.revealDescOnline.textContent = cat.desc;
      el.revealHintOnline.textContent = '📇 Draw a card from this category';
      el.categoryRevealOnline.classList.remove('hidden');
    } else {
      el.categoryRevealOnline.classList.add('hidden');
    }

    renderRound(room);
  }

  el.spinBtnOnline.addEventListener('click', ()=>{
    const room = online.lastRoomSnapshot;
    if(!room || !room.game) return;
    if(!canSpin(room, room.game) || online.hostSpinInProgress) return;
    const game = room.game;

    online.hostSpinInProgress = true;
    el.spinBtnOnline.disabled = true;
    el.spinBtnOnline.textContent = 'Spinning…';

    const i = Math.floor(Math.random() * CATEGORIES.length);
    const segCenter = i*72 + 36;
    let targetMod = ((-segCenter) % 360 + 360) % 360;
    const jitter = (Math.random()*30 - 15);
    targetMod = ((targetMod + jitter) % 360 + 360) % 360;
    const extraSpins = 4 + Math.floor(Math.random()*2);
    const baseRotation = game.wheelRotation || 0;
    const minRotation = baseRotation + extraSpins*360;
    const remainder = ((targetMod - minRotation) % 360 + 360) % 360;
    const finalRotation = minRotation + remainder;

    db.ref('rooms/' + online.roomCode + '/game').update({
      wheelRotation: finalRotation,
      spinSeed: (game.spinSeed || 0) + 1,
      revealVisible: false,
      lastCategoryIndex: i,
      phase: 'spinning',
      spinAt: serverNow()
    });

    // The host's tick loop opens the answering phase once the wheel settles,
    // so a spin works the same whether the host or the asker pressed it.
    setTimeout(()=>{ online.hostSpinInProgress = false; }, SPIN_MS);
  });

  // ============================================================
  //  ROUND FLOW  —  answer -> 15s guess -> verdict -> host override
  // ============================================================

  const GUESS_SECONDS = 15;
  const JUDGE_SECONDS = 15;   // how long the host has to accept or reject
  const SPIN_MS = 4300;       // wheel animation length
  const STALL_MS = 15000;     // how long before the host may skip a stalled round
  const HISTORY_MAX = 80;     // keep the room small; a long game still fits

  function serverNow(){ return Date.now() + (online.serverOffset || 0); }

  function myPlayerId(){
    return online.isHost ? online.hostPlayerId : online.playerId;
  }

  function playerName(room, id){
    return (room && room.players && room.players[id] && room.players[id].name) || 'Someone';
  }

  // Decide who answers and who guesses this turn.
  function buildRound(room, game){
    const units = game.units || [];
    let answererId = null, guesserId = null;
    if(room.mode === 'solo'){
      const a = units[game.askerIndex] || {};
      const g = units[1 - game.askerIndex] || {};
      answererId = (a.memberIds || [])[0] || null;
      guesserId  = (g.memberIds || [])[0] || null;
    } else {
      const u = units[game.currentIndex] || {};
      const ids = u.memberIds || [];
      const slot = (u.turnsPlayed || 0) % 2;   // pair members alternate
      answererId = ids[slot] || null;
      guesserId  = ids[1 - slot] || null;
    }
    return { answererId, guesserId, answer:'', guess:'', deadline:0, verdict:'', reason:'', timedOut:false };
  }

  // The asker for the coming round is whoever buildRound would pick as answerer,
  // and that only depends on game state, so it can be known before the spin.
  function upcomingAskerId(room, game){
    try { return buildRound(room, game).answererId; } catch(e){ return null; }
  }

  function canSpin(room, game){
    if((game.phase || 'spinning') !== 'spinning') return false;
    // a spin is already animating — nobody may start another
    if(game.spinAt && serverNow() < game.spinAt + SPIN_MS) return false;
    const me = myPlayerId();
    if(!me) return false;

    const askerId = upcomingAskerId(room, game);
    if(me === askerId) return true;
    if(!online.isHost) return false;

    // the host is a fallback, not a second spinner: only step in when the
    // asker has dropped or has sat on it long enough to look stuck
    const askerGone = !isOnline(room, askerId);
    const stalled = game.phaseAt && (serverNow() - game.phaseAt > STALL_MS);
    return askerGone || !!stalled;
  }

  // ---------- host-side round driver ----------
  function startHostTick(){
    stopHostTick();
    online.hostTickTimer = setInterval(hostTick, 300);
  }
  function stopHostTick(){
    if(online.hostTickTimer){ clearInterval(online.hostTickTimer); online.hostTickTimer = null; }
  }

  function hostTick(){
    if(!online.isHost) return;
    const room = online.lastRoomSnapshot;
    if(!room || room.status !== 'playing' || !room.game) return;
    const game = room.game;
    const seed = game.spinSeed || 0;
    const base = 'rooms/' + online.roomCode + '/game';

    // a stalled room pushes no snapshots, so re-check the skip button here
    if(game.phase === 'answering'){
      const ar = game.round || {};
      const stalled = !isOnline(room, ar.answererId) ||
                      (game.phaseAt && serverNow() - game.phaseAt > STALL_MS);
      el.skipRoundBtn.classList.toggle('hidden', !stalled);
    }

    // the host's fallback spin unlocks on a timer, and a stalled room
    // pushes no snapshots, so re-evaluate the button here
    if(game.phase === 'spinning'){
      const maySpinNow = canSpin(room, game);
      el.spinBtnOnline.classList.toggle('hidden', !maySpinNow);
      el.spinBtnOnline.disabled = !maySpinNow || online.hostSpinInProgress;
    }

    // a spin finished animating -> open the answering phase
    if(game.phase === 'spinning'){
      if(game.spinAt && serverNow() > game.spinAt + SPIN_MS && online.spinResolvedSeed !== seed){
        online.spinResolvedSeed = seed;
        db.ref(base).update({
          revealVisible: true,
          phase: 'answering',
          phaseAt: serverNow(),
          round: buildRound(room, game)
        });
      }
      return;
    }

    const r = game.round;
    if(!r) return;

    if(game.phase === 'judging'){
      if(r.judgeDeadline && serverNow() > r.judgeDeadline + 400) resolveRound(false);
      return;
    }

    if(game.phase === 'answering'){
      if(r.answer){
        db.ref(base).update({ phase:'guessing', 'round/deadline': serverNow() + GUESS_SECONDS*1000 });
      }
    } else if(game.phase === 'guessing'){
      if(online.judgingSeed === seed) return;      // already judged this round
      if(r.guess){
        online.judgingSeed = seed;
        judgeRound(r.answer, r.guess, false);
      } else if(r.deadline && serverNow() > r.deadline + 400){
        online.judgingSeed = seed;
        judgeRound(r.answer, '', true);
      }
    }
  }

  function judgeRound(answer, guess, timedOut){
    let res;
    if(timedOut){
      res = { verdict:'no', score:0, reason:'time ran out' };
    } else if(window.FFCheck){
      res = window.FFCheck.compare(answer, guess);
    } else {
      res = { verdict:'no', score:0, reason:'checker unavailable' };
    }
    const cur = (online.lastRoomSnapshot && online.lastRoomSnapshot.game &&
                 online.lastRoomSnapshot.game.round) || {};
    const left = Math.max(0, (cur.deadline || 0) - serverNow());
    const updates = {
      phase:'judging',
      'round/verdict': res.verdict,
      'round/reason': res.reason,
      'round/timedOut': !!timedOut,
      'round/ms': timedOut ? 0 : Math.max(0, GUESS_SECONDS*1000 - left)
    };
    // a clean match needs no ruling; anything else is on the clock
    if(res.verdict !== 'match'){
      updates['round/judgeDeadline'] = serverNow() + JUDGE_SECONDS*1000;
    }
    db.ref('rooms/' + online.roomCode + '/game').update(updates);
    if(res.verdict === 'match'){
      setTimeout(()=> resolveRound(true), 1800);
    }
  }

  function resolveRound(award, force){
    if(!online.isHost) return;
    const room = online.lastRoomSnapshot;
    if(!room || !room.game) return;
    if(!force && room.game.phase !== 'judging') return;
    const game = room.game;
    const units = (game.units || []).map(u=>({ ...u }));

    const scoringIndex = room.mode === 'solo' ? (1 - game.askerIndex) : game.currentIndex;
    if(award && units[scoringIndex]){
      units[scoringIndex].score = (units[scoringIndex].score || 0) + 1;
      FF.showToast(`✅ Point for ${units[scoringIndex].label}!`);
    } else {
      FF.showToast(force ? '⏭️ Round skipped' : '❌ No point this round');
    }

    const activeIndex = room.mode === 'solo' ? game.askerIndex : game.currentIndex;
    if(units[activeIndex]) units[activeIndex].turnsPlayed = (units[activeIndex].turnsPlayed || 0) + 1;

    // keep the round for the end-of-game recap (skips aren't worth remembering)
    const r = game.round || {};
    const history = Array.isArray(game.history) ? game.history.slice() : [];
    if(!force && (r.answer || r.guess)){
      history.push({
        cat: game.lastCategoryIndex == null ? -1 : game.lastCategoryIndex,
        unit: (units[scoringIndex] && units[scoringIndex].label) || '',
        answerer: playerName(room, r.answererId),
        guesser: playerName(room, r.guesserId),
        answer: r.answer || '',
        guess: r.timedOut ? '' : (r.guess || ''),
        timedOut: !!r.timedOut,
        ms: r.ms || 0,
        awarded: !!award
      });
      while(history.length > HISTORY_MAX) history.shift();
    }

    const updates = {
      units,
      history,
      phase:'spinning',
      phaseAt: serverNow(),
      spinAt: 0,
      revealVisible:false,
      round:null,
      turnCount:(game.turnCount || 1) + 1
    };
    if(room.mode === 'solo') updates.askerIndex = 1 - game.askerIndex;
    else updates.currentIndex = (game.currentIndex + 1) % units.length;

    db.ref('rooms/' + online.roomCode + '/game').update(updates);
  }

  // ---------- rendering ----------
  function renderRound(room){
    const game = room.game;
    const phase = game.phase || 'spinning';
    const r = game.round || {};
    const seed = game.spinSeed || 0;
    const me = myPlayerId();
    const isAnswerer = !!me && r.answererId === me;
    const isGuesser  = !!me && r.guesserId  === me;

    // wipe the inputs whenever a new round starts
    if(seed !== online.lastRoundSeed){
      online.lastRoundSeed = seed;
      el.answerInput.value = '';
      el.guessInput.value = '';
      el.submitAnswerBtn.disabled = false;
      el.submitGuessBtn.disabled = false;
    }

    el.roundAnswering.classList.toggle('hidden', phase !== 'answering');
    el.roundGuessing.classList.toggle('hidden',  phase !== 'guessing');
    el.roundJudging.classList.toggle('hidden',   phase !== 'judging');

    if(phase === 'answering'){
      const who = playerName(room, r.answererId);
      const live = isOnline(room, r.answererId);
      if(isAnswerer){
        el.answeringStatus.innerHTML = '✍️ Your turn — type the <b>real answer</b>. Keep it secret.';
        el.answerInputWrap.classList.remove('hidden');
      } else if(!live){
        el.answeringStatus.innerHTML = `⚠️ <b>${who}</b> looks disconnected.`;
        el.answerInputWrap.classList.add('hidden');
      } else {
        el.answeringStatus.innerHTML = `⏳ Waiting for <b>${who}</b> to write the real answer…`;
        el.answerInputWrap.classList.add('hidden');
      }
      // the host can bail out of a round nobody can finish
      const stalled = !live || (game.phaseAt && serverNow() - game.phaseAt > STALL_MS);
      el.skipRoundBtn.classList.toggle('hidden', !(online.isHost && stalled));
    } else {
      el.skipRoundBtn.classList.add('hidden');
    }

    if(phase === 'guessing'){
      const who = playerName(room, r.guesserId);
      if(isGuesser){
        el.guessingStatus.innerHTML = '🤔 Your turn — what did they say?';
        el.guessInputWrap.classList.remove('hidden');
        if(document.activeElement !== el.guessInput) el.guessInput.focus();
      } else if(!isOnline(room, r.guesserId)){
        el.guessingStatus.innerHTML = `⚠️ <b>${who}</b> looks disconnected — the timer will run out.`;
        el.guessInputWrap.classList.add('hidden');
      } else {
        el.guessingStatus.innerHTML = `⏳ <b>${who}</b> is guessing…`;
        el.guessInputWrap.classList.add('hidden');
      }
      startTimerLoop(r.deadline || 0, GUESS_SECONDS, el.timerBar, el.timerNum);
    } else if(phase !== 'judging'){
      stopTimerLoop();
    }

    if(phase === 'judging'){
      el.judgeReal.textContent  = r.answer || '—';
      el.judgeGuess.textContent = r.timedOut ? '(no answer in time)' : (r.guess || '—');

      const v = r.verdict || 'no';
      el.verdictBadge.className = 'verdict-badge is-' + v;
      el.verdictBadge.textContent =
        v === 'match' ? '✅ Match — point awarded' :
        v === 'close' ? '🤔 Close — host decides' :
                        '❌ Not a match';
      el.verdictReason.textContent = r.reason ? r.reason : '';
      // host rules on anything that is not a clean match
      el.hostJudgeRow.classList.toggle('hidden', v === 'match');

      if(v !== 'match' && r.judgeDeadline){
        el.judgeTimerWrap.classList.remove('hidden');
        startTimerLoop(r.judgeDeadline, JUDGE_SECONDS, el.judgeTimerBar, el.judgeTimerNum);
        if(!online.isHost){
          el.verdictReason.textContent =
            (r.reason ? r.reason + ' — ' : '') + 'waiting on the host…';
        }
      } else {
        el.judgeTimerWrap.classList.add('hidden');
        stopTimerLoop();
      }
    }
  }

  // ---------- countdown ----------
  function startTimerLoop(deadline, totalSeconds, barEl, numEl){
    stopTimerLoop();
    if(!deadline) return;
    const tick = ()=>{
      const left = Math.max(0, deadline - serverNow());
      numEl.textContent = Math.ceil(left / 1000);
      const pct = Math.max(0, Math.min(100, (left / (totalSeconds*1000)) * 100));
      barEl.style.width = pct + '%';
      barEl.classList.toggle('warn', left <= 5000);
      if(left <= 0) stopTimerLoop();
    };
    tick();
    online.timerLoop = setInterval(tick, 200);
  }
  function stopTimerLoop(){
    if(online.timerLoop){ clearInterval(online.timerLoop); online.timerLoop = null; }
  }

  // ---------- input handlers ----------
  function submitAnswer(){
    const room = online.lastRoomSnapshot;
    if(!room || !room.game || room.game.phase !== 'answering') return;
    const val = el.answerInput.value.trim();
    if(!val){ FF.showToast('Type an answer first'); return; }
    el.submitAnswerBtn.disabled = true;
    db.ref('rooms/' + online.roomCode + '/game/round/answer').set(val)
      .catch(()=>{ el.submitAnswerBtn.disabled = false; });
  }
  el.submitAnswerBtn.addEventListener('click', submitAnswer);
  el.answerInput.addEventListener('keydown', e=>{ if(e.key === 'Enter') submitAnswer(); });

  function submitGuess(){
    const room = online.lastRoomSnapshot;
    if(!room || !room.game || room.game.phase !== 'guessing') return;
    const val = el.guessInput.value.trim();
    if(!val){ FF.showToast('Type a guess first'); return; }
    el.submitGuessBtn.disabled = true;
    db.ref('rooms/' + online.roomCode + '/game/round/guess').set(val)
      .catch(()=>{ el.submitGuessBtn.disabled = false; });
  }
  el.submitGuessBtn.addEventListener('click', submitGuess);
  el.guessInput.addEventListener('keydown', e=>{ if(e.key === 'Enter') submitGuess(); });

  el.acceptAnswerBtn.addEventListener('click', ()=> resolveRound(true));
  el.rejectAnswerBtn.addEventListener('click', ()=> resolveRound(false));
  el.skipRoundBtn.addEventListener('click', ()=> resolveRound(false, true));

  el.endGameOnlineBtn.addEventListener('click', ()=>{
    if(!online.isHost) return;
    if(!online.pendingEndOnline){
      online.pendingEndOnline = true;
      el.endGameOnlineBtn.textContent = 'Sure? Tap again';
      setTimeout(()=>{ online.pendingEndOnline = false; el.endGameOnlineBtn.textContent = '🏁 End Game'; }, 2500);
      return;
    }
    online.pendingEndOnline = false;
    el.endGameOnlineBtn.textContent = '🏁 End Game';
    db.ref('rooms/' + online.roomCode).update({ status:'finished' });
  });

  // ---------- results ----------
  function renderOnlineResults(room){
    const units = (room.game && room.game.units) ? room.game.units : [];
    const sorted = [...units].sort((a,b)=> b.score - a.score);
    const topScore = sorted.length ? sorted[0].score : 0;
    el.leaderboardOnline.innerHTML = '';
    sorted.forEach((unit, idx)=>{
      const isWinner = unit.score === topScore && topScore > 0;
      const row = document.createElement('div');
      row.className = 'lb-row' + (isWinner ? ' winner' : '');
      row.innerHTML = `
        <span class="lb-rank">${isWinner ? '🏆' : (idx+1)}</span>
        <span class="lb-name">${unit.label}</span>
        <span class="lb-score">${unit.score} pt${unit.score===1?'':'s'}</span>`;
      el.leaderboardOnline.appendChild(row);
    });
    const winners = sorted.filter(u=>u.score===topScore && topScore>0).map(u=>u.label);
    el.resultsSubOnline.textContent = winners.length
      ? (winners.length>1 ? `It's a tie between ${winners.join(' and ')}!` : `${winners[0]} knows their people best!`)
      : 'No points scored this round — rematch?';
    if(winners.length && FF.launchConfetti) FF.launchConfetti();
    renderStats(room);
    renderRecap(room);
  }

  // ---------- end-of-game statistics ----------
  function renderStats(room){
    const history = (room.game && Array.isArray(room.game.history)) ? room.game.history : [];
    el.awardList.innerHTML = '';
    el.statTable.innerHTML = '';
    el.statNote.textContent = '';
    if(history.length < 2){ el.statsWrap.classList.add('hidden'); return; }
    el.statsWrap.classList.remove('hidden');

    // tally per player, in both roles
    const P = {};
    const slot = name => (P[name] = P[name] || {
      name, guesses:0, correct:0, timeouts:0, msTotal:0, msCount:0,
      asked:0, read:0,           // times they answered / times someone read them right
      run:0, bestRun:0           // consecutive correct guesses by this player
    });

    const catStats = {};

    history.forEach(h=>{
      const g = slot(h.guesser), a = slot(h.answerer);
      g.guesses++; a.asked++;
      if(h.awarded){
        g.correct++; a.read++;
        g.run++;
        if(g.run > g.bestRun) g.bestRun = g.run;
      } else {
        g.run = 0;
      }
      if(h.timedOut) g.timeouts++;
      else if(h.ms > 0){ g.msTotal += h.ms; g.msCount++; }

      const c = catStats[h.cat] = catStats[h.cat] || { hits:0, total:0 };
      c.total++; if(h.awarded) c.hits++;
    });

    const players = Object.values(P);
    const rate = p => p.guesses ? p.correct / p.guesses : 0;
    const avgMs = p => p.msCount ? p.msTotal / p.msCount : Infinity;

    const awards = [];

    // sharpest guesser — most correct, accuracy breaks the tie
    const guessers = players.filter(p=>p.guesses >= 2);
    if(guessers.length){
      const best = guessers.slice().sort((x,y)=> y.correct - x.correct || rate(y) - rate(x))[0];
      if(best.correct > 0){
        awards.push(['🎯','Sharpest guesser', `${best.name} — ${best.correct} of ${best.guesses} right`]);
      }
    }

    // quickest — lowest average time to a correct guess
    const quick = players.filter(p=>p.msCount >= 2 && p.correct > 0);
    if(quick.length){
      const q = quick.slice().sort((x,y)=> avgMs(x) - avgMs(y))[0];
      awards.push(['⚡','Quickest draw', `${q.name} — ${(avgMs(q)/1000).toFixed(1)}s on average`]);
    }

    // open book — the person others read most easily
    const answerers = players.filter(p=>p.asked >= 2);
    if(answerers.length){
      const readRate = p => p.asked ? p.read / p.asked : 0;
      const open = answerers.slice().sort((x,y)=> readRate(y) - readRate(x))[0];
      const hard = answerers.slice().sort((x,y)=> readRate(x) - readRate(y))[0];
      if(readRate(open) > 0){
        awards.push(['📖','Open book', `${open.name} — read right ${open.read}/${open.asked} times`]);
      }
      if(hard.name !== open.name && readRate(hard) < 0.5){
        awards.push(['🕵️','Hardest to read', `${hard.name} — only ${hard.read}/${hard.asked} guessed`]);
      }
    }

    const streaker = players.slice().sort((x,y)=> y.bestRun - x.bestRun)[0];
    if(streaker && streaker.bestRun >= 2){
      awards.push(['🔥','Hot streak', `${streaker.name} — ${streaker.bestRun} correct in a row`]);
    }

    const clocked = players.filter(p=>p.timeouts > 0)
                           .sort((x,y)=> y.timeouts - x.timeouts)[0];
    if(clocked && clocked.timeouts >= 2){
      awards.push(['⏱️','Beaten by the clock', `${clocked.name} — ran out ${clocked.timeouts} times`]);
    }

    awards.forEach(([icon, title, line])=>{
      const card = document.createElement('div');
      card.className = 'award';
      card.innerHTML = `<span class="award-icon">${icon}</span>` +
                       `<div><b>${esc(title)}</b><p>${esc(line)}</p></div>`;
      el.awardList.appendChild(card);
    });

    // accuracy table
    players.slice().sort((x,y)=> rate(y) - rate(x) || y.correct - x.correct).forEach(p=>{
      if(!p.guesses) return;
      const pct = Math.round(rate(p) * 100);
      const row = document.createElement('div');
      row.className = 'stat-row';
      row.innerHTML =
        `<span class="stat-name">${esc(p.name)}</span>
         <span class="stat-bar"><i style="width:${pct}%"></i></span>
         <span class="stat-val">${p.correct}/${p.guesses}</span>`;
      el.statTable.appendChild(row);
    });

    // toughest category
    const cats = Object.keys(catStats).filter(k=>catStats[k].total >= 2);
    if(cats.length){
      const tough = cats.sort((a,b)=> (catStats[a].hits/catStats[a].total) - (catStats[b].hits/catStats[b].total))[0];
      const cat = CATEGORIES[tough];
      if(cat){
        el.statNote.textContent =
          `Toughest category: ${cat.icon} ${cat.name} — ${catStats[tough].hits} of ${catStats[tough].total} matched`;
      }
    }
  }

  // Escape anything a player typed — it goes into innerHTML below.
  function esc(v){
    return (v == null ? '' : String(v))
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function renderRecap(room){
    const history = (room.game && Array.isArray(room.game.history)) ? room.game.history : [];
    el.recapList.innerHTML = '';
    if(!history.length){ el.recapWrap.classList.add('hidden'); return; }
    el.recapWrap.classList.remove('hidden');

    history.forEach((h, i)=>{
      const cat = CATEGORIES[h.cat] || { icon:'❔' };
      const row = document.createElement('div');
      row.className = 'recap-row' + (h.awarded ? ' hit' : ' miss');
      const guessText = h.timedOut
        ? '<i class="recap-none">ran out of time</i>'
        : `<b>${esc(h.guess)}</b>`;
      row.innerHTML =
        `<div class="recap-top">
           <span class="recap-cat">${cat.icon}</span>
           <span class="recap-n">Round ${i+1}</span>
           <span class="recap-mark">${h.awarded ? '✅' : '❌'}</span>
         </div>
         <p class="recap-line">${esc(h.answerer)} said <b>${esc(h.answer)}</b></p>
         <p class="recap-line">${esc(h.guesser)} guessed ${guessText}</p>`;
      el.recapList.appendChild(row);
    });
  }
  window.addEventListener('pagehide', ()=>{
    if(online.isHost && online.roomCode && online.lastRoomSnapshot
       && online.lastRoomSnapshot.status === 'finished'){
      const url = firebaseConfig.databaseURL + '/rooms/' + online.roomCode + '.json';
      navigator.sendBeacon(url, JSON.stringify(null));
    }
  });
  el.rematchBtn.addEventListener('click', ()=>{
    if(!online.isHost || !online.roomCode) return;
    el.rematchBtn.disabled = true;
    db.ref('rooms/' + online.roomCode).update({ status:'lobby', game:null })
      .catch(()=> FF.showToast('Could not restart — try again'))
      .finally(()=>{ el.rematchBtn.disabled = false; });
  });

  el.backToMenuBtn.addEventListener('click', ()=>{
    if(online.isHost && online.roomCode){
      db.ref('rooms/' + online.roomCode).remove().catch(()=>{});
    }
    clearOnlineSession();
    resetOnlineLocalState();
    FF.showScreen('menu');
  });

  // ---------- reconnect on page load / join-via-link ----------
  (function initOnlineEntry(){
    if(!dbReady()) return;
    const saved = loadOnlineSession();
    if(saved && saved.roomCode){
      online.role = saved.role;
      online.roomCode = saved.roomCode;
      online.isHost = saved.role === 'host';
      if(saved.role === 'host'){ online.hostId = saved.hostId; online.hostPlayerId = saved.hostPlayerId; }
      else { online.playerId = saved.playerId; online.playerName = saved.playerName; }
      db.ref('rooms/' + saved.roomCode).once('value').then(snap=>{
        if(snap.exists()){
          subscribeRoom(saved.roomCode);
          trackPresence();
        } else {
          clearOnlineSession();
          resetOnlineLocalState();
        }
      });
      return;
    }
    const params = new URLSearchParams(location.search);
    const joinParam = params.get('join');
    if(joinParam){
      el.joinCodeInput.value = joinParam.toUpperCase();
      FF.showScreen('join');
    }
  })();
})();
