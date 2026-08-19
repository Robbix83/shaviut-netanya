/**
 * Google Apps Script — webhook להוספת לידים לגיליון.
 *
 * התקנה:
 *  1. צרו Google Sheet חדש. בשורה הראשונה הכותרות:
 *     createdAt | name | phone | email | address | neighborhood | rooms | areaSqm | estimateLow | estimateHigh | source
 *  2. Extensions > Apps Script. הדביקו את הקוד הזה. שמרו.
 *  3. Deploy > New deployment > type: Web app.
 *     Execute as: Me  |  Who has access: Anyone
 *  4. העתיקו את כתובת ה-/exec והדביקו ב-.env תחת GOOGLE_SHEETS_WEBHOOK
 */
function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    var d = JSON.parse(e.postData.contents);
    sheet.appendRow([
      d.createdAt || new Date().toISOString(),
      d.name || "",
      d.phone || "",
      d.email || "",
      d.address || "",
      d.neighborhood || "",
      d.rooms || "",
      d.areaSqm || "",
      d.estimateLow || "",
      d.estimateHigh || "",
      d.source || "",
    ]);
    return ContentService.createTextOutput(
      JSON.stringify({ ok: true }),
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ ok: false, error: String(err) }),
    ).setMimeType(ContentService.MimeType.JSON);
  }
}
