/*
 * util.js — small ES5 helpers shared by the interaction plugin and the player.
 * No dependencies on the TVX framework so it can be reused in player.html too.
 */
(function (global) {
    "use strict";

    var U = {};

    // --- object / property helpers -----------------------------------------
    U.isArr = function (o) { return Object.prototype.toString.call(o) === "[object Array]"; };
    U.isObj = function (o) { return o !== null && typeof o === "object"; };
    U.isStr = function (o) { return typeof o === "string"; };
    U.isNum = function (o) { return typeof o === "number" && isFinite(o); };

    // safe nested get: get(obj, "a.b.c", fallback)
    U.get = function (obj, path, fallback) {
        var parts = path.split("."), cur = obj, i;
        for (i = 0; i < parts.length; i++) {
            if (cur === null || cur === undefined) { return fallback; }
            cur = cur[parts[i]];
        }
        return (cur === undefined || cur === null) ? fallback : cur;
    };

    // --- query string ------------------------------------------------------
    U.qs = function (params) {
        var out = [], k, v;
        for (k in params) {
            if (!params.hasOwnProperty(k)) { continue; }
            v = params[k];
            if (v === undefined || v === null || v === "") { continue; }
            out.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(v)));
        }
        return out.length ? ("?" + out.join("&")) : "";
    };

    // --- text / html -------------------------------------------------------
    U.esc = function (s) {
        if (s === undefined || s === null) { return ""; }
        return String(s)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    };

    // Split "Title / Original Title" into a clean primary title.
    U.primaryTitle = function (title) {
        if (!title) { return ""; }
        var parts = String(title).split("/");
        return U.trim(parts[0]);
    };
    U.trim = function (s) { return String(s === undefined || s === null ? "" : s).replace(/^\s+|\s+$/g, ""); };

    // --- formatting --------------------------------------------------------
    // seconds -> "1:23:45" or "23:45"
    U.hms = function (sec) {
        sec = Math.max(0, Math.floor(sec || 0));
        var h = Math.floor(sec / 3600),
            m = Math.floor((sec % 3600) / 60),
            s = sec % 60,
            pad = function (n) { return (n < 10 ? "0" : "") + n; };
        return (h > 0) ? (h + ":" + pad(m) + ":" + pad(s)) : (m + ":" + pad(s));
    };

    // minutes -> "1 ч 45 мин" (KinoPUB durations are usually in minutes)
    U.durationMin = function (min) {
        min = Math.max(0, Math.floor(min || 0));
        var h = Math.floor(min / 60), m = min % 60, out = [];
        if (h > 0) { out.push(h + " ч"); }
        if (m > 0 || h === 0) { out.push(m + " мин"); }
        return out.join(" ");
    };

    // KinoPUB rating -> "★ 8.1"
    U.ratingLabel = function (item) {
        var r = item.kinopoisk_rating || item.imdb_rating || item.rating;
        if (!r) { return ""; }
        r = Math.round(r * 10) / 10;
        return "★ " + r;
    };

    // choose a poster url (prefer medium for grids, big for hero)
    U.poster = function (item, size) {
        var p = item.posters || {};
        return p[size] || p.medium || p.big || p.small || "";
    };

    // clamp progress 0..1
    U.progress = function (time, duration) {
        if (!duration || duration <= 0) { return -1; }
        var p = time / duration;
        if (p <= 0) { return -1; }
        if (p >= 0.999) { return 1; }
        return Math.round(p * 1000) / 1000;
    };

    // --- debounce (used by incremental search) -----------------------------
    U.debounce = function (fn, wait) {
        var t = null;
        return function () {
            var ctx = this, args = arguments;
            if (t) { clearTimeout(t); }
            t = setTimeout(function () { t = null; fn.apply(ctx, args); }, wait);
        };
    };

    // --- SRT -> WebVTT ------------------------------------------------------
    // HTML5 <track> needs WebVTT; KinoPUB ships .srt. This converts on the fly.
    U.srtToVtt = function (srt) {
        if (!srt) { return "WEBVTT\n\n"; }
        var body = String(srt)
            .replace(/\r+/g, "")
            // 00:00:12,345 --> 00:00:15,000  =>  dots instead of commas
            .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
        return "WEBVTT\n\n" + body;
    };

    // Build a blob: URL (falls back to data: URL where Blob is unavailable).
    U.textBlobUrl = function (text, mime) {
        mime = mime || "text/vtt";
        try {
            var blob = new Blob([text], { type: mime });
            return (global.URL || global.webkitURL).createObjectURL(blob);
        } catch (e) {
            return "data:" + mime + ";charset=utf-8," + encodeURIComponent(text);
        }
    };

    // pretty language label
    var LANGS = { rus: "Русский", eng: "English", ukr: "Українська", jpn: "日本語", fra: "Français", ger: "Deutsch", deu: "Deutsch", spa: "Español", ita: "Italiano" };
    U.lang = function (code) { return LANGS[code] || (code ? String(code).toUpperCase() : ""); };

    global.KP_UTIL = U;

})(typeof window !== "undefined" ? window : this);
