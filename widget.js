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
  var lastRegion = null;    // 앞에서 말한 지역 (다음 질문에서 다시 묻지 않기)
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
    // '병원주말' 안의 '원주' 처럼 흔한 낱말에 걸친 지역명을 잡지 않는다 (서버 region_index 와 같은 규칙)
    flat = flat.replace(/병원|의원|요양원|학원|옆구리/g, function (m) { return new Array(m.length + 1).join("□"); });

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
  /* ── 몸 부위·방향 (서버 extract_conditions 와 같은 규칙, 2026-10-07) ──
     '오른쪽무릎'·'왼무릎'·'오른발'처럼 붙여 써도 방향과 부위를 띄어 읽는다.
     한 글자 부위(손·발·등·간)는 뒤에 '이/가/을…'이 올 때만 부위로 본다 ('손님'·'발진' 제외). */
  var SIDE_GLUE = /(왼쪽|오른쪽|양쪽|좌측|우측|왼편|오른편)(?=[가-힣])/g;
  var SIDE_SHORT = /(^|[^가-힣])(왼|오른|양)(?=(손|발|팔|다리|무릎|눈|귀|어깨|허리|가슴|옆구리|엉덩이|골반|발목|손목|종아리|허벅지|팔꿈치|엄지|검지|새끼|코|턱|볼|뺨|갈비))/g;
  function 방향띄우기(t) {
    return String(t || "").replace(SIDE_GLUE, "$1 ").replace(SIDE_SHORT, "$1$2 ");
  }
  function 낱말있나(w, t) {
    if (w.length === 1) return new RegExp("(^|[^가-힣])" + w + "(?=[이가을를은는도에의만랑]|\\s|$)").test(t);
    if (w.length <= 2) return new RegExp("(^|[^가-힣])" + w).test(t);
    // 세 글자 이상은 띄어쓰기 무시 ('복숭아 뼈' 처럼 받아쓰기가 띄어 쓰는 일이 많다)
    return t.indexOf(w) >= 0 || t.replace(/\s/g, "").indexOf(w.replace(/\s/g, "")) >= 0;
  }
  var SIDE_WORDS = [["왼쪽", "왼쪽"], ["왼편", "왼쪽"], ["좌측", "왼쪽"], ["오른쪽", "오른쪽"],
                    ["오른편", "오른쪽"], ["우측", "오른쪽"], ["양쪽", "양쪽"], ["양", "양쪽"],
                    ["왼", "왼쪽"], ["오른", "오른쪽"]];
  function 방향과부위(text) {
    var t = 방향띄우기(text), side = null, part = null;
    for (var i = 0; i < SIDE_WORDS.length; i++) {
      if (new RegExp("(^|[^가-힣])" + SIDE_WORDS[i][0] + "(?=\\s|$)").test(t)) { side = SIDE_WORDS[i][1]; break; }
    }
    var parts = R.bodyParts || [];
    for (var j = 0; j < parts.length; j++) { if (낱말있나(parts[j], t)) { part = parts[j]; break; } }
    return { side: side, part: part };
  }

  function matchSymptom(t) {
    t = 방향띄우기(t);
    var S = R.symptoms || {};
    var A = R.ambiguous || {};

    // 코피는 흔한 일이라 이비인후과. 멎지 않으면 응급 (서버 match_symptom 과 같은 규칙, 2026-10-07 공유판에 빠져 있던 것)
    if (t.indexOf("코피") >= 0) {
      if (/멈추지|안 멈|멎지|계속 나|많이 나|쓰러|의식|119|숨이 안/.test(t)) return { dept: "응급의학과", ask: null };
      return { dept: "이비인후과", ask: null };
    }
    // '변에 피'는 '피가 나'(응급)보다 먼저 본다. 멎지 않거나 어지러우면 응급 (서버와 같은 규칙, 2026-10-07)
    if (/변에 피|혈변|피똥|항문에서 피|대변에 피|변 볼 때 피/.test(t)) {
      if (/멈추지|안 멈|멎지|계속 나|많이 나|쓰러|의식|119|숨이 안|어지러|식은땀/.test(t)) {
        return { dept: "응급의학과", ask: null };
      }
      return { dept: null, ask: null, depts: ["외과", "내과"],
               intro: "변에 피가 보이면 외과(항문)나 내과(소화기)에서 봐요. 많이 나거나 어지러우면 바로 119에 연락하세요." };
    }

    var first = ["응급의학과", "소아청소년과"];
    for (var i = 0; i < first.length; i++) {
      var ws = S[first[i]] || [];
      for (var j = 0; j < ws.length; j++) {
        if (t.indexOf(ws[j]) >= 0) return { dept: first[i], ask: null };
      }
    }

    var keys = Object.keys(A);
    for (var k = 0; k < keys.length; k++) {
      var spec = A[keys[k]];
      if (t.indexOf(keys[k]) < 0) continue;
      // '손목'·'발목' 안의 '목' 은 건너뛴다. 단 '거북목'처럼 그 말 자체가 단서면 본다 (서버와 같은 규칙)
      var 단서 = Object.keys(spec.decide || {}).some(function (d) {
        return spec.decide[d].some(function (cl) { return t.indexOf(cl) >= 0 && cl.indexOf(keys[k]) >= 0; });
      });
      if (!new RegExp("(^|[^가-힣])" + keys[k]).test(t) && !단서) continue;
      var decided = null;
      Object.keys(spec.decide || {}).forEach(function (dept) {
        if (decided) return;
        var clues = spec.decide[dept];
        for (var m = 0; m < clues.length; m++) {
          if (t.indexOf(clues[m]) >= 0) { decided = dept; return; }
        }
      });
      if (decided) return { dept: decided, ask: null };
      // 2026-10-06 : 되묻지 않고 두 과를 함께 찾는다 (영훈 "질문을 해도 다시 되물어본다")
      return { dept: null, ask: null, intro: spec.intro || null,
               depts: (spec.options || []).map(function (o) { return o.dept; }) };
    }

    var best = null, bestLen = 0, bestWord = "";
    Object.keys(S).forEach(function (dept) {
      if (first.indexOf(dept) >= 0) return;
      S[dept].forEach(function (w) {
        // 짧은 낱말은 낱말 첫머리에서만 ('엉덩이가' 안의 '이가' 를 이빨로 보지 않게), 한 글자는 뒤 조사까지 본다
        var 있다 = 낱말있나(w, t);
        if (있다 && w.length > bestLen) {
          best = dept; bestLen = w.length; bestWord = w;
        }
      });
    });
    // 2026-10-01 : 일반 '감기'는 이비인후과·내과·가정의학과 모두 진료한다 → 한 과로 정하지 않는다.
    // '목감기'·'코감기'처럼 구체적인 말은 이비인후과.
    // 여러 과 표현(감기·성병 등)도 같은 '가장 긴 표현' 규칙으로 본다 (서버 match_symptom 과 같다)
    Object.keys(MULTI_DEPT).forEach(function (w) {
      if (new RegExp("(^|[^가-힣])" + w).test(t) && w.length >= bestLen) {
        best = null; bestLen = w.length; bestWord = w;
      }
    });
    if (MULTI_DEPT[bestWord]) {
      if (/코감기|목감기/.test(t)) return { dept: "이비인후과", ask: null };
      return { dept: null, depts: MULTI_DEPT[bestWord].slice(), ask: null,
               intro: (R.multiIntro || {})[bestWord] || (MULTI_DEPT[bestWord].join("·") + "에서 진료해요.") };
    }
    return { dept: best, ask: null };
  }
  // 서버(파이썬)가 규칙을 넘겨주면 그것을, 아니면 같은 기본값을 쓴다
  var MULTI_DEPT = R.multiDept || { "감기": ["이비인후과", "내과", "가정의학과"] };
  var NEAR_WORDS = (R.distance || []).concat(["여기", "내 위치", "현재 위치", "지금 있는 곳", "집 근처"]);

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
      c.depts = got2.depts || null;
      c.altIntro = got2.intro || null;
      c.symptomChoice = got2.ask;
    }
    // 방향·부위 ("왼쪽 무릎") — 되짚어 줄 때 쓴다
    var 몸 = 방향과부위(t);
    c.side = 몸.side; c.part = 몸.part;

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
    if (has(NEAR_WORDS)) c.nearMe = true;
    if (has(R.parking)) c.parking = true;
    if (has(R.specialist)) c.specialist = true;
    if (has(R.rating)) c.rating = true;
    // '주말'만 말하면 토·일 중 하루라도 여는 곳 (둘 다 여는 곳만 찾으면 거의 없다, 2026-10-06)
    if (has(["주말"]) && !has(["일요일", "일욜", "토요일", "토욜"])) c.weekend = true;
    if (has(["일요일", "일욜", "공휴일", "휴일"])) c.sunday = true;
    if (has(["토요일", "토욜"])) c.saturday = true;
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
    // 치과의원은 진료과를 '치주과·교정과'처럼 세부로만 적어 '치과'가 목록에 없다 → 종별로도 본다 (2026-10-06)
    if (c.dept) res = res.filter(function (h) {
      if (c.dept === "치과" && DENTAL.indexOf(h.c) >= 0) return true;
      return h.d.indexOf(c.dept) >= 0;
    });
    if (!c.dept && c.depts) {
      res = res.filter(function (h) {
        // 이름에 과가 들어간 과를 먼저 고른다 ('참사랑가정의학과' 가 내과도 등록했으면 가정의학과로)
        var got = c.depts.filter(function (d) { return h.d.indexOf(d) >= 0; });
        if (!got.length) return false;
        var named = got.filter(function (d) { return h.n.indexOf(d.replace("과", "")) >= 0; });
        h._dept = (named[0] || got[0]);
        return true;
      });
    }
    // 지역 이름 없이 현재 위치로 찾을 때 : 3km 안에서 찾고, 없으면 10km 까지 넓힌다
    if (!c.region && c.here) {
      res.forEach(function (h) { h._km = Math.round(dist(c.here.lat, c.here.lon, h.y, h.x) * 100) / 100; });
      var near = res.filter(function (h) { return h._km <= 3; });
      if (!near.length) near = res.filter(function (h) { return h._km <= 10; });
      res = near;
    }
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
        // 서버판(availability.py)과 같은 규칙 : 시간이 적혀 있으면 진료, '휴진'이면 쉼,
        // 그 밖의 말(예: '응급실 진료')은 외래 진료 여부를 알 수 없으므로 미확인.
        // (2026-10-01 '응급실 진료'를 일요일 진료로 잘못 세던 것을 고침)
        // 공유 묶음에는 sun 칸이 없고 요일별 시간(h.h["일"])에 들어 있다 (2026-10-06 확인)
        var s = String(h.sun || (h.h && h.h["일"]) || "").trim();
        if (/^\d{1,2}:\d{2}\s*~\s*\d{1,2}:\d{2}$/.test(s)) return true;
        if (/^((전부|종일|매주|일요일|공휴일)?\s*(휴진|휴무)|진료\s*없음)$/.test(s)) return false;
        return null;
      }]);
    }
    if (c.saturday) {
      checks.push(["토요일 진료", function (h) {
        return hasHours(h) ? !!(h.h && h.h["토"]) : null;
      }]);
    }
    if (c.night) {
      // 평일 저녁 8시 이후까지 진료하는 곳 (서버 availability 와 같은 기준, 응급 병상은 서버판에서만)
      checks.push(["야간 진료", function (h) {
        if (!hasHours(h)) return null;
        var late = ["월", "화", "수", "목", "금"].some(function (d) {
          var t = h.h[d];
          if (!t || t.indexOf("~") < 0) return false;
          var e = t.split("~")[1].split(":");
          return (+e[0] * 60 + +e[1]) >= 20 * 60;
        });
        return late;
      }]);
    }
    if (c.weekend) {
      checks.push(["주말 진료", function (h) {
        var 토 = hasHours(h) ? !!(h.h && h.h["토"]) : null;
        var s = String(h.sun || (h.h && h.h["일"]) || "").trim();
        var 일 = /^\d{1,2}:\d{2}\s*~\s*\d{1,2}:\d{2}$/.test(s) ? true
          : /^((전부|종일|매주|일요일|공휴일)?\s*(휴진|휴무)|진료\s*없음)$/.test(s) ? false : null;
        return (토 === true || 일 === true) ? true : (토 === false && 일 === false) ? false : null;
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

    if (!(!c.region && c.here)) {
      var lat = res.map(function (h) { return h.y; }).sort()[Math.floor(res.length / 2)];
      var lon = res.map(function (h) { return h.x; }).sort()[Math.floor(res.length / 2)];
      res.forEach(function (h) { h._km = Math.round(dist(lat, lon, h.y, h.x) * 100) / 100; });
    }

    // 확인된 곳 먼저, 그다음 찾는 계열과 맞는 기관 먼저
    var family = deptFamily(c.dept || (c.depts && c.depts[0]));
    res.forEach(function (h) {
      h._ok = h._mark === "미확인" ? 1 : 0;
      h._fit = clinicFit(h.c, h._dept ? deptFamily(h._dept) : family);
    });

    res.sort(function (a, b) {
      if (a._ok !== b._ok) return a._ok - b._ok;
      if (a._fit !== b._fit) return a._fit - b._fit;
      if (c.rating) {
        var ga = a.gr == null ? 99 : a.gr, gb = b.gr == null ? 99 : b.gr;
        if (ga !== gb) return ga - gb;
      } else if (c.specialist) {
        if (a.s !== b.s) return b.s - a.s;
      } else if (c.dept || c.depts) {
        // 이름에 그 과가 들어간 전문 의원을 먼저 (감기처럼 여러 과면 그 병원이 맞은 과로 본다)
        // '외과'는 '정형외과·신경외과·성형외과·흉부외과' 안의 외과를 빼고 본다 (서버 이름맞음 과 같은 규칙)
        var 이름맞음 = function (dept, name) {
          if (!dept) return false;
          if (dept === "외과") return /(^|[^형경성부])외과/.test(name) || name.indexOf("항문") >= 0;
          return name.indexOf(dept.replace("과", "")) >= 0;
        };
        var ma = 이름맞음(c.dept || a._dept, a.n) ? 0 : 1, mb = 이름맞음(c.dept || b._dept, b.n) ? 0 : 1;
        if (ma !== mb) return ma - mb;
      }
      return a._km - b._km;
    });

    // 조건을 말했으면, 공공데이터로 확인된 곳만 '추천'으로 보여준다.
    // 확인된 곳이 3곳이 안 돼도 미확인 곳으로 억지로 채우지 않고, 따로 2곳까지만 보여준다.
    var rows, unknownRows = [];
    if (checks.length) {
      var ok = res.filter(function (h) { return h._mark === "확인됨"; });
      var un = res.filter(function (h) { return h._mark === "미확인"; });
      rows = ok.slice(0, 3);
      if (rows.length < 3) unknownRows = un.slice(0, 2);
    } else {
      rows = res.slice(0, 3);
    }
    return {
      rows: rows, unknownRows: unknownRows, skipped: skipped,
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
  var voice = { 끊김타이머: null, rec: null, listening: false, speakOn: false, lastFinal: "" };
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

  var 세는말 = ["", "한", "두", "세", "네", "다섯",
                "여섯", "일곱", "여덟", "아홉", "열"];

  /* "0.98km" → "약 980미터"
     소수점을 그대로 읽으면 "영점구팔 킬로미터"로 들려 알아듣기 어렵다.
     1킬로미터가 안 되면 미터로 바꾸고 10미터 단위로 반올림한다. */
  function sayDistance(text) {
    var m = /([\d.]+)\s*km/i.exec(String(text || ""));
    if (!m) return "";
    var km = parseFloat(m[1]);
    if (isNaN(km)) return "";
    if (km < 1) {
      var meter = Math.round(km * 1000 / 10) * 10;
      return "약 " + meter + "미터";
    }
    return "약 " + (Math.round(km * 10) / 10) + "킬로미터";
  }

  /* 작은 수는 한글로 읽는다. "3곳"을 "삼곳"으로 읽는 것을 막는다. */
  var 세는말 = ["", "한", "두", "세", "네", "다섯",
                "여섯", "일곱", "여덟", "아홉", "열"];
  function sayCount(n) {
    n = parseInt(n, 10);
    if (isNaN(n)) return "";
    return (n >= 1 && n <= 10) ? 세는말[n] : String(n);
  }

  /* 진료시간에서 '닫는 시각'만 꺼낸다.
     지금 열려 있다면 언제 문을 닫는지가 가장 궁금한 정보다.
     여는 시각까지 같이 읽으면 말이 길어져 귀에 남지 않는다. */
  function sayCloseTime(text) {
    var m = /(\d{1,2}:\d{2})\s*[~\-–]\s*(\d{1,2}:\d{2})/.exec(String(text || ""));
    if (!m) return null;
    var 시작 = 분으로(m[1]), 끝 = 분으로(m[2]);
    var t = sayTime(m[2]);
    if (!t) return null;
    // 밤을 넘기는 곳은 '오늘'을 붙이면 "오늘 다음 날 오전 1시"가 되어 말이 꼬인다.
    // 그래서 '오늘'을 앞에 붙일지 여부를 함께 돌려준다.
    if (시작 !== null && 끝 !== null && 끝 <= 시작) {
      return { 말: "다음 날 " + t + "까지", 오늘: false };
    }
    return { 말: t + "까지", 오늘: true };
  }

  /* "오늘 저녁 6시까지예요" / "다음 날 오전 1시까지예요" 로 만든다 */
  function closeSentence(hours) {
    var c = sayCloseTime(hours);
    if (!c) return "";
    return (c.오늘 ? " 오늘 " : " ") + c.말 + "예요.";
  }

  /* 화면용 문장을 귀로 듣기 쉬운 말로 바꾼다.
     "3곳" 을 그냥 읽히면 "삼곳" 으로 들린다. "세 곳" 이라야 알아듣는다. */
  function easyWords(text) {
    function swap(all, n, unit) {
      var v = parseInt(n, 10);
      // 열 이하만 한글로 바꾼다. 큰 수는 숫자 그대로가 오히려 잘 들린다.
      if (v >= 1 && v <= 10) return 세는말[v] + " " + unit;
      return all;
    }
    return String(text || "")
      .replace(/(\d+)\s*곳/g, function (a, n) { return swap(a, n, "곳"); })
      .replace(/(\d+)\s*개/g, function (a, n) { return swap(a, n, "개"); });
  }

  /* 서버가 보내는 안내말과 회색 줄이 같은 내용을 두 번 말할 때가 있다.
     화면에서는 두 줄로 나뉘어 있어 자연스럽지만, 소리로 이어 들으면
     "한 곳이에요. 한 곳을 찾았어요." 처럼 되풀이로 들린다.
     그래서 앞에 나온 문장과 많이 겹치는 문장은 빼고 읽는다. */
  function dropRepeats(lines) {
    var 나온것 = [], 결과 = [];
    lines.forEach(function (chunk) {
      String(chunk).split(/(?<=[.!?])\s+/).forEach(function (s) {
        var t = s.trim();
        if (!t) return;
        var 핵심 = t.replace(/[^가-힣0-9]/g, "");
        var 겹침 = 나온것.some(function (prev) {
          if (!핵심 || !prev) return false;
          var 짧은 = 핵심.length < prev.length ? 핵심 : prev;
          var 긴 = 핵심.length < prev.length ? prev : 핵심;
          if (긴.indexOf(짧은) >= 0) return true;      // 한쪽이 다른 쪽에 통째로 들어감
          // 짧은 문장의 60% 이상이 잇따라 똑같으면 같은 말을 되풀이하는 것으로 본다.
          // ("심야 약국 한 곳이에요" 와 "심야 약국 한 곳을 찾았어요" 처럼)
          // 2026-10-07 : 예전엔 여섯 글자만 겹쳐도 지워서 "가장 가까운 곳은 ○○소아청소년과의원"이
          // 앞 문장의 '소아청소년과' 때문에 통째로 빠졌다. 병원 이름을 못 듣게 되던 문제.
          var 기준 = Math.max(6, Math.ceil(짧은.length * 0.6));
          for (var i = 0; i + 기준 <= 짧은.length; i++) {
            if (긴.indexOf(짧은.substr(i, 기준)) >= 0) return true;
          }
          return false;
        });
        if (!겹침) {
          나온것.push(핵심);
          결과.push(t);
        }
      });
    });
    return 결과.join(" ");
  }

  /* 마지막 글자에 받침이 있는가.
     한글 한 글자는 (초성·중성·종성)을 한 칸에 담고 있어서,
     '가'(0xAC00)부터 세어 28로 나눈 나머지가 0이면 받침이 없다.
     예) 광주 → 받침 없음 → '라는',  서울 → 받침 있음 → '이라는'
     소리로 읽어 주면서 조사 오류가 귀에 걸려 고쳤다(2026-09-15). */
  function 받침있나(word) {
    var s = String(word || "").trim();
    if (!s) return false;
    var c = s.charCodeAt(s.length - 1);
    if (c < 0xac00 || c > 0xd7a3) return true;   // 한글이 아니면 '이라는' 쪽
    return (c - 0xac00) % 28 !== 0;
  }

  function stopSpeaking() {
    if (window.JGSay) { JGSay.stop(); if (el.speakToggle) el.speakToggle.classList.remove("talking"); return; }
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
    // 같은 말이 두 번 나오면 하나만 남긴다
    var t = dropRepeats(읽을거리);
    읽을거리 = []; 읽은카드수 = 0;
    if (!t || !voice.speakOn || !window.speechSynthesis) return;
    // 2026-10-07 : 좋은 목소리 고르기·기호 풀어 읽기·문장별 읽기는 공용 부품(life.js JGSay)이 한다
    if (window.JGSay) {
      JGSay.speak(t, function (on) {
        if (el.speakToggle) el.speakToggle.classList.toggle("talking", !!on);
      });
      return;
    }
    stopSpeaking();
    var u = new SpeechSynthesisUtterance(t);
    u.lang = "ko-KR";
    // 2026-09-15 휴대폰에서 들어 보니 0.95 도 빨라 알아듣기 어려웠다
    u.rate = 0.88;
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

  /* 목록은 가장 가까운 한 곳만 읽는다.
     2026-09-15 실제로 휴대폰에서 들어 본 결과, 세 곳을 모두 읽으면
     정보가 열두 개나 지나가 무슨 말인지 남지 않았다.
     나머지는 눈으로 보는 편이 빠르다. */
  function 카드읽기(이름, 상태, 시간, 거리) {
    if (!voice.speakOn) return;
    읽은카드수 += 1;
    if (읽은카드수 === 2) {
      읽기예약("나머지는 화면에서 봐주세요.");
      return;
    }
    if (읽은카드수 > 2) return;
    var t = "가장 가까운 곳은 " + 이름 + "이에요.";
    if (상태) t += " " + 상태;
    if (시간) t += closeSentence(시간);
    var d = sayDistance(거리 + "km");
    if (d) t += " " + d + " 떨어져 있어요.";
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
    else if (알릴까) 읽기예약("이제 답변을 읽어드릴게요. 말풍선을 누르면 다시 들을 수 있어요.");
  }

  function voiceBar(on, msg) {
    if (!el.voiceBar) return;
    el.voiceBar.hidden = !on;
    if (msg && el.voiceMsg) el.voiceMsg.textContent = msg;
  }

  function stopListen() {
    var r = voice.rec;
    if (r && voice.listening) {
      try { r.stop(); } catch (e) {}
      // 휴대폰에서 '끝' 신호가 안 오면 '듣는 중' 상태가 남아 두 번째부터 마이크가 먹통이 됐다.
      // 1.5초 안에 끝 신호가 없으면 우리가 직접 끝낸다 (들은 말은 그대로 보낸다) (2026-10-07)
      setTimeout(function () {
        if (voice.rec === r && voice.listening && r.onend) {
          try { r.abort(); } catch (e) {}
          r.onend();
        }
      }, 1500);
    }
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
    if (!SR) return;
    // 듣는 상태가 12초 넘게 남아 있으면 걸린 것으로 보고 풀어 준다 (휴대폰에서 끝 신호가 안 오는 일)
    if (voice.listening) {
      if (Date.now() - (voice.시작시각 || 0) < 12000) return;
      var 걸린것 = voice.rec; voice.rec = null;
      try { 걸린것 && 걸린것.abort(); } catch (e) {}
      voice.listening = false;
      if (el.mic) el.mic.classList.remove("listening");
    }
    stopSpeaking();
    // 누른 그 순간에 바로 시작한다. 휴대폰 크롬은 사람이 누른 직후에만 마이크를 허락하는 일이 있어
    // 예전처럼 '마이크가 꽂혀 있나'를 먼저 묻고(기다림) 시작하면 두 번째부터 막힐 수 있다 (2026-10-07).
    // 마이크가 없는지는 실패했을 때(onerror) 확인한다.
    듣기시작();
  }


  // 앞 말과 겹치면 하나만 남긴다 ("머리" + "머리 아파" → "머리 아파", "머리 아파" + "머리 아파" → "머리 아파")
  function 겹침없이(앞, 새) {
    if (!앞) return 새;
    var a = 앞.replace(/\s/g, ""), b = 새.replace(/\s/g, "");
    if (b.indexOf(a) === 0) return 새;          // 새 말이 앞 말을 포함(누적)
    if (a.indexOf(b) >= 0) return 앞;           // 이미 들어 있음
    return 앞 + " " + 새;
  }

  function 듣기시작() {
    // 앱이 읽어 주는 소리를 다시 받아쓰지 않게, 들을 때는 읽기를 멈춘다
    if (window.JGSay) JGSay.stop();
    var 앞회차 = voice.rec;
    voice.rec = null;                                       // 앞 회차 신호는 이제부터 무시된다
    // 앞 회차가 아직 듣는 중일 때만 끈다. 이미 끝난 회차까지 abort 하면 안드로이드에서
    // 방금 시작한 새 회차까지 꺼질 수 있다 (2026-10-07 휴대폰에서 아예 인식이 안 되던 일)
    if (앞회차 && voice.listening) { try { 앞회차.abort(); } catch (e) {} }
    voice.시작시각 = Date.now();
    voice.listening = false;
    voice.lastFinal = "";
    var rec = new SR();
    voice.rec = rec;
    rec.lang = "ko-KR";
    /* 2026-09-15 확인 — "광주 남구"라고 말했는데 "광주"까지만 잡히는 일이 있었다.
       continuous 가 false 면 잠깐 숨을 고르는 사이에도 인식이 끝나 버린다.
       계속 듣게 두고, 말이 멎은 뒤 1.6초가 지나면 우리가 끝낸다. */
    // 안드로이드 크롬은 계속 듣기(continuous)에서 앞에 들은 말을 다시 보내는 등 오작동이 많아
    // 한 번 말하면 끝나는 방식으로 듣는다 (2026-10-07 영훈 휴대폰: "한 번밖에 인식을 못 한다")
    rec.continuous = !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);   // 아이폰도 (2026-10-07 진단)
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    voice.lastFinal = "";

    function 말끊김대기() {
      clearTimeout(voice.끊김타이머);
      voice.끊김타이머 = setTimeout(function () {
        if (voice.listening) stopListen();
      }, 1600);
    }

    rec.onstart = function () {
      if (voice.rec !== rec) return;            // 지난 회차의 신호는 무시 (2026-10-07)
      clearTimeout(voice.끊김타이머);
      voice.끊김타이머 = setTimeout(function () {
        if (voice.listening) stopListen();
      }, 8000);
      voice.listening = true;
      if (el.mic) el.mic.classList.add("listening");
      voiceBar(true, "듣고 있어요. 말씀해 주세요");
    };
    rec.onresult = function (e) {
      if (voice.rec !== rec) return;            // 지난 회차의 신호는 무시 (2026-10-07)
      // 결과를 이어 붙이지 않고 매번 처음부터 다시 정리한다.
      // 휴대폰 크롬은 앞서 들은 말을 다시 보내는 일이 있어, 이어 붙이면
      // "머리 아파머리 아파머리 아파" 처럼 되어 못 알아들었다 (2026-10-07)
      var 확정 = "", 중간 = "";
      for (var i = 0; i < e.results.length; i++) {
        var t = String(e.results[i][0].transcript || "").trim();
        if (!t) continue;
        if (e.results[i].isFinal) 확정 = 겹침없이(확정, t); else 중간 = 겹침없이(중간, t);
      }
      voice.lastFinal = 확정;
      var 지금 = (중간 ? 겹침없이(확정, 중간) : 확정).trim();
      if (지금) {
        el.input.value = 지금;
        voiceBar(true, "“" + 지금 + "”");
        말끊김대기();                      // 말이 이어지면 기다리는 시간을 다시 센다
      }
    };
    rec.onerror = function (e) {
      if (voice.rec !== rec) return;            // 지난 회차의 신호는 무시 (2026-10-07)
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
      // 지난 회차의 '끝' 신호(새 회차를 시작하며 정리할 때 늦게 오는 것)는 무시하고,
      // 한 회차의 말은 딱 한 번만 보낸다. 같은 말이 두 번 전송되어 대답이 두 개 나오던 문제 (2026-10-07)
      if (voice.rec !== rec || rec.__끝남) return;
      rec.__끝남 = true;
      clearTimeout(voice.끊김타이머);
      voice.listening = false;
      if (el.mic) el.mic.classList.remove("listening");
      var 말한것 = (voice.lastFinal || el.input.value || "").trim();
      if (말한것) {
        voiceBar(false);
        el.input.value = "";
        // 말로 물었다고 자동으로 읽어 주지는 않는다.
        // 2026-09-15 휴대폰에서 들어 본 결과 기계 목소리가 깨져 들려
        // 오히려 방해가 됐다. 원하는 사람만 위쪽 스피커 단추로 켠다.
        // ask() 가 내 말풍선을 그린다. 여기서도 그리면 파란 말풍선이 두 번 나온다(2026-10-06 수정).
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
    if (읽을까 !== false) 읽기예약(easyWords(문구));
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

  var lastMe = { text: "", at: 0 };
  function bubble(text, who) {
    // 안전장치 : 같은 내 말이 2초 안에 또 그려지면 한 번만 보인다
    if (who === "me") {
      var now = Date.now();
      if (text === lastMe.text && now - lastMe.at < 2000) return;
      lastMe = { text: text, at: now };
    }
    var r = node('<div class="row ' + who + '"><div class="bubble"></div></div>');
    r.querySelector(".bubble").textContent = text;
    el.log.appendChild(r); scroll();
    if (who === "bot") 읽기예약(easyWords(text));  // 안내말은 목소리로도 전한다
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
    el.log.appendChild(box);
    emit("jg:quick", { items: items, node: box });
    scroll();
  }

  // 생활 기능(life.js)에 알리는 사건. 위젯 동작은 이 사건과 무관하게 그대로다.
  function emit(name, detail) {
    try { document.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (e) {}
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
    el.log.appendChild(c);
    emit("jg:card", { card: { name: h.n, tel: h.t, addr: h.a, lat: h.y, lon: h.x,
                              hours: t.text }, node: c });
    scroll();

    // 진료시간은 우리가 모은 심평원·응급의료정보 자료에서 나온 값이다
    var 상태 = t.open === true ? "지금 진료중이에요."
      : t.open === false ? "오늘은 쉬어요."
      : "진료시간이 공개되지 않아 전화로 확인이 필요해요.";
    var 시간 = (t.text && String(t.text).indexOf("미확인") < 0) ? t.text : "";
    카드읽기(h.n, 상태, 시간, h._km);
    return c;
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

  // 현재 위치를 받아 온다. 허용하면 cb(true), 거부·실패하면 cb(false)
  var locDenied = false;
  /* ── 위치 미리 받아 두기 (2026-10-06 영훈 "위치를 말 안 해도 바로 검색되게") ──
     상담 창을 여는 순간 위치를 받아 두고, 움직이면 따라 갱신한다(watchPosition).
     이미 허용한 사람은 아무것도 묻지 않고, 처음인 사람만 브라우저 허용 창이 한 번 뜬다.
     위치는 이 화면의 메모리에만 두고 저장하거나 보내지 않는다(공유판은 서버가 없다). */
  var watching = false, permState = "unknown";
  function warmLocation() {
    if (watching || locDenied || !navigator.geolocation) return;
    watching = true;
    navigator.geolocation.watchPosition(function (pos) {
      var first = !myPos;
      myPos = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      if (first) refreshRoutes();
    }, function (e) {
      if (e && e.code === 1) { locDenied = true; watching = false; }
    }, { maximumAge: 60000, timeout: 15000 });
  }
  try {
    navigator.permissions.query({ name: "geolocation" }).then(function (st) {
      permState = st.state;
      if (st.state === "granted") warmLocation();      // 이미 허용 → 바로 조용히 받는다
      if (st.state === "denied") locDenied = true;
      st.onchange = function () { permState = st.state; if (st.state === "denied") locDenied = true; };
    }).catch(function () {});
  } catch (e) {}

  function askLocation(cb) {
    if (myPos) { cb(true); return; }
    if (!navigator.geolocation || locDenied) { cb(false); return; }
    // 이미 받는 중이면 새로 묻지 않고 도착을 기다린다 (최대 10초)
    if (watching) {
      var 시작 = Date.now();
      (function 기다리기() {
        if (myPos) { cb(true); return; }
        if (locDenied || Date.now() - 시작 > 10000) { cb(false); return; }
        setTimeout(기다리기, 200);
      })();
      return;
    }
    navigator.geolocation.getCurrentPosition(function (pos) {
      myPos = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      refreshRoutes();
      cb(true);
    }, function () { locDenied = true; cb(false); },
    { timeout: 10000, maximumAge: 60000 });
  }
  function regionQuestion(c, merged) {
    pending = merged;
    bubble((c.dept ? c.dept + " 진료를 찾을게요. " : "") + "어느 지역인가요?", "bot");
    var items = REGION_CHOICES.map(function (d) { return { label: d, value: d }; });
    if (navigator.geolocation && !locDenied) items.unshift({ label: "📍 현재 위치로 찾기", value: "__HERE__" });
    quick(items);
  }

  function ask(text, quiet, noCmd) {
    if (!text) return;

    // 화면 버튼 글씨를 말로 읽었으면 그 버튼 값으로 바꾼다
    var 버튼값 = window.JGCmd && JGCmd.quickValue(text);
    if (버튼값 && 버튼값 !== text) text = 버튼값;

    // "두리치과의원 대중교통" · "두 번째 병원 전화" 처럼 할 일을 말하면 되묻지 않고 바로 연다 (life.js)
    if (!noCmd && window.JGCmd) {
      // 명령도 내가 한 말을 먼저 보여 준다 (예전엔 명령이면 내 말풍선이 안 떴다, 2026-10-07)
      if (!quiet && String(text).indexOf("__") !== 0) bubble(text, "me");
      if (JGCmd.handle(text, function () { ask(text, quiet, true); })) return;
    }

    // '현재 위치로 찾기' 버튼
    if (text === "__HERE__") {
      var 이어서 = pending;
      askLocation(function (ok) {
        if (ok && 이어서) { pending = ""; ask(이어서, true); }
        else if (ok) { bubble("위치를 확인했어요. 어디가 불편하신지, 또는 진료과를 알려주세요.", "bot"); }
        else { bubble("위치를 쓸 수 없어요. 브라우저에서 위치 권한을 허용하거나 지역을 골라 주세요.", "bot");
               quick(REGION_CHOICES.map(function (d) { return { label: d, value: d }; })); }
      });
      return;
    }

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
    } else if (!quiet) {
      bubble(text, "me");
    }

    var merged = (pending ? pending + " " : "") + text;
    var c = extract(merged);

    // 이번에 한 말만으로도 진료과나 지역이 정해지면 그쪽을 따른다.
    // 그러지 않으면 되묻는 중에 다른 걸 물어봐도 이전 문장이 계속 따라붙어
    // 같은 질문만 반복하게 된다.
    if (text && merged !== text) {
      var fresh = extract(text);
      // 진료과와 자기 조건(요일·시간·주차)을 다 갖춘 새 질문이면 이전 말을 섞지 않는다 (2026-10-06)
      if ((fresh.dept || fresh.depts) && (fresh.sunday || fresh.saturday || fresh.weekend ||
          fresh.night || fresh.openNow || fresh.openUntil || fresh.parking)) {
        var 지역 = c.region;
        c = fresh; merged = text;
        if (!c.region && 지역) c.region = 지역;
      }
      if (fresh.dept) {
        c.dept = fresh.dept;
        c.depts = null;
        c.symptomChoice = null;
      } else if (fresh.depts) {
        c.dept = null;
        c.depts = fresh.depts;
        c.altIntro = fresh.altIntro;
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
      // 지역을 안 말했으면 먼저 지금 위치로 찾는다. 위치를 못 받을 때만 지역을 묻는다.
      if (navigator.geolocation && !locDenied) {
        var 문장 = merged;
        pending = "";
        askLocation(function (ok) {
          if (ok) { pharmacyList(문장, myPos); return; }
          pending = 문장;
          bubble("위치를 쓸 수 없어 지역을 여쭤볼게요. 어느 지역 약국을 찾으세요?", "bot");
          quick(REGION_CHOICES.map(function (x) {
            return { label: x, value: x + " 약국" };
          }));
        });
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
    // '피가 나' 만 있으면 코피·변에 피 같은 흔한 일일 수 있다 → 증상 규칙이 응급이라고 할 때만 응급실 (2026-10-07)
    var 응급말 = /응급실|응급 실|119|쓰러|의식이/.test(merged) ||
      matchSymptom(merged).dept === "응급의학과";   // "코피가 안 멈춰요" 처럼 증상 규칙이 응급이라고 할 때
    if (응급말) {
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
      var 지역 = c.matched || "그 지역";
      bubble("‘" + 지역 + "’" + (받침있나(지역) ? "이라는" : "라는") +
             " 곳이 여러 곳이에요. 어디를 찾으세요?", "bot");
      quick(c.candidates.slice(0, 6));
      return;
    }

    // 지역을 말하지 않았으면 현재 위치로 찾는다 (2026-10-01 영훈 지적: "가까운 데"인데 지역을 되물었다)
    // 증상·진료과·조건·지역 중 아무것도 못 알아들었으면 아무 병원이나 보여주지 않고 다시 말해 달라고 한다
    // (2026-10-07 영훈 : "병원 이름을 말 안 했는데 병원이 나오면 오류") — 서버 dialog 와 같은 규칙
    if (!c.dept && !c.depts && !c.region && !(c.sunday || c.saturday || c.weekend || c.night ||
        c.openNow || c.openUntil || c.parking || c.specialist)) {
      pending = "";
      bubble("잘 못 알아들었어요. 어디가 아픈지 한 번만 다시 말씀해 주세요. "
             + "예를 들면 ‘목이 아파요’, ‘애가 열나요’처럼요.", "bot");
      quick((R.commonSymptoms || []).map(function (x) { return { label: x, value: x }; }));
      return;
    }

    // 앞에서 말한 지역은 이어 쓴다 (다시 묻지 않기)
    if (!c.region && lastRegion && !c.nearMe) c.region = lastRegion;
    // 지역을 말하지 않으면 무엇을 묻든 현재 위치부터 (2026-10-06 : "지금 문 연 병원"도 지역을 물었다)
    if (!c.region) {
      if (myPos) {
        c.here = myPos;
      } else if (navigator.geolocation && !locDenied) {
        pending = merged;
        // 이미 허용한 사람에게는 허용해 달라고 하지 않는다
        if (permState !== "granted") bubble("지금 계신 곳에서 가까운 곳을 찾을게요. 위치 사용을 허용해 주세요.", "bot");
        askLocation(function (ok) {
          var m = pending; pending = "";
          if (ok) { ask(m, true); }
          else { bubble("위치를 쓸 수 없어 지역을 여쭤볼게요.", "bot"); regionQuestion(c, m); }
        });
        return;
      }
    }

    if (isDiagnosisAsk(text) && c.dept) {
      pending = merged;
      bubble("증상만으로는 판단하기 어려워요. 가까운 병원에서 확인하시는 게 좋습니다. "
             + c.dept + " 쪽을 찾아드릴까요?", "bot");
      quick([{ label: "네, 찾아주세요", value: c.dept }]);
      return;
    }

    if (!c.region && !c.here) {
      regionQuestion(c, merged);
      return;
    }
    if (!c.dept && !c.depts && !(c.sunday || c.saturday || c.weekend || c.night || c.openNow
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
    if (c.region) lastRegion = c.region;
    var 장소 = c.region || "현재 위치 근처";
    var 무엇 = c.dept || (c.depts ? c.depts.join("·") : "병원");
    // 방향까지 말했으면 들은 대로 되짚어 준다 ("왼쪽 무릎이 불편하시군요")
    if (c.side && c.part) {
      bubble(c.side + " " + c.part + (받침있나(c.part) ? "이" : "가") + " 불편하시군요.", "bot");
    }
    if (c.depts && !c.dept) {
      bubble((c.altIntro || (c.depts.join("·") + "에서 진료해요.")) +
             (/보여드릴게요/.test(c.altIntro || "") ? "" : " 가까운 전문 의원부터 보여드릴게요."), "bot");
    }
    if (!out.rows.length && !out.unknownRows.length) {
      bubble(장소 + " " + 무엇 +
             (c.here && !c.region ? " 10km 안에서" : "") +
             " 조건에 맞는 곳을 찾지 못했어요. 조건을 조금 줄여볼까요?", "bot");
      quick([{ label: "조건 없이 다시 찾기",
               value: (c.region || "가까운") + " " + (c.dept || (c.depts ? "감기" : "병원")) }]);
      return;
    }
    var ct = out.conditions.join("·");
    if (out.conditions.length) {
      bubble(out.rows.length
        ? 장소 + " " + 무엇 + " 중 " + ct + " 조건을 모두 확인한 곳은 " +
          out.rows.length + "곳이에요."
        : 장소 + " " + 무엇 + " 중 " + ct + " 조건을 공공데이터로 확인한 곳이 없어요.", "bot");
    } else {
      bubble(장소 + " " + 무엇 + " " + out.rows.length + "곳이에요.", "bot");
    }
    var notices = [];
    if (out.unknownRows.length) {
      notices.push("조건 일부를 확인하지 못한 곳 " + out.unknownRows.length +
        "곳은 아래에 따로 보여드릴게요. 방문 전 전화로 확인해 주세요.");
    }
    out.skipped.forEach(function (x) {
      notices.push(x + " 은(는) 반영하지 못했어요.");
    });
    if (notices.length) notice(notices.join(" "));
    el.log.appendChild(node('<div class="from-note">거리는 ' +
      esc(c.region && !c.here ? c.region : "현재 위치") + " 기준이에요.</div>"));
    // 번호(①②③)가 실제 거리 순서와 맞도록 가까운 순으로 세운다 (평가·전문의 순으로 물었으면 그 순서 유지)
    // 읽어주기의 '가장 가까운 곳'도 ①번과 같아진다 (2026-10-07)
    var 순서 = c.rating ? "rating" : c.specialist ? "specialist" : "distance";
    if (순서 === "distance") {
      out.rows.sort(function (a, b) { return a._km - b._km; });
      out.unknownRows.sort(function (a, b) { return a._km - b._km; });
    }
    var 병원들 = out.rows.map(function (h) { return card(h, c.dept || h._dept); });
    if (window.JGOrder) JGOrder.mark(병원들, { kind: "병원", order: 순서,
      from: c.region && !c.here ? c.region : "현재 위치" });
    if (out.unknownRows.length) {
      el.log.appendChild(node('<div class="from-note jg-unknown-head">아래는 ' + esc(ct) +
        " 정보가 공공데이터에 없어 확인하지 못한 곳이에요.</div>"));
      out.unknownRows.forEach(function (h) { card(h, c.dept || h._dept); });
    }
    emit("jg:results", { count: out.rows.length + out.unknownRows.length });
  }

  /* ── 열고 닫기 ── */
  function open() {
    warmLocation();          // 창을 여는 순간 위치를 미리 받아 둔다
    el.panel.hidden = false;
    document.body.classList.add("panel-open");
    if (el.assistant) el.assistant.hidden = true;
    if (!el.log.childElementCount) {
      bubble("안녕하세요. 어디가 불편하세요?", "bot");
      bubble("증상을 말씀해주시면 어떤 진료과를 가야 하는지, "
             + "가까운 병원은 어디인지 같이 찾아드릴게요.", "bot");
      // 창을 열 때 위치를 받으므로 그 사실을 알린다 (개인정보 고지)
      if (navigator.geolocation) {
        bubble("지역을 말하지 않으면 지금 계신 곳 기준으로 찾아요. 위치는 저장하지 않아요.", "bot");
      }
      // 마이크를 쓸 수 있는 브라우저에서만 안내한다
      if (SR) bubble("글자 대신 아래 마이크를 눌러 말씀하셔도 돼요.", "bot");
      // 밤·주말·공휴일이면 생활 기능이 그때에 맞는 버튼을 대신 보여준다
      var 맞춤 = window.JGLife ? window.JGLife.welcome() : null;
      if (!(맞춤 && 맞춤.items.length)) {
        quick(["감기 걸린 것 같아요", "지금 문 연 병원",
               "주말에도 하는 소아과", "서울 강남구 피부과"]);
      }
      emit("jg:open", { first: true });
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
    pharmLoading = fetch("pharmacies.json?v=202610071550")
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

  function pharmacyList(regionText, here) {
    openPanel();
    setTimeout(function () {
      bubble("약국 찾기", "me");
      var wait = bubbleNode("약국 정보를 불러오는 중이에요…", "bot");
      ensurePharm().then(function () {
        if (wait) wait.remove();
        drawPharmacies(regionText, here);
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

  function drawPharmacies(regionText, here) {
    if (here) {
      // 현재 위치 기준: 3km 안을 먼저, 없으면 10km 까지 넓힌다
      var near = PHARM.map(function (x) {
        x._km = Math.round(dist(here.lat, here.lon, x.y, x.x) * 100) / 100;
        return x;
      });
      var hit = near.filter(function (x) { return x._km <= 3; });
      if (!hit.length) hit = near.filter(function (x) { return x._km <= 10; });
      if (!hit.length) {
        bubble("현재 위치 10km 안에서 약국을 찾지 못했어요. 지역 이름을 함께 말씀해 주세요.", "bot");
        return;
      }
      hit.sort(function (a, b) { return a._km - b._km; });
      return drawPharmHits(hit, regionText, "현재 위치 근처 약국");
    }
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
      return drawPharmHits(hit, regionText, null);
    }
  }

  function drawPharmHits(hit, regionText, 머리말) {
    {
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
      var 머리 = 머리말 || (regionText.indexOf("약국") >= 0
        ? regionText : regionText + " 약국");
      bubble(머리 + " " + top.length + "곳이에요. (전체 "
             + hit.length + "곳 중 가까운 순)", "bot");
      var 약국들 = [];
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
        emit("jg:card", { card: { name: x.n, tel: x.t, addr: x.a, lat: x.y, lon: x.x,
                                  pharmacy: true }, node: c2 });

        var 상태 = x.al ? "24시간 운영이에요."
          : x.la ? "심야까지 운영이에요."
          : x.ni ? "야간까지 운영이에요." : "";
        카드읽기(x.n, 상태, 오늘 ? "오늘 " + 오늘 : "", x._km);
        약국들.push(c2);
      });
      if (window.JGOrder) JGOrder.mark(약국들, { kind: "약국", order: "distance",
        from: 머리말 ? "현재 위치" : regionText.replace(/\s*약국.*$/, "") + " 한가운데" });
      // 출처는 매번 같은 말이라 눈으로만 보여준다
      notice("건강보험심사평가원 약국정보와 국립중앙의료원 응급의료정보를 합친 자료입니다. "
             + "운영시간은 실제와 다를 수 있으니 방문 전 전화로 확인해 주세요.", false);
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

  // 홈의 큰 마이크 : 한 번 누르면 상담 창이 열리고 바로 듣기 시작한다 (2026-10-07 피드백)
  var bigMic = document.getElementById("big-mic");
  if (bigMic) bigMic.addEventListener("click", function () {
    open();
    if (el.mic && !el.mic.hidden) el.mic.click();   // 같은 누름 안에서 시작해야 휴대폰이 마이크를 허락한다
    else el.input.focus();                           // 음성인식이 없는 브라우저는 글자 입력으로
  });
  var typeInstead = document.getElementById("type-instead");
  if (typeInstead) typeInstead.addEventListener("click", function () {
    open();
    setTimeout(function () { el.input.focus(); }, 50);
  });
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
  // 생활 기능(life.js)이 쓰는 고리
  /* 이름으로 병원·약국 찾기 (음성 명령용). 위치를 알면 가까운 순, 최대 3곳 */
  function findPlace(q, pharmacy, cb) {
    var 찾기 = function (rows, 약국) {
      var hit = [];
      rows.forEach(function (h) {
        var sc = JGCmd.nameScore(h.n, q);
        if (sc < 99) hit.push({ h: h, sc: sc });
      });
      if (!hit.length) return [];
      // 이름이 똑같아도 10km 넘게 멀면 가까운 '비슷한 이름'과 같은 순위로 본다 (서버 find_place 와 같은 규칙)
      hit.forEach(function (x) {
        x.km = myPos ? dist(myPos.lat, myPos.lon, x.h.y, x.h.x) : 0;
        x.key = x.sc + (x.km > 10 ? 3 : 0);
      });
      hit.sort(function (a, b) { return (a.key - b.key) || (a.km - b.km); });
      return hit.slice(0, 3).map(function (x) {
        return { name: x.h.n, tel: x.h.t, addr: x.h.a, lat: x.h.y, lon: x.h.x, km: x.km, pharmacy: 약국 };
      });
    };
    if (pharmacy) {
      ensurePharm().then(function () { cb(찾기(PHARM, true)); })
        .catch(function () { cb([]); });
      return;
    }
    var got = 찾기(HOSP, false);
    if (got.length) { cb(got); return; }
    // 병원에 없으면 약국에서도 찾아 본다 ('온누리' 처럼 약국 이름만 말했을 때)
    ensurePharm().then(function () { cb(찾기(PHARM, true)); }).catch(function () { cb([]); });
  }

  // 대화를 처음으로 (음성 명령 "처음으로")
  function resetChat() {
    pending = ""; lastRegion = null;
    el.log.innerHTML = "";
    el.panel.hidden = true;
    open();
  }

  window.JG = {
    reset: resetChat,
    server: false, send: function (v) { ask(v); }, bubble: bubble, node: node,
    quick: quick, log: el.log, mic: el.mic, input: el.input,
    depts: R.departments,
    pos: function () { return myPos; },
    getPos: function (cb) { askLocation(function () { cb(); }); },
    findPlace: findPlace
  };
  emit("jg:ready", {});
})();
