/*
 * store.js — persistence for auth tokens and user settings.
 *
 * Uses TVXServices.storage when the TVX framework is present (interaction &
 * video plugins both load tvx-plugin.min.js). Falls back to window.localStorage
 * otherwise. Both plugins are served from the SAME origin, so tokens written by
 * the interaction plugin are visible to the player plugin and vice versa.
 */
(function (global) {
    "use strict";

    var C = global.KP_CONFIG;

    function backend() {
        // TVXServices.storage is a TVXStorage instance with get/set/remove.
        if (global.TVXServices && global.TVXServices.storage) { return global.TVXServices.storage; }
        return null;
    }

    function rawGet(key) {
        var b = backend();
        if (b) { return b.get(key, null); }
        try { return global.localStorage.getItem(key); } catch (e) { return null; }
    }
    function rawSet(key, val) {
        var b = backend();
        if (b) { b.set(key, val); return; }
        try { global.localStorage.setItem(key, val); } catch (e) {}
    }
    function rawDel(key) {
        var b = backend();
        if (b) { b.remove(key); return; }
        try { global.localStorage.removeItem(key); } catch (e) {}
    }

    var Store = {

        // --- tokens --------------------------------------------------------
        getAccess: function () { return rawGet(C.STORAGE.ACCESS); },
        getRefresh: function () { return rawGet(C.STORAGE.REFRESH); },
        getExpiresAt: function () {
            var v = rawGet(C.STORAGE.EXPIRES);
            return v ? parseInt(v, 10) : 0;
        },
        isLoggedIn: function () { return !!this.getAccess(); },
        // access token considered stale 60s before real expiry
        isAccessStale: function () {
            var exp = this.getExpiresAt();
            return !exp || Date.now() > (exp - 60000);
        },
        saveTokens: function (t) {
            if (!t) { return; }
            if (t.access_token) { rawSet(C.STORAGE.ACCESS, t.access_token); }
            if (t.refresh_token) { rawSet(C.STORAGE.REFRESH, t.refresh_token); }
            var ttl = (t.expires_in ? parseInt(t.expires_in, 10) : 3600) * 1000;
            rawSet(C.STORAGE.EXPIRES, String(Date.now() + ttl));
        },
        clearTokens: function () {
            rawDel(C.STORAGE.ACCESS);
            rawDel(C.STORAGE.REFRESH);
            rawDel(C.STORAGE.EXPIRES);
        },

        // --- device code (during activation) -------------------------------
        saveDeviceCode: function (obj) { rawSet(C.STORAGE.DEVICE_CODE, JSON.stringify(obj)); },
        getDeviceCode: function () {
            var v = rawGet(C.STORAGE.DEVICE_CODE);
            try { return v ? JSON.parse(v) : null; } catch (e) { return null; }
        },
        clearDeviceCode: function () { rawDel(C.STORAGE.DEVICE_CODE); },

        // --- settings ------------------------------------------------------
        getSettings: function () {
            var v = rawGet(C.STORAGE.SETTINGS), s = null, k;
            try { s = v ? JSON.parse(v) : null; } catch (e) { s = null; }
            // merge over defaults so new keys appear after upgrades
            var merged = {};
            for (k in C.DEFAULT_SETTINGS) {
                if (C.DEFAULT_SETTINGS.hasOwnProperty(k)) { merged[k] = C.DEFAULT_SETTINGS[k]; }
            }
            if (s) { for (k in s) { if (s.hasOwnProperty(k)) { merged[k] = s[k]; } } }
            return merged;
        },
        setSetting: function (key, val) {
            var s = this.getSettings();
            s[key] = val;
            rawSet(C.STORAGE.SETTINGS, JSON.stringify(s));
            return s;
        },
        setSettings: function (obj) { rawSet(C.STORAGE.SETTINGS, JSON.stringify(obj)); }
    };

    global.KP_STORE = Store;

})(typeof window !== "undefined" ? window : this);
