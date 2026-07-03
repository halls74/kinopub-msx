/*
 * player.js — MSX Video Plugin for KinoPUB streams.
 *
 * Launched by the shell via:  video:plugin:<PLAYER_URL>?mid=..&id=..&video=..&season=..&pos=..
 *
 * Responsibilities:
 *   - resolve fresh, tokenized stream + subtitle URLs from /v1/items/media-links
 *   - pick quality + stream type from user settings (4K/HDR aware)
 *   - drive an HTML5 <video> element (native HLS on webOS; optional hls.js)
 *   - RESUME playback from the saved position
 *   - periodically save the resume point via /v1/watching/marktime
 *   - apply preferred audio track and subtitles
 *
 * It shares localStorage (tokens/settings) with the interaction plugin because
 * both are served from the same origin. ES5 only.
 */
(function (global) {
    "use strict";

    var C = global.KP_CONFIG, U = global.KP_UTIL, Store = global.KP_STORE, Api = global.KP_API;
    var VP = function () { return global.TVXVideoPlugin; };

    function params() {
        var out = {}, q = (global.location.search || "").replace(/^\?/, ""), pairs = q ? q.split("&") : [], i, kv;
        for (i = 0; i < pairs.length; i++) { kv = pairs[i].split("="); out[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || ""); }
        return out;
    }

    var P = params();
    var ITEM_ID = P.id, MID = P.mid, VIDEO = parseInt(P.video || "1", 10), SEASON = P.season ? parseInt(P.season, 10) : 0,
        START_POS = Math.max(0, parseInt(P.pos || "0", 10));
    var settings = Store.getSettings();

    var video = null;
    var lastMark = 0;         // last time (ms) we sent a marktime
    var markTimer = null;
    var resumed = false;
    var subtitles = [];

    // ---- quality / stream selection ---------------------------------------
    function qNum(label) { var n = parseInt(String(label).replace(/[^0-9]/g, ""), 10); return isFinite(n) ? n : 0; }

    function chooseFile(files) {
        if (!files || !files.length) { return null; }
        var list = files.slice(0), i;
        // numeric quality on each
        for (i = 0; i < list.length; i++) { list[i].__q = qNum(list[i].quality || list[i].quality_id); }
        list.sort(function (a, b) { return a.__q - b.__q; });          // ascending
        if (!settings.allow4k) { list = list.filter(function (f) { return f.__q <= 1080; }); if (!list.length) { list = files.slice(0); } }
        var want = qNum(settings.quality) || 1080, best = null;
        for (i = 0; i < list.length; i++) {                            // highest <= want
            if (list[i].__q <= want) { best = list[i]; }
        }
        if (!best) { best = list[0]; }                                 // else lowest available
        return best;
    }

    function streamUrl(file) {
        if (!file || !file.urls) { return null; }
        var order = [settings.streamType, "hls4", "hls2", "hls", "http"], i;
        for (i = 0; i < order.length; i++) { if (order[i] && file.urls[order[i]]) { return file.urls[order[i]]; } }
        // last resort: any value in urls
        for (var k in file.urls) { if (file.urls.hasOwnProperty(k) && file.urls[k]) { return file.urls[k]; } }
        return null;
    }

    // ---- subtitles --------------------------------------------------------
    function addSubtitles(subs) {
        if (!subs || !subs.length) { return; }
        var i;
        for (i = 0; i < subs.length; i++) {
            (function (sub) {
                // fetch (through same transport) and convert SRT->VTT into a blob
                var xhr = new XMLHttpRequest();
                // subtitle files are cross-origin -> fetch through the proxy /sub
                var surl = C.API_BASE + "/sub?u=" + encodeURIComponent(sub.url);
                try { xhr.open("GET", surl, true); } catch (e) { return; }
                xhr.onreadystatechange = function () {
                    if (xhr.readyState !== 4) { return; }
                    if (xhr.status >= 200 && xhr.status < 300 && xhr.responseText) {
                        var vtt = /\.vtt(\?|$)/i.test(sub.url) ? xhr.responseText : U.srtToVtt(xhr.responseText);
                        var url = U.textBlobUrl(vtt, "text/vtt");
                        var track = document.createElement("track");
                        track.kind = "subtitles";
                        track.label = U.lang(sub.lang) || sub.lang || "Subtitle";
                        track.srclang = sub.lang || "und";
                        track.src = url;
                        video.appendChild(track);
                        subtitles.push({ lang: sub.lang, track: track });
                        applyPreferredSubtitle();
                    }
                };
                xhr.onerror = function () {};
                try { xhr.send(null); } catch (e2) {}
            })(subs[i]);
        }
    }

    function applyPreferredSubtitle() {
        var tt = video.textTracks, i, want = settings.preferSubLang;
        for (i = 0; i < tt.length; i++) {
            tt[i].mode = (want && tt[i].language === want) ? "showing" : "hidden";
        }
    }

    function applyPreferredAudio() {
        var at = video.audioTracks, i, want = settings.preferAudioLang, matched = false;
        if (!at || !at.length) { return; }
        for (i = 0; i < at.length; i++) {
            var on = (want && at[i].language === want);
            if (on) { matched = true; }
            try { at[i].enabled = on; } catch (e) {}
        }
        if (!matched) { try { at[0].enabled = true; } catch (e) {} } // keep first if no match
    }

    // ---- marktime (resume point sync) -------------------------------------
    function saveProgress(force) {
        if (!ITEM_ID || !video) { return; }
        var now = Date.now();
        if (!force && (now - lastMark) < 15000) { return; }  // throttle to ~15s
        lastMark = now;
        var t = Math.floor(video.currentTime || 0);
        if (t <= 0) { return; }
        Api.markTime(ITEM_ID, VIDEO, t, SEASON || null, function () {});
    }

    // ---- load + play ------------------------------------------------------
    function fail(msg) { try { VP().stopLoading(); VP().error(msg, true, true); } catch (e) {} }

    function loadMedia() {
        try { VP().startLoading(); } catch (e) {}
        if (!MID) {
            fail("Нет идентификатора медиа. Обновите список и попробуйте снова.");
            return;
        }
        Api.mediaLinks(MID, function (err, data) {
            if (err || !data) { fail("Не удалось получить ссылки на видео."); return; }
            var file = chooseFile(data.files || []);
            var url = streamUrl(file);
            if (!url) { fail("Поток недоступен для выбранного качества."); return; }
            subtitles = [];
            startVideo(url, data.subtitles || []);
        });
    }

    function startVideo(url, subs) {
        var isHls = /\.m3u8(\?|$)/i.test(url) || settings.streamType.indexOf("hls") === 0;
        // Prefer native playback (webOS handles HLS). Use hls.js only if present and needed.
        if (isHls && global.Hls && global.Hls.isSupported && global.Hls.isSupported() && video.canPlayType("application/vnd.apple.mpegurl") === "") {
            try {
                var hls = new global.Hls();
                hls.loadSource(url);
                hls.attachMedia(video);
            } catch (e) { video.src = url; }
        } else {
            video.src = url;
        }
        addSubtitles(subs);
        try { video.load(); } catch (e) {}
        try { video.play(); } catch (e2) {}
    }

    // ---- MSX player object ------------------------------------------------
    function Player() {
        this.init = function () {
            video = document.getElementById("video");

            video.addEventListener("loadedmetadata", function () {
                try { VP().setDuration(video.duration || 0, true); } catch (e) {}
                if (!resumed && START_POS > 0 && START_POS < (video.duration - 5)) {
                    resumed = true;
                    try { video.currentTime = START_POS; } catch (e2) {}
                    try { VP().setPosition(START_POS, true); } catch (e3) {}
                }
                applyPreferredAudio();
                applyPreferredSubtitle();
            });
            video.addEventListener("canplay", function () { try { VP().stopLoading(); } catch (e) {} });
            video.addEventListener("playing", function () { try { VP().stopLoading(); VP().setState(global.TVXVideoState.PLAYING, true); } catch (e) {} });
            video.addEventListener("pause", function () { saveProgress(true); });
            video.addEventListener("ended", function () {
                saveProgress(true);
                try { VP().setEnded(true, true); } catch (e) {}
            });
            video.addEventListener("timeupdate", function () { saveProgress(false); });
            video.addEventListener("error", function () { fail("Ошибка воспроизведения потока."); });

            // periodic marktime as a safety net (covers platforms with sparse events)
            markTimer = setInterval(function () { saveProgress(false); }, 20000);

            loadMedia();
        };
        this.ready = function () {};
        this.play = function () { try { video.play(); } catch (e) {} };
        this.pause = function () { try { video.pause(); } catch (e) {} };
        this.stop = function () { saveProgress(true); try { video.pause(); } catch (e) {} };
        this.getDuration = function () { return video && isFinite(video.duration) ? video.duration : 0; };
        this.getPosition = function () { return video ? (video.currentTime || 0) : 0; };
        this.setPosition = function (pos) { try { video.currentTime = pos; } catch (e) {} };
        this.setVolume = function (v) { try { video.volume = Math.max(0, Math.min(1, v / 100)); } catch (e) {} };
        this.getVolume = function () { return video ? Math.round(video.volume * 100) : 100; };
        this.setMuted = function (m) { try { video.muted = !!m; } catch (e) {} };
        this.isMuted = function () { return video ? !!video.muted : false; };
        this.getSpeed = function () { return video ? (video.playbackRate || 1) : 1; };
        this.setSpeed = function (s) { try { video.playbackRate = s; } catch (e) {} };
        this.setSize = function (w, h) { /* video is full-screen via CSS */ };
        this.getUpdateData = function () {
            return { position: this.getPosition(), duration: this.getDuration(), speed: this.getSpeed() };
        };
        this.handleEvent = function (data) {
            var ev = U.get(data, "event", "");
            if (ev === "app:suspend" || ev === "app:sleep") { saveProgress(true); }
        };
        this.handleData = function (data) {};
        this.handleRequest = function (dataId, data, callback) { callback(null); };
        this.onError = function (message, error) { saveProgress(true); };
    }

    global.TVXPluginTools.onReady(function () {
        global.TVXVideoPlugin.setupPlayer(new Player());
        global.TVXVideoPlugin.init();
    });

    // ensure we flush progress if the page is torn down
    global.addEventListener("beforeunload", function () { saveProgress(true); if (markTimer) { clearInterval(markTimer); } });

})(typeof window !== "undefined" ? window : this);
