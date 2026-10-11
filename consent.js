/*
 * consent.js — analytics cookie consent for same3le (EEA, UK and Switzerland).
 *
 * Load this as a plain <script> BEFORE the Google tag on every page that uses Google
 * Analytics. It must run first: Google ignores consent defaults set after the tag.
 *
 * Three layers:
 *  1. Google Consent Mode region default: for visitors whose IP is in the EEA, UK or
 *     Switzerland, Google keeps analytics cookies off until consent. Google decides the
 *     region server-side, so this protects visitors even when the banner can't tell.
 *  2. Devices set to a European time zone get a banner with equally weighted Allow and
 *     Decline buttons. Until they choose, nothing is sent to Google Analytics at all.
 *  3. A stored choice is honoured everywhere: Decline turns measurement off for that
 *     visitor on any page; Allow turns it on. Anyone can change it from the privacy page
 *     (any element with data-consent-reset) or via window.same3leConsent.reset().
 *
 * Advertising features are never used, so ad consent types are always denied.
 */
(function (w, d) {
  'use strict';

  var GA_ID = 'G-8FVETBN9N5';
  var DISABLE_FLAG = 'ga-disable-' + GA_ID;
  var STORAGE_KEY = 'same3le.analyticsConsent.v1';
  var CONSENT_REGIONS = [
    'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
    'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
    'IS', 'LI', 'NO', 'GB', 'CH'
  ];
  // Time zones outside "Europe/..." that belong to EEA countries or their regions.
  var EXTRA_ZONES = [
    'Atlantic/Reykjavik', 'Atlantic/Canary', 'Atlantic/Madeira', 'Atlantic/Azores',
    'Atlantic/Faroe', 'Africa/Ceuta', 'Asia/Nicosia', 'Asia/Famagusta', 'Arctic/Longyearbyen',
    'America/Guadeloupe', 'America/Martinique', 'America/Cayenne', 'Indian/Reunion',
    'Indian/Mayotte', 'GB', 'GB-Eire', 'Eire', 'WET', 'CET', 'MET', 'EET'
  ];

  function timeZone() {
    try {
      return (typeof Intl !== 'undefined' && Intl.DateTimeFormat().resolvedOptions().timeZone) || '';
    } catch (error) {
      return '';
    }
  }

  function isEuropeanTimeZone(zone) {
    return zone.indexOf('Europe/') === 0 || EXTRA_ZONES.indexOf(zone) !== -1;
  }

  function readChoice() {
    try {
      var value = w.localStorage.getItem(STORAGE_KEY);
      return value === 'granted' || value === 'denied' ? value : null;
    } catch (error) {
      return null;
    }
  }

  function storeChoice(value) {
    try {
      if (value) w.localStorage.setItem(STORAGE_KEY, value);
      else w.localStorage.removeItem(STORAGE_KEY);
    } catch (error) { /* storage blocked: the choice lasts for this page only */ }
  }

  w.dataLayer = w.dataLayer || [];
  function gtag() { w.dataLayer.push(arguments); }
  if (typeof w.gtag !== 'function') w.gtag = gtag;

  var zone = timeZone();
  var european = isEuropeanTimeZone(zone);
  var choice = readChoice();

  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    region: CONSENT_REGIONS
  });
  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: european ? 'denied' : 'granted'
  });
  if (choice) gtag('consent', 'update', { analytics_storage: choice });

  // Until a European-time-zone visitor chooses, or after anyone declines, send nothing.
  var heldAtLoad = choice === 'denied' || (!choice && european);
  if (heldAtLoad) w[DISABLE_FLAG] = true;
  var pageViewPending = heldAtLoad;

  function sendPageView() {
    var location = w.location.origin + w.location.pathname;
    var referrer = '';
    try {
      if (d.referrer) {
        var url = new URL(d.referrer);
        referrer = url.origin + url.pathname;
      }
    } catch (error) { /* ignore malformed referrers */ }
    w.gtag('event', 'page_view', { page_title: d.title, page_location: location, page_referrer: referrer });
  }

  var banner = null;

  function hideBanner() {
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    banner = null;
  }

  function setChoice(value) {
    if (value !== 'granted' && value !== 'denied') return;
    choice = value;
    storeChoice(value);
    w.gtag('consent', 'update', { analytics_storage: value });
    w[DISABLE_FLAG] = value === 'denied';
    if (value === 'granted' && pageViewPending) {
      pageViewPending = false;
      sendPageView();
    }
    hideBanner();
    try {
      w.dispatchEvent(new CustomEvent('same3le:consent', { detail: { analytics: value } }));
    } catch (error) { /* very old browsers: nothing listens anyway */ }
  }

  var STYLES = [
    '.s3-consent{position:fixed;z-index:2147483000;left:12px;right:12px;bottom:12px;max-width:640px;margin:0 auto;',
    'padding:16px 18px;border-radius:16px;background:#171717;color:#fff;box-shadow:0 18px 48px rgba(0,0,0,.28);',
    'font:15px/1.5 Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
    'padding-bottom:calc(16px + env(safe-area-inset-bottom,0px))}',
    '.s3-consent p{margin:0 0 12px}',
    '.s3-consent a{color:#ffb391;font-weight:700}',
    '.s3-consent-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
    '.s3-consent button{min-height:46px;padding:10px 14px;border:1px solid rgba(255,255,255,.4);border-radius:11px;',
    'background:#fff;color:#171717;font:inherit;font-weight:800;cursor:pointer}',
    '.s3-consent button:hover{background:#f1ede7}',
    '.s3-consent button:focus-visible{outline:3px solid #ff8a5f;outline-offset:2px}'
  ].join('');

  function showBanner() {
    if (banner || !d.body) return;
    if (!d.getElementById('s3-consent-style')) {
      var style = d.createElement('style');
      style.id = 's3-consent-style';
      style.textContent = STYLES;
      d.head.appendChild(style);
    }
    banner = d.createElement('section');
    banner.className = 's3-consent';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Analytics cookie choice');
    banner.innerHTML =
      '<p>same3le uses Google Analytics cookies to count visits and see which features help people study. ' +
      'No ads, and your cards are never sent. Allow analytics cookies? ' +
      '<a href="/privacy/">Privacy policy</a></p>' +
      '<div class="s3-consent-actions">' +
      '<button type="button" data-consent="granted">Allow</button>' +
      '<button type="button" data-consent="denied">Decline</button>' +
      '</div>';
    banner.addEventListener('click', function (event) {
      var target = event.target;
      var value = target && target.getAttribute ? target.getAttribute('data-consent') : null;
      if (value) setChoice(value);
    });
    d.body.appendChild(banner);
  }

  function reset() {
    choice = null;
    storeChoice(null);
    showBanner();
  }

  w.same3leConsent = {
    choice: function () { return choice; },
    held: function () { return w[DISABLE_FLAG] === true; },
    set: setChoice,
    reset: reset
  };

  function onReady() {
    if (!choice && european) showBanner();
    var resets = d.querySelectorAll('[data-consent-reset]');
    for (var i = 0; i < resets.length; i += 1) {
      resets[i].addEventListener('click', function (event) {
        event.preventDefault();
        reset();
      });
    }
  }

  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', onReady);
  else onReady();
})(window, document);
