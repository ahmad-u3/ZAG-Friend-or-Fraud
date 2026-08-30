(function(){
  const muteBtn = document.getElementById('muteBtn');
  if(!muteBtn) return;

  const STORAGE_KEY = 'ffMusicMuted';
  const TARGET_VOLUME = 0.16;
  const CHORD_SECONDS = 2;      // each chord holds for 2s
  const LOOP_SECONDS = CHORD_SECONDS * 4; // 4 chords per loop = 8s

  // Frequencies (Hz), equal temperament
  const N = {
    C2:65.41, D2:73.42, E2:82.41, F2:87.31, G2:98.00, A2:110.00, B2:123.47,
    F3:174.61, G3:196.00, A3:220.00, B3:246.94,
    C4:261.63, D4:293.66, E4:329.63
  };

  // Simple I – vi – IV – V progression (Cmaj – Amin – Fmaj – Gmaj)
  const CHORDS = [
    { bass:N.C2, pad:[N.C4,N.E4,N.G3], arp:[N.C4,N.E4,N.G3,N.E4] },
    { bass:N.A2, pad:[N.A3,N.C4,N.E4], arp:[N.A3,N.C4,N.E4,N.C4] },
    { bass:N.F3, pad:[N.F3,N.A3,N.C4], arp:[N.F3,N.A3,N.C4,N.A3] },
    { bass:N.G3, pad:[N.G3,N.B3,N.D4], arp:[N.G3,N.B3,N.D4,N.B3] }
  ];

  let audioCtx = null;
  let masterGain = null;
  let started = false;
  let muted = false;
  try{ muted = localStorage.getItem(STORAGE_KEY) === 'true'; }catch(e){}

  function updateIcon(){
    muteBtn.textContent = muted ? '🔇' : '🔊';
    muteBtn.setAttribute('aria-label', muted ? 'Unmute music' : 'Mute music');
  }
  updateIcon();

  function playPadNote(freq, startTime, duration, peak){
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(peak, startTime + 0.35);
    gain.gain.setValueAtTime(peak, startTime + duration - 0.3);
    gain.gain.linearRampToValueAtTime(0, startTime + duration);
    osc.connect(gain).connect(masterGain);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);
  }

  function playPluck(freq, startTime, peak){
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(peak, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.45);
    osc.connect(gain).connect(masterGain);
    osc.start(startTime);
    osc.stop(startTime + 0.5);
  }

  function scheduleLoopFrom(loopStartTime){
    CHORDS.forEach((chord, i)=>{
      const t = loopStartTime + i * CHORD_SECONDS;
      playPadNote(chord.bass, t, CHORD_SECONDS, 0.22);
      chord.pad.forEach(freq => playPadNote(freq, t, CHORD_SECONDS, 0.07));
      chord.arp.forEach((freq, j)=> playPluck(freq, t + j * (CHORD_SECONDS/4), 0.09));
    });
    const nextLoopStart = loopStartTime + LOOP_SECONDS;
    const msUntilNextSchedule = Math.max(200, (nextLoopStart - audioCtx.currentTime - 0.6) * 1000);
    setTimeout(()=> scheduleLoopFrom(nextLoopStart), msUntilNextSchedule);
  }

  function ensureStarted(){
    if(started) return;
    started = true;
    try{
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = muted ? 0 : TARGET_VOLUME;
      masterGain.connect(audioCtx.destination);
      scheduleLoopFrom(audioCtx.currentTime + 0.15);
    }catch(e){
      console.error('Background music unavailable:', e);
    }
  }

  document.addEventListener('click', ensureStarted, { once:true });
  document.addEventListener('touchstart', ensureStarted, { once:true });

  muteBtn.addEventListener('click', ()=>{
    ensureStarted();
    muted = !muted;
    try{ localStorage.setItem(STORAGE_KEY, muted ? 'true' : 'false'); }catch(e){}
    if(audioCtx && masterGain){
      if(audioCtx.state === 'suspended') audioCtx.resume();
      const now = audioCtx.currentTime;
      masterGain.gain.cancelScheduledValues(now);
      masterGain.gain.setValueAtTime(masterGain.gain.value, now);
      masterGain.gain.linearRampToValueAtTime(muted ? 0 : TARGET_VOLUME, now + 0.15);
    }
    updateIcon();
  });
})();
