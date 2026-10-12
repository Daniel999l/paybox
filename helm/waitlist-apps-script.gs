// Helm waitlist -> Google Sheet
// 1. Create a Google Sheet. Extensions > Apps Script. Paste this file. Save.
// 2. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone. Deploy.
// 3. Copy the web app URL into CONFIG.endpoint in index.html.
function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (sheet.getLastRow() === 0) sheet.appendRow(["time", "handle", "post", "wallet", "ref"]);
  var d = JSON.parse(e.postData.contents);
  var handles = sheet.getRange(1, 2, Math.max(sheet.getLastRow(), 1), 1).getValues().map(function (r) { return String(r[0]).toLowerCase(); });
  var row = handles.indexOf(String(d.handle).toLowerCase()) + 1;
  var values = [d.ts, d.handle, d.post, d.wallet, d.ref];
  if (row > 1) sheet.getRange(row, 1, 1, 5).setValues([values]); else sheet.appendRow(values);
  return ContentService.createTextOutput("ok");
}
