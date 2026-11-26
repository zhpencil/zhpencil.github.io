(function () {
  "use strict";

  var DATA = window.GOJUON;
  var phone = document.getElementById("phone");
  var lesson = document.getElementById("lesson");
  var lessonScroll = document.getElementById("lessonScroll");
  var lessonInner = document.getElementById("lessonInner");
  var lessonFooter = document.getElementById("lessonFooter");
  var lessonProgress = document.getElementById("lessonProgress");
  var lessonStageLabel = document.getElementById("lessonStageLabel");
  var lessonClose = document.getElementById("lessonClose");
  var pathEl = document.getElementById("path");
  var pathEndEl = document.getElementById("pathEnd");
  var learnSummaryEl = document.getElementById("learnSummary");
  var reviewContentEl = document.getElementById("reviewContent");
  var statsContentEl = document.getElementById("statsContent");

  var LS_KEY = "gojuon.progress.v1";
  var TOTAL_LESSONS = DATA ? DATA.lessons.length : 92;
  var ROMAJI_ROWS = ["a", "i", "u", "e", "o"];

  var DEFAULT_STATE = {
    version: 1,
    completed: {},
    xp: 0,
    gems: 0,
    streak: 0,
    lastActive: null,
    daily: {},
    checks: 0,
    correct: 0,
    reviews: 0,
    reviewXp: 0
  };

  var state = loadState();
  var session = null;
  var currentTab = "learn";
  var traceHandle = null;
  var matchBoardEl = null;
  var matchDrawFn = null;
  var speechToken = 0;

  var ID = function (x) { return document.getElementById(x); };
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var pad = function (n) { return String(n).padStart(2, "0"); };
  var clamp = function (n, a, b) { return Math.max(a, Math.min(b, n)); };

  function icon(name, cls) {
    return '<svg class="duo-icon' + (cls ? " " + cls : "") + '" aria-hidden="true"><use href="#di-' + name + '"></use></svg>';
  }

  function normalize(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
  }

  function todayKey(d) {
    d = d || new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function dateKeyOffset(days) {
    var d = new Date();
    d.setDate(d.getDate() + days);
    return todayKey(d);
  }

  function loadState() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch (e) { raw = null; }
    if (!raw || typeof raw !== "object") raw = {};
    var out = {};
    Object.keys(DEFAULT_STATE).forEach(function (key) {
      out[key] = raw[key] !== undefined ? raw[key] : DEFAULT_STATE[key];
    });
    if (!out.completed || typeof out.completed !== "object") out.completed = {};
    if (!out.daily || typeof out.daily !== "object") out.daily = {};
    out.xp = Number(out.xp) || 0;
    out.gems = Number(out.gems) || 0;
    out.streak = Number(out.streak) || 0;
    out.checks = Number(out.checks) || 0;
    out.correct = Number(out.correct) || 0;
    out.reviews = Number(out.reviews) || 0;
    out.reviewXp = Number(out.reviewXp) || 0;
    return out;
  }

  function saveState() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* storage may be blocked */ }
  }

  function lessonById(id) {
    return DATA.lessons.find(function (l) { return l.id === id; });
  }

  function completedLessons() {
    return DATA.lessons.filter(function (l) { return !!state.completed[l.id]; });
  }

  function firstIncomplete() {
    return DATA.lessons.find(function (l) { return !state.completed[l.id]; });
  }

  function isLocked(l, next) {
    if (state.completed[l.id]) return false;
    if (!next) return true;
    return l.order > next.order;
  }

  function displayStreak() {
    if (!state.lastActive) return 0;
    if (state.lastActive === todayKey()) return state.streak;
    if (state.lastActive === dateKeyOffset(-1)) return state.streak;
    return 0;
  }

  function touchStreak() {
    var today = todayKey();
    if (state.lastActive === today) return;
    state.streak = state.lastActive === dateKeyOffset(-1) ? state.streak + 1 : 1;
    state.lastActive = today;
  }

  function addDailyXp(amount) {
    var key = todayKey();
    state.daily[key] = (Number(state.daily[key]) || 0) + amount;
  }

  function syncChrome() {
    ID("stStreak").textContent = displayStreak();
    ID("stGems").textContent = state.gems;
    ID("stXp").textContent = state.xp;
  }

  function toast(message, type) {
    if (window.Duo && Duo.toast) {
      Duo.toast(message, {
        type: type || undefined,
        icon: type === "success" ? "check" : type === "error" ? "close" : undefined,
        host: phone
      });
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Speech                                                                  */
  /* ---------------------------------------------------------------------- */

  var jaVoiceCache = null;
  var speechAudio = null;

  function pickJapaneseVoice() {
    if (!window.speechSynthesis) return null;
    var voices = window.speechSynthesis.getVoices() || [];
    var ja = voices.filter(function (v) { return /^ja([-_]|$)/i.test(v.lang || ""); });
    if (!ja.length) return null;
    var preferred = ja.find(function (v) {
      return /nanami|haruka|ayumi|kyoko|otoya|ichiro|google/i.test(v.name || "");
    });
    return preferred || ja[0];
  }

  function audioSource(text) {
    var map = window.GOJUON_AUDIO;
    if (!map) return null;
    var key = String(text || "");
    return map[key] || map[key.trim()] || null;
  }

  function playClip(src, token, rate) {
    return new Promise(function (resolve) {
      if (token !== speechToken) return resolve(false);
      var audio = new Audio(src);
      var finished = false;
      var done = function (ok) {
        if (finished) return;
        finished = true;
        audio.onended = null;
        audio.onerror = null;
        if (speechAudio === audio) speechAudio = null;
        resolve(ok);
      };
      speechAudio = audio;
      audio.preload = "auto";
      audio.playbackRate = clamp((rate || 0.82) * 1.25, 0.8, 1.05);
      if ("preservesPitch" in audio) audio.preservesPitch = true;
      if ("mozPreservesPitch" in audio) audio.mozPreservesPitch = true;
      audio.onended = function () { done(true); };
      audio.onerror = function () { done(false); };
      var started = audio.play();
      if (started && started.catch) {
        started.catch(function () { done(false); });
      }
      setTimeout(function () { done(true); }, 6000);
    });
  }

  function speakWeb(text, token, rate) {
    return new Promise(function (resolve) {
      if (!window.speechSynthesis || !window.SpeechSynthesisUtterance || token !== speechToken) return resolve();
      var utter = new SpeechSynthesisUtterance(String(text));
      utter.lang = "ja-JP";
      utter.rate = rate || 0.82;
      utter.pitch = 1;
      if (!jaVoiceCache) jaVoiceCache = pickJapaneseVoice();
      if (jaVoiceCache) utter.voice = jaVoiceCache;
      var finished = false;
      var finish = function () {
        if (finished) return;
        finished = true;
        resolve();
      };
      utter.onend = finish;
      utter.onerror = finish;
      window.speechSynthesis.speak(utter);
      setTimeout(finish, 5200);
    });
  }

  function speakOne(text, token, rate) {
    var src = audioSource(text);
    if (!src) return speakWeb(text, token, rate);
    return playClip(src, token, rate).then(function (played) {
      if (played || token !== speechToken) return null;
      return speakWeb(text, token, rate);
    });
  }

  function speakSeq(parts) {
    if (!window.speechSynthesis && !window.GOJUON_AUDIO) return;
    var token = ++speechToken;
    if (speechAudio) {
      try { speechAudio.pause(); } catch (err) {}
      speechAudio = null;
    }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    var list = (parts || []).map(function (p) {
      return typeof p === "string" ? { text: p, rate: 0.82 } : p;
    }).filter(function (p) { return p && p.text; });
    (function next(i) {
      if (i >= list.length || token !== speechToken) return;
      speakOne(list[i].text, token, list[i].rate).then(function () {
        if (token !== speechToken) return;
        setTimeout(function () { next(i + 1); }, 170);
      });
    })(0);
  }

  function cancelSpeech() {
    speechToken++;
    if (speechAudio) {
      try { speechAudio.pause(); } catch (err) {}
      speechAudio = null;
    }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }

  /* ---------------------------------------------------------------------- */
  /* Sound effects                                                           */
  /* ---------------------------------------------------------------------- */

  var SFX_FILES = {
    correct: "assets/sfx/correct.mp3",
    wrong: "assets/sfx/wrong.mp3",
    complete: "assets/sfx/complete.mp3",
    tap: "assets/sfx/tap.mp3",
    pop: "assets/sfx/pop.mp3"
  };
  var SFX_VOLUME = { correct: 0.5, wrong: 0.55, complete: 0.55, tap: 0.35, pop: 0.35 };
  var sfxPool = {};

  Object.keys(SFX_FILES).forEach(function (name) {
    var audio = new Audio(SFX_FILES[name]);
    audio.preload = "auto";
    audio.volume = SFX_VOLUME[name];
    sfxPool[name] = audio;
  });

  function playSfx(name) {
    var base = sfxPool[name];
    if (!base) return;
    try {
      var audio = new Audio(base.src);
      audio.volume = base.volume;
      var started = audio.play();
      if (started && started.catch) started.catch(function () {});
    } catch (err) {}
  }

  /* ---------------------------------------------------------------------- */
  /* Learn path                                                              */
  /* ---------------------------------------------------------------------- */

  function renderLearn(scrollToCurrent) {
    var next = firstIncomplete();
    var doneCount = Object.keys(state.completed).length;
    var pct = Math.round((doneCount / TOTAL_LESSONS) * 100);

    learnSummaryEl.innerHTML =
      '<div class="learn-summary__info">' +
        '<div class="learn-summary__top"><span>学习进度</span><b>' + doneCount + " / " + TOTAL_LESSONS + "</b></div>" +
        '<div class="duo-progress" style="--duo-progress-value:' + pct + '" role="progressbar" aria-label="总进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '">' +
          '<div class="duo-progress__fill"></div>' +
        "</div>" +
        '<div class="learn-summary__next">' +
          (next
            ? "下一课：" + next.kana + " / " + next.otherKana + " · " + next.scriptName + " · " + next.row
            : "全部完成。去复习页把学过的音再过一遍吧。") +
        "</div>" +
      "</div>" +
      '<div class="learn-summary__cta">' +
        (next
          ? '<button class="duo-btn duo-btn--green duo-start learn-cta" type="button" data-lesson="' + next.id + '">' +
              "继续学习 · " + next.kana + " " + next.romaji +
            "</button>" +
            '<span class="learn-cta__hint">第 ' + next.order + " 课 · " + next.scriptName + " · " + next.row + "</span>"
          : '<button class="duo-btn duo-btn--secondary learn-cta" type="button" data-go-tab="review">去复习</button>' +
            '<span class="learn-cta__hint">92 节课全部完成</span>') +
      "</div>";
    if (window.Duo && Duo.progress) Duo.progress($(".duo-progress", learnSummaryEl), pct);

    pathEl.innerHTML = "";
    DATA.rows.forEach(function (row, ri) {
      var doneRow = row.lessons.filter(function (id) { return !!state.completed[id]; }).length;
      var block = document.createElement("section");
      block.className = "row-block";

      var header = document.createElement("div");
      header.className = "duo-section-header";
      header.innerHTML =
        '<div class="duo-section-header__body">' +
          '<span class="duo-section-header__eyebrow">第 ' + (ri + 1) + " 行 · " + doneRow + " / " + row.lessons.length + " 课</span>" +
          '<span class="duo-section-header__title">' + row.name + ' <span class="section-title-cn">· ' + row.kana.length + " 音</span></span>" +
        "</div>" +
        '<button class="duo-section-header__action" type="button" data-row="' + row.key + '" aria-label="查看 ' + row.name + ' 的假名">' + icon("info") + "</button>";
      block.appendChild(header);

      var pairs = document.createElement("div");
      pairs.className = "row-block__pairs";
      row.kana.forEach(function (k) {
        var h = lessonById("h" + pad(k.idx));
        var kk = lessonById("k" + pad(k.idx));
        if (!h || !kk) return;
        var line = document.createElement("div");
        line.className = "kana-duo";
        line.innerHTML =
          '<div class="node-wrap' + (next && h.id === next.id ? " node-wrap--current" : "") + '">' +
            nodeHtml(h, next) +
          "</div>" +
          '<span class="kana-romaji">' + k.r + "</span>" +
          '<div class="node-wrap' + (next && kk.id === next.id ? " node-wrap--current" : "") + '">' +
            nodeHtml(kk, next) +
          "</div>";
        pairs.appendChild(line);
      });
      block.appendChild(pairs);
      pathEl.appendChild(block);
    });

    var allDone = doneCount >= TOTAL_LESSONS;
    pathEndEl.className = "path-end" + (allDone ? " is-done" : "");
    pathEndEl.innerHTML =
      '<span class="path-end__icon">' + icon(allDone ? "trophy" : "flag") + "</span>" +
      "<div><div class=\"path-end__title\">" + (allDone ? "五十音全部完成" : "课程终点") + "</div>" +
      '<div class="path-end__desc">' + (allDone ? "92 节课都点亮了。去复习页巩固吧。" : "完成全部 92 节课，点亮这张假名地图。") + "</div></div>";

    if (scrollToCurrent && next) {
      var currentWrap = $(".node-wrap--current", pathEl);
      if (currentWrap) {
        setTimeout(function () {
          if (ID("view-learn").hidden) return;
          scrollDocTo(currentWrap, 150);
        }, 60);
      }
    }
  }

  function scrollDocTo(el, offset) {
    var top = el.getBoundingClientRect().top + window.pageYOffset - (offset || 0);
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }

  function nodeHtml(l, next) {
    var done = !!state.completed[l.id];
    var current = next && next.id === l.id;
    var locked = isLocked(l, next);
    var cls = ["duo-node", "kana-node"];
    if (done) cls.push("duo-node--gold", "kana-node--done");
    if (locked) cls.push("duo-node--locked", "kana-node--locked");
    if (current) cls.push("duo-node--current", "kana-node--current");
    var badge = done
      ? '<span class="node-badge">' + icon("check") + "</span>"
      : locked
        ? '<span class="node-badge node-badge--lock">' + icon("lock") + "</span>"
        : current
          ? '<span class="node-badge node-badge--play">' + icon("play") + "</span>"
          : "";
    var label = l.scriptName + " " + l.kana + "，第 " + l.order + " 课" + (done ? "，已完成" : locked ? "，未解锁" : current ? "，当前课程" : "");
    return '<button class="' + cls.join(" ") + '" type="button" data-lesson="' + l.id + '" aria-label="' + label + '"' +
      (locked ? ' aria-disabled="true"' : "") + ">" +
      '<span class="duo-node__edge"></span>' +
      '<span class="duo-node__face"><span class="kana-node__glyph">' + l.kana + "</span></span>" +
      badge +
      "</button>";
  }

  function openRowSheet(key) {
    var row = DATA.rows.find(function (r) { return r.key === key; });
    if (!row) return;
    var next = firstIncomplete();
    ID("rowSheetTitle").textContent = row.name + " · " + row.kana.length + " 个音";
    ID("rowSheetBody").innerHTML =
      '<p class="sheet-intro">平假名取自汉字草书，片假名取自汉字楷书。点一个字开始对应课程。</p>' +
      row.kana.map(function (k) {
        var h = lessonById("h" + pad(k.idx));
        var kk = lessonById("k" + pad(k.idx));
        function mini(l) {
          if (!l) return "";
          var done = !!state.completed[l.id];
          var locked = isLocked(l, next);
          var current = next && next.id === l.id;
          var cls = "mini-lesson" + (done ? " is-done" : locked ? " is-locked" : current ? " is-current" : "");
          return '<button class="' + cls + '" type="button" data-lesson="' + l.id + '"' +
            (locked ? ' aria-disabled="true"' : "") + ">" + l.kana + "</button>";
        }
        return '<div class="sheet-row">' +
          '<div class="sheet-row__kana">' + k.h + "<small>" + k.k + "</small></div>" +
          '<div class="sheet-row__meta"><b>' + k.r + "</b><span>" +
            (state.completed[h.id] ? "平假名已学" : "平假名") + " · " +
            (state.completed[kk.id] ? "片假名已学" : "片假名") +
          "</span></div>" +
          '<div class="sheet-row__actions">' + mini(h) + mini(kk) + "</div>" +
        "</div>";
      }).join("");
    if (window.Duo) Duo.open("rowSheet");
  }

  /* ---------------------------------------------------------------------- */
  /* Lesson shell + shared footer helpers                                    */
  /* ---------------------------------------------------------------------- */

  function setProgress(value, label) {
    var v = Math.round(clamp(value, 0, 100));
    if (window.Duo && Duo.progress) Duo.progress(lessonProgress, v);
    else lessonProgress.style.setProperty("--duo-progress-value", v);
    lessonProgress.setAttribute("aria-valuenow", String(v));
    if (label) lessonStageLabel.textContent = label;
  }

  function feedbackInner(tone, title, text, iconName) {
    var map = { good: "check", bad: "close", neutral: "info" };
    return '<div class="lesson-feedback is-' + tone + '" role="status">' +
      '<span class="lesson-feedback__icon">' + icon(iconName || map[tone] || "info") + "</span>" +
      "<div>" +
        '<div class="lesson-feedback__title">' + title + "</div>" +
        (text ? '<div class="lesson-feedback__text">' + text + "</div>" : "") +
      "</div>" +
    "</div>";
  }

  function setFeedback(tone, title, text, iconName) {
    var box = ID("lessonFeedback");
    if (!box) return;
    box.innerHTML = feedbackInner(tone, title, text, iconName);
  }

  function footerWithCheck(label, onClick) {
    lessonFooter.innerHTML =
      '<div id="lessonFeedback"></div>' +
      '<div class="footer-actions"><button class="duo-btn duo-btn--green" type="button" id="primaryBtn">' + label + "</button></div>";
    ID("primaryBtn").addEventListener("click", onClick);
  }

  function showContinue(tone, title, text, label, onClick, iconName) {
    lessonFooter.innerHTML =
      '<div id="lessonFeedback">' + feedbackInner(tone, title, text, iconName) + "</div>" +
      '<div class="footer-actions"><button class="duo-btn duo-btn--green" type="button" id="continueBtn">' + label + "</button></div>";
    ID("continueBtn").addEventListener("click", onClick);
  }

  function exampleCard(ex, kana) {
    var img = ex.img
      ? '<img class="example-card__img" src="assets/img/' + ex.img + '" alt="" loading="lazy">'
      : '<span class="example-card__img example-card__img--empty" aria-hidden="true">' + (ex.word ? ex.word.charAt(0) : kana) + "</span>";
    return '<div class="example-card">' +
      img +
      '<div class="example-card__body">' +
        '<div class="example-card__word">' + ex.word + "</div>" +
        '<div class="example-card__romaji">' + ex.romaji + "</div>" +
        (ex.meaning ? '<div class="example-card__meaning">' + ex.meaning + "</div>" : "") +
      "</div>" +
      '<button class="speaker-btn example-card__play" type="button" id="examplePlay" aria-label="播放例词">' + icon("volume") + "</button>" +
    "</div>";
  }

  /* ---------------------------------------------------------------------- */
  /* Lesson flow                                                             */
  /* ---------------------------------------------------------------------- */

  function startLesson(id) {
    var l = lessonById(id);
    if (!l) return;
    var next = firstIncomplete();
    if (isLocked(l, next)) {
      toast("先完成前面的课程，这一课才会解锁。", "error");
      return;
    }
    cancelSpeech();
    session = {
      kind: "lesson",
      lesson: l,
      stage: 0,
      checks: 0,
      correct: 0,
      attempts: 0,
      finished: false
    };
    traceHandle = null;
    lesson.hidden = false;
    lessonInner.innerHTML = "";
    lessonFooter.innerHTML = "";
    lessonScroll.scrollTop = 0;
    goStage(0);
  }

  function goStage(n) {
    if (!session) return;
    session.stage = n;
    session.attempts = 0;
    traceHandle = null;
    lessonScroll.scrollTop = 0;
    if (n === 0) {
      setProgress(0, "1 / 4");
      renderSoundStage();
    } else if (n === 1) {
      setProgress(25, "2 / 4");
      renderOriginStage();
    } else if (n === 2) {
      setProgress(50, "3 / 4");
      renderMatchStage();
    } else if (n === 3) {
      setProgress(75, "4 / 4");
      renderFillStageWord(0);
    }
  }

  function renderSoundStage() {
    var l = session.lesson;
    var ex = l.example || { word: l.kana, romaji: l.romaji, meaning: "" };
    lessonInner.innerHTML =
      '<div class="stage">' +
        '<span class="stage-tag">' + icon("volume") + " 第 1 关 · 跟着读</span>" +
        '<h2 class="stage-title">听发音，打出罗马音</h2>' +
        '<p class="stage-sub">先听「' + l.kana + '」和例词，再把「' + l.kana + "」的罗马音敲进键盘。</p>" +
        '<div class="sound-hero">' +
          '<button class="speaker-btn sound-hero__play" type="button" id="soundPlay" aria-label="播放发音">' + icon("volume") + "</button>" +
          '<span class="sound-hero__glyph">' + l.kana + "</span>" +
          '<span class="sound-hero__script">' + l.scriptName + " · " + l.row + " · " + l.ipa + "</span>" +
          '<span class="sound-hero__hint" id="soundHint">点击喇叭可以再听一遍</span>' +
        "</div>" +
        exampleCard(ex, l.kana) +
        '<label class="type-label" for="romajiInput">「' + l.kana + "」的罗马音</label>" +
        '<input class="duo-input answer-input" id="romajiInput" type="text" inputmode="latin" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="输入罗马音">' +
        '<p class="type-help">按 Enter 检查 · 只填罗马字母 · 写错可以重试</p>' +
      "</div>";

    var input = ID("romajiInput");
    var hint = ID("soundHint");
    var soundPlay = ID("soundPlay");
    var exPlay = ID("examplePlay");
    var parts = [{ text: l.kana, rate: 0.7 }];
    if (ex.word && ex.word !== l.kana) parts.push({ text: ex.word, rate: 0.8 });
    speakSeq(parts);

    soundPlay.addEventListener("click", function () { speakSeq([{ text: l.kana, rate: 0.7 }]); });
    if (exPlay) exPlay.addEventListener("click", function () { speakSeq([{ text: ex.word, rate: 0.8 }]); });

    function check() {
      if (session.finished) return;
      var val = normalize(input.value);
      if (!val) {
        input.focus();
        setFeedback("bad", "先输入罗马音", "用键盘敲出这个假名的读音。");
        return;
      }
      var ok = l.variants.indexOf(val) !== -1;
      session.checks++;
      if (ok) {
        session.correct++;
        playSfx("correct");
        input.classList.remove("is-wrong");
        input.classList.add("is-correct");
        input.disabled = true;
        setProgress(25, "1 / 4");
        speakSeq([{ text: l.kana, rate: 0.68 }]);
        showContinue("good", "答对了！", "「" + l.kana + "」读作 " + l.romaji + "。", "继续", function () {
          goStage(1);
        });
      } else {
        session.attempts++;
        playSfx("wrong");
        input.classList.remove("is-correct");
        input.classList.add("is-wrong");
        setTimeout(function () { input.classList.remove("is-wrong"); }, 700);
        speakSeq([{ text: l.kana, rate: 0.68 }, { text: ex.word, rate: 0.8 }]);
        if (session.attempts === 1) {
          hint.textContent = "再听一遍，注意开头的音。";
          setFeedback("bad", "还不对", "再听一次，然后改一改。");
        } else if (session.attempts === 2) {
          hint.textContent = "提示：以「" + l.romaji.charAt(0) + "」开头。";
          setFeedback("bad", "快到了", "罗马音以「" + l.romaji.charAt(0) + "」开头。");
        } else {
          hint.textContent = "答案就是 " + l.romaji + "，把它敲进去。";
          setFeedback("bad", "再看一眼", "「" + l.kana + "」的罗马音是 " + l.romaji + "。");
        }
        input.select();
      }
    }

    footerWithCheck("检查", check);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); check(); }
    });
    input.addEventListener("input", function () {
      input.classList.remove("is-correct", "is-wrong");
    });
    if (window.matchMedia && window.matchMedia("(pointer: fine)").matches) {
      setTimeout(function () { input.focus(); }, 180);
    }
  }

  function renderOriginStage() {
    var l = session.lesson;
    var isHira = l.script === "hiragana";
    var origin = (l.origin && l.origin[l.script]) || { kanji: "—", evolution: "" };
    var note = origin.kanji + " 的" + (isHira ? "草书" : "楷书") + "经过简省，成为今天的「" + l.kana + "」。";
    note += isHira ? "平假名多用于日语固有词和语法成分。" : "片假名多用于外来语、拟声词和强调。";
    if (l.note) note += " " + l.note;

    lessonInner.innerHTML =
      '<div class="stage">' +
        '<span class="stage-tag">' + icon("book") + " 第 2 关 · 字源与描写</span>" +
        '<h2 class="stage-title">这个字从哪里来</h2>' +
        '<p class="stage-sub">' + (isHira ? "平假名取自汉字草书，笔画圆转连绵。" : "片假名取自汉字楷书，只取原字的一角。") + "看完字源，再跟着灰字描一遍。</p>" +
        '<div class="origin-card">' +
          '<div class="origin-eq">' +
            '<div class="origin-cell">' +
              '<span class="origin-kanji ' + (isHira ? "is-brush" : "is-kaisho") + '">' + origin.kanji + "</span>" +
              '<span class="origin-label">' + (isHira ? "草书" : "楷书") + "</span>" +
            "</div>" +
            '<span class="origin-arrow">→</span>' +
            '<div class="origin-cell">' +
              '<span class="origin-kana">' + l.kana + "</span>" +
              '<span class="origin-label">' + l.scriptName + "</span>" +
            "</div>" +
          "</div>" +
          '<p class="origin-note">' + note + "</p>" +
        "</div>" +
        '<div class="trace-card">' +
          '<div class="trace-head"><span class="trace-head__title">沿着灰色字描一遍</span><span class="trace-head__score" id="traceScore">覆盖 0%</span></div>' +
          '<div class="trace-canvas-wrap"><canvas id="traceCanvas" aria-label="描写练习画布"></canvas></div>' +
          '<p class="trace-help">不要求笔顺，尽量盖住灰色笔画。描到接近即可通过。</p>' +
        "</div>" +
      "</div>";

    lessonFooter.innerHTML =
      '<div id="lessonFeedback"></div>' +
      '<div class="footer-actions">' +
        '<button class="duo-btn duo-btn--secondary" type="button" id="traceReset">重写</button>' +
        '<button class="duo-btn duo-btn--green" type="button" id="traceSubmit">完成描写</button>' +
      "</div>";

    traceHandle = initTrace(l.kana);
    ID("traceReset").addEventListener("click", function () {
      if (traceHandle) traceHandle.reset();
      var box = ID("lessonFeedback");
      if (box) box.innerHTML = "";
    });
    ID("traceSubmit").addEventListener("click", function () {
      if (traceHandle) traceHandle.submit();
    });
  }

  function renderMatchStage() {
    setProgress(50, "3 / 4");
    lessonScroll.scrollTop = 0;
    renderMatchView({
      tag: icon("list") + " 第 3 关 · 假名连线",
      title: "先认识下一关的字",
      sub: "这些是下一关会出现、而且你已经学过的假名。先点左边的字，再点右边的读音。",
      pairs: session.lesson.pairs,
      onSolved: function () { setProgress(75, "3 / 4"); },
      onContinue: function () { goStage(3); }
    });
  }

  function renderFillStageWord(index) {
    var l = session.lesson;
    var words = l.stage4 || [];
    if (!words.length) { completeLesson(); return; }
    if (index >= words.length) { completeLesson(); return; }
    var w = words[index];
    setProgress(75 + (index / words.length) * 25, "4 / 4");
    lessonScroll.scrollTop = 0;
    renderFillView({
      word: w,
      tag: icon("volume") + " 第 4 关 · 听音填空" + (words.length > 1 ? " " + (index + 1) + "/" + words.length : ""),
      title: "把听到的词补完整",
      sub: "只填虚线框里的罗马音：学过的假名才挖空。按 Enter 检查。",
      onResult: function (r) {
        session.checks += r.checks;
        session.correct += r.correct;
      },
      onContinue: function () {
        setProgress(75 + ((index + 1) / words.length) * 25, "4 / 4");
        renderFillStageWord(index + 1);
      }
    });
  }

  function completeLesson() {
    if (!session || session.finished) return;
    var l = session.lesson;
    session.finished = true;
    cancelSpeech();
    playSfx("complete");

    var firstTime = !state.completed[l.id];
    var accuracy = session.checks ? Math.round((session.correct / session.checks) * 100) : 100;
    var xp = firstTime ? 10 : 4;
    state.xp += xp;
    if (firstTime) state.gems += 3;
    state.checks += session.checks;
    state.correct += session.correct;
    state.completed[l.id] = { ts: Date.now(), xp: xp, accuracy: accuracy };
    touchStreak();
    addDailyXp(xp);
    saveState();
    syncChrome();

    setProgress(100, "完成");
    lessonScroll.scrollTop = 0;
    var next = firstIncomplete();
    var origin = (l.origin && l.origin[l.script]) || { kanji: "" };
    var label = l.kana + " " + l.otherKana;

    lessonInner.innerHTML =
      '<div class="complete">' +
        '<div class="complete__art"><span>' + l.kana + "</span></div>" +
        '<h2 class="complete__title">课程完成</h2>' +
        '<p class="complete__sub">' + l.scriptName + "「" + l.kana + "」已经收入你的假名地图。" +
          (l.otherKana ? "别忘了它对应的「" + l.otherKana + "」。" : "") + "</p>" +
        '<div class="complete__kana">' + label + "</div>" +
        '<div class="reward-row">' +
          '<div class="reward"><span class="reward__icon">' + icon("lightning") + "</span><b>+" + xp + '</b><span>XP</span></div>' +
          '<div class="reward"><span class="reward__icon">' + icon("target") + "</span><b>" + accuracy + '%</b><span>正确率</span></div>' +
          '<div class="reward"><span class="reward__icon">' + icon("star") + "</span><b>4 / 4</b><span>关卡</span></div>" +
        "</div>" +
        (origin.kanji ? '<p class="complete__note">字源：' + origin.kanji + " → " + l.kana + "。" + (l.script === "hiragana" ? "平假名来自草书。" : "片假名来自楷书。") + "</p>" : "") +
      "</div>";

    lessonFooter.innerHTML =
      '<div class="footer-actions">' +
        '<button class="duo-btn duo-btn--green" type="button" id="nextLessonBtn">' + (next ? "继续下一课" : "回到路径") + "</button>" +
        (next ? '<button class="duo-btn duo-btn--secondary" type="button" id="backPathBtn">回到路径</button>' : "") +
      "</div>";

    ID("nextLessonBtn").addEventListener("click", function () {
      if (next) startLesson(next.id);
      else closeLesson("learn");
    });
    if (next) ID("backPathBtn").addEventListener("click", function () { closeLesson("learn"); });
  }

  function closeLesson(tab) {
    cancelSpeech();
    lesson.hidden = true;
    lessonInner.innerHTML = "";
    lessonFooter.innerHTML = "";
    session = null;
    traceHandle = null;
    matchBoardEl = null;
    matchDrawFn = null;
    lessonScroll.scrollTop = 0;
    renderLearn(true);
    renderReview();
    renderStats();
    syncChrome();
    if (tab) showTab(tab);
  }

  /* ---------------------------------------------------------------------- */
  /* Sound / origin helpers                                                  */
  /* ---------------------------------------------------------------------- */

  function initTrace(kana) {
    var canvas = ID("traceCanvas");
    if (!canvas) return null;
    var ctx = canvas.getContext("2d");
    var strokes = [];
    var current = null;
    var css = 0;
    var passed = false;
    var attempts = 0;
    var raf = 0;
    var ro = null;

    function schedule() {
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = 0;
        redraw();
      });
    }

    function resize() {
      var rect = canvas.getBoundingClientRect();
      if (!rect.width) return;
      css = rect.width;
      var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      canvas.width = Math.round(css * dpr);
      canvas.height = Math.round(css * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redraw();
    }

    function redraw() {
      if (!css) return;
      ctx.clearRect(0, 0, css, css);
      ctx.fillStyle = "#f7f7f7";
      ctx.fillRect(0, 0, css, css);

      ctx.save();
      ctx.strokeStyle = "#ededed";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(css / 2, 14);
      ctx.lineTo(css / 2, css - 14);
      ctx.moveTo(14, css / 2);
      ctx.lineTo(css - 14, css / 2);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = "#6b6b6b";
      ctx.font = '800 ' + Math.round(css * 0.6) + 'px "M PLUS Rounded 1c", "Yu Gothic", sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(kana, css / 2, css / 2 + css * 0.035);
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = "#3d3d3d";
      ctx.lineWidth = Math.max(14, css * 0.064);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      strokes.forEach(function (s) {
        if (!s.length) return;
        ctx.beginPath();
        ctx.moveTo(s[0].x, s[0].y);
        if (s.length === 1) ctx.lineTo(s[0].x + 0.1, s[0].y + 0.1);
        for (var i = 1; i < s.length; i++) ctx.lineTo(s[i].x, s[i].y);
        ctx.stroke();
      });
      ctx.restore();
    }

    function pointOf(e) {
      var rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function onDown(e) {
      if (passed) return;
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      current = [pointOf(e)];
      strokes.push(current);
      schedule();
    }

    function onMove(e) {
      if (!current) return;
      e.preventDefault();
      current.push(pointOf(e));
      schedule();
    }

    function onUp() {
      current = null;
    }

    function score() {
      var N = 200;
      var off = document.createElement("canvas");
      off.width = N;
      off.height = N;
      var g = off.getContext("2d", { willReadFrequently: true });
      g.fillStyle = "#000";
      g.font = '800 ' + Math.round(N * 0.6) + 'px "M PLUS Rounded 1c", "Yu Gothic", sans-serif';
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(kana, N / 2, N / 2 + N * 0.035);
      var glyphData = g.getImageData(0, 0, N, N).data;

      var u = document.createElement("canvas");
      u.width = N;
      u.height = N;
      var uc = u.getContext("2d", { willReadFrequently: true });
      var scale = N / (css || 300);
      uc.strokeStyle = "#000";
      uc.lineWidth = Math.max(10, N * 0.06);
      uc.lineCap = "round";
      uc.lineJoin = "round";
      strokes.forEach(function (s) {
        if (!s.length) return;
        uc.beginPath();
        uc.moveTo(s[0].x * scale, s[0].y * scale);
        if (s.length === 1) uc.lineTo(s[0].x * scale + 0.1, s[0].y * scale + 0.1);
        for (var i = 1; i < s.length; i++) uc.lineTo(s[i].x * scale, s[i].y * scale);
        uc.stroke();
      });
      var userData = uc.getImageData(0, 0, N, N).data;

      var glyphPx = 0;
      var userPx = 0;
      var overlap = 0;
      for (var i = 0; i < N * N; i++) {
        var ga = glyphData[i * 4 + 3] > 40;
        var ua = userData[i * 4 + 3] > 40;
        if (ga) glyphPx++;
        if (ua) userPx++;
        if (ga && ua) overlap++;
      }
      return {
        glyphPx: glyphPx,
        userPx: userPx,
        coverage: glyphPx ? overlap / glyphPx : 0,
        precision: userPx ? overlap / userPx : 0
      };
    }

    function reset() {
      if (passed) return;
      strokes = [];
      current = null;
      var scoreEl = ID("traceScore");
      if (scoreEl) scoreEl.textContent = "覆盖 0%";
      redraw();
    }

    function submit() {
      if (passed) return;
      if (!strokes.length) {
        setFeedback("bad", "先在灰字上描一遍", "按住鼠标或手指，沿着灰色笔画写一次。");
        return;
      }
      attempts++;
      var s = score();
      var pct = Math.round(s.coverage * 100);
      var scoreEl = ID("traceScore");
      if (scoreEl) scoreEl.textContent = "覆盖 " + pct + "%";
      var ok = (s.coverage >= 0.45 && s.precision >= 0.3) ||
        (attempts >= 4 && s.coverage >= 0.22 && s.userPx >= s.glyphPx * 0.1);

      if (ok) {
        passed = true;
        playSfx("correct");
        setProgress(50, "2 / 4");
        showContinue("good", "描写通过", "覆盖了 " + pct + "% 的笔画，这个字已经写进肌肉记忆里了。", "继续", function () {
          goStage(2);
        });
      } else {
        playSfx("wrong");
        if (pct < 12) {
          setFeedback("bad", "还没描到字", "把灰色字的笔画尽量都盖住，再点“完成描写”。");
        } else {
          setFeedback("bad", "再接近一点", "现在盖住了 " + pct + "%。沿着灰字慢慢描满，覆盖率到 45% 左右就能通过。");
        }
      }
    }

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("pointerleave", function (e) {
      if (e.buttons === 0) current = null;
    });

    if (window.ResizeObserver) {
      ro = new ResizeObserver(function () { resize(); });
      ro.observe(canvas);
    } else {
      window.addEventListener("resize", resize);
    }
    requestAnimationFrame(resize);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        if (canvas.isConnected) resize();
      });
    }

    return {
      reset: reset,
      submit: submit,
      disconnect: function () {
        if (ro) ro.disconnect();
        else window.removeEventListener("resize", resize);
      }
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Matching view                                                           */
  /* ---------------------------------------------------------------------- */

  function shuffle(array) {
    var a = array.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  function renderMatchView(opts) {
    var pairs = (opts.pairs || []).filter(function (p) { return p && p.kana && p.romaji; });
    var right = shuffle(pairs);
    var matched = [];
    var leftSel = null;
    var rightSel = null;
    var lock = false;
    var total = pairs.length;

    if (!total) {
      if (opts.onSolved) opts.onSolved();
      showContinue("good", "没有需要连的字", "继续下一部分。", "继续", opts.onContinue);
      return;
    }

    lessonInner.innerHTML =
      '<div class="stage">' +
        '<span class="stage-tag">' + opts.tag + "</span>" +
        '<h2 class="stage-title">' + opts.title + "</h2>" +
        '<p class="stage-sub">' + opts.sub + "</p>" +
        '<div class="match-board" id="matchBoard">' +
          '<svg class="match-lines" id="matchLines" aria-hidden="true"></svg>' +
          '<div class="match-col">' + pairs.map(function (p) {
            return '<button class="match-card match-card--kana" type="button" data-side="left" data-id="' + p.kana + '">' + p.kana + "</button>";
          }).join("") + "</div>" +
          '<div class="match-col">' + right.map(function (p) {
            return '<button class="match-card match-card--romaji" type="button" data-side="right" data-id="' + p.kana + '">' + p.romaji + "</button>";
          }).join("") + "</div>" +
        "</div>" +
        '<p class="match-status" id="matchStatus">0 / ' + total + " 已连对</p>" +
      "</div>";

    lessonFooter.innerHTML =
      '<div id="lessonFeedback"></div>' +
      '<div class="footer-actions"><button class="duo-btn duo-btn--green" type="button" id="matchNext" disabled>继续</button></div>';

    var board = ID("matchBoard");
    var svg = ID("matchLines");
    var status = ID("matchStatus");
    matchBoardEl = board;

    function drawLines() {
      if (!board || !board.isConnected) return;
      var br = board.getBoundingClientRect();
      if (!br.width) return;
      svg.setAttribute("viewBox", "0 0 " + br.width + " " + br.height);
      svg.innerHTML = matched.map(function (m) {
        var lr = m.left.getBoundingClientRect();
        var rr = m.right.getBoundingClientRect();
        var x1 = lr.right - br.left;
        var y1 = lr.top + lr.height / 2 - br.top;
        var x2 = rr.left - br.left;
        var y2 = rr.top + rr.height / 2 - br.top;
        var mx = (x1 + x2) / 2;
        return '<path d="M' + x1 + " " + y1 + " C " + mx + " " + y1 + ", " + mx + " " + y2 + ", " + x2 + " " + y2 + '"></path>';
      }).join("");
    }
    matchDrawFn = drawLines;

    function solved() {
      status.textContent = "全部连对";
      status.classList.remove("is-bad");
      playSfx("correct");
      if (opts.onSolved) opts.onSolved();
      speakSeq(pairs.slice(0, 2).map(function (p) { return { text: p.audio || p.kana, rate: 0.72 }; }));
      showContinue("good", "连好了！", total + " 组假名和读音全部对应。", "继续", opts.onContinue);
    }

    function evaluate() {
      lock = true;
      var ok = leftSel.getAttribute("data-id") === rightSel.getAttribute("data-id");
      var lEl = leftSel;
      var rEl = rightSel;
      leftSel.classList.remove("is-selected");
      rightSel.classList.remove("is-selected");
      leftSel = null;
      rightSel = null;
      if (ok) {
        lEl.classList.add("is-matched");
        rEl.classList.add("is-matched");
        matched.push({ left: lEl, right: rEl });
        playSfx("pop");
        speakSeq([{ text: lEl.getAttribute("data-id"), rate: 0.72 }]);
        status.textContent = matched.length + " / " + total + " 已连对";
        status.classList.remove("is-bad");
        drawLines();
        setTimeout(function () { drawLines(); lock = false; }, 80);
        if (matched.length === total) solved();
      } else {
        lEl.classList.add("is-wrong");
        rEl.classList.add("is-wrong");
        playSfx("wrong");
        status.textContent = "这对不匹配，再听一听";
        status.classList.add("is-bad");
        setTimeout(function () {
          lEl.classList.remove("is-wrong");
          rEl.classList.remove("is-wrong");
          lock = false;
        }, 500);
      }
    }

    board.addEventListener("click", function (e) {
      var card = e.target.closest(".match-card");
      if (!card || lock || card.classList.contains("is-matched")) return;
      playSfx("tap");
      var side = card.getAttribute("data-side");
      status.classList.remove("is-bad");
      status.textContent = matched.length + " / " + total + " 已连对";
      if (side === "left") {
        if (leftSel === card) {
          card.classList.remove("is-selected");
          leftSel = null;
          return;
        }
        if (leftSel) leftSel.classList.remove("is-selected");
        leftSel = card;
        card.classList.add("is-selected");
        speakSeq([{ text: card.getAttribute("data-id"), rate: 0.7 }]);
      } else {
        if (rightSel === card) {
          card.classList.remove("is-selected");
          rightSel = null;
          return;
        }
        if (rightSel) rightSel.classList.remove("is-selected");
        rightSel = card;
        card.classList.add("is-selected");
      }
      if (leftSel && rightSel) evaluate();
    });

    requestAnimationFrame(drawLines);
  }

  /* ---------------------------------------------------------------------- */
  /* Fill-in view                                                            */
  /* ---------------------------------------------------------------------- */

  var ROMAJI_ALT = {};
  (function () {
    var base = {
      shi: ["si"], chi: ["ti"], tsu: ["tu"], fu: ["hu"], ji: ["zi"],
      sha: ["sya"], shu: ["syu"], sho: ["syo"],
      cha: ["tya"], chu: ["tyu"], cho: ["tyo"],
      ja: ["zya"], ju: ["zyu"], jo: ["zyo"],
      she: ["sye"], che: ["tye"], je: ["zye"]
    };
    Object.keys(base).forEach(function (k) {
      ROMAJI_ALT[k] = base[k].slice();
      base[k].forEach(function (alt) {
        if (!ROMAJI_ALT[alt]) ROMAJI_ALT[alt] = [];
        if (ROMAJI_ALT[alt].indexOf(k) === -1) ROMAJI_ALT[alt].push(k);
      });
    });
  })();

  function acceptedRomaji(unit, value) {
    var v = normalize(value);
    if (!v) return false;
    if (v === unit.r) return true;
    var alts = ROMAJI_ALT[unit.r] || [];
    if (alts.indexOf(v) !== -1) return true;
    if (unit.k === "を" || unit.k === "ヲ") return v === "wo";
    if (unit.k === "ん" || unit.k === "ン") return v === "nn";
    return false;
  }

  function renderFillView(opts) {
    var w = opts.word;
    var units = w.units || [];
    var blankUnits = [];
    units.forEach(function (u, i) { if (u.blank) blankUnits.push({ u: u, i: i }); });
    var attempts = 0;
    var done = false;

    if (!blankUnits.length) {
      if (opts.onSolved) opts.onSolved();
      showContinue("good", "这个词没有可挖空的音", "继续下一部分。", "继续", opts.onContinue);
      return;
    }

    var groupsHtml = units.map(function (u, i) {
      if (u.blank) {
        var width = clamp(u.r.length * 14 + 28, 52, 96);
        return '<div class="fill-unit" style="width:' + width + 'px">' +
          '<input class="fill-input" type="text" data-i="' + i + '" inputmode="latin" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="第 ' + (i + 1) + ' 个音的罗马音" placeholder="?">' +
          '<span class="fill-hint">?</span>' +
        "</div>";
      }
      return '<div class="fill-unit">' +
        '<span class="fill-tile">' + u.k + "</span>" +
        '<span class="fill-hint">' + u.r + "</span>" +
      "</div>";
    }).join("");

    var image = w.img
      ? '<img class="fill-card__img" src="assets/img/' + w.img + '" alt="" loading="lazy">'
      : '<span class="fill-card__img fill-card__img--empty" aria-hidden="true">' + ((units[0] && units[0].k) || "?") + "</span>";

    lessonInner.innerHTML =
      '<div class="stage">' +
        '<span class="stage-tag">' + opts.tag + "</span>" +
        '<h2 class="stage-title">' + opts.title + "</h2>" +
        '<p class="stage-sub">' + opts.sub + "</p>" +
        '<div class="fill-card">' +
          '<div class="fill-card__top">' +
            image +
            '<div class="fill-card__body">' +
              '<div class="fill-card__mean">' + (w.meaning || "听音填空") + "</div>" +
              '<div class="fill-card__hint">' + (w.romaji ? w.romaji.split(" ").length + " 个音拍 · 按 Enter 检查" : "按 Enter 检查") + "</div>" +
            "</div>" +
            '<button class="speaker-btn fill-card__play" type="button" id="fillPlay" aria-label="播放这个词">' + icon("volume") + "</button>" +
          "</div>" +
          '<div class="fill-groups" id="fillGroups">' + groupsHtml + "</div>" +
          (w.note ? '<p class="fill-bottom-note">' + w.note + "</p>" : "") +
        "</div>" +
      "</div>";

    footerWithCheck("检查", submit);

    var inputs = $$(".fill-input", lessonInner);
    var playBtn = ID("fillPlay");

    function unitForInput(input) {
      var idx = Number(input.getAttribute("data-i"));
      for (var k = 0; k < blankUnits.length; k++) {
        if (blankUnits[k].i === idx) return blankUnits[k].u;
      }
      return null;
    }

    function typedValue(input) {
      return input.hasAttribute("data-preview") ? input.getAttribute("data-typed") : input.value;
    }

    function enterPreview(input) {
      if (done || input.disabled || input.hasAttribute("data-preview")) return;
      var raw = input.value.trim();
      var unit = unitForInput(input);
      if (!raw || !unit || !acceptedRomaji(unit, raw)) return;
      var hint = $(".fill-hint", input.parentNode);
      input.setAttribute("data-typed", normalize(raw));
      input.setAttribute("data-preview", "1");
      input.readOnly = true;
      input.value = unit.k;
      input.classList.add("is-preview");
      input.parentNode.classList.add("is-preview");
      if (hint) hint.textContent = normalize(raw);
    }

    function exitPreview(input, focusInput) {
      if (!input.hasAttribute("data-preview")) return;
      var typed = input.getAttribute("data-typed") || "";
      var hint = $(".fill-hint", input.parentNode);
      input.removeAttribute("data-preview");
      input.removeAttribute("data-typed");
      input.classList.remove("is-preview");
      input.parentNode.classList.remove("is-preview");
      input.readOnly = false;
      input.value = typed;
      if (hint) hint.textContent = "?";
      if (focusInput) {
        input.focus();
        try { input.select(); } catch (err) {}
      }
    }
    speakSeq([{ text: w.word, rate: 0.76 }]);
    if (playBtn) playBtn.addEventListener("click", function () {
      speakSeq([{ text: w.word, rate: 0.72 }]);
    });

    function reveal() {
      blankUnits.forEach(function (x) {
        var input = $('.fill-input[data-i="' + x.i + '"]', lessonInner);
        if (!input) return;
        exitPreview(input, false);
        input.value = x.u.r;
        input.classList.remove("is-wrong");
        input.classList.add("is-revealed");
        input.disabled = true;
      });
      setFeedback("neutral", "答案已显示", "记住这个词的读法，继续下一部分。");
      showContinue("neutral", "答案已显示", "「" + w.word + "」读作 " + w.romaji + "。", "继续", opts.onContinue);
    }

    function submit() {
      if (done) return;
      var values = blankUnits.map(function (x) {
        return $('.fill-input[data-i="' + x.i + '"]', lessonInner);
      });
      var emptyIndex = -1;
      values.forEach(function (input, i) {
        if (!typedValue(input).trim() && emptyIndex === -1) emptyIndex = i;
      });
      if (emptyIndex !== -1) {
        setFeedback("bad", "还有空没填", "每个虚线框都要填上罗马音。");
        playSfx("wrong");
        values[emptyIndex].classList.add("is-wrong");
        values[emptyIndex].focus();
        setTimeout(function () { if (values[emptyIndex]) values[emptyIndex].classList.remove("is-wrong"); }, 700);
        return;
      }

      values.forEach(function (input) {
        input.classList.remove("is-correct", "is-wrong");
      });

      var correct = 0;
      var firstWrong = null;
      blankUnits.forEach(function (x, i) {
        var input = values[i];
        if (acceptedRomaji(x.u, typedValue(input))) {
          correct++;
          input.classList.add("is-correct");
        } else {
          input.classList.add("is-wrong");
          if (!firstWrong) firstWrong = input;
        }
      });

      if (opts.onResult) opts.onResult({ checks: blankUnits.length, correct: correct, revealed: false });

      if (correct === blankUnits.length) {
        done = true;
        playSfx("correct");
        values.forEach(function (input) { input.disabled = true; });
        speakSeq([{ text: w.word, rate: 0.72 }]);
        if (opts.onSolved) opts.onSolved();
        showContinue("good", "写对了！", "「" + w.word + "」· " + (w.meaning || "读音正确"), "继续", opts.onContinue);
      } else {
        attempts++;
        playSfx("wrong");
        speakSeq([{ text: w.word, rate: 0.7 }]);
        if (attempts >= 3) {
          setTimeout(reveal, 350);
          return;
        }
        setFeedback("bad", "再听一遍", "红色框里的音不对。可以按喇叭重听，也可以对照灰色提示。");
        if (firstWrong) setTimeout(function () { firstWrong.select(); }, 120);
      }
    }

    inputs.forEach(function (input) {
      input.addEventListener("input", function () {
        input.classList.remove("is-wrong", "is-correct");
      });
      input.addEventListener("blur", function () {
        enterPreview(input);
      });
      input.addEventListener("focus", function () {
        if (input.hasAttribute("data-preview")) exitPreview(input, true);
      });
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          submit();
        }
      });
    });

    if (window.matchMedia && window.matchMedia("(pointer: fine)").matches && inputs[0]) {
      setTimeout(function () { inputs[0].focus(); }, 200);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Review                                                                  */
  /* ---------------------------------------------------------------------- */

  function learnedSoundCount() {
    var set = {};
    completedLessons().forEach(function (l) { set[l.idx] = true; });
    return Object.keys(set).length;
  }

  function accuracy() {
    return state.checks ? Math.round((state.correct / state.checks) * 100) : null;
  }

  function buildReviewPairs() {
    var byRomaji = {};
    completedLessons().forEach(function (l) {
      (l.pairs || []).forEach(function (p) {
        if (!byRomaji[p.romaji]) byRomaji[p.romaji] = p;
      });
    });
    return shuffle(Object.keys(byRomaji).map(function (r) { return byRomaji[r]; })).slice(0, 5);
  }

  function buildReviewWords(limit) {
    var seen = {};
    var pool = [];
    completedLessons().forEach(function (l) {
      (l.stage4 || []).forEach(function (w) {
        var key = w.word + "|" + w.romaji;
        if (seen[key]) return;
        seen[key] = true;
        pool.push(w);
      });
    });
    return shuffle(pool).slice(0, limit || 4);
  }

  function renderReview() {
    var done = completedLessons();
    if (!done.length) {
      reviewContentEl.innerHTML =
        '<div class="duo-empty review-empty">' +
          icon("book") +
          '<h2 class="duo-empty__title">还没有可复习的内容</h2>' +
          '<p class="duo-empty__desc">完成第一节课后，这里会出现连线、听写和完整的假名地图。</p>' +
          '<button class="duo-btn duo-btn--green" type="button" data-go-tab="learn">去学习第一课</button>' +
        "</div>";
      return;
    }

    var pairs = buildReviewPairs();
    var words = buildReviewWords(4);
    var acc = accuracy();
    var learned = learnedSoundCount();
    var minutes = Math.max(1, Math.ceil(words.length * 0.4 + (pairs.length >= 2 ? 0.5 : 0)));

    reviewContentEl.innerHTML =
      '<div class="review-layout">' +
        '<div class="review-hero">' +
        '<span class="review-hero__icon">' + icon("weights") + "</span>" +
        '<div class="review-hero__body">' +
          '<h2 class="review-hero__title">今日复习</h2>' +
          '<p class="review-hero__meta">' + (pairs.length >= 2 ? "一组假名连线 + " : "") + words.length + " 道听写题，大约 " + minutes + " 分钟。</p>" +
          '<button class="duo-btn duo-btn--green" type="button" data-start-review>开始复习</button>' +
        "</div>" +
      "</div>" +
      '<div class="review-stats">' +
        '<div class="review-stat"><b>' + learned + " / 46</b><span>已学音</span></div>" +
        '<div class="review-stat"><b>' + state.reviews + "</b><span>复习次数</span></div>" +
        '<div class="review-stat"><b>' + (acc === null ? "—" : acc + "%") + "</b><span>正确率</span></div>" +
      "</div>" +
        '<div class="review-col--map">' +
          '<div class="section-head"><h2>假名地图</h2><span>点按听发音</span></div>' +
          '<div class="kana-map">' + kanaMapHtml() + "</div>" +
          '<div class="review-foot"><p>复习题从你完成的课程里随机抽取，答错不会扣分。</p></div>' +
        "</div>" +
      "</div>";
  }

  function kanaMapHtml() {
    function mapCol(rows) {
      return '<div class="kana-map__col">' + rows.map(function (row) {
        return '<div class="kana-map__row">' + row.kana.map(function (k) {
          var h = !!state.completed["h" + pad(k.idx)];
          var kk = !!state.completed["k" + pad(k.idx)];
          var cls = h && kk ? "is-both" : h || kk ? "is-learned" : "is-none";
          return '<button class="kana-cell ' + cls + '" type="button" data-say="' + k.h + '" aria-label="' + k.h + " " + k.k + "，读音 " + k.r + '">' +
            '<span class="kana-cell__h">' + k.h + "</span>" +
            '<span class="kana-cell__k">' + k.k + "</span>" +
            '<span class="kana-cell__r">' + k.r + "</span>" +
          "</button>";
        }).join("") + "</div>";
      }).join("") + "</div>";
    }
    var split = Math.ceil(DATA.rows.length / 2);
    return mapCol(DATA.rows.slice(0, split)) + mapCol(DATA.rows.slice(split));
  }

  function startReview() {
    if (!completedLessons().length) {
      toast("先完成一节课再来复习。", "error");
      return;
    }
    var pairs = buildReviewPairs();
    var words = buildReviewWords(4);
    if (!pairs.length && !words.length) {
      toast("还没有复习素材。", "error");
      return;
    }
    cancelSpeech();
    session = {
      kind: "review",
      pairs: pairs,
      words: words,
      checks: 0,
      correct: 0,
      finished: false,
      done: false
    };
    lesson.hidden = false;
    lessonInner.innerHTML = "";
    lessonFooter.innerHTML = "";
    lessonScroll.scrollTop = 0;
    setProgress(5, "复习");
    reviewMatchStep();
  }

  function reviewMatchStep() {
    if (!session) return;
    if (session.pairs.length < 2) {
      setProgress(40, "复习");
      reviewFillStep(0);
      return;
    }
    setProgress(8, "复习");
    renderMatchView({
      tag: icon("list") + " 复习 · 连线",
      title: "先把读音连起来",
      sub: "这些字都来自你已经完成的课程。先点假名，再点罗马音。",
      pairs: session.pairs,
      onSolved: function () { setProgress(40, "复习"); },
      onContinue: function () {
        setProgress(40, "复习");
        reviewFillStep(0);
      }
    });
  }

  function reviewFillStep(index) {
    if (!session || !session.words.length) { finishReview(); return; }
    if (index >= session.words.length) { finishReview(); return; }
    setProgress(40 + (index / session.words.length) * 60, "复习 " + (index + 1) + "/" + session.words.length);
    lessonScroll.scrollTop = 0;
    renderFillView({
      word: session.words[index],
      tag: icon("volume") + " 复习 · 听写 " + (index + 1) + "/" + session.words.length,
      title: "听发音，补全罗马音",
      sub: "按 Enter 检查；写错会自动重播这个词。",
      onResult: function (r) {
        session.checks += r.checks;
        session.correct += r.correct;
      },
      onContinue: function () {
        reviewFillStep(index + 1);
      }
    });
  }

  function finishReview() {
    if (!session || session.done) return;
    session.done = true;
    session.finished = true;
    cancelSpeech();
    playSfx("complete");

    var xp = 8;
    var acc = session.checks ? Math.round((session.correct / session.checks) * 100) : 100;
    state.xp += xp;
    state.gems += 1;
    state.reviews += 1;
    state.reviewXp += xp;
    state.checks += session.checks;
    state.correct += session.correct;
    touchStreak();
    addDailyXp(xp);
    saveState();
    syncChrome();

    setProgress(100, "完成");
    lessonScroll.scrollTop = 0;
    lessonInner.innerHTML =
      '<div class="complete">' +
        '<div class="complete__art complete__art--review">' + icon("star") + "</div>" +
        '<h2 class="complete__title">复习完成</h2>' +
        '<p class="complete__sub">' + (session.pairs.length >= 2 ? "连线与听写都过了一遍。" : "听写都过了一遍。") + "学过的音正在变熟。</p>" +
        '<div class="reward-row">' +
          '<div class="reward"><span class="reward__icon">' + icon("lightning") + "</span><b>+" + xp + '</b><span>XP</span></div>' +
          '<div class="reward"><span class="reward__icon">' + icon("list") + "</span><b>" + session.words.length + '</b><span>听写题</span></div>' +
          '<div class="reward"><span class="reward__icon">' + icon("target") + "</span><b>" + acc + '%</b><span>正确率</span></div>' +
        "</div>" +
        '<p class="complete__note">累计复习 ' + state.reviews + " 次，共获得 " + state.reviewXp + " 复习 XP。</p>" +
      "</div>";

    lessonFooter.innerHTML =
      '<div class="footer-actions">' +
        '<button class="duo-btn duo-btn--green" type="button" id="reviewBack">回到复习</button>' +
        '<button class="duo-btn duo-btn--secondary" type="button" id="reviewAgain">再练一组</button>' +
      "</div>";
    ID("reviewBack").addEventListener("click", function () {
      closeLesson("review");
    });
    ID("reviewAgain").addEventListener("click", function () {
      cancelSpeech();
      startReview();
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Stats                                                                   */
  /* ---------------------------------------------------------------------- */

  function renderStats() {
    var doneCount = Object.keys(state.completed).length;
    var hDone = 0;
    var kDone = 0;
    var mastered = 0;
    var learned = 0;
    DATA.lessons.forEach(function (l) {
      if (!state.completed[l.id]) return;
      if (l.script === "hiragana") hDone++;
      else kDone++;
    });
    DATA.kana.forEach(function (k) {
      var h = !!state.completed["h" + pad(k.idx)];
      var kk = !!state.completed["k" + pad(k.idx)];
      if (h && kk) mastered++;
      if (h || kk) learned++;
    });
    var acc = accuracy();
    var week = lastSevenDays();
    var weekMax = Math.max.apply(null, week.map(function (d) { return d.xp; }).concat([1]));
    var weekTotal = week.reduce(function (sum, d) { return sum + d.xp; }, 0);
    var todayXp = state.daily[todayKey()] || 0;

    var recent = Object.keys(state.completed).map(function (id) {
      return { lesson: lessonById(id), info: state.completed[id] };
    }).filter(function (x) { return x.lesson && x.info; })
      .sort(function (a, b) { return (b.info.ts || 0) - (a.info.ts || 0); })
      .slice(0, 5);

    var rowsHtml = DATA.rows.map(function (row) {
      var total = row.kana.length * 2;
      var got = row.lessons.filter(function (id) { return !!state.completed[id]; }).length;
      var pct = Math.round((got / total) * 100);
      return '<div class="mastery-row' + (got ? "" : " is-empty") + '">' +
        '<span class="mastery-row__name">' + row.name + "</span>" +
        '<div class="mastery-row__bar"><div class="mastery-row__fill" style="width:' + pct + '%"></div></div>' +
        '<span class="mastery-row__count">' + got + " / " + total + "</span>" +
      "</div>";
    }).join("");

    statsContentEl.innerHTML =
      '<div class="stats-layout">' +
        '<div class="stats-col stats-col--overview">' +
      '<div class="stats-hero">' +
        '<span class="stats-hero__flame">' + icon("streak-large") + "</span>" +
        '<div class="stats-hero__label">连续学习</div>' +
        '<div class="stats-hero__num">' + displayStreak() + "</div>" +
        '<div class="stats-hero__sub">天 · ' + (todayXp > 0 ? "今天已获得 " + todayXp + " XP" : "今天还没开始，去学一课吧") + "</div>" +
      "</div>" +
      '<div class="duo-stat-grid stats-grid">' +
        '<div class="duo-stat"><span class="duo-stat__icon">' + icon("book") + '</span><span class="duo-stat__text"><span class="duo-stat__value">' + doneCount + " / " + TOTAL_LESSONS + '</span><span class="duo-stat__label">课程完成</span></span></div>' +
        '<div class="duo-stat"><span class="duo-stat__icon">' + icon("target") + '</span><span class="duo-stat__text"><span class="duo-stat__value">' + mastered + " / 46" + '</span><span class="duo-stat__label">双写掌握</span></span></div>' +
        '<div class="duo-stat"><span class="duo-stat__icon">' + icon("timer") + '</span><span class="duo-stat__text"><span class="duo-stat__value">' + (acc === null ? "—" : acc + "%") + '</span><span class="duo-stat__label">总体正确率</span></span></div>' +
        '<div class="duo-stat"><span class="duo-stat__icon">' + icon("star") + '</span><span class="duo-stat__text"><span class="duo-stat__value">' + state.reviews + " 次" + '</span><span class="duo-stat__label">复习完成</span></span></div>' +
      "</div>" +
      '<div class="week-card">' +
        '<div class="week-card__head"><b>最近 7 天</b><span>' + weekTotal + " XP</span></div>" +
        '<div class="week-chart">' + week.map(function (d) {
          var h = d.xp ? Math.max(8, Math.round((d.xp / weekMax) * 100)) : 0;
          return '<div class="week-bar' + (d.today ? " is-today" : "") + '">' +
            '<div class="week-bar__track"><div class="week-bar__fill" style="height:' + h + '%"></div></div>' +
            '<span class="week-bar__label">' + d.label + "</span>" +
          "</div>";
        }).join("") + "</div>" +
      "</div>" +
        "</div>" +
        '<div class="stats-col stats-col--detail">' +
      '<div class="section-head"><h2>按行掌握</h2><span>平假名 + 片假名</span></div>' +
      '<div class="row-mastery">' + rowsHtml + "</div>" +
      '<div class="section-head"><h2>最近完成</h2><span>' + learned + " / 46 音已接触</span></div>" +
      (recent.length
        ? '<div class="recent-list">' + recent.map(function (r) {
            return '<div class="recent-item">' +
              '<span class="recent-item__glyph">' + r.lesson.kana + "</span>" +
              '<div class="recent-item__body">' +
                '<div class="recent-item__title">' + r.lesson.kana + " / " + r.lesson.otherKana + " · " + r.lesson.scriptName + "</div>" +
                '<div class="recent-item__meta">' + fmtTime(r.info.ts) + " · 正确率 " + (r.info.accuracy || 0) + "%</div>" +
              "</div>" +
              '<span class="recent-item__xp">+' + (r.info.xp || 0) + " XP</span>" +
            "</div>";
          }).join("") + "</div>"
        : '<div class="recent-empty">还没有完成的课程。第一课在等你。</div>') +
      '<div class="stats-foot"><button class="danger-link" type="button" data-open-reset>清除学习记录</button></div>' +
        "</div>" +
      "</div>";
  }

  function lastSevenDays() {
    var out = [];
    var labels = ["日", "一", "二", "三", "四", "五", "六"];
    for (var i = 6; i >= 0; i--) {
      var d = new Date();
      d.setDate(d.getDate() - i);
      out.push({
        key: todayKey(d),
        label: labels[d.getDay()],
        xp: Number(state.daily[todayKey(d)]) || 0,
        today: i === 0
      });
    }
    return out;
  }

  function fmtTime(ts) {
    if (!ts) return "刚刚";
    var d = new Date(ts);
    var now = new Date();
    var time = pad(d.getHours()) + ":" + pad(d.getMinutes());
    if (todayKey(d) === todayKey(now)) return "今天 " + time;
    return pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + time;
  }

  /* ---------------------------------------------------------------------- */
  /* Tabs, global events, init                                               */
  /* ---------------------------------------------------------------------- */

  function showTab(tab) {
    currentTab = tab || "learn";
    $$(".view").forEach(function (v) {
      var on = v.id === "view-" + currentTab;
      v.classList.toggle("is-active", on);
      v.hidden = !on;
    });
    $$(".duo-nav-btn").forEach(function (btn) {
      if (btn.getAttribute("data-tab") === currentTab) btn.setAttribute("aria-current", "page");
      else btn.removeAttribute("aria-current");
    });
    window.scrollTo({ top: 0, behavior: "auto" });
    if (currentTab === "review") renderReview();
    else if (currentTab === "stats") renderStats();
    else syncChrome();
  }

  function resetProgress() {
    state = JSON.parse(JSON.stringify(DEFAULT_STATE));
    saveState();
    syncChrome();
    renderLearn(false);
    renderReview();
    renderStats();
    showTab("learn");
    if (window.Duo) Duo.close("resetDialog");
    toast("学习记录已清除", "success");
  }

  lessonClose.addEventListener("click", function () {
    if (!session) return;
    if (session.finished) {
      closeLesson(currentTab);
      return;
    }
    if (window.Duo) Duo.open("quitDialog");
  });

  ID("quitConfirm").addEventListener("click", function () {
    if (window.Duo) Duo.close("quitDialog");
    closeLesson(currentTab);
  });

  ID("resetConfirm").addEventListener("click", resetProgress);

  $$(".duo-nav-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (btn.getAttribute("data-tab") === currentTab) {
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      playSfx("tap");
      showTab(btn.getAttribute("data-tab"));
    });
  });

  document.addEventListener("click", function (e) {
    var goTab = e.target.closest("[data-go-tab]");
    if (goTab) {
      playSfx("tap");
      showTab(goTab.getAttribute("data-go-tab"));
      return;
    }

    var say = e.target.closest("[data-say]");
    if (say) {
      speakSeq([{ text: say.getAttribute("data-say"), rate: 0.72 }]);
      return;
    }

    var startReviewBtn = e.target.closest("[data-start-review]");
    if (startReviewBtn) {
      startReview();
      return;
    }

    var rowBtn = e.target.closest("[data-row]");
    if (rowBtn) {
      playSfx("pop");
      openRowSheet(rowBtn.getAttribute("data-row"));
      return;
    }

    var lessonBtn = e.target.closest("[data-lesson]");
    if (lessonBtn) {
      var l = lessonById(lessonBtn.getAttribute("data-lesson"));
      if (!l) return;
      var next = firstIncomplete();
      if (isLocked(l, next)) {
        toast("先完成前面的课程，这一课才会解锁。", "error");
        return;
      }
      var inSheet = lessonBtn.closest(".duo-sheet");
      if (inSheet && window.Duo) Duo.close(inSheet);
      playSfx("pop");
      startLesson(l.id);
      return;
    }

    var resetBtn = e.target.closest("[data-open-reset]");
    if (resetBtn) {
      if (window.Duo) Duo.open("resetDialog");
      return;
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && session && !e.isComposing && !e.repeat && !e.defaultPrevented) {
      var t = e.target;
      var typing = t && t.closest && t.closest("input, textarea, select, [contenteditable='true'], #lessonClose, [data-duo-close]");
      var altAction = t && t.closest && t.closest("#backPathBtn, #reviewAgain, .speaker-btn");
      var overlay = document.querySelector(".duo-dialog-scrim.is-open, .duo-sheet.is-open, .duo-scrim.is-open");
      if (!typing && !altAction && !overlay) {
        var btn = ID("continueBtn");
        if (!btn) {
          var matchNext = ID("matchNext");
          if (matchNext && !matchNext.disabled) btn = matchNext;
        }
        if (!btn) btn = ID("nextLessonBtn") || ID("reviewBack");
        if (btn && !btn.disabled) {
          e.preventDefault();
          btn.click();
          return;
        }
      }
    }
    if (e.key === "Escape" && session && session.finished) {
      closeLesson(currentTab);
    }
  });

  window.addEventListener("resize", function () {
    if (matchBoardEl && matchBoardEl.isConnected && matchDrawFn) matchDrawFn();
  });

  if (window.speechSynthesis) {
    if (typeof window.speechSynthesis.onvoiceschanged !== "undefined") {
      window.speechSynthesis.onvoiceschanged = function () {
        jaVoiceCache = pickJapaneseVoice();
      };
    }
    jaVoiceCache = pickJapaneseVoice();
  }

  function init() {
    if (!DATA) {
      pathEl.innerHTML = '<div class="duo-empty"><h2 class="duo-empty__title">数据没有加载</h2><p class="duo-empty__desc">请确认 js/data.js 与页面在一起。</p></div>';
      return;
    }
    renderLearn(false);
    renderReview();
    renderStats();
    syncChrome();
    showTab("learn");
  }

  init();
})();