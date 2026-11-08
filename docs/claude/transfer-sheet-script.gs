// VIP Transfer: copies each new application into this Google Sheet and emails the account owner.
// Lives in the Sheet's Apps Script, deployed as a web app (Execute as: Me, Who has access: Anyone).
// SECRET must equal public.transfer_application_settings.webhook_secret (never commit the real value).
const SECRET = 'PASTE_WEBHOOK_SECRET';
const COLUMNS = [
  ['Submitted (MYT)', 'created_at'], ['Full name', 'full_name'], ['Contact number', 'contact_number'], ['WhatsApp', 'whatsapp_number'], ['Email', 'email'],
  ['Previous platform', 'platform_name'], ['Platform link', 'platform_link'], ['Tier there', 'current_tier'], ['Avg monthly deposit', 'avg_deposit'], ['Avg monthly withdrawal', 'avg_withdrawal'],
  ['Why us / why leaving', 'why_us'], ['Has sureWin account', 'has_account'], ['Member ID', 'member_id'], ['Preferred tier', 'preferred_tier'], ['Open in CRM (screenshots)', 'crm_link'], ['Application ID', 'id'],
];

// A leading ' stops Sheets treating answers like "+6012…" or "=…" as formulas.
function asText(value) {
  const text = String(value == null ? '' : value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function reply(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let a;
  try { a = JSON.parse(e.postData.contents); } catch (err) { return reply({ ok: false, error: 'bad json' }); }
  if (a.secret !== SECRET) return reply({ ok: false, error: 'not allowed' });

  a.created_at = Utilities.formatDate(new Date(a.created_at), 'Asia/Kuala_Lumpur', 'yyyy-MM-dd HH:mm');
  const sheet = SpreadsheetApp.getActive().getSheets()[0];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(COLUMNS.map(c => c[0]));
    sheet.getRange(1, 1, 1, COLUMNS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  sheet.appendRow(COLUMNS.map(c => asText(a[c[1]])));

  const body = COLUMNS.map(c => c[0] + ': ' + (a[c[1]] || '-')).join('\n');
  const subject = 'New VIP Transfer application: ' + String(a.full_name).replace(/[\r\n]+/g, ' ') + ' (' + String(a.platform_name).replace(/[\r\n]+/g, ' ') + ')';
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(), subject, body);
  return reply({ ok: true });
}
