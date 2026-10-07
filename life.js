/* ════════════════════════════════════════════════════════════
   생활 기능 — 기획서 '다시 쓸 때 더 편하게'·'윤리 및 안전성' 구현 (2026-10-01)

   서버판(widget.js)과 공개 시연판(share_widget.js)이 함께 쓴다.
   두 위젯은 window.JG 로 아래 고리만 열어 주고, 기능은 전부 여기에 있다.
     JG.send(text)        질문 보내기
     JG.bubble(text, who) 말풍선
     JG.node(html)        HTML → 요소
     JG.log               대화 목록 요소
     JG.mic               마이크 버튼
     JG.server            서버판이면 true
   위젯이 보내는 사건
     jg:ready   고리 준비됨
     jg:open    창을 처음 열었을 때 (detail.first)
     jg:card    병원 카드를 그렸을 때 (detail.card, detail.node)
     jg:results 병원 결과를 다 그렸을 때 (detail.count)
     jg:quick   빠른 선택 버튼을 그렸을 때 (detail.items, detail.node)

   저장 원칙 : 가족 조건·진료일은 이 기기의 브라우저(localStorage)에만 둔다.
   서버로 보내지 않는다.
   ════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var KEY_FAMILY = "jg_family_v1";     // { region, who }
  var KEY_VISITS = "jg_visits_v1";     // [{ name, tel, addr, lat, lon, date }]
  var KEY_VOICE_OK = "jg_voice_notice_v1";

  function load(k, d) {
    try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; }
    catch (e) { return d; }
  }
  function save(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { return false; }   // 사생활 보호 창 등에서는 저장이 안 될 수 있다
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  var WEEK = ["일", "월", "화", "수", "목", "금", "토"];

  function JG() { return window.JG; }
  function add(html) {
    var g = JG(); if (!g) return null;
    var n = g.node(html); g.log.appendChild(n);
    g.log.scrollTop = g.log.scrollHeight;
    return n;
  }

  /* ── 오늘이 어떤 날인지 ─────────────────────────────────────
     서버판은 /api/today (공휴일 API 결과)를, 공개판은 holidays.json 을 본다.
     둘 다 없으면 공휴일은 모른다고 보고 주말·밤만 판단한다. (지어내지 않는다) */
  var today = null;
  function localToday() {
    var d = new Date(), h = d.getHours();
    var dt = d.getDay() === 0 ? "일요일" : d.getDay() === 6 ? "토요일" : "평일";
    return { date: ymd(d), weekday: WEEK[d.getDay()], day_type: dt,
             holiday_name: null, is_night: h >= 19 || h < 8, holiday_source: "none" };
  }
  function loadToday() {
    var base = localToday();
    var g = JG();
    var url = g && g.server ? "/api/today" : "holidays.json";
    return fetch(url, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }).then(function (j) {
      if (g && g.server) {
        today = Object.assign(base, j);
      } else {
        var name = j && j.days ? j.days[base.date] : null;   // { "2026-10-03": "개천절" }
        if (name) { base.day_type = "공휴일"; base.holiday_name = name; }
        base.holiday_source = j && j.days ? "cache" : "none";
        today = base;
      }
      return today;
    }).catch(function () { today = base; return today; });
  }

  /* ── 1. 시간대에 맞춘 첫 화면 ─────────────────────────────── */
  function welcome() {
    var t = today || localToday();
    var fam = load(KEY_FAMILY, {});
    var items = [];
    var msg = null;
    if (t.day_type === "공휴일") {
      msg = "오늘은 " + (t.holiday_name || "공휴일") + "이라 문 연 병원이 적어요. 문 연 곳부터 찾아볼게요.";
      items.push({ label: "지금 문 연 병원", value: "지금 문 연 병원" });
      items.push({ label: "문 연 약국", value: "지금 문 연 약국" });
    } else if (t.is_night) {
      msg = "지금은 밤이라 문 연 병원이 적어요. 약국·응급실도 함께 찾아드릴게요.";
      items.push({ label: "지금 문 연 약국", value: "지금 문 연 약국" });
      items.push({ label: "응급실 병상", value: "응급실" });
      items.push({ label: "지금 진료 중인 병원", value: "지금 문 연 병원" });
    } else if (t.day_type === "토요일" || t.day_type === "일요일") {
      msg = "오늘은 " + t.day_type + "이에요. " + t.day_type + "에 진료하는 곳으로 찾아볼게요.";
      items.push({ label: t.day_type + " 진료하는 병원", value: t.day_type + "에 하는 병원" });
      items.push({ label: "지금 문 연 약국", value: "지금 문 연 약국" });
    }
    if (fam.who === "아이") items.unshift({ label: "우리 아이 소아과", value: "지금 문 연 소아과" });
    if (fam.who === "어르신") items.unshift({ label: "어르신 정형외과", value: "가까운 정형외과" });
    // 평일 낮이면 기본 예시도 함께 보여준다 (가족 버튼만 남지 않게)
    if (!msg && items.length) {
      items = items.concat([
        { label: "감기 걸린 것 같아요", value: "감기 걸린 것 같아요" },
        { label: "지금 문 연 병원", value: "지금 문 연 병원" },
        { label: "주말에도 하는 소아과", value: "주말에도 하는 소아과" }
      ]);
    }
    return { msg: msg, items: items };
  }

  /* ── 2. 우리 가족 조건 (기본 지역 · 함께 찾는 사람) ──────────── */
  function familyBar() {
    var fam = load(KEY_FAMILY, {});
    var label = fam.region
      ? "우리 동네 <b>" + esc(fam.region) + "</b>" + (fam.who ? " · " + esc(fam.who) : "")
      : "우리 동네를 저장하면 다음엔 더 짧게 물어볼 수 있어요";
    var bar = add('<div class="jg-fam"><span>' + label + '</span>' +
                  '<button type="button">' + (fam.region ? "바꾸기" : "저장하기") + '</button></div>');
    if (!bar) return;
    bar.querySelector("button").addEventListener("click", function () { familyForm(bar); });
  }
  function familyForm(bar) {
    var fam = load(KEY_FAMILY, {});
    var f = JG().node(
      '<form class="jg-form">' +
        '<label>우리 동네 <input name="region" placeholder="예: 광주 남구" value="' + esc(fam.region || "") + '"></label>' +
        '<label>주로 함께 찾는 사람 <select name="who">' +
          ["", "본인", "아이", "어르신"].map(function (w) {
            return '<option value="' + w + '"' + (fam.who === w ? " selected" : "") + ">" + (w || "선택 안 함") + "</option>";
          }).join("") +
        '</select></label>' +
        '<p class="jg-small">이 기기 브라우저에만 저장돼요. 서버로 보내지 않아요.</p>' +
        '<div class="jg-row"><button type="submit">저장</button>' +
        '<button type="button" class="jg-del">지우기</button></div>' +
      '</form>');
    bar.replaceWith(f);
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var v = { region: f.region.value.trim(), who: f.who.value };
      save(KEY_FAMILY, v.region || v.who ? v : {});
      f.remove(); familyBar();
    });
    f.querySelector(".jg-del").addEventListener("click", function () {
      save(KEY_FAMILY, {}); f.remove(); familyBar();
    });
  }
  // 지역을 되묻는 버튼 줄에 '우리 동네'를 맨 앞에 넣는다
  function onQuick(e) {
    var fam = load(KEY_FAMILY, {});
    if (!fam.region || !e.detail || !e.detail.node) return;
    var items = e.detail.items || [];
    var looksRegion = items.some(function (it) {
      var l = typeof it === "string" ? it : it.label;
      return /서울 강남구|부산 해운대구|광주 북구/.test(l || "");
    });
    if (!looksRegion) return;
    var first = items[0];
    var suffix = "";
    if (first && typeof first !== "string" && first.value && first.label && first.value !== first.label) {
      suffix = first.value.slice(first.label.length);   // 예: '광주 북구 약국' → ' 약국'
    }
    var b = document.createElement("button");
    b.type = "button"; b.className = "jg-home";
    b.textContent = "우리 동네 (" + fam.region + ")";
    b.addEventListener("click", function () { JG().send(fam.region + suffix); });
    e.detail.node.insertBefore(b, e.detail.node.firstChild);
  }

  /* ── 3. 정기 진료일 등록 → 그날 열면 맨 위에 확인 카드 ────────── */
  function onCard(e) {
    var card = e.detail && e.detail.card, n = e.detail && e.detail.node;
    if (!card || !n || card.pharmacy) return;   // 약국 카드는 '두 번째' 목록용으로만 받는다
    // 정보 기준 시점 (서버가 as_of 를 주면 그 값, 없으면 데이터 출처)
    var asof = card.as_of || (JG().server ? "" : "심평원 전국 병의원 및 약국 현황(2026.6.) · 응급의료정보");
    if (asof) n.appendChild(JG().node('<div class="jg-asof">정보 기준 · ' + esc(asof) + '</div>'));
    var btn = JG().node('<button type="button" class="jg-visit">진료일 등록</button>');
    var cta = n.querySelector(".cta") || n;
    cta.appendChild(btn);
    btn.addEventListener("click", function () { visitForm(card, n, btn); });
  }
  function visitForm(card, n, btn) {
    btn.disabled = true;
    var f = JG().node(
      '<form class="jg-form jg-inline"><label>진료 날짜 <input type="date" name="d" min="' + ymd(new Date()) + '" required></label>' +
      '<button type="submit">등록</button><button type="button" class="jg-cancel">취소</button>' +
      '<p class="jg-small">그날 이 창을 열면 맨 위에 진료시간 기준과 전화 확인을 띄워 드려요. 이 기기에만 저장돼요.</p></form>');
    n.appendChild(f);
    f.querySelector(".jg-cancel").addEventListener("click", function () { f.remove(); btn.disabled = false; });
    f.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var list = load(KEY_VISITS, []).filter(function (v) { return v.date >= ymd(new Date()); });
      list.push({ name: card.name, tel: card.tel || "", addr: card.addr || "",
                  lat: card.lat, lon: card.lon, hours: card.hours || "", date: f.d.value });
      save(KEY_VISITS, list);
      f.replaceWith(JG().node('<div class="jg-small jg-ok">' + esc(f.d.value) + ' 진료일로 등록했어요.</div>'));
      btn.textContent = "등록됨";
    });
  }
  function todayVisits() {
    var t = ymd(new Date());
    var list = load(KEY_VISITS, []);
    var keep = list.filter(function (v) { return v.date >= t; });
    if (keep.length !== list.length) save(KEY_VISITS, keep);   // 지난 진료일은 지운다
    return keep.filter(function (v) { return v.date === t; });
  }
  function visitCards() {
    todayVisits().forEach(function (v) {
      var tel = String(v.tel || "").replace(/[^0-9+]/g, "");
      var route = (v.lat && v.lon)
        ? "https://map.naver.com/p/directions/-/" + v.lon + "," + v.lat + "," + encodeURIComponent(v.name) + "/-/transit"
        : "https://map.naver.com/p/search/" + encodeURIComponent(v.name);
      add('<div class="jg-visitcard"><b>오늘은 ' + esc(v.name) + ' 진료일이에요</b>' +
          (v.hours ? '<div>등록할 때 확인한 진료시간 : ' + esc(v.hours) + '</div>' : "") +
          '<div class="jg-small">진료시간은 공공데이터에 등록된 값이에요. 오늘 휴진·접수 여부는 전화로 확인해 주세요.</div>' +
          '<div class="jg-row">' + (tel ? '<a class="call" href="tel:' + esc(tel) + '">전화로 확인</a>' : "") +
          '<a class="out" href="' + esc(route) + '" target="_blank" rel="noopener">길찾기</a></div></div>');
    });
  }

  /* ── 4. 음성 첫 사용 안내 (처리 주체 고지) ─────────────────── */
  function voiceNotice() {
    var g = JG(); if (!g || !g.mic) return;
    g.mic.addEventListener("click", function (e) {
      if (load(KEY_VOICE_OK, false)) return;
      e.stopImmediatePropagation(); e.preventDefault();
      if (document.querySelector(".jg-voice-note")) return;
      var box = add(
        '<div class="jg-voice-note"><b>말로 묻기 전에 알려드려요</b>' +
        '<div>' + (g.server ? '말소리는 받아쓰기 회사(일레븐랩스, 미국)의 서버에서 글자로 바뀌어요. 녹음은 저장하지 않아요. '
                            : '말소리는 이 브라우저를 만든 회사(예: 크롬은 Google)의 서버에서 글자로 바뀔 수 있어요. ') +
        '이 서비스는 질문 내용을 저장하지 않아요.</div>' +
        '<div class="jg-row"><button type="button" class="ok">알겠어요, 말할게요</button>' +
        '<button type="button" class="no">글자로 쓸게요</button></div></div>');
      box.querySelector(".ok").addEventListener("click", function () {
        save(KEY_VOICE_OK, true); box.remove(); g.mic.click();
      });
      box.querySelector(".no").addEventListener("click", function () { box.remove(); g.input && g.input.focus(); });
    }, true);   // 위젯의 마이크 처리보다 먼저 받는다
  }

  /* ── 5. 결과가 '안전 판정'이 아님을 알림 ─────────────────── */
  function onResults(e) {
    if (!e.detail || !e.detail.count) return;
    add('<div class="jg-safe">이 결과는 병원 선택을 돕는 정보예요. 위급한지 판단해 주지는 않아요. ' +
        '숨쉬기 힘들거나 의식이 흐리면 바로 119에 연락하세요.</div>');
  }

  /* ── 시작 ─────────────────────────────────────────────── */
  function onOpen(e) {
    if (!e.detail || !e.detail.first) return;
    var w = welcome();
    if (w.msg) JG().bubble(w.msg, "bot");
    visitCards();
    familyBar();
    if (w.items.length && JG().quick) JG().quick(w.items);
  }
  function start() {
    loadToday();
    voiceNotice();
    document.addEventListener("jg:open", onOpen);
    document.addEventListener("jg:card", onCard);
    document.addEventListener("jg:results", onResults);
    document.addEventListener("jg:quick", onQuick);
  }
  window.JGLife = { welcome: welcome, today: function () { return today || localToday(); },
                    _setToday: function (t) { today = Object.assign(localToday(), t); } };   // 시험용
  if (window.JG) start(); else document.addEventListener("jg:ready", start, { once: true });
})();

