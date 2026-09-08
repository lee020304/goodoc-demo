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
    areaName: document.getElementById("area-name")
  };

  var PHARM = window.__PHARM_DATA__ || [];

  var pending = "";
  var lastCards = {};

  /* ── 지역 사전: 데이터에서 만든다 ── */
  /* ── 지역 사전 ──
     파이썬 region_index 가 만든 사전을 그대로 받아 쓴다.
     (공유본이 따로 만들면 '창원시'처럼 데이터에 없는 상위 지명을 못 알아본다) */
  var REG = R.regions || null;
  var NICKMAP = (REG && REG.nick) || {};

  var DISTRICTS = (function () {
    if (REG && REG.sggu) return { map: REG.sggu, sido: REG.sido };
    // 사전을 못 받은 경우의 대비책: 데이터에서 직접 만든다
    var set = {}, sd = {};
    HOSP.forEach(function (h) {
      set[h.g] = h.g;
      (sd[h.sd] = sd[h.sd] || []).push(h.g);
    });
    return { map: set, sido: sd };
  })();

  // 파이썬 resolve() 와 같은 순서로 지역을 찾는다.
  function resolveRegion(flat) {
    // 별칭: 파이썬에서 받은 것 + 이 화면이 따로 가진 동 단위 이름
    var nicks = {};
    Object.keys(NICKMAP).forEach(function (k) { nicks[k] = NICKMAP[k]; });
    Object.keys(NICK).forEach(function (k) { nicks[k] = NICK[k]; });

    var nk = Object.keys(nicks).sort(function (a, b) { return b.length - a.length; });
    for (var n = 0; n < nk.length; n++) {
      if (flat.indexOf(nk[n]) >= 0 && DISTRICTS.map[nicks[nk[n]]]) {
        return { region: DISTRICTS.map[nicks[nk[n]]], ambiguous: false };
      }
    }

    var sidos = Object.keys(DISTRICTS.sido || {});
    var names = Object.keys(DISTRICTS.map)
      .sort(function (a, b) { return b.length - a.length; });

    for (var m = 0; m < names.length; m++) {
      var name = names[m];
      if (name.length < 2 || flat.indexOf(name) < 0) continue;
      var full = DISTRICTS.map[name];

      // '북구'처럼 여러 시도에 있는 이름인지 본다
      if (name !== full) {
        var owners = sidos.filter(function (sd) {
          return (DISTRICTS.sido[sd] || []).some(function (g) {
            return g === name || g.slice(-name.length) === name;
          });
        });
        if (owners.length > 1) {
          // 문장에 시도명이 같이 있으면 그걸로 좁힌다
          for (var o = 0; o < owners.length; o++) {
            var sd2 = owners[o];
            var shortSd = sd2.replace("특별시", "").replace("광역시", "");
            if (flat.indexOf(sd2) >= 0 || flat.indexOf(shortSd) >= 0) {
              var g2 = (DISTRICTS.sido[sd2] || []).filter(function (g) {
                return g.slice(-name.length) === name;
              })[0];
              if (g2) return { region: g2, ambiguous: false };
            }
          }
          return { region: null, ambiguous: true };
        }
      }
      return { region: full, ambiguous: false };
    }

    // 시도명만 말한 경우
    var bySd = sidos.slice().sort(function (a, b) { return b.length - a.length; });
    for (var i2 = 0; i2 < bySd.length; i2++) {
      var s2 = bySd[i2];
      var sh = s2.replace("특별자치도", "").replace("특별자치시", "")
                 .replace("특별시", "").replace("광역시", "")
                 .replace("통합특별시", "").replace("도", "");
      if (flat.indexOf(s2) >= 0 || (sh.length >= 2 && flat.indexOf(sh) >= 0)) {
        return { region: s2, ambiguous: false };
      }
    }
    return { region: null, ambiguous: false };
  }


  var NICK = {
    "상무": "광주서구", "치평": "광주서구", "화정": "광주서구",
    "봉선": "광주남구", "진월": "광주남구",
    "용봉": "광주북구", "일곡": "광주북구", "문흥": "광주북구", "두암": "광주북구",
    "수완": "광주광산구", "첨단": "광주광산구", "하남": "광주광산구",
    "송정": "광주광산구", "신가": "광주광산구"
  };

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
    // 증상 -> 진료과 힌트 (사전 순서가 곧 우선순위)
    if (!c.dept) {
      var keys = Object.keys(R.symptoms);
      outer:
      for (var k = 0; k < keys.length; k++) {
        var words = R.symptoms[keys[k]];
        for (var w = 0; w < words.length; w++) {
          if (t.indexOf(words[w]) >= 0) { c.dept = keys[k]; break outer; }
        }
      }
    }

    // 지역
    var flat = t.replace(/\s/g, "");
    var got = resolveRegion(flat);
    c.region = got.region;
    c.ambiguous = got.ambiguous;

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
    el.log.appendChild(node('<div class="notice">예약은 병원에 직접 문의하거나 ' +
      "예약 페이지에서 진행해 주세요. 이 화면에서 예약이 접수되지는 않습니다.</div>"));
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

    bubble(text, "me");
    var merged = (pending ? pending + " " : "") + text;
    var c = extract(merged);

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
    if (notices.length) {
      el.log.appendChild(node('<div class="notice">' +
        esc(notices.join(" ")) + "</div>"));
    }
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
      quick(["감기 걸린 것 같아요", "지금 문 연 병원",
             "주말에도 하는 소아과", "광주 남구 이비인후과"]);
    }
    setTimeout(function () { el.input.focus(); }, 60);
  }
  function close() {
    el.panel.hidden = true;
    document.body.classList.remove("panel-open");
    if (el.assistant) el.assistant.hidden = false;
  }

  /* ── 첫 화면 '내 주변 병원' (실제 데이터) ── */
  var area = "서울 강남구";

  function openPanel() { if (el.panel.hidden) el.fab.click(); }

  function nearbyOf(regionText) {
    var flat = regionText.replace(/\s/g, "");
    var got = resolveRegion(flat);
    var rows = got.region ? filterRegion(HOSP, got.region) : [];
    rows = rows.filter(function (h) { return NON_OUTPATIENT.indexOf(h.c) < 0; });
    if (!rows.length) return [];
    var lat = rows.map(function (h) { return h.y; }).sort()[Math.floor(rows.length / 2)];
    var lon = rows.map(function (h) { return h.x; }).sort()[Math.floor(rows.length / 2)];
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
    drawNearby(nearbyOf(region));
  }

  /* ── 약국 찾기 ──
     약국 자료는 4.5MB 라 첫 화면에서 같이 받지 않고, 누른 사람만 받는다. */
  var pharmLoading = null;

  function ensurePharm() {
    if (PHARM.length) return Promise.resolve(PHARM);
    if (pharmLoading) return pharmLoading;
    pharmLoading = fetch("pharmacies.json?v=202609080930")
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

      var top = hit.slice(0, 5);
      bubble(regionText + " 약국 " + top.length + "곳이에요. (전체 "
             + hit.length + "곳 중 가까운 순)", "bot");
      top.forEach(function (x) {
        var c2 = node(
          '<div class="hcard">' +
            '<div class="top"><span class="name"></span>' +
            '<span class="kind">약국</span></div>' +
            '<div class="line"><span>' + x._km + 'km</span></div>' +
            '<div class="addr"></div>' +
            '<div class="cta"><a class="ghost" href="tel:' + esc(x.t) +
            '">전화하기</a></div>' +
          '</div>');
        c2.querySelector(".name").textContent = x.n;
        c2.querySelector(".addr").textContent = x.a;
        el.log.appendChild(c2);
      });
      el.log.appendChild(node(
        '<div class="notice">건강보험심사평가원 약국정보서비스 자료입니다. ' +
        '영업시간은 공개되어 있지 않아 표시하지 않습니다.</div>'));
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
