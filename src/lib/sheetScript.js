// Google Apps Script that lets the CRM mark rows in Marcus's Google Sheets after an email is sent
// (Email a List page → ⚙ Sheet marking setup). The setup panel fills in the token and shows this text to copy.
// Runs as the Google account that deploys it, so it can write to any sheet that account can edit.
// Writes three columns at the end of the header row (made once): CRM Email · Emailed at · Emailed by.
export const SHEET_SCRIPT = `// sureWin CRM: mark emailed rows (paste in Extensions → Apps Script, then Deploy → Web app)
const TOKEN = '__TOKEN__';

function doPost(e) {
  let out;
  try {
    const req = JSON.parse(e.postData.contents);
    if (req.token !== TOKEN) throw new Error('wrong token');
    if (req.action === 'ping' && !req.sheetId) {
      out = { ok: true, account: Session.getEffectiveUser().getEmail() };
    } else {
      const ss = SpreadsheetApp.openById(req.sheetId);
      const sh = ss.getSheets().find(function (s) { return String(s.getSheetId()) === String(req.gid || '0'); });
      if (!sh) throw new Error('tab not found in this sheet');
      if (req.action === 'ping') {
        out = { ok: true, sheet: ss.getName(), tab: sh.getName() };
      } else {
        out = mark(sh, req);
      }
    }
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function mark(sh, req) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const headRow = Number(req.headRow) || 1;
    const lastCol = Math.max(sh.getLastColumn(), 1);
    const head = sh.getRange(headRow, 1, 1, lastCol).getValues()[0].map(function (v) { return String(v).trim(); });
    const col = function (name) {
      let i = head.indexOf(name);
      if (i < 0) { head.push(name); i = head.length - 1; sh.getRange(headRow, i + 1).setValue(name).setFontWeight('bold'); }
      return i + 1;
    };
    const cS = col('CRM Email'), cT = col('Emailed at'), cB = col('Emailed by');
    const emailCol = Number(req.emailCol) || 0;
    const lastRow = sh.getLastRow();
    let emails = null, done = 0, missed = [];
    (req.marks || []).forEach(function (m) {
      let r = Number(m.row);
      const want = String(m.email || '').trim().toLowerCase();
      // Safety: the row must still hold the same email (rows may have been moved); otherwise look it up
      if (emailCol && want) {
        const here = r > headRow && r <= lastRow ? String(sh.getRange(r, emailCol).getValue()).replace(/\\s+/g, '').toLowerCase() : '';
        if (here !== want) {
          if (!emails) emails = sh.getRange(1, emailCol, lastRow, 1).getValues().map(function (x) { return String(x[0]).replace(/\\s+/g, '').toLowerCase(); });
          const i = emails.indexOf(want, headRow);
          r = i >= 0 ? i + 1 : 0;
        }
      }
      if (r > headRow) {
        sh.getRange(r, cS, 1, 1).setValue(m.status || '');
        sh.getRange(r, cT, 1, 1).setValue(m.at || '');
        sh.getRange(r, cB, 1, 1).setValue(m.by || '');
        done++;
      } else missed.push(want);
    });
    return { ok: true, marked: done, missed: missed };
  } finally {
    lock.releaseLock();
  }
}
`
