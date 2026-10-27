RUVIXSA SEO AUDIT TOOL — GITHUB UPLOAD PACKAGE

Important: keep this folder structure exactly as shown.

api/
  audit.js
  pagespeed.js
  _lib/audit-handler.mjs
tests/
  audit-core.test.mjs

GitHub website upload: open the repository, choose Add file > Upload files, then drag the CONTENTS of this extracted folder (not the ZIP itself) into the upload area. If folder upload fails, create the paths using Add file > Create new file and enter paths such as api/audit.js; GitHub creates the folders automatically.

The tests folder is for running automated tests; it is not required for the deployed page to run. The api folder contains server endpoints and must keep these exact paths.

Environment variable for PageSpeed: PAGESPEED_API_KEY (set in Vercel project settings, then redeploy).
