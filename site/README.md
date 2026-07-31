# Invite site

The static half of the add-a-friend-by-link flow. Nothing here is built or
bundled with the app — it is published on its own and referenced by URL.

| File | Purpose |
| --- | --- |
| `ms/index.html` | The page an invite link opens. Reads `?u=<public_uid>` and offers "Open in MetroSync". |
| `.well-known/assetlinks.json` | Proves to Android that this domain and the app belong together, so verified links skip the page and open the app directly. |
| `.nojekyll` | GitHub Pages runs Jekyll by default, and Jekyll drops every path starting with a dot — including `.well-known`. Without this the asset links 404. |

## The domain-root constraint

Android only ever looks for asset links at **`https://<host>/.well-known/assetlinks.json`** —
the root of the domain, never a subpath. `https://example.com/project/.well-known/…`
is not consulted and App Links will silently stay unverified.

Any host that gives you the domain root works: Vercel, Netlify, Cloudflare
Pages, S3, or your own domain. It rules out a GitHub Pages *project* site
(`codrjatin.github.io/metrosync-react-native/…`), which can't write to the
domain root — that route needs a *user* site instead, a repo named exactly
`CodrJatin.github.io`.

## Publishing to Vercel

Deploy this folder as its own project:

1. New project → import this repo → set **Root Directory** to `site`.
2. Framework preset **Other**, no build command. The files ship as-is.
3. Deploy, then confirm both URLs load on the *production* domain:
   - `https://<project>.vercel.app/ms/?u=a944aac2`
   - `https://<project>.vercel.app/.well-known/assetlinks.json` (must come back
     as `application/json`, not HTML)

Two things to watch:

- **Use the production domain, never a preview URL.** Every preview deployment
  gets its own hostname, and App Links only verify the exact host compiled into
  the manifest.
- `.nojekyll` is inert here — it exists for the GitHub Pages route, where Jekyll
  would otherwise drop `.well-known` entirely. Harmless to leave in place.

**No `vercel.json` is needed.** Vercel serves `.well-known/assetlinks.json` with
the right content type on its own, `/ms/` resolves to `index.html` by default,
and the default cache policy for static files already revalidates — pinning a
`max-age` here would only make a fingerprint update take *longer* to propagate.
(The Vercel bug you may find in searches is about `apple-app-site-association`,
which is extensionless and gets mis-typed. If iOS Universal Links are ever added,
that one file will need an explicit `Content-Type` header in `vercel.json`.)

## Growing this into a landing page

The invite page deliberately lives at `/ms/`, not `/`, and the App Links
`pathPrefix` in `app.json` is scoped to `/ms` for the same reason. So the root is
free: drop a `site/index.html` in and it becomes the marketing page, with no
change to the app, the intent filters, or any invite link already in the wild.

That scoping is also what you want behaviourally — a `/` prefix would mean
tapping *any* link to your domain tries to open the app, including someone
sharing the landing page itself.

## Pointing the app at it

Wherever you publish, two values have to agree:

| Where | What |
| --- | --- |
| `INVITE_BASE_URL` in `src/friends/inviteLink.ts` | Full URL of the page, trailing slash included |
| `expo.android.intentFilters[].data.host` (+ `pathPrefix`) in `app.json` | Same host, same path prefix |

The second is native config, so it needs a rebuild to take effect. The first
takes effect on the next JS bundle.

## Filling in the fingerprint

`assetlinks.json` ships with a `REPLACE_WITH_SHA256_FINGERPRINT` placeholder.
Get the real value from the credentials EAS signs release builds with:

```bash
npx eas credentials -p android
```

Pick the `production` profile and copy the value shown as **SHA256 Fingerprint**
(uppercase hex, colon-separated). Paste it into the array in place of the
placeholder.

### When the fingerprint changes

Not per release. It identifies the **signing key**, not the build, so it stays
put across every new version as long as the key does. It only changes when:

- **You ship through Google Play.** Play App Signing re-signs your upload with
  Google's own key, so the fingerprint Android checks becomes Google's, not
  EAS's. Take it from Play Console → Release → Setup → App signing.
- **The keystore is rotated or regenerated** on EAS.
- **Different profiles use different keys.** `sha256_cert_fingerprints` is an
  array — list every key you ship under. Direct-download APKs signed by EAS plus
  Play-signed installs means both go in.

Getting it wrong is quiet: verification just fails and links fall back to the
web page, with nothing in the app to tell you why. `adb shell pm get-app-links`
below is how you find out.

## Verifying it works

After a build that includes the intent filters is installed:

```bash
adb shell pm get-app-links com.metrosync.app
```

The host should be listed as `verified`. If it says `legacy_failure` or
`unverified`, Android either couldn't fetch the file, or the fingerprint didn't
match the one the installed APK was signed with. Re-check with:

```bash
adb shell pm verify-app-links --re-verify com.metrosync.app
```

Note that verification needs network access on first install and can lag by a
few seconds.
