/* ============================================================
   Friend or Fraud — answer matching
   Exposes window.FFCheck.compare(realAnswer, guess)
   Returns { verdict, score, reason }
     verdict: 'match'  -> award the point automatically
              'close'  -> host decides (shows Accept / Reject)
              'no'     -> no point, host can still override
   ============================================================ */
(function(){

  const STOPWORDS = [
    'the','a','an','of','and',
    'el','la','los','las','le','les','il',
    'al','ال'
  ];

  // Strip accents, Arabic tashkeel, punctuation; unify letter variants.
  function normalize(s){
    return (s == null ? '' : String(s))
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')            // latin diacritics
      .replace(/[\u064B-\u065F\u0670]/g, '')      // arabic tashkeel
      .replace(/\u0640/g, '')                     // arabic tatweel
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ؤ/g, 'و')
      .replace(/ئ/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')          // punctuation -> space
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokens(s){
    return normalize(s).split(' ').filter(t => t && STOPWORDS.indexOf(t) === -1);
  }

  function levenshtein(a, b){
    const m = a.length, n = b.length;
    if(!m) return n;
    if(!n) return m;
    let prev = new Array(n + 1), cur = new Array(n + 1);
    for(let j = 0; j <= n; j++) prev[j] = j;
    for(let i = 1; i <= m; i++){
      cur[0] = i;
      for(let j = 1; j <= n; j++){
        const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      const t = prev; prev = cur; cur = t;
    }
    return prev[n];
  }

  function similarity(a, b){
    const L = Math.max(a.length, b.length);
    return L === 0 ? 1 : 1 - levenshtein(a, b) / L;
  }

  function commonPrefixLen(a, b){
    const n = Math.min(a.length, b.length);
    let i = 0;
    while(i < n && a[i] === b[i]) i++;
    return i;
  }

  function compare(real, guess){
    const A = normalize(real);
    const B = normalize(guess);

    if(!A || !B) return { verdict:'no', score:0, reason:'empty' };
    if(A === B)  return { verdict:'match', score:1, reason:'exact' };

    const ta = tokens(real), tb = tokens(guess);
    const sa = ta.join(' '),  sb = tb.join(' ');
    if(!sa || !sb) return { verdict:'no', score:0, reason:'empty after cleanup' };
    if(sa === sb)  return { verdict:'match', score:1, reason:'exact (ignoring filler words)' };

    // typos: "cairokee" vs "cairoke", "beyonce" vs "beyoncé"
    const whole = similarity(sa, sb);
    if(whole >= 0.85) return { verdict:'match', score:whole, reason:'spelling variant' };

    // containment: "madrid" vs "real madrid", "will smith" vs "smith"
    const setA = new Set(ta), setB = new Set(tb);
    let overlap = 0;
    setA.forEach(t => { if(setB.has(t)) overlap++; });
    const smaller = Math.min(setA.size, setB.size);
    if(overlap > 0 && overlap === smaller){
      return { verdict:'match', score:0.9, reason:'one answer contains the other' };
    }

    // nickname by shared stem: "barca" vs "barcelona", "mo" vs "mohamed"
    const ja = sa.replace(/ /g, ''), jb = sb.replace(/ /g, '');
    const pre = commonPrefixLen(ja, jb);
    const shorter = Math.min(ja.length, jb.length);
    if(pre >= 4 && pre / shorter >= 0.7){
      return { verdict:'close', score:0.75, reason:'possible nickname or short form' };
    }

    if(whole >= 0.6) return { verdict:'close', score:whole, reason:'partly similar' };

    // one strong token match inside a longer phrase
    for(const x of ta){
      for(const y of tb){
        if(x.length > 3 && y.length > 3 && similarity(x, y) >= 0.8){
          return { verdict:'close', score:0.65, reason:'a key word matches' };
        }
      }
    }

    return { verdict:'no', score:whole, reason:'different answers' };
  }

  window.FFCheck = { compare, normalize, similarity };

  // node test harness
  if(typeof module !== 'undefined' && module.exports){
    module.exports = { compare, normalize, similarity };
  }
})();
