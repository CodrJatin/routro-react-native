// Download resolution and per-architecture detection.
//
// The invite page at /i/ resolves its own download link the same way but far
// more simply -- it only ever needs "some APK" -- so the two are kept in step
// by hand rather than sharing a bundle they have no build step to share.
(function () {
  var REPO = 'CodrJatin/routro-react-native';
  var RELEASES_URL = 'https://github.com/' + REPO + '/releases/latest';

  // A manifest served from this origin, written by scripts/release-apks.ts,
  // rather than a call to api.github.com.
  //
  // The API would work and did, but its unauthenticated limit is 60 requests an
  // hour **per IP** -- and behind carrier-grade NAT, which is how most mobile
  // traffic in India reaches the internet, one address can stand for a lot of
  // people. A landing page whose download button quietly degrades once a few
  // hundred visitors share an exit node is not a good trade for saving a
  // kilobyte of committed JSON. Same-origin also means no CORS preflight, no
  // cross-origin round trip, and no dependency on GitHub's API being up.
  //
  // The APKs stay on GitHub Releases regardless: GitHub blocks files over
  // 100 MiB and the universal build is ~145 MiB, so hosting them here is not
  // an option even before the repo-size question.
  var MANIFEST = '/release.json';

  // The order the list is written in, and the order a fallback walks: the
  // build most devices want first, universal last because it is the answer
  // when nothing else fits rather than a thing to choose.
  var ABIS = ['arm64-v8a', 'armeabi-v7a', 'x86_64', 'universal'];

  var isAndroid = /Android/i.test(navigator.userAgent);

  /**
   * Which build this device wants.
   *
   * Nothing about this is reliable, which is the whole reason the list below
   * it is never more than one click away. Chrome removed the architecture from
   * the user-agent string years ago, and its replacement -- User-Agent Client
   * Hints -- turns out not to fill the gap either: measured on Android Chrome
   * 148, `getHighEntropyValues(['architecture'])` returns the empty string.
   * Only `bitness` comes back populated. So on the single most common browser
   * this page will ever be opened in, the architecture is simply unavailable
   * and the best that can be done is a well-founded guess.
   *
   * Resolves to { abi, confidence }, where confidence is:
   *   'certain' -- the device said which architecture it is
   *   'guess'   -- inferred from bitness, or from nothing at all; arm64 is the
   *                safe bet, since every phone sold for years has been one
   *   'none'    -- not Android at all, so there is nothing to be right about
   */
  function detectAbi() {
    if (!isAndroid) {
      return Promise.resolve({ abi: 'universal', confidence: 'none' });
    }

    var ua = navigator.userAgent;

    // Some browsers -- Firefox for Android among them -- still carry the
    // architecture in the UA string. Checked before the async hints because it
    // costs nothing and resolves synchronously where it works at all.
    if (/aarch64|arm64|armv8/i.test(ua)) {
      return Promise.resolve({ abi: 'arm64-v8a', confidence: 'certain' });
    }
    if (/armv7|armeabi/i.test(ua)) {
      return Promise.resolve({ abi: 'armeabi-v7a', confidence: 'certain' });
    }
    if (/x86_64|x86-64/i.test(ua)) {
      return Promise.resolve({ abi: 'x86_64', confidence: 'certain' });
    }

    var uaData = navigator.userAgentData;
    if (!uaData || !uaData.getHighEntropyValues) {
      return Promise.resolve({ abi: 'arm64-v8a', confidence: 'guess' });
    }

    return uaData
      .getHighEntropyValues(['architecture', 'bitness'])
      .then(function (hints) {
        var arch = (hints.architecture || '').toLowerCase();
        var bits = String(hints.bitness || '');

        if (arch === 'arm') {
          return { abi: bits === '64' ? 'arm64-v8a' : 'armeabi-v7a', confidence: 'certain' };
        }
        if (arch === 'x86') {
          // 32-bit x86 is not built -- no phone ships it and the emulator
          // images stopped defaulting to it years ago. Universal covers it.
          return { abi: bits === '64' ? 'x86_64' : 'universal', confidence: 'certain' };
        }

        // The ordinary Android Chrome case: no architecture, but a bitness.
        // Worth using rather than discarding -- 64-bit Android is arm64 almost
        // without exception (x86_64 means an emulator or a Chromebook, and
        // both of those can pick from the list), while 32-bit is the case the
        // arm64 default would actually fail, and is the one this rescues.
        // Still a guess, so it is labelled as one and the list stays open.
        if (bits === '64') return { abi: 'arm64-v8a', confidence: 'guess' };
        if (bits === '32') return { abi: 'armeabi-v7a', confidence: 'guess' };

        return { abi: 'arm64-v8a', confidence: 'guess' };
      })
      .catch(function () {
        return { abi: 'arm64-v8a', confidence: 'guess' };
      });
  }

  /** Keys the manifest's builds by ABI. The manifest names each one outright,
   * so unlike the old API path there is no filename to parse and no guessing
   * which asset is which -- an unrecognised ABI is simply ignored rather than
   * being filed as universal on a hunch. */
  function indexBuilds(manifest) {
    var byAbi = {};

    (manifest.builds || []).forEach(function (build) {
      if (build && build.abi && build.url) byAbi[build.abi] = build;
    });

    return { byAbi: byAbi, sums: manifest.checksums || null };
  }

  function formatSize(bytes) {
    return (bytes / 1024 / 1024).toFixed(0) + ' MB';
  }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch (error) {
      return '';
    }
  }

  function text(selector, value) {
    var node = document.querySelector(selector);
    if (node) node.textContent = value;
  }

  var DETECTED_COPY = {
    certain: function (abi) {
      return 'DETECTED: ' + abi.toUpperCase();
    },
    guess: function () {
      return 'ARCHITECTURE NOT READABLE — SHOWING THE ONE ALMOST EVERY PHONE USES';
    },
    none: function () {
      return 'ROUTRO IS ANDROID-ONLY — THIS IS THE BUILD THAT RUNS ANYWHERE';
    },
  };

  function render(detection, index, manifest) {
    var byAbi = index ? index.byAbi : {};

    // The detected build if the release has it; universal if it does not.
    //
    // Universal specifically, rather than "the next one in the list". A
    // release missing a variant should still hand over something that runs,
    // and the only build guaranteed to run on an unknown device is the one
    // carrying every architecture. Walking the list instead would offer an
    // arm64 phone the 32-bit build -- which needs compat support the newest
    // 64-bit-only devices no longer have -- and would offer an x86 device an
    // ARM build, which simply does not run.
    var chosenAbi = byAbi[detection.abi]
      ? detection.abi
      : byAbi.universal
        ? 'universal'
        : ABIS.filter(function (abi) {
            return byAbi[abi];
          })[0];
    var chosen = chosenAbi ? byAbi[chosenAbi] : null;

    var detectedNode = document.querySelector('[data-dl-detected]');
    if (detectedNode) {
      detectedNode.textContent = DETECTED_COPY[detection.confidence](chosenAbi || detection.abi);
      detectedNode.classList.toggle('is-guess', detection.confidence === 'guess');
      detectedNode.classList.toggle('is-unsupported', detection.confidence === 'none');
    }

    // Open the list on arrival when the page had to guess -- that is exactly
    // the case where the visitor is the only one who knows the answer.
    var variants = document.querySelector('[data-dl-variants]');
    if (variants && detection.confidence !== 'certain') {
      variants.open = true;
    }

    if (manifest && manifest.tag) {
      text('[data-dl-version]', manifest.tag);
      var versionNode = document.querySelector('[data-dl-version]');
      if (versionNode && manifest.published) {
        versionNode.title = 'Released ' + formatDate(manifest.published);
      }
    }
    if (chosen) {
      text('[data-dl-size]', formatSize(chosen.size));
      text('[data-dl-label]', 'Download · ' + chosenAbi);
    }

    // Every download link on the page, hero and footer included, points at the
    // same file the button does.
    var href = chosen ? chosen.url : RELEASES_URL;
    document.querySelectorAll('[data-dl-primary], [data-install]').forEach(function (link) {
      link.href = href;
    });

    document.querySelectorAll('[data-dl-abi]').forEach(function (row) {
      var abi = row.getAttribute('data-dl-abi');
      var build = byAbi[abi];
      var link = row.querySelector('a');
      var bytes = row.querySelector('[data-dl-bytes]');

      row.classList.toggle('is-detected', abi === chosenAbi && detection.confidence !== 'none');

      if (build) {
        if (link) link.href = build.url;
        if (bytes) bytes.textContent = formatSize(build.size);
      } else if (bytes && index) {
        // Named in the list but absent from a manifest we could actually read
        // -- say so, rather than leaving a dash that reads as "still loading".
        // Guarded on `index` because when the manifest could not be fetched we
        // know nothing about any of them, and "n/a" would be claiming otherwise.
        bytes.textContent = 'n/a';
      }
    });

    if (index && index.sums) {
      var sumsLink = document.querySelector('[data-dl-sums]');
      if (sumsLink) sumsLink.href = index.sums;
    }
  }

  var detecting = detectAbi();
  var fetching = fetch(MANIFEST, { headers: { Accept: 'application/json' } })
    .then(function (response) {
      return response.ok ? response.json() : null;
    })
    .catch(function () {
      // Offline, or the manifest has not been generated yet. Every link on the
      // page keeps pointing at releases/latest, which is where the markup
      // already had them.
      return null;
    });

  Promise.all([detecting, fetching]).then(function (results) {
    render(results[0], results[1] ? indexBuilds(results[1]) : null, results[1]);
  });
})();

// Close the mobile menu once a link in it has been followed, so the
// anchor's target isn't left sitting behind an open panel.
(function () {
  var toggle = document.getElementById('nav-toggle');
  document.querySelectorAll('.nav-links a').forEach(function (link) {
    link.addEventListener('click', function () {
      toggle.checked = false;
    });
  });
})();
