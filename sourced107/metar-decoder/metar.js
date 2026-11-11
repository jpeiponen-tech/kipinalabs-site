/* METAR and TAF decoder for the Part 107 study page. No dependencies; runs in the browser and in Node (tests).
   Code meanings follow the FAA Aviation Weather Handbook (FAA-H-8083-28). */
(function (root) {
  "use strict";

  var PHENOMENA = {
    DZ: "drizzle", RA: "rain", SN: "snow", SG: "snow grains", IC: "ice crystals", PL: "ice pellets", GR: "hail",
    GS: "small hail or snow pellets", UP: "unknown precipitation", BR: "mist", FG: "fog", FU: "smoke",
    VA: "volcanic ash", DU: "widespread dust", SA: "sand", HZ: "haze", PY: "spray", PO: "dust or sand whirls",
    SQ: "squalls", FC: "funnel cloud", SS: "sandstorm", DS: "duststorm"
  };
  var PRECIP = ["DZ", "RA", "SN", "SG", "IC", "PL", "GR", "GS", "UP"];
  var DESCRIPTORS = { MI: "shallow", PR: "partial", BC: "patches of", DR: "low drifting", BL: "blowing" };
  var COVER = {
    FEW: "Few clouds (1/8 to 2/8 of the sky)", SCT: "Scattered clouds (3/8 to 4/8)", BKN: "Broken clouds (5/8 to 7/8)",
    OVC: "Overcast (8/8)", VV: "Sky obscured; vertical visibility"
  };
  var CLEAR = {
    SKC: "Sky clear", CLR: "No clouds detected below 12,000 ft (automated station)",
    NSC: "No significant clouds", NCD: "No clouds detected"
  };

  var WX_RE = /^(-|\+|VC)?(MI|PR|BC|DR|BL|SH|TS|FZ)?((?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)*)$/;

  function feet(hundreds) { return (hundreds * 100).toLocaleString("en-US") + " ft"; }

  function fraction(s) {
    var p = s.split("/");
    return p.length === 2 ? Number(p[0]) / Number(p[1]) : Number(s);
  }

  function smText(sm) {
    var whole = Math.floor(sm), rest = sm - whole, frac = "";
    [[1 / 16, "1/16"], [1 / 8, "1/8"], [3 / 16, "3/16"], [1 / 4, "1/4"], [5 / 16, "5/16"], [3 / 8, "3/8"],
     [1 / 2, "1/2"], [5 / 8, "5/8"], [3 / 4, "3/4"], [7 / 8, "7/8"]].forEach(function (f) {
      if (Math.abs(rest - f[0]) < 0.01) frac = f[1];
    });
    if (!frac && rest > 0.01) return sm.toFixed(1) + " statute miles";
    var text = (whole ? whole + (frac ? " " : "") : "") + frac;
    return text + (sm === 1 ? " statute mile" : " statute miles");
  }

  function weatherText(tok) {
    var m = WX_RE.exec(tok);
    if (!m || (!m[2] && !m[3])) return null;
    var codes = m[3].match(/../g) || [];
    if (codes.some(function (c) { return !PHENOMENA[c]; })) return null;
    var names = codes.map(function (c) { return PHENOMENA[c]; }).join(" and ");
    var s;
    if (m[2] === "TS") s = "thunderstorm" + (names ? " with " + names : "");
    else if (m[2] === "SH") s = names ? names + " showers" : "showers";
    else if (m[2] === "FZ") s = "freezing " + names;
    else if (m[2]) s = DESCRIPTORS[m[2]] + " " + names;
    else s = names;
    if (m[1] === "+" && codes[0] === "FC") s = "tornado or waterspout";
    else if (m[1] === "-") s = "light " + s;
    else if (m[1] === "+") s = "heavy " + s;
    // no sign means moderate, but only for falling precipitation (not blowing or drifting snow)
    else if (!m[1] && !DESCRIPTORS[m[2]] && codes.some(function (c) { return PRECIP.indexOf(c) >= 0; })) s = "moderate " + s;
    if (m[1] === "VC") s += " in the vicinity (5 to 10 statute miles from the station)";
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function temp(t) { return t.charAt(0) === "M" ? -Number(t.slice(1)) : Number(t); }

  function dayTime(d, h, m) {
    return "Day " + Number(d) + " of the month, " + h + ":" + (m || "00") + " UTC (Zulu)";
  }

  /* Decode weather conditions (the body of a METAR, or one TAF period). Returns items and a summary. */
  function decodeConditions(tokens) {
    var items = [], state = { visibilitySM: null, ceiling: null, lowestCloud: null, cb: false, unknown: [] };
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i], next = tokens[i + 1], m;
      // 1 1/2SM arrives as two tokens
      if (/^\d$/.test(t) && next && /^\d\/\d{1,2}SM$/.test(next)) { t = t + " " + next; i++; }

      if ((m = /^(VRB|\d{3})(\d{2,3})(?:G(\d{2,3}))?(KT|MPS)$/.exec(t))) {
        var unit = m[4] === "KT" ? "knots" : "meters per second";
        var text = m[1] === "000" && Number(m[2]) === 0 ? "Calm"
          : (m[1] === "VRB" ? "Variable direction" : "From " + m[1] + "° true") + " at " + Number(m[2]) + " " + unit +
            (m[3] ? ", gusting to " + Number(m[3]) + " " + unit : "");
        items.push({ code: t, title: "Wind", text: text });
      } else if ((m = /^(\d{3})V(\d{3})$/.exec(t))) {
        items.push({ code: t, title: "Wind", text: "Direction varying between " + m[1] + "° and " + m[2] + "° true" });
      } else if ((m = /^(M|P)?(\d+ )?(\d+(?:\/\d+)?)SM$/.exec(t))) {
        var sm = (m[2] ? Number(m[2]) : 0) + fraction(m[3]);
        state.visibilitySM = { value: sm, less: m[1] === "M", more: m[1] === "P" };
        items.push({ code: t, title: "Visibility", text: (m[1] === "M" ? "Less than " : m[1] === "P" ? "More than " : "") + smText(sm) });
      } else if (t === "CAVOK") {
        state.visibilitySM = { value: 6.2, more: true };
        items.push({ code: t, title: "Visibility", text: "Ceiling and visibility OK: 10 km or more, no clouds below 5,000 ft, no significant weather" });
      } else if ((m = /^(\d{4})$/.exec(t)) && !state.visibilitySM) {
        var meters = Number(m[1]);
        state.visibilitySM = { value: meters / 1609.344, more: meters === 9999 };
        items.push({ code: t, title: "Visibility", text: meters === 9999 ? "10 kilometers or more" : meters.toLocaleString("en-US") + " meters" });
      } else if ((m = /^R(\d{2}[LRC]?)\/(M|P)?(\d{4})(?:V(M|P)?(\d{4}))?(FT)?\/?([UDN])?$/.exec(t))) {
        var trend = { U: ", improving", D: ", worsening", N: ", no change" }[m[7]] || "";
        var range = (m[2] === "M" ? "less than " : m[2] === "P" ? "more than " : "") + Number(m[3]).toLocaleString("en-US") +
          (m[5] ? " to " + (m[4] === "M" ? "less than " : m[4] === "P" ? "more than " : "") + Number(m[5]).toLocaleString("en-US") : "");
        items.push({ code: t, title: "Runway visual range", text: "Runway " + m[1] + ": " + range + (m[6] ? " ft" : " meters") + trend });
      } else if (CLEAR[t]) {
        items.push({ code: t, title: "Clouds", text: CLEAR[t] });
      } else if ((m = /^(FEW|SCT|BKN|OVC|VV)(\d{3}|\/\/\/)(CB|TCU)?$/.exec(t))) {
        var known = m[2] !== "///", h = known ? Number(m[2]) : null;
        var extra = m[3] === "CB" ? ", cumulonimbus" : m[3] === "TCU" ? ", towering cumulus" : "";
        if (m[3] === "CB") state.cb = true;
        if (known && (state.lowestCloud === null || h < state.lowestCloud)) state.lowestCloud = h;
        if (known && /BKN|OVC|VV/.test(m[1]) && (state.ceiling === null || h < state.ceiling)) state.ceiling = h;
        items.push({ code: t, title: "Clouds", text: COVER[m[1]] + (known ? (m[1] === "VV" ? " " : " at ") + feet(h) + " above ground level" : ", height not reported") + extra + (known && /BKN|OVC|VV/.test(m[1]) && state.ceiling === h ? " (ceiling)" : "") });
      } else if ((m = /^(M?\d{2})\/(M?\d{2})?$/.exec(t))) {
        items.push({ code: t, title: "Temperature / dew point", text: temp(m[1]) + " °C" + (m[2] ? ", dew point " + temp(m[2]) + " °C (spread " + (temp(m[1]) - temp(m[2])) + " °C)" : ", dew point missing") });
      } else if ((m = /^A(\d{4})$/.exec(t))) {
        items.push({ code: t, title: "Altimeter", text: (Number(m[1]) / 100).toFixed(2) + " inches of mercury" });
      } else if ((m = /^Q(\d{4})$/.exec(t))) {
        items.push({ code: t, title: "Altimeter", text: Number(m[1]) + " hectopascals" });
      } else if ((m = /^WS(\d{3})\/(\d{3})(\d{2,3})KT$/.exec(t))) {
        items.push({ code: t, title: "Wind shear", text: "Low-level wind shear at " + feet(Number(m[1])) + ": wind from " + m[2] + "° at " + Number(m[3]) + " knots" });
      } else if (t === "NSW") {
        items.push({ code: t, title: "Weather", text: "No significant weather" });
      } else if (weatherText(t)) {
        items.push({ code: t, title: "Weather", text: weatherText(t) });
      } else {
        state.unknown.push(t);
        items.push({ code: t, title: "Not decoded", text: "This decoder doesn't recognize this group." });
      }
    }
    state.category = flightCategory(state);
    return { items: items, summary: state };
  }

  /* VFR, MVFR, IFR or LIFR from ceiling and visibility (FAA and Aviation Weather Center definitions). */
  function flightCategory(s) {
    var v = s.visibilitySM, c = s.ceiling;
    if (!v && c === null) return null;
    function rank(cat) { return ["LIFR", "IFR", "MVFR", "VFR"].indexOf(cat); }
    var byVis = !v ? "VFR" : v.value < 1 ? "LIFR" : v.value < 3 ? "IFR" : v.value <= 5 && !v.more ? "MVFR" : "VFR";
    var byCeil = c === null ? "VFR" : c < 5 ? "LIFR" : c < 10 ? "IFR" : c <= 30 ? "MVFR" : "VFR";
    var cat = rank(byVis) < rank(byCeil) ? byVis : byCeil;
    return { code: cat, partial: !v }; // no visibility group: judged on the ceiling alone
  }

  /* Remarks: decode the common automated ones, keep the rest as written. */
  function decodeRemarks(tokens) {
    var items = [], m;
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (t === "AO1") items.push({ code: t, title: "Remark", text: "Automated station without a precipitation sensor" });
      else if (t === "AO2") items.push({ code: t, title: "Remark", text: "Automated station with a precipitation sensor" });
      else if ((m = /^SLP(\d{3})$/.exec(t))) {
        var hpa = Number(m[1]) / 10 + (Number(m[1]) >= 500 ? 900 : 1000);
        items.push({ code: t, title: "Remark", text: "Sea-level pressure " + hpa.toFixed(1) + " hectopascals" });
      } else if (t === "SLPNO") items.push({ code: t, title: "Remark", text: "Sea-level pressure not available" });
      else if ((m = /^T([01])(\d{3})(?:([01])(\d{3}))?$/.exec(t))) {
        var tc = (m[1] === "1" ? -1 : 1) * Number(m[2]) / 10;
        items.push({ code: t, title: "Remark", text: "Temperature " + tc.toFixed(1) + " °C" + (m[3] ? ", dew point " + ((m[3] === "1" ? -1 : 1) * Number(m[4]) / 10).toFixed(1) + " °C" : "") });
      } else if (t === "PK" && tokens[i + 1] === "WND" && (m = /^(\d{3})(\d{2,3})\/(\d{2})?(\d{2})$/.exec(tokens[i + 2] || ""))) {
        items.push({ code: "PK WND " + tokens[i + 2], title: "Remark", text: "Peak wind from " + m[1] + "° at " + Number(m[2]) + " knots, at " + (m[3] ? m[3] + ":" : "minute ") + m[4] + (m[3] ? " UTC" : " past the hour") });
        i += 2;
      } else if (t === "WSHFT" && (m = /^(\d{2})?(\d{2})$/.exec(tokens[i + 1] || ""))) {
        items.push({ code: "WSHFT " + tokens[i + 1], title: "Remark", text: "Wind shift at " + (m[1] ? m[1] + ":" + m[2] + " UTC" : "minute " + m[2] + " past the hour") });
        i += 1;
      } else if (t === "$") items.push({ code: t, title: "Remark", text: "The station needs maintenance" });
      else items.push({ code: t, title: "Remark", text: "Not decoded here; kept as written." });
    }
    return items;
  }

  function tokenize(text) {
    return text.toUpperCase().replace(/=/g, " ").trim().split(/\s+/).filter(Boolean);
  }

  function decodeMetar(text) {
    var tokens = tokenize(text), i = 0, items = [], m;
    var type = "METAR";
    if (tokens[i] === "METAR" || tokens[i] === "SPECI") {
      type = tokens[i];
      items.push({ code: tokens[i], title: "Report type", text: type === "SPECI" ? "Special (unscheduled) observation" : "Routine hourly observation" });
      i++;
    }
    if (!/^[A-Z][A-Z0-9]{3}$/.test(tokens[i] || "")) throw new Error("Expected a 4-letter station code, like KJFK, at the start.");
    var station = tokens[i];
    items.push({ code: station, title: "Station", text: "ICAO airport code " + station });
    i++;
    if ((m = /^(\d{2})(\d{2})(\d{2})Z$/.exec(tokens[i] || ""))) {
      items.push({ code: tokens[i], title: "Observed", text: dayTime(m[1], m[2], m[3]) });
      i++;
    }
    while (tokens[i] === "AUTO" || tokens[i] === "COR") {
      items.push({ code: tokens[i], title: "Report type", text: tokens[i] === "AUTO" ? "Fully automated report, no human observer" : "Corrected report" });
      i++;
    }
    var rmk = tokens.indexOf("RMK", i);
    var body = decodeConditions(tokens.slice(i, rmk < 0 ? undefined : rmk));
    var remarks = rmk < 0 ? [] : [{ code: "RMK", title: "Remarks", text: "Remarks follow" }].concat(decodeRemarks(tokens.slice(rmk + 1)));
    return { kind: type, station: station, items: items.concat(body.items, remarks), summary: body.summary };
  }

  function decodeTaf(text) {
    var tokens = tokenize(text), i = 0, items = [], m;
    if (tokens[i] === "TAF") i++;
    while (tokens[i] === "AMD" || tokens[i] === "COR") {
      items.push({ code: tokens[i], title: "Forecast type", text: tokens[i] === "AMD" ? "Amended forecast" : "Corrected forecast" });
      i++;
    }
    if (!/^[A-Z][A-Z0-9]{3}$/.test(tokens[i] || "")) throw new Error("Expected a 4-letter station code after TAF.");
    var station = tokens[i++];
    items.push({ code: station, title: "Station", text: "ICAO airport code " + station });
    if ((m = /^(\d{2})(\d{2})(\d{2})Z$/.exec(tokens[i] || ""))) { items.push({ code: tokens[i], title: "Issued", text: dayTime(m[1], m[2], m[3]) }); i++; }
    if ((m = /^(\d{2})(\d{2})\/(\d{2})(\d{2})$/.exec(tokens[i] || ""))) {
      items.push({ code: tokens[i], title: "Valid", text: "From day " + Number(m[1]) + " " + m[2] + ":00 UTC to day " + Number(m[3]) + " " + m[4] + ":00 UTC" });
      i++;
    }
    // Split the rest into periods at FM, TEMPO, BECMG and PROB groups
    var periods = [], current = { code: "", title: "Base forecast", text: "Conditions from the start of the valid period", tokens: [] };
    for (; i < tokens.length; i++) {
      var t = tokens[i], span = /^(\d{2})(\d{2})\/(\d{2})(\d{2})$/;
      var start = null;
      if ((m = /^FM(\d{2})(\d{2})(\d{2})$/.exec(t))) start = { code: t, title: "From " + dayTime(m[1], m[2], m[3]).replace("Day", "day"), text: "Conditions change to these from this time" };
      else if (t === "TEMPO" || t === "BECMG" || /^PROB(30|40)$/.test(t)) {
        var code = t, title;
        if (/^PROB/.test(t) && tokens[i + 1] === "TEMPO") { code += " TEMPO"; i++; }
        if ((m = span.exec(tokens[i + 1] || ""))) { code += " " + tokens[i + 1]; i++; }
        var when = m ? "day " + Number(m[1]) + " " + m[2] + ":00 to day " + Number(m[3]) + " " + m[4] + ":00 UTC" : "";
        if (t === "TEMPO") title = "Temporarily, " + when;
        else if (t === "BECMG") title = "Becoming, " + when;
        else title = t.slice(4) + "% chance" + (code.indexOf("TEMPO") > 0 ? " of temporary" : "") + ", " + when;
        start = { code: code, title: title, text: t === "TEMPO" || code.indexOf("TEMPO") > 0 ? "Fluctuations lasting under an hour each, less than half the period" : t === "BECMG" ? "A gradual change during this period" : "Probability of these conditions" };
      }
      if (start) { periods.push(current); current = start; current.tokens = []; }
      else current.tokens.push(t);
    }
    periods.push(current);
    periods = periods.filter(function (p) { return p.tokens.length || p.code; }).map(function (p) {
      var d = decodeConditions(p.tokens);
      return { code: p.code, title: p.title, text: p.text, items: d.items, summary: d.summary };
    });
    return { kind: "TAF", station: station, items: items, periods: periods };
  }

  function decode(text) {
    var tokens = tokenize(text);
    if (!tokens.length) throw new Error("Paste a METAR or TAF first.");
    return tokens[0] === "TAF" ? decodeTaf(text) : decodeMetar(text);
  }

  /* Part 107 weather minimums (14 CFR 107.51): 3 SM visibility, 500 ft below clouds, 400 ft above ground. */
  function part107(summary) {
    var out = [], v = summary.visibilitySM;
    if (v) {
      var ok = v.value >= 3;
      out.push({ ok: ok, rule: "14 CFR 107.51(c)", text: ok
        ? "Reported visibility (" + (v.more ? "more than " : "") + smText(v.value) + ") is at least the 3 statute miles Part 107 requires."
        : "Reported visibility (" + (v.less ? "less than " : "") + smText(v.value) + ") is below the 3 statute miles Part 107 requires." });
    }
    if (summary.lowestCloud !== null) {
      var base = summary.lowestCloud * 100, top = Math.min(400, base - 500);
      out.push({ ok: top > 0, rule: "14 CFR 107.51(d)", text: top > 0
        ? "Lowest reported cloud base is " + base.toLocaleString("en-US") + " ft. Staying 500 ft below it allows up to " + top + " ft above ground" + (top === 400 ? " (the 400 ft limit applies first)." : ".")
        : "Lowest reported cloud base is " + base.toLocaleString("en-US") + " ft, so staying 500 ft below it leaves no room to fly." });
    }
    return out;
  }

  var api = { decode: decode, decodeMetar: decodeMetar, decodeTaf: decodeTaf, part107: part107, weatherText: weatherText };
  if (typeof module === "object" && module.exports) module.exports = api; else root.MetarDecoder = api;
})(this);