/* ════════════════════════════════════════════════════════════
   말 한마디로 바로 실행 — 음성 명령 해석 (2026-10-01 영훈 휴대폰 시험)

   "두리 치과의원 대중교통" 이라고 말하면 되묻지 않고 네이버 지도 대중교통 길찾기를 연다.
   "두 번째 병원 전화해 줘" 처럼 방금 보여준 목록의 순서로도 부를 수 있다.
   여기서는 '무슨 일을, 어디에' 만 알아듣는다. 실제로 여는 일은 각 위젯이 한다.

   JGCmd.parse(문장, 진료과목록) →
     null  (명령이 아님 — 평소처럼 병원 찾기로 넘긴다)
     { act: "route"|"call", mode: "transit"|"car"|"walk", app: "naver"|"kakao",
       nth: 0부터 시작하는 순서 또는 null, name: "두리치과의원", pharmacy: true/false }
   ════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var MODE_WORDS = [
    ["transit", /대중\s*교통|버스|지하철|전철/],
    ["car", /자동차|자가용|차로|차 타고|차타고|운전|택시/],
    ["walk", /도보|걸어서|걸어|걷는|걸어가/]
  ];
  // 2026-10-07 : '안내해 줘', '위치 알려줘', '어디야'도 길찾기로 본다 ('어디가 아파'는 아니다)
  var ROUTE_WORDS = /길\s*찾기|길찾아|가는\s*길|가는\s*법|가는\s*방법|어떻게\s*가|길\s*안내|길\s*알려|안내|위치|어디야|어디\s*있|어딨|어디에\s*있|데려다|네이버\s*지도|카카오\s*맵|카카오\s*지도|지도/;
  var CALL_WORDS = /전화|통화/;
  var NTH = [
    [0, /(첫|1)\s*(번째|번)|첫\s*번|맨\s*위|제일\s*위|1\s*등/],
    [1, /(두|2)\s*(번째|번)/],
    [2, /(세|3)\s*(번째|번)/],
    [3, /(네|4)\s*(번째|번)/],
    [4, /(다섯|5)\s*(번째|번)/]
  ];
  // 이름을 뽑을 때 지우는 말 (할 일·꾸밈말·조사)
  var FILLER = /안내해?|달라고|해\s*달라|부탁해?|가르쳐\s*줘?|데려다\s*줘?|위치|어디야|어디\s*있어?|어딨어?|갈\s*수\s*있는|갈\s*수|있는|할\s*수|대중\s*교통|버스|지하철|전철|자동차|자가용|차 타고|차타고|운전|택시|도보|걸어서|걸어가|걸어|걷는|길\s*찾기|길찾아|가는\s*길|가는\s*법|어떻게|길\s*안내|길\s*알려|네이버\s*지도|카카오\s*맵|카카오\s*지도|카카오|네이버|지도|전화|통화|연결|으로|까지|에서|로|가자|가줘|가 줘|갈래|가고\s*싶어|가는|가요|가$|알려\s*줘|알려\s*주세요|알려|보여\s*줘|열어\s*줘|열어|걸어\s*줘|해\s*줘|해\s*주세요|해봐|해|줘|주세요|좀|번호|바로|지금|빨리|[.,!?~]/g;
  // 이름이 아니라 '조건'인 말 ("지금 문 연 병원", "주말에 하는 병원") — 이것만 남으면 이름이 아니다 (2026-10-07)
  var GENERIC = /의원|병원|약국|한의원|치과|클리닉|의료원|센터|보건소|근처|가까운|가까이|주변|여기|제일|가장|거기|그곳|저기|아무|곳|데$|지금|문연|문 연|여는|열린|열려|오늘|내일|야간|밤|새벽|심야|주말|일요일|토요일|공휴일|24시간|24시|큰|대학|종합|좋은|잘하는|유명한|아이|애기|소아|어린이|안내|달라고|부탁|알려|가르쳐|데려다|위치|어디|해줘|해 줘|줘|요/g;

  /* 말에서 병원·약국 이름을 직접 찾는다 (2026-10-07)
     "중앙 신경과 의원 도보로 안내해 달라고" → "중앙신경과의원"
     예전엔 군더더기를 지우는 방식이라 '안내'·'달라고'가 이름에 붙어 병원을 못 찾았다. */
  var 앞군더더기 = /^(저기|거기|여기|그|이|우리|집앞|집\s*앞|동네|근처|가까운|제일|가장|혹시|그럼|그러면|아니|음|어)+/;
  function 이름찾기(t, depts) {
    // 지도 앱 이름·가는 방법 말은 먼저 뺀다 ("카카오맵으로 신이비인후과" → "신이비인후과")
    var 붙인 = String(t || "")
      .replace(/카카오\s*맵|카카오\s*지도|네이버\s*지도|지도|대중\s*교통|자동차|자가용|택시|도보|걸어서|버스|지하철|전철|(으로|로)(?=\s)/g, " ")
      .replace(/[\s.,!?~"'“”‘’]/g, "");
    var 끝말 = ["한의원", "치과의원", "의원", "병원", "약국", "의료원", "클리닉", "센터", "보건소"]
      .concat((depts || []).slice().sort(function (a, b) { return b.length - a.length; }));
    var 맞음 = new RegExp("([가-힣A-Za-z0-9]{1,24}?(?:" + 끝말.join("|") + "))").exec(붙인);
    if (!맞음) return "";
    var 이름 = 맞음[1].replace(앞군더더기, "");
    // 뒤에 '의원'이 이어지면 함께 ("중앙신경과" + "의원")
    var 뒤 = 붙인.slice(맞음.index + 맞음[1].length);
    var 덧 = /^(의원|병원|한의원)/.exec(뒤);
    if (덧) 이름 += 덧[1];
    return 이름;
  }

  function parse(text, depts) {
    var t = String(text || "").trim();
    if (!t || t.indexOf("__") === 0) return null;
    var mode = null;
    for (var i = 0; i < MODE_WORDS.length; i++) {
      if (MODE_WORDS[i][1].test(t)) { mode = MODE_WORDS[i][0]; break; }
    }
    var call = CALL_WORDS.test(t);
    var route = !!mode || ROUTE_WORDS.test(t);
    if (!call && !route) return null;

    var nth = null;
    for (var j = 0; j < NTH.length; j++) {
      if (NTH[j][1].test(t)) { nth = NTH[j][0]; break; }
    }
    var name = 이름찾기(t, depts || DEFAULT_DEPTS);
    if (!name) {
      name = t;
      NTH.forEach(function (n) { name = name.replace(n[1], " "); });
      name = name.replace(FILLER, " ").replace(/\s+/g, "");
    }
    // 진료과·일반 낱말을 빼고도 한 글자 이상 남아야 '이름'으로 본다. ('신이비인후과' → '신')
    // ("근처 이비인후과 대중교통" 은 이름이 아니라 병원 찾기다)
    var core = name;
    // 진료과 이름과 흔한 줄임말(소아과·비뇨기과·정신과)을 모두 빼고 본다
    (depts || []).concat(DEFAULT_DEPTS, ["소아과", "비뇨기과", "정신과", "이비인후", "산부인과", "피부과"])
      .sort(function (a, b) { return b.length - a.length; })
      .forEach(function (d) { core = core.split(d).join(""); });

    // 조건 낱말과 조사를 번갈아 두 번 지운다 ("주말에하는" → "주말에" → "")
    var 조사 = /에서|에도|에는|하는|하고|되는|있는|^에|에$/g;
    core = core.replace(GENERIC, "").replace(조사, "").replace(GENERIC, "").replace(조사, "");
    // 이름 없이 "거기 전화해 줘", "길 안내해 줘" 처럼만 말하면 방금 보여 준 ①번으로 본다 (nth = -1)
    // ('가까운 약국 어디야'처럼 조건만 있는 말은 찾기다 — '그/이/거기' 같은 가리키는 말이 있거나 아무 이름도 없을 때만)
    // 이름이 따로 있으면 이름이 먼저다 ("저기 중앙신경과의원" → 중앙신경과의원)
    var 지시만 = !name || /^(거기|여기|저기|그곳|그거|거|그|이)$/.test(name) ||
      (/^(병원|약국|의원)$/.test(name) &&
       (/(^|\s)(그|이|저)\s*(병원|약국|의원|곳)/.test(t) || /(^|\s)(거기|여기|저기)(\s|$)/.test(t)));
    if (nth === null && 지시만) nth = -1;
    if (nth === null && core.length < 1) return null;
    return {
      act: call && !route ? "call" : "route",
      mode: mode || "transit",
      app: /카카오/.test(t) ? "kakao" : "naver",
      nth: nth,
      name: nth === null ? name : "",
      pharmacy: /약국/.test(t)
    };
  }

  // 이름 맞추기 점수 (작을수록 잘 맞음). 띄어쓰기는 무시한다.
  function nameScore(placeName, q) {
    var n = String(placeName || "").replace(/\s+/g, "");
    if (!q || !n) return 99;
    if (n === q) return 0;
    var bare = function (s) { return s.replace(/(의원|병원|약국|한의원|치과의원|치과)$/, ""); };
    if (bare(n) === bare(q)) return 1;
    if (n.indexOf(q) === 0) return 2;
    if (n.indexOf(q) >= 0) return 3;
    if (bare(q).length >= 2 && n.indexOf(bare(q)) >= 0) return 4;
    return 99;
  }

  var MODE_LABEL = { transit: "대중교통", car: "자동차", walk: "도보" };
  // 서버판처럼 진료과 사전을 안 넘겨 주는 위젯을 위한 기본 목록
  var DEFAULT_DEPTS = ["가정의학과", "내과", "소아청소년과", "이비인후과", "피부과", "안과",
    "정형외과", "신경외과", "외과", "산부인과", "비뇨의학과", "정신건강의학과", "신경과",
    "재활의학과", "마취통증의학과", "영상의학과", "치과", "한의원", "한방"];

  /* 방금 화면에 그린 카드 목록 ("두 번째 병원" 을 알아듣기 위해).
     카드가 1.5초 넘게 끊겼다가 다시 오면 새 목록으로 본다. */
  var shown = [], lastCardAt = 0;
  document.addEventListener("jg:card", function (e) {
    var c = e.detail && e.detail.card;
    if (!c || !c.name) return;
    var now = Date.now();
    if (now - lastCardAt > 1500) shown = [];
    lastCardAt = now;
    shown.push(c);
    c.__node = e.detail.node || null;
  });

  function naverUrl(mode, p, pos) {
    var nm = encodeURIComponent(p.name || "목적지");
    if (!p.lat || !p.lon) return "https://map.naver.com/p/search/" + nm;
    var from = pos ? pos.lon + "," + pos.lat + "," + encodeURIComponent("내 위치") : "-";
    return "https://map.naver.com/p/directions/" + from + "/" + p.lon + "," + p.lat + "," + nm + "/-/" + mode;
  }
  function kakaoUrl(p, pos) {
    var nm = encodeURIComponent(p.name || "목적지");
    if (!p.lat || !p.lon) return "https://map.kakao.com/?q=" + nm;
    var to = nm + "," + p.lat + "," + p.lon;
    if (!pos) return "https://map.kakao.com/link/to/" + to;
    return "https://map.kakao.com/link/from/" + encodeURIComponent("내 위치") + "," +
      pos.lat + "," + pos.lon + "/to/" + to;
  }

  // 실제로 연다. 지도·전화 앱으로 넘어가므로 열리지 않을 때를 대비해 누를 수 있는 단추도 남긴다.
  function go(p, cmd, same) {
    var JG = window.JG;
    var url, 말;
    if (cmd.act === "call") {
      var tel = String(p.tel || "").replace(/[^0-9+]/g, "");
      if (!tel) { JG.bubble(p.name + "은(는) 전화번호가 공개되어 있지 않아요.", "bot"); return; }
      url = "tel:" + tel;
      말 = p.name + "에 전화를 걸게요. (" + p.tel + ")";
    } else {
      var pos = JG.pos ? JG.pos() : null;
      url = cmd.app === "kakao" ? kakaoUrl(p, pos) : naverUrl(cmd.mode, p, pos);
      말 = p.name + "까지 " + (cmd.app === "kakao" ? "카카오맵 길찾기를" : MODE_LABEL[cmd.mode] + " 길찾기를 네이버 지도로") +
        " 열게요." + (pos ? "" : " (출발지는 지도에서 정해 주세요)");
    }
    if (same > 1) 말 += " 같은 이름이 " + same + "곳이라 " + (JG.pos && JG.pos() ? "가장 가까운 곳" : "첫 번째 곳") + "으로 골랐어요.";
    JG.bubble(말, "bot");
    var 단추 = JG.node('<div class="jg-go"><a class="rbtn" rel="noopener" href="' +
      url.replace(/"/g, "&quot;") + '">' + (cmd.act === "call" ? "📞 전화가 안 걸리면 눌러 주세요" : "🗺️ 지도가 안 열리면 눌러 주세요") + "</a></div>");
    JG.log.appendChild(단추);
    try { JG.log.scrollTop = JG.log.scrollHeight; } catch (e) {}
    setTimeout(function () { window.location.href = url; }, 800);
  }

  /* 위젯이 부른다. 명령이면 true (위젯은 더 하지 않는다), 아니면 false.
     fallback : 이름을 못 찾았는데 이름 같지도 않을 때 평소 병원 찾기로 넘기는 함수 */
  /* ── 말로 화면 다루기 (2026-10-07 영훈 "명령어 더 추가") ──
     손이 바쁜 부모·어르신이 버튼 없이 말로만 쓸 수 있게. 짧은 말 전체가 맞을 때만 실행한다
     (증상 문장 "다시 아파요" 같은 것을 가로채지 않게). */
  function 다듬기(t) {
    return String(t || "").replace(/[.,!?~"'“”‘’]/g, "").replace(/\s+/g, " ").trim()
      .replace(/\s*(주세요|줘요|줘|해요|요|좀)$/g, "").replace(/\s*(해|주)$/, "").trim();
  }
  var 도움말 = "이렇게 말해 보세요. ‘허리가 아파요’, ‘애가 열나요’, ‘지금 문 연 약국’, " +
    "‘두 번째 병원 전화해 줘’, ‘첫 번째 병원 걸어서’, ‘두리치과의원 대중교통’, ‘첫 번째 병원 몇 시까지 해’, " +
    "‘다시 읽어 줘’, ‘글씨 크게’, ‘소리 켜’, ‘처음으로’, 급하면 ‘119’.";
  // 명령에 대한 대답 : 말풍선을 그리고, 소리로 읽기를 켰으면 읽어 준다
  // (공유판은 말풍선을 그리면 위젯이 알아서 읽는다 — 두 번 읽지 않게 서버판만)
  function 대답(말) {
    var JG = window.JG;
    JG.bubble(말, "bot");
    var 토글 = document.getElementById("speak-toggle");
    if (JG.server && window.JGSay && 토글 && 토글.getAttribute("aria-pressed") === "true") JGSay.speak(말);
  }
  function 은는(이름) {
    var c = String(이름 || "").charCodeAt(String(이름 || "").length - 1);
    return (c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0) ? "은" : "는";
  }
  function 마지막대답() {
    var JG = window.JG, rows = [].slice.call(JG.log.children), 나 = [];
    rows.forEach(function (r, i) { if (r.classList && r.classList.contains("me")) 나.push(i); });
    var 끝 = 나.length ? 나[나.length - 1] : rows.length, 시작 = 나.length > 1 ? 나[나.length - 2] : -1;
    return rows.slice(시작 + 1, 끝).filter(function (r) { return r.classList && r.classList.contains("bot"); })
      .map(function (r) { return r.textContent; }).join(" ");
  }
  function 앱명령(t) {
    var JG = window.JG, d = 다듬기(t);
    if (/^(도움말|도와|도움|뭐라고 말하면 돼|뭐라고 해야 돼|어떻게 (써|사용해|말해)|사용법|명령어|뭐 할 수 있어)/.test(d)) {
      대답(도움말); return true;
    }
    if (/^(다시 (읽어|말해|들려)|한 번 더 (읽어|말해)|뭐라고(\s*했어)?|못 들었어|다시)$/.test(d)) {
      var 말 = 마지막대답();
      if (!말) { 대답("다시 읽어 드릴 대답이 아직 없어요."); return true; }
      if (window.JGSay) JGSay.speak(말);
      return true;
    }
    if (/^(멈춰|그만|스톱|정지|그만 읽어|조용히)$/.test(d)) { if (window.JGSay) JGSay.stop(); return true; }
    var 토글 = document.getElementById("speak-toggle");
    if (/^(소리 켜|읽어|목소리 켜|음성 켜|읽어 줘|소리 내|크게 읽어)$/.test(d)) {
      if (토글 && 토글.getAttribute("aria-pressed") !== "true") 토글.click();
      else 대답("이미 소리로 읽어 드리고 있어요.");
      return true;
    }
    if (/^(소리 꺼|목소리 꺼|음성 꺼|읽지 마|소리 끄)/.test(d)) {
      if (토글 && 토글.getAttribute("aria-pressed") === "true") 토글.click();
      if (window.JGSay) JGSay.stop();
      JG.bubble("소리로 읽기를 껐어요.", "bot");
      return true;
    }
    if (/^(글씨|글자)\s*(더\s*)?(크게|키워|크게 해|커지게)/.test(d)) {
      if (window.JGFont) { JGFont.set(Math.min(2, JGFont.level() + 1)); }
      대답("글씨를 크게 했어요."); return true;
    }
    if (/^(글씨|글자)\s*(작게|줄여|보통|원래대로)/.test(d)) {
      if (window.JGFont) { JGFont.set(/보통|원래/.test(d) ? 0 : Math.max(0, JGFont.level() - 1)); }
      대답("글씨를 작게 했어요."); return true;
    }
    if (/^(처음으로|처음부터|다시 시작|새로 시작|처음 화면|초기화|취소)$/.test(d)) {
      shown = [];
      if (JG.reset) JG.reset();
      return true;
    }
    if (/^(119|일일구|구급차|응급차)(\s*(불러|전화|연결|걸어))?/.test(d)) {
      go({ name: "119", tel: "119" }, { act: "call" });
      return true;
    }
    return false;
  }
  // 방금 보여 준 카드에 대한 명령 : 진료시간 / 자세히 / 예약
  function 카드명령(t) {
    var 할일 = /몇\s*시까지|언제까지|진료\s*시간|몇\s*시에\s*(닫|끝)|문\s*(열었|여나|닫)|영업\s*시간|운영\s*시간/.test(t) ? "hours"
      : /예약/.test(t) ? "book"
      : /자세히|정보\s*(보여|알려)|병원\s*보기|상세/.test(t) ? "detail" : null;
    if (!할일 || !shown.length) return false;
    var nth = null;
    for (var j = 0; j < NTH.length; j++) { if (NTH[j][1].test(t)) { nth = NTH[j][0]; break; } }
    // 이름을 말했으면 그 카드
    var 이름 = 이름찾기(t, window.JG.depts || DEFAULT_DEPTS), 고른 = null;
    if (이름) shown.forEach(function (c) { if (!고른 && nameScore(c.name, 이름) <= 4) 고른 = c; });
    // "내과 예약하고 싶어"처럼 진료과·증상을 말하거나 긴 문장이면 새 질문이다 (가로채지 않는다)
    var 가리킴 = /(^|\s)(그|이|저)\s*(병원|약국|의원|곳)|거기|여기|저기/.test(t);
    var 진료과말 = (window.JG.depts || DEFAULT_DEPTS).concat(["소아과", "아파", "아픈", "열이", "기침"])
      .some(function (w) { return t.indexOf(w) >= 0; });
    if (!고른 && nth === null && !가리킴 && (진료과말 || 다듬기(t).replace(/\s/g, "").length > 12)) return false;
    if (nth === null) nth = 0;
    var c = 고른 || shown[nth];
    if (!c) { 대답("방금 보여드린 곳은 " + shown.length + "곳이에요. 몇 번째인지 다시 말씀해 주세요."); return true; }
    if (할일 === "hours") {
      var h = String(c.hours || "");
      대답(c.name + 은는(c.name) + " " + (h && h.indexOf("미확인") < 0 ? h + "까지예요." :
        "진료시간이 공개되지 않았어요. 전화로 확인해 주세요."));
      return true;
    }
    var n = c.__node, b = n && n.querySelector(할일 === "book" ? ".fill" : ".ghost");
    if (b && b.tagName === "BUTTON") { b.click(); return true; }
    대답(할일 === "book" ? "이 곳은 화면에서 예약을 도와드릴 수 없어요. 전화로 문의해 주세요." : "자세한 정보를 열 수 없어요.");
    return true;
  }

  function handle(text, fallback) {
    var JG = window.JG;
    if (!JG) return false;
    if (앱명령(text)) return true;
    if (카드명령(text)) return true;
    var cmd = parse(text, JG.depts || DEFAULT_DEPTS);
    if (!cmd) return false;
    if (cmd.nth === -1) {
      if (!shown.length) return false;          // 보여 준 목록이 없으면 평소 찾기로
      JG.bubble("①번 " + shown[0].name + "(으)로 할게요.", "bot");
      go(shown[0], cmd);
      return true;
    }
    if (cmd.nth !== null) {
      var p = shown[cmd.nth];
      if (p) { go(p, cmd); return true; }
      JG.bubble(shown.length ? "방금 보여드린 곳은 " + shown.length + "곳이에요. 몇 번째인지 다시 말씀해 주세요."
                             : "먼저 병원을 찾아 볼게요. 예) 근처 치과, 감기 걸렸어", "bot");
      return true;
    }
    // 1) 방금 보여준 카드에서 먼저 찾는다
    var best = null, bs = 99;
    shown.forEach(function (x) { var sc = nameScore(x.name, cmd.name); if (sc < bs) { bs = sc; best = x; } });
    if (best && bs <= 4) { go(best, cmd); return true; }
    // 2) 전국 자료에서 이름으로 찾는다 (위치를 알면 가장 가까운 곳)
    if (!JG.findPlace) return false;
    var 진행 = function (이름, 남은) {
      JG.findPlace(이름, cmd.pharmacy, function (list) {
        if ((!list || !list.length) && 남은 > 0 && 이름.length > 4) { 진행(이름.slice(1), 남은 - 1); return; }
        if (list && list.length) {
          var 같은 = list.filter(function (x) { return x.name === list[0].name; }).length;
          if (nameScore(list[0].name, cmd.name) > 1) {
            JG.bubble("‘" + cmd.name + "’ 이름이 들어간 곳 중 " +
                      (JG.pos && JG.pos() ? "가장 가까운 " : "") + "‘" + list[0].name + "’(으)로 찾았어요.", "bot");
            같은 = 1;
          }
          go(list[0], cmd, 같은);
          return;
        }
        if (/(의원|병원|약국|치과|한의원|센터)$/.test(cmd.name)) {
          JG.bubble("‘" + cmd.name + "’을(를) 찾지 못했어요. 이름을 한 번만 다시 말씀해 주세요.", "bot");
        } else if (fallback) { fallback(); }
      });
    };
    if (JG.getPos) JG.getPos(function () { 진행(cmd.name, 3); }); else 진행(cmd.name, 3);
    return true;
  }

  /* 화면에 뜬 버튼 글씨를 말로 읽으면 그 버튼을 누른 것과 같게 한다.
     ("증상으로 찾기" 라고 말하면 __symptom__ 버튼) */
  var lastQuick = [];
  document.addEventListener("jg:quick", function (e) {
    lastQuick = (e.detail && e.detail.items) || [];
  });
  function quickValue(text) {
    var t = String(text || "").replace(/[\s.,!?~📍]/g, "");
    if (!t) return null;
    for (var i = 0; i < lastQuick.length; i++) {
      var q = lastQuick[i] || {};
      var l = String(q.label || "").replace(/[\s.,!?~📍]/g, "");
      if (l && (t === l || t === l + "요" || t === l + "해줘" || t === l + "해주세요")) return q.value;
    }
    return null;
  }

  window.JGCmd = { parse: parse, nameScore: nameScore, modeLabel: MODE_LABEL, handle: handle, app: 앱명령,
                   quickValue: quickValue,
                   _shown: function () { return shown; } };
})();


/* ════════════════════════════════════════════════════════════
   글씨 크기 (2026-10-07 피드백 : 고령자를 위한 글씨 크기 변경)
   '가+' 단추를 누를 때마다 보통 → 크게 → 아주 크게 → 보통.
   고른 크기는 이 기기 브라우저에만 기억한다(다음에 열어도 그대로).
   ════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  var KEY = "jg_font_v1", 이름 = ["보통", "크게", "아주 크게"];
  var lv = 0;
  try { lv = Math.max(0, Math.min(2, +localStorage.getItem(KEY) || 0)); } catch (e) {}
  function apply() {
    var h = document.documentElement;
    h.classList.remove("fs-1", "fs-2");
    if (lv) h.classList.add("fs-" + lv);
    var 버튼 = document.querySelectorAll(".fs-toggle");
    for (var i = 0; i < 버튼.length; i++) {
      버튼[i].setAttribute("aria-label", "글씨 크기 " + 이름[lv] + ". 눌러서 바꾸기");
      버튼[i].title = "글씨 크기 : " + 이름[lv];
      var l = 버튼[i].querySelector(".fs-label");
      if (l) l.textContent = ["글씨 크게", "글씨 더 크게", "글씨 보통으로"][lv];
    }
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest(".fs-toggle");
    if (!b) return;
    lv = (lv + 1) % 3;
    try { localStorage.setItem(KEY, String(lv)); } catch (err) {}
    apply();
  });
  apply();
  window.JGFont = { level: function () { return lv; },
                    set: function (n) { lv = Math.max(0, Math.min(2, n)); try { localStorage.setItem(KEY, String(lv)); } catch (e) {} apply(); } };
})();

/* ════════════════════════════════════════════════════════════
   읽어주기 목소리 (2026-10-07 영훈 : "무슨 말인지 하나도 안 들리고 목소리도 별로")

   고친 것
   1) 목소리 고르기 : 한국어 목소리 중 '첫 번째'가 아니라 가장 자연스러운 것을 고른다.
      엣지의 신경망 목소리(…Online (Natural)) > 구글 목소리(크롬·안드로이드)
      > 아이폰 '향상된' 목소리 > 그 밖. 윈도우 기본 '해미'는 기계음이 강해 뒤로 둔다.
      목소리 목록은 늦게 오는 일이 많아 올 때까지 잠깐 기다린다(최대 1.2초).
      기다리지 않으면 한국어가 아닌 목소리로 읽혀 알아들을 수 없게 된다.
   2) 기호를 말로 : '09:00~18:00' → '오전 9시부터 오후 6시까지', '0.42km' → '약 420미터',
      '·' → 쉼표, '119' → '일일구', 따옴표·그림문자는 읽지 않는다.
   3) 문장마다 끊어 읽는다 : 크롬은 긴 글을 한 번에 읽다 중간에 멈추는 일이 있다.
   4) 속도 : 보통 0.9배, 글씨를 크게 쓰는 분(어르신)께는 0.8배로 더 천천히.
   5) 말풍선을 누르면 그 말을 다시 읽는다 (놓친 말을 다시 듣기).
   ════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) { window.JGSay = null; return; }
  var S = window.speechSynthesis, chosen = null, token = 0, onstate = null;

  function score(v) {
    var n = (v.name || "") + " " + (v.voiceURI || ""), s = 0;
    if (/natural|neural|online/i.test(n)) s += 50;
    if (/google/i.test(n)) s += 40;
    if (/premium|enhanced|향상|고품질/i.test(n)) s += 35;
    if (/yuna|유나|sora|sunhi|선희|injoon|인준/i.test(n)) s += 10;
    if (/heami|해미/i.test(n)) s -= 10;
    if (/ko[-_]?kr/i.test(v.lang || "")) s += 3;
    return s;
  }
  function pick() {
    var vs = S.getVoices().filter(function (v) { return /^ko/i.test(v.lang || ""); });
    if (!vs.length) return null;
    vs.sort(function (a, b) { return score(b) - score(a); });
    return vs[0];
  }
  function ready(cb) {
    chosen = chosen || pick();
    if (chosen) { cb(); return; }
    var done = false;
    var t = setTimeout(function () { if (!done) { done = true; chosen = pick(); cb(); } }, 1200);
    var h = function () {
      if (done) return;
      chosen = pick();
      if (chosen) { done = true; clearTimeout(t); cb(); }
    };
    if (S.addEventListener) S.addEventListener("voiceschanged", h); else S.onvoiceschanged = h;
  }
  try { S.getVoices(); } catch (e) {}   // 목록을 미리 불러 둔다

  var 세는말 = ["", "한", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉", "열"];
  function 시각(h, m) {
    h = +h; m = +m;
    var 앞 = h === 0 ? "밤 12시" : h < 12 ? "오전 " + h + "시" : h === 12 ? "낮 12시"
          : h === 24 ? "밤 12시" : (h > 24 ? "다음 날 " + (h - 24) + "시" : "오후 " + (h - 12) + "시");
    return 앞 + (m ? " " + m + "분" : "");
  }
  function normalize(text) {
    var t = String(text || "");
    t = t.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "");
    // 뒤에 이미 '까지'가 있으면 붙이지 않는다 ("18:30까지예요" 가 "까지까지예요" 로 읽히던 문제, 2026-10-07)
    t = t.replace(/(\d{1,2}):(\d{2})\s*[~\-–]\s*(\d{1,2}):(\d{2})(까지)?/g, function (a, h1, m1, h2, m2) {
      return 시각(h1, m1) + "부터 " + 시각(h2, m2) + "까지";
    });
    t = t.replace(/(\d{1,2}):(\d{2})/g, function (a, h, m) { return 시각(h, m); });
    t = t.replace(/(\d+(?:\.\d+)?)\s*km/gi, function (a, n) {
      var km = parseFloat(n);
      if (km < 1) return "약 " + Math.round(km * 100) * 10 + "미터";
      return "약 " + (Math.round(km * 10) / 10) + "킬로미터";
    });
    t = t.replace(/(\d+)\s*(곳|개|명)/g, function (a, n, u) {
      n = +n; return n >= 1 && n <= 10 ? 세는말[n] + " " + u : a;
    });
    // 전화번호는 한 자리씩 ("062-676-5075" 를 "육백칠십육"처럼 읽지 않게)
    t = t.replace(/(0\d{1,2})-(\d{3,4})-(\d{4})/g, function (a) {
      return a.split("").map(function (ch) {
        return ch === "-" ? ", " : "공일이삼사오육칠팔구".charAt(+ch);
      }).join("");
    });
    t = t.replace(/119/g, "일일구");
    t = t.replace(/[“”"‘’'«»「」]/g, "");
    // 괄호 안 말은 따로 한 문장으로 읽는다 ("다섯 곳이에요. (전체 174곳 중)" → "…이에요. 전체 174곳 중.")
    // 짧은 괄호 말은 쉼표로 이어 읽고 ("외과(항문)나" → "외과, 항문, 나" 대신 "외과 항문이나"),
    // 긴 괄호 말만 따로 한 문장으로 읽는다 ("(전체 174곳 중 가까운 순)")
    t = t.replace(/\s*[(\[]([^)\]]*)[)\]]\s*(이나|나|에서|은|는|이|가|을|를|와|과|도)?/g, function (a, x, 조사) {
      x = x.trim();
      if (!x) return 조사 ? 조사 + " " : " ";
      if (x.length <= 6 && !/\d{3}/.test(x)) {
        var 받침 = (x.charCodeAt(x.length - 1) - 0xac00) % 28 !== 0;
        if (조사 === "나" || 조사 === "이나") 조사 = 받침 ? "이나" : "나";
        return " " + x + (조사 || "") + " ";
      }
      return ". " + x + ". " + (조사 || "");
    });
    t = t.replace(/[·•|/]/g, ", ").replace(/~/g, "에서 ");
    t = t.replace(/([.!?])\s*[.,]+/g, "$1").replace(/^\s*[.,]\s*/, "");
    t = t.replace(/\s*,\s*(,\s*)+/g, ", ").replace(/\s+,/g, ",").replace(/\s+/g, " ")
         .replace(/^,\s*|,\s*$/g, "").trim();
    return t;
  }
  function sentences(t) {
    var out = [];
    t.split(/(?<=[.!?])\s+/).forEach(function (s) {
      s = s.trim();
      // 너무 긴 문장은 쉼표에서 한 번 더 나눈다 (한 번에 들을 수 있는 길이로)
      while (s.length > 70 && s.indexOf(", ", 25) > 0) {
        var i = s.indexOf(", ", 25);
        out.push(s.slice(0, i)); s = s.slice(i + 2).trim();
      }
      if (s) out.push(s);
    });
    return out;
  }
  function rate() {
    var lv = window.JGFont ? window.JGFont.level() : 0;
    return lv >= 1 ? 0.8 : 0.9;
  }
  /* 서버판은 일레븐랩스 'Alice · v4' 목소리로 읽는다 (2026-10-07 영훈이 휴대폰 비교에서 고름).
     키는 서버에만 있고 화면은 소리(mp3)만 받는다. 실패하면 이 기기 목소리로 바로 넘어간다.
     공개판(깃허브)은 서버가 없어 이 기기 목소리를 그대로 쓴다. */
  var 소리 = null, 원격꺼짐 = false;
  function 원격가능() { return !!(window.JG && window.JG.server) && !원격꺼짐 && window.Audio; }

  function stop() {
    token++;
    try { S.cancel(); } catch (e) {}
    if (소리) { try { 소리.pause(); } catch (e) {} 소리 = null; }
    if (onstate) { var f = onstate; onstate = null; f(false); }
  }
  function speak(text, stateCb) {
    stop();
    var my = token, said = normalize(text), parts = sentences(said);
    if (!parts.length) return;
    onstate = stateCb || null;
    if (원격가능()) {
      var a = new Audio("/api/tts/say?speed=" + (rate() < 0.9 ? 0.8 : 0.9) + "&text=" + encodeURIComponent(said));
      소리 = a;
      var 대신 = function () {
        if (my !== token) return;
        원격꺼짐 = true;                       // 한 번 실패하면 이번 화면에서는 이 기기 목소리로
        setTimeout(function () { 원격꺼짐 = false; }, 60000);   // 1분 뒤 다시 시도
        소리 = null; 기기로(my, parts);
      };
      a.onerror = 대신;
      // 8초 안에 소리가 나지 않으면(인터넷이 느리거나 막힘) 이 기기 목소리로 넘어간다
      var 시작됨 = false;
      setTimeout(function () {
        if (!시작됨 && my === token && 소리 === a) { try { a.pause(); } catch (e) {} 대신(); }
      }, 8000);
      a.onplaying = function () { 시작됨 = true; if (my === token && onstate) onstate(true); };
      a.onended = function () { if (my === token && onstate) { var f = onstate; onstate = null; f(false); } };
      var p = a.play();
      if (p && p.catch) p.catch(대신);       // 자동 재생이 막혀도 이 기기 목소리로
      return;
    }
    기기로(my, parts);
  }
  function 기기로(my, parts) {
    ready(function () {
      if (my !== token) return;
      // 안드로이드 크롬은 멈추기(cancel) 바로 뒤의 첫 말을 흘리는 일이 있어 잠깐 쉰다
      setTimeout(function () {
        if (my !== token) return;
        if (onstate) onstate(true);
        parts.forEach(function (p, i) {
          var u = new SpeechSynthesisUtterance(p);
          u.lang = "ko-KR";
          if (chosen) u.voice = chosen;
          u.rate = rate(); u.pitch = 1; u.volume = 1;
          if (i === parts.length - 1) {
            u.onend = u.onerror = function () {
              if (my === token && onstate) { var f = onstate; onstate = null; f(false); }
            };
          }
          S.speak(u);
        });
      }, 80);
    });
  }

  // 말풍선을 누르면 그 말을 다시 읽어 준다 (읽어주기를 켜지 않았어도, 누른 것은 읽는다)
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest(".row.bot .bubble");
    if (!b) return;
    speak(b.textContent);
  });

  window.JGSay = { speak: speak, stop: stop, normalize: normalize,
                   voiceName: function () { return 원격가능() ? "일레븐랩스 Alice" : (chosen ? chosen.name : null); } };
})();

