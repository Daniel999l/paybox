# Helm landing page

Static waitlist site for Helm ($HELM), served at https://helm.klin.lol.

- `index.html` - the whole site (no build step)
- `logo.png` - favicon and token image (400x400)
- `og.png` - link preview image for X and other sites
- `x-banner.png` - X header (1500x500)
- `waitlist-apps-script.gs` - saves signups to a Google Sheet

## Config

At the bottom of `index.html`, in `CONFIG`:

- `buyUrl` - set to the $HELM page on Pons once the token is live
- `endpoint` - the Google Apps Script web app URL (see the comments in `waitlist-apps-script.gs`). Until this is set, signups are not saved.

## Deploy

Upload this folder to any static host (Vercel, Netlify, Cloudflare Pages) with `helm` as the root directory.
