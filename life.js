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
    if (!card || !n) return;
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
        '<div>말소리는 이 브라우저를 만든 회사(예: 크롬은 Google)의 서버에서 글자로 바뀔 수 있어요. ' +
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