/* ════════════════════════════════════════════════════════════
   번호와 순서 안내 (2026-10-07 영훈 : "1번부터 3번까지 거리순으로 나왔다는 식으로,
   고령층이 잘 알아볼 수 있게 맨 아래에 설명 문구")

   JGOrder.mark(카드요소들, { order: "distance"|"rating"|"specialist", kind: "병원"|"약국", from: "현재 위치" })
     · 카드 이름 앞에 ①②③ 큰 번호를 붙이고
     · 목록 맨 아래에 어떤 순서인지 한 줄로 알려 준다.
   순서 자체는 위젯이 그리기 전에 맞춰 둔다(거리순이면 가까운 곳이 ①번).
   ════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  var 동그라미 = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];
  function mark(nodes, opt) {
    var JG = window.JG;
    nodes = (nodes || []).filter(Boolean);
    if (!JG || !nodes.length) return;
    opt = opt || {};
    nodes.forEach(function (n, i) {
      var top = n.querySelector(".top") || n;
      var b = document.createElement("span");
      b.className = "jg-num";
      b.textContent = String(i + 1);
      b.setAttribute("aria-label", (i + 1) + "번");
      top.insertBefore(b, top.firstChild);
    });
    var 끝 = 동그라미[Math.min(nodes.length, 10) - 1];
    var 줄 = 동그라미.slice(0, Math.min(nodes.length, 10)).join(" → ");
    var 무엇 = opt.kind || "병원";
    var 말;
    if (nodes.length === 1) {
      말 = "찾은 " + 무엇 + "은 한 곳이에요.";
    } else if (opt.order === "rating") {
      말 = "①번이 정부 평가 등급이 가장 좋은 " + 무엇 + "이에요. " + 줄 + " 순서예요.";
    } else if (opt.order === "specialist") {
      말 = "①번이 전문의가 가장 많은 " + 무엇 + "이에요. " + 줄 + " 순서예요.";
    } else {
      말 = "①번이 가장 가까운 " + 무엇 + "이에요. " + 줄 + " 순서로 멀어져요.";
    }
    if (opt.from && opt.order !== "rating" && opt.order !== "specialist" && nodes.length > 1) {
      말 += " (거리는 " + opt.from + " 기준)";
    }
    var note = JG.node('<div class="jg-order"></div>');
    note.textContent = 말;
    var last = nodes[nodes.length - 1];
    if (last.nextSibling) last.parentNode.insertBefore(note, last.nextSibling);
    else last.parentNode.appendChild(note);
  }
  window.JGOrder = { mark: mark };
})();
