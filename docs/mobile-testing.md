# Mobile camera validation

Validated locally on 2026-10-24. This is the temporary camera lab, without
Supabase or saved-note storage. Mobile layout sizes below are CSS pixels,
not claims of testing physical handsets.

## Behavior

- Separate rear-camera capture and album controls use standard file inputs on
  iOS and Android. The browser and operating system choose the native picker.
- `viewport-fit=cover` and all four safe-area insets protect the interface.
  `100svh` avoids a full-screen height based on a collapsed browser toolbar.
- The camera screen has no fixed action bar. It remains scrollable in landscape
  and with enlarged text. At normal text size, its buttons are at least 54px tall.
- Zoom remains enabled. Controls stack at 200% text size, and reduced motion
  disables smooth scrolling, shimmer, and spinner animation.
- Photo preparation keeps the browser-decoded orientation, bounds the longest
  edge to 3000px, and exports a JPEG no larger than 10MiB. Temporary canvas memory
  is released after conversion. Original photos stay on the user's device.
- HEIC/HEIF decoding depends on the browser. Safari supports it from version 17;
  unsupported or damaged files receive a short message asking for a JPG or a new
  camera photo. No universal HEIC decoder or new package has been added.

## Completed checks

| Check | Result |
| --- | --- |
| Chromium layout at 320×568, 360×740, 402×874, 412×915, 440×956 | No horizontal overflow; controls remain usable |
| Landscape layout at 874×402 | Single scrollable flow with bounded preview |
| Simulated top/bottom safe areas (59px/34px) | Applied to page padding |
| Text at 200% in a 402px viewport | Full-width stacked controls; no horizontal overflow |
| Long unbroken title/URL at 200% text | Result remains within the viewport |
| 48MP JPEG with EXIF orientation 6 | Converted to an upright 3000×2250 preview |
| Damaged JPEG | Rejected in the browser with a Korean message |
| Same photo selected twice | Both selections prepare a fresh preview |
| Simulated lost network | Korean error and retry controls remain available |
| macOS Safari upload and live API analysis | Successful, 6.0 seconds for the synthetic text fixture |
| HTTPS idle for 70 seconds after selecting a photo | Same document and photo retained; no automatic reload |
| Updated HTTPS screen, upload and live analysis | Successful, 6.3 seconds for the synthetic text fixture |

These checks do not replace physical iPhone 18 Pro or Android camera testing.
Native camera permissions, the album picker, HEIC decoding, and OS text-size
settings should be checked on the target phones. The earlier phone capture test
was confirmed by the user before this layout update; its device model was not
recorded.

The HTTPS preview also terminates Next's browser HMR connection at the gateway
without forwarding it. Blocking every upgrade caused Next to reload after
repeated failures, clearing a selected photo or completed result. Automated
checks verify authentication, Origin/Host validation, expiry, bounded messages,
and that nothing reaches the upstream app through this connection.

## Phone check after an update

Reload the full HTTPS invitation. Take a portrait photo, select a landscape
photo from the album, and create a note. Rotate the device and enlarge browser
text, then confirm that the controls and complete result remain reachable.
Cancel the picker once and select the same photo again. For supported Safari
versions, include a HEIC photo; on Android, include the camera's normal format.

References: [WebKit safe-area guidance](https://webkit.org/blog/7929/designing-websites-for-iphone-x/),
[mobile viewport units](https://web.dev/blog/viewport-units),
[Safari 17 image formats](https://webkit.org/blog/14445/webkit-features-in-safari-17-0/).
