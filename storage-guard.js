/*
 * storage-guard.js — keeps the study app working when the browser blocks storage.
 *
 * Loaded with `defer` right before app.js, so it runs before any app module touches
 * localStorage or sessionStorage. Browsers can refuse storage in three ways:
 *   - writes throw (storage full, some private modes),
 *   - any access throws (site data / cookies blocked, sandboxed frames),
 *   - the storage object is missing (Firefox with storage disabled).
 * Without this guard, the first unguarded call during startup stops the app from
 * initialising: pasting does nothing and the Start button never enables.
 *
 * When storage works, this script changes nothing. Only when a probe write fails does it
 * replace that storage area with a resilient wrapper: reads still come from the real
 * storage when the browser allows it (so saved settings survive), and writes the browser
 * refuses are kept in memory for this visit instead of throwing.
 *
 * Do NOT load this on tool pages that hand data to the app (e.g. /quizlet-to-anki/):
 * there a failed write must stay visible so the page can fall back to the clipboard.
 */
(function (global) {
  'use strict';

  var PROBE_KEY = '__same3le_storage_probe__';

  function probe(name) {
    var real = null;
    try {
      real = global[name] || null;
      real.setItem(PROBE_KEY, '1');
      real.removeItem(PROBE_KEY);
      return { ok: true, real: real };
    } catch (error) {
      return { ok: false, real: real };
    }
  }

  function createResilientStorage(real) {
    var memory = Object.create(null);
    var removed = Object.create(null);

    function has(map, key) {
      return Object.prototype.hasOwnProperty.call(map, key);
    }

    function realKeys() {
      var keys = [];
      if (!real) return keys;
      try {
        for (var i = 0; i < real.length; i += 1) {
          var key = real.key(i);
          if (key !== null) keys.push(key);
        }
      } catch (error) { /* unreadable: no real keys */ }
      return keys;
    }

    function allKeys() {
      var keys = [];
      realKeys().forEach(function (key) {
        if (!has(memory, key) && !has(removed, key)) keys.push(key);
      });
      Object.keys(memory).forEach(function (key) { keys.push(key); });
      return keys;
    }

    var storage = {
      getItem: function (key) {
        key = String(key);
        if (has(memory, key)) return memory[key];
        if (has(removed, key) || !real) return null;
        try {
          return real.getItem(key);
        } catch (error) {
          return null;
        }
      },
      setItem: function (key, value) {
        key = String(key);
        value = String(value);
        delete removed[key];
        try {
          real.setItem(key, value);
          delete memory[key];
        } catch (error) {
          memory[key] = value;
        }
      },
      removeItem: function (key) {
        key = String(key);
        delete memory[key];
        try {
          real.removeItem(key);
          delete removed[key];
        } catch (error) {
          removed[key] = true;
        }
      },
      clear: function () {
        memory = Object.create(null);
        try {
          real.clear();
          removed = Object.create(null);
        } catch (error) {
          realKeys().forEach(function (key) { removed[key] = true; });
        }
      },
      key: function (index) {
        var keys = allKeys();
        index = Number(index);
        return index >= 0 && index < keys.length ? keys[index] : null;
      }
    };
    Object.defineProperty(storage, 'length', {
      enumerable: true,
      get: function () { return allKeys().length; }
    });
    return storage;
  }

  var fallbacks = [];
  ['localStorage', 'sessionStorage'].forEach(function (name) {
    var result = probe(name);
    if (result.ok) return;
    var wrapper = createResilientStorage(result.real);
    try {
      Object.defineProperty(global, name, {
        configurable: true,
        enumerable: true,
        get: function () { return wrapper; }
      });
      fallbacks.push(name);
    } catch (error) { /* the browser refused the replacement; behave as before */ }
  });

  global.__same3leStorageFallback = fallbacks;
  if (fallbacks.length && global.console && typeof global.console.warn === 'function') {
    global.console.warn('same3le: browser storage is blocked (' + fallbacks.join(', ') + '). Settings will last for this visit only.');
  }
})(typeof window !== 'undefined' ? window : globalThis);
