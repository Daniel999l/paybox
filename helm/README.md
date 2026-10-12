# Helm landing page

Waitlist site for Helm ($HELM), served at https://helm.klin.lol.

## Railway

1. New service from this repo, branch `main`.
2. Settings > Source > Root Directory: `/helm`
3. Variables:
   - `HELM_CA` - the $HELM contract address (0x...). Shows the CA on the site and points every Buy button to its Pons page. Leave empty before launch.
   - `WAITLIST_URL` - Google Apps Script web app URL that saves signups (see `waitlist-apps-script.gs`). Until set, signups are not saved.
4. Settings > Networking > Custom Domain: `helm.klin.lol`

Changing a variable redeploys the service and the site picks up the new value.

## Files

- `index.html` - the site
- `server.js` - tiny Node server, no dependencies, fills in the env vars
- `logo.png`, `og.png`, `x-banner.png` - brand images
