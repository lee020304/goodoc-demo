/*
  공유용 위젯 스크립트.

  서버가 없는 환경에서 도는 판이다.
  조건 추출 규칙(사전)은 파이썬에서 그대로 넘겨받아 쓰므로,
  실제 서비스와 판단 기준이 갈라지지 않는다.
*/
(function () {
  "use strict";

  // 전국 데이터(18.6MB)는 HTML 에 넣지 않고 따로 받아 온다.
  // 먼저 받아 둔 것이 있으면 그것을 쓰고, 없으면 예전처럼 HTML 안에서 읽는다.
  var DATA = window.__HOSP_DATA__ ||
    JSON.parse(document.getElementById("hospital-data").textContent);
  var R = JSON.parse(document.getElementById("rule-data").textContent);
  var HOSP = DATA.hospitals;
  var WEEK = ["월", "화", "수", "목", "금", "토", "일"];

  var el = {
    fab: document.getElementById("fab"),
    panel: document.getElementById("panel"),
    close: document.getElementById("close"),
    log: document.getElementById("log"),
    form: document.getElementById("composer"),
    input: document.getElementById("input"),
    send: document.getElementById("send"),
    assistant: document.getElementById("assistant"),
    siteForm: document.getElementById("site-search"),
    siteInput: document.getElementById("site-search-input"),
    nearby: document.getElementById("nearby-grid"),
    areaPick: document.getElementById("area-pick"),
    areaName: document.getElementById("area-name"),
    areaHere: document.getElementById("area-here"),
    distFrom: document.getElementById("dist-from"),
    mic: document.getElementById("mic"),
    voiceBar: document.getElementById("voice-bar"),
    voiceMsg: document.getElementById("voice-msg"),
    voiceStop: document.getElementById("voice-stop"),
    speakToggle: document.getElementById("speak-toggle")
  };

  var PHARM = window.__PHARM_DATA__ || [];

  var pending = "";
  var lastCards = {};

  /* ── 지역 사전: 데이터에서 만든다 ── */
  /* ── 지역 사전 ──
     파이썬 region_index 가 만든 표기 사전을 통째로 받아 쓴다.
     ('경기도 광주', '경기광주', '분당', '판교' 같은 표기를 모두 알아본다) */
  var REG = R.regions || null;
  var NICKMAP = (REG && REG.nick) || {};
  var FORMS = (REG && REG.forms) || null;
  var SIZE = (REG && REG.size) || {};
  var SIDO_DISPLAY = (REG && REG.display) || {};
  var SIDO_LIST = (REG && REG.sido) || {};

  var METRO = ["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종"];

  function metroBody(sggu) {
    for (var i = 0; i < METRO.length; i++) {
      var pre = METRO[i];
      if (sggu.indexOf(pre) === 0 && sggu.length > pre.length + 1) {
        return sggu.slice(pre.length);
      }
    }
    return sggu;
  }

  function displayName(sggu) {
    if (!sggu) return "";
    if (sggu.indexOf("__CITY__") === 0) return sggu.slice(8) + "시";
    var body = metroBody(sggu);
    if (body !== sggu) return sggu.slice(0, sggu.length - body.length) + " " + body;
    var m = /^(.{2,}?)(.+구)$/.exec(sggu);
    if (m) return m[1] + "시 " + m[2];
    return sggu;
  }

  // 예전 코드가 쓰던 모양을 유지한다
  var DISTRICTS = { map: {}, sido: SIDO_LIST };
  if (FORMS) {
    Object.keys(FORMS).forEach(function (k) {
      var first = FORMS[k][0];
      if (first && first[1] && first[1].indexOf("__CITY__") !== 0) {
        DISTRICTS.map[k] = first[1];
      }
    });
  }

  // 파이썬 resolve_detail 과 같은 규칙
  function resolveRegion(flat) {
    var empty = { region: null, ambiguous: false, matched: "", candidates: [] };
    if (!FORMS || !flat) return empty;

    var nicks = Object.keys(NICKMAP);
    for (var n = 0; n < nicks.length; n++) {
      if (flat.indexOf(nicks[n]) >= 0 && DISTRICTS.map[NICKMAP[nicks[n]]]) {
        return { region: NICKMAP[nicks[n]], ambiguous: false,
                 matched: nicks[n], candidates: [] };
      }
    }

    var hitsList = [];
    Object.keys(FORMS).forEach(function (name) {
      if (flat.indexOf(name) >= 0) hitsList.push(name);
    });
    if (!hitsList.length) return empty;

    // 한 곳만 가리키는 표기 우선 → 구까지 특정하는 것 우선 → 긴 것 우선
    hitsList.sort(function (a, b) {
      var ha = FORMS[a], hb = FORMS[b];
      var oa = ha.length === 1 ? 1 : 0, ob = hb.length === 1 ? 1 : 0;
      if (oa !== ob) return ob - oa;
      var ga = (ha.length === 1 && ha[0][1] && ha[0][1].indexOf("__CITY__") !== 0) ? 1 : 0;
      var gb = (hb.length === 1 && hb[0][1] && hb[0][1].indexOf("__CITY__") !== 0) ? 1 : 0;
      if (ga !== gb) return gb - ga;
      return b.length - a.length;
    });

    var name = hitsList[0], hits = FORMS[name];

    if (hits.length === 1) {
      var sg = hits[0][1] || null;
      if (sg && sg.indexOf("__CITY__") === 0) sg = sg.slice(8);
      return { region: sg || hits[0][0], ambiguous: false,
               matched: name, candidates: [] };
    }

    // 시도와 그 시도 안의 시군구가 겹치면(제주/제주시) 시도 전체로 본다
    var sidoOnly = hits.filter(function (h) { return !h[1]; });
    if (sidoOnly.length === 1) {
      var only = sidoOnly[0][0];
      var allSame = hits.every(function (h) { return h[0] === only; });
      if (allSame) {
        return { region: only, ambiguous: false, matched: name, candidates: [] };
      }
    }

    hits = hits.slice().sort(function (a, b) {
      return (SIZE[b[0] + "|" + b[1]] || 0) - (SIZE[a[0] + "|" + a[1]] || 0);
    });

    var cands = hits.map(function (h) {
      var sd = h[0], sg2 = h[1] || null;
      var sdName = SIDO_DISPLAY[sd] || sd;
      var label;
      if (sg2) {
        var nm = displayName(sg2);
        label = nm.indexOf(" ") >= 0 ? nm : (sdName + " " + nm);
      } else {
        label = sdName;
      }
      var pick = sg2 || "";
      if (pick.indexOf("__CITY__") === 0) pick = pick.slice(8);
      return { label: label, value: "__REGION__" + sd + "|" + pick };
    });
    return { region: null, ambiguous: true, matched: name, candidates: cands };
  }

  var NICK = {
    "상무": "광주서구", "치평": "광주서구", "화정": "광주서구",
    "봉선": "광주남구", "진월": "광주남구",
    "용봉": "광주북구", "일곡": "광주북구", "문흥": "광주북구", "두암": "광주북구",
    "수완": "광주광산구", "첨단": "광주광산구", "하남": "광주광산구",
    "송정": "광주광산구", "신가": "광주광산구"
  };

  /* ── 증상 -> 진료과 (파이썬 match_symptom 과 같은 규칙) ──
     1) 응급·소아가 먼저
     2) 애매한 표현('목','어지','가슴')은 함께 쓰인 말로 가리고, 못 가리면 되묻기
     3) 그 밖에는 '가장 긴 표현'을 따른다
        (길이로 보지 않으면 '목감기'가 '감기'에 걸려 내과로 간다) */
  function matchSymptom(t) {
    var S = R.symptoms || {};
    var A = R.ambiguous || {};

    var first = ["응급의학과", "소아청소년과"];
    for (var i = 0; i < first.length; i++) {
      var ws = S[first[i]] || [];
      for (var j = 0; j < ws.length; j++) {
        if (t.indexOf(ws[j]) >= 0) return { dept: first[i], ask: null };
      }
    }

    var keys = Object.keys(A);
    for (var k = 0; k < keys.length; k++) {
      if (t.indexOf(keys[k]) < 0) continue;
      var spec = A[keys[k]];
      var decided = null;
      Object.keys(spec.decide || {}).forEach(function (dept) {
        if (decided) return;
        var clues = spec.decide[dept];
        for (var m = 0; m < clues.length; m++) {
          if (t.indexOf(clues[m]) >= 0) { decided = dept; return; }
        }
      });
      if (decided) return { dept: decided, ask: null };
      return { dept: null, ask: spec };
    }

    var best = null, bestLen = 0;
    Object.keys(S).forEach(function (dept) {
      if (first.indexOf(dept) >= 0) return;
      S[dept].forEach(function (w) {
        if (t.indexOf(w) >= 0 && w.length > bestLen) {
          best = dept; bestLen = w.length;
        }
      });
    });
    return { dept: best, ask: null };
  }

  /* ── 조건 추출 (파이썬 규칙 이식) ── */
  function extract(text) {
    var t = String(text || "");
    var c = {
      dept: null, region: null, parking: false, sunday: false,
      saturday: false, night: false, openNow: false, openUntil: null,
      specialist: false, rating: false, ambiguous: false
    };

    // 진료과 직접 언급
    var byLen = R.departments.slice().sort(function (a, b) { return b.length - a.length; });
    for (var i = 0; i < byLen.length; i++) {
      if (t.indexOf(byLen[i]) >= 0) { c.dept = byLen[i]; break; }
    }
    if (!c.dept) {
      var al = Object.keys(R.aliases).sort(function (a, b) { return b.length - a.length; });
      for (var j = 0; j < al.length; j++) {
        if (t.indexOf(al[j]) >= 0) { c.dept = R.aliases[al[j]]; break; }
      }
    }
    // 증상 -> 진료과. 파이썬 match_symptom 과 같은 규칙을 쓴다.
    if (!c.dept) {
      var got2 = matchSymptom(t);
      c.dept = got2.dept;
      c.symptomChoice = got2.ask;
    }

    // 지역
    var flat = t.replace(/\s/g, "");
    var got = resolveRegion(flat);
    c.region = got.region;
    c.ambiguous = got.ambiguous;
    c.candidates = got.candidates || [];
    c.matched = got.matched || "";

    var has = function (list) {
      return list.some(function (x) { return t.indexOf(x) >= 0; });
    };
    if (has(R.parking)) c.parking = true;
    if (has(R.specialist)) c.specialist = true;
    if (has(R.rating)) c.rating = true;
    if (has(["일요일", "일욜", "주말", "공휴일", "휴일"])) c.sunday = true;
    if (has(["토요일", "토욜", "주말"])) c.saturday = true;
    if (has(["야간", "밤에", "새벽", "심야", "24시", "응급"])) c.night = true;
    if (has(["지금", "문 연", "문연", "여는", "열린", "열려",
             "오늘 진료", "오늘 하는", "당장", "바로"])) c.openNow = true;

    var hm = t.match(/(\d{1,2})\s*시/);
    if (hm) {
      var hour = parseInt(hm[1], 10);
      if (hour <= 11 && has(["저녁", "오후", "밤", "퇴근"])) hour += 12;
      if (hour >= 6 && hour <= 23) c.openUntil = hour * 60;
    }
    return c;
  }

  function isDiagnosisAsk(t) {
    return ["인가요", "일까요", "인지", "맞나요", "무슨 병", "병명", "진단",
            "가능성", "인 것 같", "일까", "인가"]
      .some(function (k) { return String(t).indexOf(k) >= 0; });
  }

  /* ── 검색 ── */
  function todayHours(h) {
    var day = WEEK[(new Date()).getDay() === 0 ? 6 : (new Date()).getDay() - 1];
    if (day === "일") {
      if (String(h.sun || "").indexOf("휴진") >= 0) return { open: false, text: "오늘 휴진" };
      return { open: null, text: "일요일 진료 미확인" };
    }
    var txt = h.h && h.h[day];
    if (!txt) return { open: null, text: "진료시간 미확인" };
    return { open: true, text: "오늘 " + txt };
  }

  function openNowCheck(h) {
    var now = new Date();
    var day = WEEK[now.getDay() === 0 ? 6 : now.getDay() - 1];
    var txt = h.h && h.h[day];
    if (!txt || txt.indexOf("~") < 0) return false;
    var p = txt.split("~");
    var a = p[0].split(":"), b = p[1].split(":");
    var cur = now.getHours() * 60 + now.getMinutes();
    return (+a[0] * 60 + +a[1]) <= cur && cur <= (+b[0] * 60 + +b[1]);
  }

  function dist(lat1, lon1, lat2, lon2) {
    var R2 = 6371, rad = Math.PI / 180;
    var dp = (lat2 - lat1) * rad, dl = (lon2 - lon1) * rad;
    var a = Math.sin(dp / 2) * Math.sin(dp / 2) +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return R2 * 2 * Math.asin(Math.sqrt(a));
  }

  var NON_OUTPATIENT = ["요양병원", "정신병원", "보건소", "보건지소",
                        "보건진료소", "조산원"];
  // 한방·치과 계열. 한방병원도 '내과'를 가지고 있어 그냥 두면 앞에 나온다.
  var ORIENTAL = ["한방병원", "한의원"];
  var DENTAL = ["치과병원", "치과의원"];

  function deptFamily(dept) {
    if (!dept) return "일반";
    if (dept.indexOf("한방") === 0) return "한방";
    if (dept.indexOf("치과") === 0) return "치과";
    return "일반";
  }
  function clinicFit(cl, family) {
    if (family === "한방") return ORIENTAL.indexOf(cl) >= 0 ? 0 : 1;
    if (family === "치과") return DENTAL.indexOf(cl) >= 0 ? 0 : 1;
    return (ORIENTAL.indexOf(cl) >= 0 || DENTAL.indexOf(cl) >= 0) ? 1 : 0;
  }

  // 지역 이름 하나로 걸러 낸다. 파이썬 filter_region 과 같은 순서로 넓힌다.
  //   1) 시군구 정확히  2) 시도 정확히  3) 시군구 앞부분  4) 시도 앞부분
  function filterRegion(rows, name) {
    var hit = rows.filter(function (h) { return h.g === name; });
    if (hit.length) return hit;
    hit = rows.filter(function (h) { return h.sd === name; });
    if (hit.length) return hit;

    var base = name, sufs = ["특별자치시", "특별자치도", "광역시", "특별시", "시", "군", "구"];
    for (var i = 0; i < sufs.length; i++) {
      if (base.length > sufs[i].length + 1 &&
          base.slice(-sufs[i].length) === sufs[i]) {
        base = base.slice(0, -sufs[i].length);
        break;
      }
    }
    if (base.length >= 2) {
      hit = rows.filter(function (h) { return h.g.indexOf(base) === 0; });
      if (hit.length) return hit;
      hit = rows.filter(function (h) { return h.sd && h.sd.indexOf(base) === 0; });
      if (hit.length) return hit;
    }
    return [];
  }

  function hasHours(h) {
    if (!h.h) return false;
    return ["월", "화", "수", "목", "금", "토"].some(function (d) { return h.h[d]; });
  }

  function search(c) {
    var res = HOSP.slice();
    var skipped = [];

    if (c.region) res = filterRegion(res, c.region);
    if (c.dept) res = res.filter(function (h) { return h.d.indexOf(c.dept) >= 0; });
    res = res.filter(function (h) { return NON_OUTPATIENT.indexOf(h.c) < 0; });
    if (c.specialist) res = res.filter(function (h) { return h.s >= 3; });

    // 시간·주차 조건은 '거르기'가 아니라 '확인 / 미확인 / 제외'로 나눈다.
    // 전국 병원 중 진료시간이 등록된 곳은 8.6% 뿐이라, 그냥 거르면 대부분 0건이 된다.
    // (판정: true 만족 / false 불만족 / null 정보 없음)
    var checks = [];
    if (c.parking) {
      checks.push(["주차 가능", function (h) {
        return h.p == null ? null : h.p > 0;
      }]);
    }
    if (c.sunday) {
      checks.push(["일요일 진료", function (h) {
        if (!h.sun || h.sun === "미확인") return null;
        return String(h.sun).indexOf("휴진") < 0;
      }]);
    }
    if (c.saturday) {
      checks.push(["토요일 진료", function (h) {
        return hasHours(h) ? !!(h.h && h.h["토"]) : null;
      }]);
    }
    if (c.openNow) {
      checks.push(["지금 진료중", function (h) {
        return hasHours(h) ? openNowCheck(h) : null;
      }]);
    }
    if (c.openUntil) {
      checks.push([Math.floor(c.openUntil / 60) + "시 이후 진료", function (h) {
        if (!h.h) return null;
        var found = null;
        ["월", "화", "수", "목", "금"].forEach(function (d) {
          var t = h.h[d];
          if (!t || t.indexOf("~") < 0) return;
          var e = t.split("~")[1].split(":");
          if (found !== true) found = (+e[0] * 60 + +e[1]) >= c.openUntil;
        });
        return found;
      }]);
    }
    if (c.night) skipped.push("야간 응급(공유본에서는 조회 불가)");
    if (c.rating) skipped.push("이용자 별점(공개 데이터에 없음)");

    var confirmed = 0, unconfirmed = 0;
    if (checks.length) {
      res = res.filter(function (h) {
        var verdicts = checks.map(function (x) { return x[1](h); });
        if (verdicts.some(function (v) { return v === false; })) return false;
        h._mark = verdicts.some(function (v) { return v == null; })
          ? "미확인" : "확인됨";
        return true;
      });
      res.forEach(function (h) {
        if (h._mark === "확인됨") confirmed++; else unconfirmed++;
      });
    } else {
      res.forEach(function (h) { h._mark = "해당없음"; });
    }

    if (!res.length) {
      return { rows: [], skipped: skipped, confirmed: 0, unconfirmed: 0,
               conditions: checks.map(function (x) { return x[0]; }) };
    }

    var lat = res.map(function (h) { return h.y; }).sort()[Math.floor(res.length / 2)];
    var lon = res.map(function (h) { return h.x; }).sort()[Math.floor(res.length / 2)];
    res.forEach(function (h) { h._km = Math.round(dist(lat, lon, h.y, h.x) * 100) / 100; });

    // 확인된 곳 먼저, 그다음 찾는 계열과 맞는 기관 먼저
    var family = deptFamily(c.dept);
    res.forEach(function (h) {
      h._ok = h._mark === "미확인" ? 1 : 0;
      h._fit = clinicFit(h.c, family);
    });

    res.sort(function (a, b) {
      if (a._ok !== b._ok) return a._ok - b._ok;
      if (a._fit !== b._fit) return a._fit - b._fit;
      if (c.rating) {
        var ga = a.gr == null ? 99 : a.gr, gb = b.gr == null ? 99 : b.gr;
        if (ga !== gb) return ga - gb;
      } else if (c.specialist) {
        if (a.s !== b.s) return b.s - a.s;
      } else if (c.dept) {
        var core = c.dept.replace("과", "");
        var ma = a.n.indexOf(core) >= 0 ? 0 : 1, mb = b.n.indexOf(core) >= 0 ? 0 : 1;
        if (ma !== mb) return ma - mb;
      }
      return a._km - b._km;
    });

    return {
      rows: res.slice(0, 3), skipped: skipped,
      confirmed: confirmed, unconfirmed: unconfirmed,
      conditions: checks.map(function (x) { return x[0]; })
    };
  }

  /* ── 화면 ── */
  /* ══════════════════════════════════════════════════════════
     음성 — 말로 묻고, 목소리로 답한다

     이 화면은 서버 없이 브라우저만으로 돈다.
     음성도 마찬가지로 브라우저에 이미 들어 있는 기능(Web Speech API)만 쓴다.
     2026-09-15 확인 — 크롬 152에서 ko-KR 인식과 한국어 목소리가 모두 동작했다.

     서버본(src/api/static/widget.js)은 답을 한 덩어리로 받아 한 번에 읽지만,
     이 화면은 말풍선과 카드를 순서대로 그린다.
     그래서 그려지는 것을 잠깐 모아 두었다가 한 번에 읽는다.
     ══════════════════════════════════════════════════════════ */
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var voice = { rec: null, listening: false, speakOn: false, lastFinal: "" };
  var 읽을거리 = [], 읽기타이머 = null, 읽은카드수 = 0;

  function loadSpeakPref() {
    try { return localStorage.getItem("goodoc_speak") === "1"; } catch (e) { return false; }
  }
  function saveSpeakPref(on) {
    try { localStorage.setItem("goodoc_speak", on ? "1" : "0"); } catch (e) {}
  }

  /* "08:30~17:00" 을 "오전 8시 30분부터 오후 5시까지" 로 바꾼다.
     그냥 읽히면 "공팔 삼십 물결 십칠 공공" 처럼 들려서 알아듣기 어렵다. */
  function sayTime(hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
    if (!m) return null;
    var h = parseInt(m[1], 10), min = parseInt(m[2], 10);
    if (h > 24 || min > 59) return null;
    var 낮밤 = h < 12 ? "오전 " : (h < 18 ? "오후 " : "저녁 ");
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    return 낮밤 + h12 + "시" + (min ? " " + min + "분" : "");
  }
  function 분으로(hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }
  function sayHours(text) {
    var s = String(text || "").trim();
    if (!s) return "";
    var m = /(\d{1,2}:\d{2})\s*[~\-–]\s*(\d{1,2}:\d{2})/.exec(s);
    if (!m) return s;
    var a = sayTime(m[1]), b = sayTime(m[2]);
    if (!a || !b) return s;
    var 앞 = s.slice(0, m.index).trim();
    /* 끝나는 시각이 시작보다 이른 자료가 섞여 있다(예: 08:30~06:00).
       밤을 넘겨 보는 곳인지 잘못 신고된 것인지 알 수 없으므로
       숫자는 그대로 두고 '다음 날' 만 붙인다. 고쳐 읽으면 없는 사실을 만드는 셈이다. */
    var 시작 = 분으로(m[1]), 끝 = 분으로(m[2]);
    if (시작 !== null && 끝 !== null && 끝 <= 시작) b = "다음 날 " + b;
    return (앞 ? 앞 + " " : "") + a + "부터 " + b + "까지";
  }

  function stopSpeaking() {
    if (!window.speechSynthesis) return;
    try { speechSynthesis.cancel(); } catch (e) {}
    if (el.speakToggle) el.speakToggle.classList.remove("talking");
  }

  /* 그려지는 것을 모았다가 잠깐 뒤 한 번에 읽는다.
     말풍선마다 따로 읽으면 말이 뚝뚝 끊긴다. */
  function 읽기예약(문장) {
    if (!voice.speakOn) return;
    var t = String(문장 || "").trim();
    if (t) 읽을거리.push(t);
    clearTimeout(읽기타이머);
    읽기타이머 = setTimeout(읽기실행, 420);
  }
  function 읽기실행() {
    var t = 읽을거리.join(" ");
    읽을거리 = []; 읽은카드수 = 0;
    if (!t || !voice.speakOn || !window.speechSynthesis) return;
    stopSpeaking();
    var u = new SpeechSynthesisUtterance(t);
    u.lang = "ko-KR";
    u.rate = 0.95;                        // 어르신이 듣기 편하도록 조금 천천히
    var ko = speechSynthesis.getVoices().filter(function (v) {
      return v.lang && v.lang.indexOf("ko") === 0;
    });
    if (ko.length) u.voice = ko[0];
    if (el.speakToggle) el.speakToggle.classList.add("talking");
    u.onend = u.onerror = function () {
      if (el.speakToggle) el.speakToggle.classList.remove("talking");
    };
    speechSynthesis.speak(u);
  }

  /* 카드는 앞의 3곳까지만 읽는다. 전부 읽으면 너무 길다. */
  function 카드읽기(이름, 상태, 시간, 거리) {
    if (!voice.speakOn) return;
    읽은카드수 += 1;
    if (읽은카드수 > 3) return;
    var t = 읽은카드수 + "번째, " + 이름 + ".";
    if (상태) t += " " + 상태;
    if (시간) t += " " + sayHours(시간) + ".";
    if (거리) t += " " + 거리 + " 킬로미터.";
    읽기예약(t);
  }

  function setSpeak(on, 알릴까) {
    voice.speakOn = !!on;
    saveSpeakPref(voice.speakOn);
    if (el.speakToggle) {
      el.speakToggle.setAttribute("aria-pressed", voice.speakOn ? "true" : "false");
      el.speakToggle.setAttribute(
        "aria-label", voice.speakOn ? "답변 읽어주기 끄기" : "답변 읽어주기 켜기");
    }
    if (!voice.speakOn) { stopSpeaking(); 읽을거리 = []; }
    else if (알릴까) 읽기예약("이제 답변을 읽어드릴게요.");
  }

  function voiceBar(on, msg) {
    if (!el.voiceBar) return;
    el.voiceBar.hidden = !on;
    if (msg && el.voiceMsg) el.voiceMsg.textContent = msg;
  }

  function stopListen() {
    if (voice.rec && voice.listening) { try { voice.rec.stop(); } catch (e) {} }
  }

  /* 마이크가 실제로 꽂혀 있는지 먼저 본다.
     2026-09-15 확인 — 마이크가 없는 컴퓨터에서 음성인식을 시작하면
     브라우저가 'not-allowed'(권한 거부)를 돌려준다.
     그대로 "자물쇠에서 허용해 주세요" 라고 안내하면
     허용할 것이 없는 사람에게 엉뚱한 길을 알려주는 셈이다.
     알 수 없으면(null) 일단 시도한다. 없다고 단정하지 않는다. */
  function 마이크확인(다음) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      다음(null);
      return;
    }
    navigator.mediaDevices.enumerateDevices().then(function (list) {
      var 입력 = list.filter(function (d) { return d.kind === "audioinput"; });
      다음(입력.length > 0);
    }).catch(function () { 다음(null); });
  }

  var 마이크없음안내 =
    "이 기기에 마이크가 없어요. 마이크 달린 이어폰을 꽂거나 휴대폰에서 열어 주세요";

  function startListen() {
    if (!SR || voice.listening) return;
    stopSpeaking();
    마이크확인(function (있나) {
      if (있나 === false) {
        voiceBar(true, 마이크없음안내);
        setTimeout(function () { voiceBar(false); }, 5200);
        return;
      }
      듣기시작();
    });
  }

  function 듣기시작() {
    var rec = new SR();
    voice.rec = rec;
    rec.lang = "ko-KR";
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    voice.lastFinal = "";

    rec.onstart = function () {
      voice.listening = true;
      if (el.mic) el.mic.classList.add("listening");
      voiceBar(true, "듣고 있어요. 말씀해 주세요");
    };
    rec.onresult = function (e) {
      var 중간 = "", 확정 = "";
      for (var i = e.resultIndex; i < e.results.length; i++) {
        var t = e.results[i][0].transcript;
        if (e.results[i].isFinal) 확정 += t; else 중간 += t;
      }
      if (확정) voice.lastFinal += 확정;
      var 지금 = (voice.lastFinal + 중간).trim();
      if (지금) {
        el.input.value = 지금;
        voiceBar(true, "“" + 지금 + "”");
      }
    };
    rec.onerror = function (e) {
      var 말 = "소리를 알아듣지 못했어요. 다시 한 번 말씀해 주세요";
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        // 권한을 막은 것인지, 마이크가 아예 없는 것인지 나눠서 알려준다
        마이크확인(function (있나) {
          voiceBar(true, 있나 === false ? 마이크없음안내
            : "마이크 사용이 막혀 있어요. 주소창 왼쪽 자물쇠에서 허용해 주세요");
          setTimeout(function () { voiceBar(false); }, 5200);
        });
        return;
      } else if (e.error === "no-speech") {
        말 = "소리가 들리지 않았어요. 마이크를 다시 눌러 주세요";
      } else if (e.error === "network") {
        말 = "인터넷 연결을 확인해 주세요";
      } else if (e.error === "aborted") {
        말 = "";
      }
      if (말) {
        voiceBar(true, 말);
        setTimeout(function () { voiceBar(false); }, 3600);
      } else { voiceBar(false); }
    };
    rec.onend = function () {
      voice.listening = false;
      if (el.mic) el.mic.classList.remove("listening");
      var 말한것 = (voice.lastFinal || el.input.value || "").trim();
      if (말한것) {
        voiceBar(false);
        el.input.value = "";
        setSpeak(true);                   // 말로 물었으면 목소리로 답한다
        bubble(말한것, "me");
        ask(말한것);
      } else if (el.voiceBar && !el.voiceBar.hidden &&
                 el.voiceMsg.textContent.indexOf("듣고 있어요") === 0) {
        voiceBar(false);
      }
    };
    try {
      rec.start();
    } catch (e) {
      voiceBar(true, "마이크를 시작하지 못했어요. 잠시 뒤 다시 눌러 주세요");
      setTimeout(function () { voiceBar(false); }, 3600);
    }
  }

  /* 브라우저가 지원할 때만 버튼을 보여준다. 없는 기능을 있다고 하지 않는다. */
  function setupVoice() {
    if (SR && el.mic) {
      el.mic.hidden = false;
      el.mic.addEventListener("click", function () {
        if (voice.listening) stopListen(); else startListen();
      });
    }
    if (el.voiceStop) {
      el.voiceStop.addEventListener("click", function () {
        voice.lastFinal = "";
        el.input.value = "";
        stopListen();
        voiceBar(false);
      });
    }
    if (window.speechSynthesis && el.speakToggle) {
      el.speakToggle.hidden = false;
      el.speakToggle.addEventListener("click", function () {
        setSpeak(!voice.speakOn, true);
      });
      setSpeak(loadSpeakPref());
    }
  }

  /* 회색 안내줄.
     화면에만 띄우고 넘어가면, 귀로 듣는 사람은 '조건에 맞는 곳을 못 찾았다'
     같은 중요한 단서를 놓친다. 그래서 그릴 때 읽기도 함께 예약한다.
     자료 출처처럼 매번 같은 말은 읽지 않는다(읽을까 = false). */
  function notice(문구, 읽을까) {
    el.log.appendChild(node('<div class="notice">' + esc(문구) + "</div>"));
    if (읽을까 !== false) 읽기예약(문구);
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function node(h) {
    var d = document.createElement("div"); d.innerHTML = h.trim();
    return d.firstElementChild;
  }
  function scroll() { el.log.scrollTop = el.log.scrollHeight; }

  function bubble(text, who) {
    var r = node('<div class="row ' + who + '"><div class="bubble"></div></div>');
    r.querySelector(".bubble").textContent = text;
    el.log.appendChild(r); scroll();
    if (who === "bot") 읽기예약(text);   // 안내말은 목소리로도 전한다
  }

  function quick(items) {
    if (!items || !items.length) return;
    var box = node('<div class="quick"></div>');
    items.forEach(function (q) {
      var b = document.createElement("button");
      b.type = "button"; b.textContent = q.label || q;
      b.addEventListener("click", function () {
        box.remove(); ask(q.value || q);
      });
      box.appendChild(b);
    });
    el.log.appendChild(box); scroll();
  }

  // 배지에 이미 '진료시간 미확인'이라고 적혀 있으면 같은 말을 또 쓰지 않는다
  function hoursText(text) {
    var h = String(text || "");
    if (!h || h.indexOf("미확인") >= 0) return "";
    return '<span class="sep">·</span><span>' + esc(h) + "</span>";
  }

  /* ── 길찾기 ─────────────────────────────────────────────
     굿닥 병원 상세 페이지를 직접 열어 확인한 결과(2026-09-09)
     지도 그림과 주소만 있고 경로 안내 버튼은 없었다.
     급한 사람에게는 '어디로' 다음에 '어떻게 가나' 가 바로 필요하다.
     그래서 좌표를 그대로 넘겨 네이버지도·카카오맵의 길찾기를 연다.
     내 위치를 허락했으면 출발지로 넣고, 아니면 도착지만 넣는다. */
  var ROUTE_MODES = [["transit", "🚇 대중교통"], ["car", "🚗 자동차"],
                     ["walk", "🚶 도보"]];

  function routeUrl(mode, name, lat, lon) {
    var nm = encodeURIComponent(name || "목적지");
    if (!lat || !lon) return "https://map.naver.com/p/search/" + nm;
    var from = myPos
      ? myPos.lon + "," + myPos.lat + "," + encodeURIComponent("내 위치")
      : "-";
    return "https://map.naver.com/p/directions/" + from + "/" +
      lon + "," + lat + "," + nm + "/-/" + mode;
  }

  function kakaoUrl(name, lat, lon) {
    var nm = encodeURIComponent(name || "목적지");
    if (!lat || !lon) return "https://map.kakao.com/?q=" + nm;
    var to = nm + "," + lat + "," + lon;
    if (!myPos) return "https://map.kakao.com/link/to/" + to;
    return "https://map.kakao.com/link/from/" +
      encodeURIComponent("내 위치") + "," + myPos.lat + "," + myPos.lon +
      "/to/" + to;
  }

  function routeRow(name, lat, lon) {
    return '<div class="route" data-rn="' + esc(name || "") +
      '" data-ry="' + esc(lat || "") + '" data-rx="' + esc(lon || "") + '">' +
      routeInner(name, lat, lon) + "</div>";
  }

  function routeInner(name, lat, lon) {
    var 안내 = myPos
      ? '<span class="rlabel on">📍 내 위치에서</span>'
      : '<span class="rlabel">길찾기</span>' +
        '<button type="button" class="rhere">📍 내 위치 쓰기</button>';
    return '<div class="rhead">' + 안내 + '</div><div class="rbtns">' +
      ROUTE_MODES.map(function (m) {
        return '<a class="rbtn" target="_blank" rel="noopener" href="' +
          esc(routeUrl(m[0], name, lat, lon)) + '">' + m[1] + "</a>";
      }).join("") +
      '<a class="rbtn kakao" target="_blank" rel="noopener" href="' +
      esc(kakaoUrl(name, lat, lon)) + '">카카오맵</a></div>';
  }

  /* 이미 그려 둔 길찾기 줄을 다시 그린다 (내 위치를 켠 뒤) */
  function refreshRoutes() {
    var 줄 = document.querySelectorAll(".route");
    for (var i = 0; i < 줄.length; i++) {
      var d = 줄[i].dataset;
      줄[i].innerHTML = routeInner(d.rn, d.ry, d.rx);
    }
  }

  /* '내 위치 쓰기' — 사용자가 직접 눌렀을 때만 위치를 묻는다. */
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest(".rhere");
    if (!b) return;
    if (!navigator.geolocation) { b.textContent = "위치를 쓸 수 없어요"; return; }
    b.textContent = "📍 확인 중…";
    b.disabled = true;
    navigator.geolocation.getCurrentPosition(function (pos) {
      myPos = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      refreshRoutes();
      refreshRoutes();
    }, function () {
      b.textContent = "위치 허용이 필요해요";
      b.disabled = false;
    }, { timeout: 8000, maximumAge: 60000 });
  });

  function card(h, dept) {
    var t = todayHours(h);
    var mark = t.open === true ? '<span class="state open">진료중</span>'
      : t.open === false ? '<span class="state closed">오늘 휴진</span>'
      : '<span class="state unknown">진료시간 미확인</span>';
    var bits = [h._km + "km"];
    if (dept) bits.push(esc(dept));
    if (h.s > 0) bits.push("전문의 " + h.s + "명");
    if (h.p > 0) bits.push("주차 " + h.p + "대");
    if (h.gr) bits.push("평가 " + h.gr.toFixed(1) + "등급");

    var c = node(
      '<div class="hcard">' +
        '<div class="top"><span class="name">' + esc(h.n) + '</span>' +
        '<span class="kind">' + esc(h.c) + "</span></div>" +
        '<div class="line">' + mark + hoursText(t.text) + "</div>" +
        '<div class="line">' + bits.join(' <span class="sep">·</span> ') + "</div>" +
        '<div class="addr">' + esc(h.a) + "</div>" +
        '<div class="cta"><button type="button" class="ghost">병원 보기</button>' +
        '<button type="button" class="fill">예약하기</button></div>' +
        routeRow(h.n, h.y, h.x) +
      "</div>");

    c.querySelector(".ghost").addEventListener("click", function () {
      var rows = [["진료과", (h.d || []).join(", ") || "정보 없음"],
                  ["오늘", t.text], ["거리", h._km + "km"],
                  ["전문의", h.s > 0 ? h.s + "명" : "미확인"],
                  ["주차", h.p > 0 ? h.p + "대" : "미확인"],
                  ["주소", h.a], ["전화", h.t]];
      el.log.appendChild(node('<div class="detail"><dl>' +
        rows.map(function (r) {
          return "<dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd>";
        }).join("") + "</dl></div>"));
      scroll();
    });
    c.querySelector(".fill").addEventListener("click", function () {
      bubble(h.n + " 예약", "me");
      confirmBox(h, dept, t);
    });
    el.log.appendChild(c); scroll();

    // 진료시간은 우리가 모은 심평원·응급의료정보 자료에서 나온 값이다
    var 상태 = t.open === true ? "지금 진료중이에요."
      : t.open === false ? "오늘은 쉬어요."
      : "진료시간이 공개되지 않아 전화로 확인이 필요해요.";
    var 시간 = (t.text && String(t.text).indexOf("미확인") < 0) ? t.text : "";
    카드읽기(h.n, 상태, 시간, h._km);
  }

  function confirmBox(h, dept, t) {
    var tel = String(h.t || "").replace(/[^0-9+]/g, "");
    var rows = [["병원", h.n + " (" + h.c + ")"],
                ["진료과", dept || "미지정"],
                ["진료시간", t.text],
                ["주차", h.p > 0 ? h.p + "대" : "미확인"],
                ["주소", h.a], ["전화", h.t]];
    var script = "안녕하세요. " + (dept || "진료") +
      " 예약 문의드립니다.\n가능한 시간이 있을까요?";
    el.log.appendChild(node(
      '<div class="confirm"><h4>예약 안내</h4><dl>' +
      rows.map(function (r) {
        return "<dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd>";
      }).join("") + "</dl>" +
      '<div class="cta"><a class="call" href="tel:' + esc(tel) + '">전화하기</a>' +
      '<a class="out" href="https://www.goodoc.co.kr/hospitals" target="_blank" ' +
      'rel="noopener">예약 페이지</a></div>' +
      '<div class="script">' + esc(script) + "</div></div>"));
    notice("예약은 병원에 직접 문의하거나 예약 페이지에서 진행해 주세요. "
           + "이 화면에서 예약이 접수되지는 않습니다.");
    scroll();
  }

  /* ── 대화 ── */
  // 지역을 되물을 때 보여줄 보기. (예전에는 전국 시군구를 전부 뿌려 너무 길었다)
  var REGION_CHOICES = ["서울 강남구", "부산 해운대구", "광주 북구",
                        "대구 중구", "인천 남동구", "대전 서구"];

  function ask(text) {
    if (!text) return;

    // 빠른 선택 버튼 값. 서버 쪽 dialog.reply 와 같은 방식으로 처리한다.
    if (text === "__symptom__") {
      bubble("어떤 증상이신가요?", "bot");
      quick((R.commonSymptoms || []).map(function (x) {
        return { label: x, value: x };
      }));
      return;
    }
    if (text === "__department__") {
      bubble("어느 진료과를 찾으세요?", "bot");
      quick((R.commonDepts || []).map(function (x) {
        return { label: x, value: x };
      }));
      return;
    }
    if (text === "__nearby__") {
      bubble("어느 지역에서 찾을까요? 시·군·구까지 알려주시면 정확해요.", "bot");
      quick(REGION_CHOICES.map(function (x) { return { label: x, value: x }; }));
      return;
    }

    // 여러 곳 중에서 고른 경우: 다시 해석하지 않고 그 지역으로 확정한다
    var pickedRegion = null;
    if (text.indexOf("__REGION__") === 0) {
      var body = text.slice("__REGION__".length);
      var bar = body.indexOf("|");
      var sd = bar >= 0 ? body.slice(0, bar) : body;
      var sg = bar >= 0 ? body.slice(bar + 1) : "";
      pickedRegion = sg || sd;
      text = "";
    } else {
      bubble(text, "me");
    }

    var merged = (pending ? pending + " " : "") + text;
    var c = extract(merged);

    // 이번에 한 말만으로도 진료과나 지역이 정해지면 그쪽을 따른다.
    // 그러지 않으면 되묻는 중에 다른 걸 물어봐도 이전 문장이 계속 따라붙어
    // 같은 질문만 반복하게 된다.
    if (text && merged !== text) {
      var fresh = extract(text);
      if (fresh.dept) {
        c.dept = fresh.dept;
        c.symptomChoice = null;
      } else if (fresh.symptomChoice) {
        c.symptomChoice = fresh.symptomChoice;
        c.dept = null;
      }
      if (fresh.region) {
        c.region = fresh.region;
        c.ambiguous = fresh.ambiguous;
        c.candidates = fresh.candidates;
      }
    }

    if (pickedRegion) {
      c.region = pickedRegion;
      c.ambiguous = false;
      c.candidates = [];
    }

    // 약국을 물어보면 병원이 아니라 약국을 찾는다
    if (merged.indexOf("약국") >= 0) {
      var got3 = resolveRegion(merged.replace(/\s/g, ""));
      if (got3.region) {
        pending = "";
        pharmacyList(merged);   // 문장을 그대로 넘겨 야간·심야 조건을 살린다
        return;
      }
      pending = merged;
      bubble("어느 지역 약국을 찾으세요?", "bot");
      quick(REGION_CHOICES.map(function (x) {
        return { label: x, value: x + " 약국" };
      }));
      return;
    }

    // 응급실 실시간 병상은 서버가 있어야 조회할 수 있다.
    // (API 키를 공개 화면에 넣을 수 없다)
    if (/응급실|응급 실|119|쓰러|의식이|피가 나/.test(merged)) {
      pending = "";
      bubble("응급실 실시간 병상은 이 화면에서는 볼 수 없어요. "
             + "서버가 있는 화면에서 조회됩니다.", "bot");
      bubble("위급한 상황이면 먼저 119에 연락하세요.", "bot");
      quick([{ label: "가까운 병원 찾기", value: "__department__" }]);
      return;
    }

    // 한 증상이 여러 진료과를 가리키면 되묻는다
    if (c.symptomChoice && !c.dept) {
      pending = merged;
      bubble(c.symptomChoice.question, "bot");
      quick((c.symptomChoice.options || []).map(function (o) {
        return { label: o.label, value: o.dept };
      }));
      return;
    }

    // 같은 이름이 여러 곳이면 마음대로 고르지 않고 후보를 보여준다
    if (c.ambiguous) {
      pending = merged;
      bubble("‘" + (c.matched || "그 지역") +
             "’ 이라는 곳이 여러 곳이에요. 어디를 찾으세요?", "bot");
      quick(c.candidates.slice(0, 6));
      return;
    }

    if (isDiagnosisAsk(text) && c.dept) {
      pending = merged;
      bubble("증상만으로는 판단하기 어려워요. 가까운 병원에서 확인하시는 게 좋습니다. "
             + c.dept + " 쪽을 찾아드릴까요?", "bot");
      quick([{ label: "네, 찾아주세요", value: c.dept }]);
      return;
    }

    if (!c.region) {
      pending = merged;
      bubble((c.dept ? c.dept + " 진료를 찾을게요. " : "") + "어느 지역인가요?", "bot");
      quick(REGION_CHOICES.map(function (d) {
        return { label: d, value: d };
      }));
      return;
    }
    if (!c.dept && !(c.sunday || c.saturday || c.night || c.openNow
                     || c.openUntil || c.parking)) {
      pending = merged;
      bubble("어디가 불편하신지, 또는 진료과를 알려주세요.", "bot");
      quick((R.commonSymptoms || []).map(function (x) {
        return { label: x, value: x };
      }));
      return;
    }

    var out = search(c);
    pending = "";
    if (!out.rows.length) {
      bubble(c.region + " " + (c.dept || "병원") +
             " 조건에 맞는 곳을 찾지 못했어요. 조건을 조금 줄여볼까요?", "bot");
      quick([{ label: "조건 없이 다시 찾기",
               value: c.region + " " + (c.dept || "병원") }]);
      return;
    }
    bubble(c.region + " " + (c.dept || "병원") + " " + out.rows.length + "곳이에요.", "bot");
    var notices = [];
    if (out.conditions.length && out.unconfirmed) {
      var ct = out.conditions.join("·");
      if (out.confirmed) {
        notices.push(ct + " 조건은 " + out.confirmed +
          "곳에서 확인됐고, 나머지 " + out.unconfirmed +
          "곳은 병원이 진료시간을 공개하지 않아 전화 확인이 필요해요.");
      } else {
        notices.push(ct + " 정보가 공개된 병원이 이 지역에 없어요. 아래는 조건을 " +
          "빼고 가까운 순으로 찾은 곳이며, 방문 전 전화 확인을 권해요.");
      }
    }
    out.skipped.forEach(function (x) {
      notices.push(x + " 은(는) 반영하지 못했어요.");
    });
    if (notices.length) notice(notices.join(" "));
    el.log.appendChild(node('<div class="from-note">거리는 ' +
      esc(c.region) + " 기준이에요.</div>"));
    out.rows.forEach(function (h) { card(h, c.dept); });
  }

  /* ── 열고 닫기 ── */
  function open() {
    el.panel.hidden = false;
    document.body.classList.add("panel-open");
    if (el.assistant) el.assistant.hidden = true;
    if (!el.log.childElementCount) {
      bubble("안녕하세요. 어디가 불편하세요?", "bot");
      bubble("증상을 말씀해주시면 어떤 진료과를 가야 하는지, "
             + "가까운 병원은 어디인지 같이 찾아드릴게요.", "bot");
      // 마이크를 쓸 수 있는 브라우저에서만 안내한다
      if (SR) bubble("글자 대신 아래 마이크를 눌러 말씀하셔도 돼요.", "bot");
      quick(["감기 걸린 것 같아요", "지금 문 연 병원",
             "주말에도 하는 소아과", "서울 강남구 피부과"]);
    }
    setTimeout(function () { el.input.focus(); }, 60);
  }
  function close() {
    el.panel.hidden = true;
    document.body.classList.remove("panel-open");
    if (el.assistant) el.assistant.hidden = false;
    // 창을 닫으면 듣기도 읽어주기도 멈춘다
    stopListen();
    stopSpeaking();
    voiceBar(false);
  }

  /* ── 첫 화면 '내 주변 병원' (실제 데이터) ── */
  var area = "서울 강남구";

  function openPanel() { if (el.panel.hidden) el.fab.click(); }

  var myPos = null;   // 사용자가 위치 사용을 허락하면 채워진다

  function nearbyOf(regionText) {
    var flat = regionText.replace(/\s/g, "");
    var got = resolveRegion(flat);
    var rows = got.region ? filterRegion(HOSP, got.region) : [];
    rows = rows.filter(function (h) { return NON_OUTPATIENT.indexOf(h.c) < 0; });
    if (!rows.length) return [];
    var lat, lon;
    if (myPos) {
      lat = myPos.lat; lon = myPos.lon;
    } else {
      lat = rows.map(function (h) { return h.y; }).sort()[Math.floor(rows.length / 2)];
      lon = rows.map(function (h) { return h.x; }).sort()[Math.floor(rows.length / 2)];
    }
    rows.forEach(function (h) {
      h._km = Math.round(dist(lat, lon, h.y, h.x) * 100) / 100;
    });
    // 서버 쪽 search() 와 같은 기준: 한방·치과 계열은 뒤로 보낸다
    // (진료과를 고르지 않고 '내 주변'만 본 사람에게는 일반 의원이 먼저 맞다)
    rows.forEach(function (h) { h._fit = clinicFit(h.c, "일반"); });
    rows.sort(function (a, b) {
      return (a._fit - b._fit) || (a._km - b._km);
    });
    return rows.slice(0, 6);
  }

  function drawNearby(rows) {
    if (!el.nearby) return;
    if (!rows.length) {
      el.nearby.innerHTML =
        '<p class="grid-msg">이 지역에서 병원을 찾지 못했어요. 지역을 바꿔보세요.</p>';
      return;
    }
    el.nearby.innerHTML = "";
    rows.forEach(function (h) {
      var t = todayHours(h);
      var badge = t.open === true ? '<span class="badge open">진료중</span>'
        : t.open === false ? '<span class="badge closed">오늘 휴진</span>'
        : '<span class="badge unknown">시간 미확인</span>';
      var tags = [];
      if (h.p > 0) tags.push("주차 " + h.p + "대");
      if (h.s > 0) tags.push("전문의 " + h.s + "명");
      if (h.gr) tags.push("평가 " + h.gr.toFixed(1) + "등급");

      var art = node(
        '<article class="hosp">' +
          '<div class="hosp-top"><span class="hosp-name"></span>' + badge + '</div>' +
          '<p class="hosp-dept"></p>' +
          '<div class="hosp-meta">' +
            (t.text.indexOf("미확인") >= 0 ? "" :
              '<span>' + esc(t.text) + '</span><span class="dot">·</span>') +
            '<span>' + h._km + 'km</span></div>' +
          '<div class="hosp-tags">' +
            tags.map(function (x) { return '<span class="tag">' + esc(x) + '</span>'; }).join("") +
          '</div>' +
          '<div class="hosp-cta">' +
            '<button type="button" class="ghost">병원 보기</button>' +
            '<button type="button" class="fill">예약하기</button>' +
          '</div>' +
        '</article>');

      art.querySelector(".hosp-name").textContent = h.n;
      art.querySelector(".hosp-dept").textContent =
        h.c + (h.a ? " · " + h.a.split(" ").slice(0, 3).join(" ") : "");
      // 챗봇 안에서 이미 쓰고 있는 카드 그리기를 그대로 재사용한다
      art.querySelector(".ghost").addEventListener("click", function () {
        openPanel();
        setTimeout(function () {
          bubble(h.n, "me");
          card(h, (h.d && h.d[0]) || null);
        }, 300);
      });
      art.querySelector(".fill").addEventListener("click", function () {
        openPanel();
        setTimeout(function () {
          bubble(h.n + " 예약", "me");
          confirmBox(h, (h.d && h.d[0]) || null, todayHours(h));
        }, 300);
      });
      el.nearby.appendChild(art);
    });
  }

  function loadNearby(region) {
    area = region;
    if (el.areaName) el.areaName.textContent = region;
    if (el.distFrom) {
      el.distFrom.textContent = myPos ? "현재 위치" : region;
    }
    drawNearby(nearbyOf(region));
  }

  /* ── 내 위치로 거리 계산 (버튼을 눌렀을 때만 물어본다) ── */
  function useMyLocation() {
    if (!navigator.geolocation) return;
    if (el.areaHere) {
      el.areaHere.disabled = true;
      el.areaHere.lastChild.textContent = " 위치 확인 중…";
    }
    navigator.geolocation.getCurrentPosition(function (pos) {
      myPos = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      loadNearby(area);
      restoreHere();
    }, function () {
      restoreHere();
    }, { timeout: 8000, maximumAge: 60000 });
  }

  function restoreHere() {
    if (!el.areaHere) return;
    el.areaHere.disabled = false;
    el.areaHere.lastChild.textContent = " 내 위치로";
  }

  if (el.areaHere) el.areaHere.addEventListener("click", useMyLocation);

  /* ── 약국 찾기 ──
     약국 자료는 4.5MB 라 첫 화면에서 같이 받지 않고, 누른 사람만 받는다. */
  var pharmLoading = null;

  function ensurePharm() {
    if (PHARM.length) return Promise.resolve(PHARM);
    if (pharmLoading) return pharmLoading;
    pharmLoading = fetch("pharmacies.json?v=202609151144")
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (rows) {
        PHARM = rows || [];
        window.__PHARM_DATA__ = PHARM;
        return PHARM;
      });
    return pharmLoading;
  }

  function pharmacyList(regionText) {
    openPanel();
    setTimeout(function () {
      bubble("약국 찾기", "me");
      var wait = bubbleNode("약국 정보를 불러오는 중이에요…", "bot");
      ensurePharm().then(function () {
        if (wait) wait.remove();
        drawPharmacies(regionText);
      }).catch(function () {
        if (wait) wait.remove();
        bubble("약국 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.", "bot");
      });
    }, 300);
  }

  function bubbleNode(text, who) {
    var r = node('<div class="row ' + who + '"><div class="bubble"></div></div>');
    r.querySelector(".bubble").textContent = text;
    el.log.appendChild(r); scroll();
    return r;
  }

  function drawPharmacies(regionText) {
    {
      var got = resolveRegion(regionText.replace(/\s/g, ""));
      var name = got.region;
      var hit = PHARM.filter(function (x) { return x.g === name; });
      if (!hit.length) hit = PHARM.filter(function (x) { return x.sd === name; });
      if (!hit.length && name) {
        var base = name.replace(/[시군구]$/, "");
        if (base.length >= 2) {
          hit = PHARM.filter(function (x) { return x.g.indexOf(base) === 0; });
        }
      }
      if (!hit.length) {
        bubble("‘" + regionText + "’ 에서 약국을 찾지 못했어요.", "bot");
        return;
      }
      var lat = hit.map(function (x) { return x.y; }).sort()[Math.floor(hit.length / 2)];
      var lon = hit.map(function (x) { return x.x; }).sort()[Math.floor(hit.length / 2)];
      hit.forEach(function (x) {
        x._km = Math.round(dist(lat, lon, x.y, x.x) * 100) / 100;
      });
      hit.sort(function (a, b) { return a._km - b._km; });

      // 야간·심야·24시간 조건이 있으면 걸러 낸다
      var 조건 = /24시|이십사시/.test(regionText) ? "al"
        : /심야|새벽|자정/.test(regionText) ? "la"
        : /야간|밤에|늦게|늦은/.test(regionText) ? "ni" : null;
      var 안내 = null;
      if (조건) {
        var 골라낸 = hit.filter(function (x) { return x[조건]; });
        if (골라낸.length) {
          hit = 골라낸;
        } else {
          안내 = "조건에 맞는 약국을 찾지 못했어요. 아래는 가까운 순이며 "
               + "방문 전 전화 확인을 권해요.";
        }
      }

      var top = hit.slice(0, 5);
      if (안내) notice(안내);
      // '광주 북구 야간 약국' 처럼 문장을 그대로 받으므로 '약국' 을 또 붙이지 않는다
      var 머리 = regionText.indexOf("약국") >= 0
        ? regionText : regionText + " 약국";
      bubble(머리 + " " + top.length + "곳이에요. (전체 "
             + hit.length + "곳 중 가까운 순)", "bot");
      top.forEach(function (x) {
        var 배지 = x.al ? '<span class="ptag always">24시간</span>'
          : x.la ? '<span class="ptag late">심야</span>'
          : x.ni ? '<span class="ptag night">야간</span>' : "";
        var 오늘 = (x.h || {})[WEEK[new Date().getDay() === 0 ? 6
                                    : new Date().getDay() - 1]];
        var c2 = node(
          '<div class="hcard">' +
            '<div class="top"><span class="name"></span>' +
            '<span class="kind">약국</span>' + 배지 + "</div>" +
            '<div class="line"><span>' +
            (오늘 ? "오늘 " + esc(오늘) : "운영시간 미확인") +
            '</span><span class="sep">·</span><span>' + x._km + 'km</span></div>' +
            '<div class="addr"></div>' +
            '<div class="cta"><a class="fill" href="tel:' + esc(x.t) +
            '">전화하기</a></div>' +
            routeRow(x.n, x.y, x.x) +
          '</div>');
        c2.querySelector(".name").textContent = x.n;
        c2.querySelector(".addr").textContent = x.a;
        el.log.appendChild(c2);

        var 상태 = x.al ? "24시간 운영이에요."
          : x.la ? "심야까지 운영이에요."
          : x.ni ? "야간까지 운영이에요." : "";
        카드읽기(x.n, 상태, 오늘 ? "오늘 " + 오늘 : "", x._km);
      });
      // 출처는 매번 같은 말이라 눈으로만 보여준다
      notice("건강보험심사평가원 약국정보서비스 자료입니다. "
             + "영업시간은 공개되어 있지 않아 표시하지 않습니다.", false);
      scroll();
    }
  }

  /* ── 상단 메뉴 · 퀵메뉴 ── */
  function goto2(what) {
    if (what === "hospital") {
      openPanel();
      setTimeout(function () { ask("__department__"); }, 300);
      return;
    }
    if (what === "booking") {
      openPanel();
      setTimeout(function () {
        bubble("접수·예약", "me");
        bubble("어느 병원에 접수·예약할지 먼저 찾아드릴게요. 진료과를 골라주세요.", "bot");
        ask("__department__");
      }, 300);
      return;
    }
    if (what === "pharmacy") { pharmacyList(area); return; }
    if (what === "telemed") {
      openPanel();
      setTimeout(function () {
        bubble("비대면진료", "me");
        bubble("비대면진료는 굿닥이 이미 제공하는 기능이라 이번 프로젝트에서는 "
               + "다시 만들지 않았어요.", "bot");
        bubble("저희가 맡은 부분은 ‘어느 병원에 가야 할지 고르는 일’이에요. "
               + "증상이나 지역을 말씀해 주시면 찾아드릴게요.", "bot");
        quick([{ label: "증상으로 찾기", value: "__symptom__" },
               { label: "진료과로 찾기", value: "__department__" }]);
      }, 300);
      return;
    }
    if (what === "login") {
      openPanel();
      setTimeout(function () {
        bubble("로그인", "me");
        bubble("이 화면은 서버 없이 브라우저만으로 도는 시연본이라 "
               + "로그인은 동작하지 않아요.", "bot");
        bubble("로그인·회원가입·예약 내역 저장은 서버가 있는 화면에서 됩니다. "
               + "발표 때는 그 화면으로 시연할 예정이에요.", "bot");
      }, 300);
      return;
    }
    if (what === "app") {
      openPanel();
      setTimeout(function () {
        bubble("앱 다운로드", "me");
        bubble("이 화면은 학교 프로젝트 시연용이라 받을 앱이 없어요. "
               + "실제 굿닥 앱은 앱스토어에서 받을 수 있습니다.", "bot");
      }, 300);
    }
  }

  document.querySelectorAll("[data-go]").forEach(function (b) {
    b.addEventListener("click", function (e) {
      e.preventDefault();
      goto2(b.getAttribute("data-go"));
    });
  });

  if (el.areaPick) {
    el.areaPick.addEventListener("click", function () {
      openPanel();
      setTimeout(function () {
        bubble("지역 바꾸기", "me");
        bubble("어느 지역에서 찾을까요?", "bot");
        var box = node('<div class="quick"></div>');
        ["서울 강남구", "부산 해운대구", "광주 북구", "대구 중구",
         "인천 남동구", "대전 서구"].forEach(function (a) {
          var b2 = document.createElement("button");
          b2.type = "button";
          b2.textContent = a;
          b2.addEventListener("click", function () {
            box.remove();
            bubble(a, "me");
            bubble(a + " 병원으로 바꿨어요. 첫 화면에서 확인해 보세요.", "bot");
            loadNearby(a);
          });
          box.appendChild(b2);
        });
        el.log.appendChild(box);
        scroll();
      }, 300);
    });
  }

  loadNearby(area);
  setupVoice();

  el.fab.addEventListener("click", open);
  el.close.addEventListener("click", close);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !el.panel.hidden) close();
  });
  el.form.addEventListener("submit", function (e) {
    e.preventDefault();
    var v = el.input.value.trim();
    if (!v) return;
    el.input.value = "";
    ask(v);
  });
  if (el.siteForm) {
    el.siteForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var q = el.siteInput.value.trim();
      if (!q) return;
      el.siteInput.value = "";
      if (el.panel.hidden) open();
      setTimeout(function () { ask(q); }, 300);
    });
  }
  document.querySelectorAll("[data-ask]").forEach(function (b) {
    b.addEventListener("click", function (e) {
      e.preventDefault();
      var q = b.getAttribute("data-ask");
      if (el.panel.hidden) open();
      setTimeout(function () { ask(q); }, 300);
    });
  });
  if (el.assistant) {
    setTimeout(function () {
      if (!el.panel.hidden) return;
      el.assistant.classList.add("peek");
      setTimeout(function () { el.assistant.classList.remove("peek"); }, 4200);
    }, 1400);
  }
})();
