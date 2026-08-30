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
    lastRoomSnapshot: null
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

  function resetOnlineLocalState(){
    detachRoomListener();
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
    matchBtnOnline: document.getElementById('matchBtnOnline'),
    noMatchBtnOnline: document.getElementById('noMatchBtnOnline'),
    endGameOnlineBtn: document.getElementById('endGameOnlineBtn'),
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
        sweepOldRooms();
      }).catch(()=>{
        FF.showToast('Could not create room — check your Firebase setup');
        el.createRoomBtn.disabled = false;
        el.createRoomBtn.textContent = 'Create Room →';
      });
    });
  }

  el.copyLinkBtn.addEventListener('click', ()=>{
    const link = location.origin + location.pathname + '?join=' + online.roomCode;
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(link).then(()=> FF.showToast('Link copied!')).catch(()=> FF.showToast(link));
    } else {
      FF.showToast(link);
    }
  });

  el.startOnlineGameBtn.addEventListener('click', ()=>{
    if(!online.isHost || !online.lastRoomSnapshot) return;
    const room = online.lastRoomSnapshot;
    const names = room.players ? Object.keys(room.players).sort().map(k=>room.players[k].name) : [];
    if(names.length !== room.numPlayers) return;
    let units = [];
    if(room.mode === 'solo'){
      units = names.map(n=>({ label:n, score:0 }));
    } else {
      for(let i=0;i<names.length;i+=2){
        units.push({ label:`${names[i]} & ${names[i+1]}`, score:0 });
      }
    }
    const game = {
      units, currentIndex:0, askerIndex:0, turnCount:1,
      lastCategoryIndex:null, revealVisible:false, wheelRotation:0, spinSeed:0
    };
    db.ref('rooms/' + online.roomCode).update({ status:'playing', game });
  });

  // ---------- join flow ----------
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
      return db.ref('rooms/' + code + '/players').push({ name, joinedAt: firebase.database.ServerValue.TIMESTAMP });
    }).then(ref=>{
      online.role = 'player'; online.roomCode = code; online.playerId = ref.key; online.playerName = name; online.isHost = false;
      saveOnlineSession();
      subscribeRoom(code);
    }).catch(err=>{
      const messages = { notfound:'Room not found — check the code', started:'That game already started', full:'That room is full' };
      showJoinError(messages[err.message] || 'Something went wrong — try again');
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
    } else if(room.status === 'finished'){
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
      slot.innerHTML = `<span class="dot">${filled ? '✅' : '⏳'}</span> ${label}`;
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

    // spin button (host only, cosmetically)
    el.spinBtnOnline.disabled = !online.isHost || online.hostSpinInProgress || game.revealVisible;
    el.spinBtnOnline.textContent = online.hostSpinInProgress ? 'Spinning…' : '🎡 Spin for a category';

    // category reveal
    if(game.revealVisible && game.lastCategoryIndex !== null && game.lastCategoryIndex !== undefined){
      const cat = CATEGORIES[game.lastCategoryIndex];
      el.revealIconOnline.textContent = cat.icon;
      el.revealNameOnline.textContent = cat.name;
      el.revealDescOnline.textContent = cat.desc;
      if(mode === 'solo'){
        const asker = game.units[game.askerIndex];
        const guesser = game.units[1 - game.askerIndex];
        el.revealHintOnline.textContent = `📇 ${asker.label} draws a card & answers honestly — ${guesser.label} writes a guess`;
        el.matchBtnOnline.textContent = `✅ ${guesser.label} guessed right (+1)`;
      } else {
        el.revealHintOnline.textContent = '📇 Draw a card from this category & ask away';
        el.matchBtnOnline.textContent = "✅ It's a Match (+1)";
      }
      el.categoryRevealOnline.classList.remove('hidden');
    } else {
      el.categoryRevealOnline.classList.add('hidden');
    }
  }

  el.spinBtnOnline.addEventListener('click', ()=>{
    if(!online.isHost || online.hostSpinInProgress) return;
    const room = online.lastRoomSnapshot;
    if(!room || !room.game) return;
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
      lastCategoryIndex: i
    });

    setTimeout(()=>{
      db.ref('rooms/' + online.roomCode + '/game').update({ revealVisible:true });
      online.hostSpinInProgress = false;
    }, 4300);
  });

  function resolveOnlineTurn(isMatch){
    if(!online.isHost) return;
    const room = online.lastRoomSnapshot;
    if(!room || !room.game) return;
    const game = room.game;
    const units = game.units.map(u=>({ ...u }));

    let toastMsg;
    if(room.mode === 'solo'){
      const guesserIndex = 1 - game.askerIndex;
      if(isMatch){ units[guesserIndex].score += 1; toastMsg = `✅ Point for ${units[guesserIndex].label}!`; }
      else toastMsg = '❌ No match — card goes to the bottom of the deck';
    } else {
      if(isMatch){ units[game.currentIndex].score += 1; toastMsg = `✅ Point for ${units[game.currentIndex].label}!`; }
      else toastMsg = '❌ No match — card goes to the bottom of the deck';
    }
    FF.showToast(toastMsg);
    db.ref('rooms/' + online.roomCode + '/game/units').set(units);
    el.spinBtnOnline.disabled = true;

    setTimeout(()=>{
      const updates = { revealVisible:false, turnCount:(game.turnCount||1) + 1 };
      if(room.mode === 'solo'){
        updates.askerIndex = 1 - game.askerIndex;
      } else {
        updates.currentIndex = (game.currentIndex + 1) % units.length;
      }
      db.ref('rooms/' + online.roomCode + '/game').update(updates);
    }, 900);
  }
  el.matchBtnOnline.addEventListener('click', ()=> resolveOnlineTurn(true));
  el.noMatchBtnOnline.addEventListener('click', ()=> resolveOnlineTurn(false));

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
  }
  window.addEventListener('pagehide', ()=>{
    if(online.isHost && online.roomCode && online.lastRoomSnapshot
       && online.lastRoomSnapshot.status === 'finished'){
      const url = firebaseConfig.databaseURL + '/rooms/' + online.roomCode + '.json';
      navigator.sendBeacon(url, JSON.stringify(null));
    }
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
