/**
 * ECI Timesheet Management - Google Apps Script Backend
 *
 * Sheets:
 *   entries     : id | name | date | startTime | endTime | category | description | hours | submittedAt | modifiedAt | status | approverName | approvedAt | signatureId | rejectionReason
 *   members     : name | role | hourlyRate | isActive | department | email
 *   config      : key | value
 *   departments : name | approverName | approverEmail
 *   signatures  : name | signatureData | uploadedAt
 */

// ─────────────────────────────────────────
// Constants
// ─────────────────────────────────────────

var SHEET_ENTRIES     = 'entries';
var SHEET_MEMBERS     = 'members';
var SHEET_CONFIG      = 'config';
var SHEET_DEPARTMENTS = 'departments';
var SHEET_SIGNATURES  = 'signatures';

// Column indices (0-based)
var COL_ENTRIES = {
  id:0, name:1, date:2, startTime:3, endTime:4,
  category:5, description:6, hours:7, submittedAt:8, modifiedAt:9,
  status:10, approverName:11, approvedAt:12, signatureId:13, rejectionReason:14
};
var COL_MEMBERS = { name:0, role:1, hourlyRate:2, isActive:3, department:4, email:5 };
var COL_CONFIG  = { key:0, value:1 };
var COL_DEPARTMENTS = { name:0, approverName:1, approverEmail:2 };
var COL_SIGNATURES  = { name:0, signatureData:1, uploadedAt:2 };


// ─────────────────────────────────────────
// Entry Point: GET
// ─────────────────────────────────────────

function doGet(e) {
  try {
    var action = e.parameter.action;

    if (action === 'getConfig')              return jsonResponse(getConfig());
    if (action === 'getMembers')             return jsonResponse(getMembers());
    if (action === 'getEntries')             return jsonResponse(getEntries(e.parameter.name));
    if (action === 'getAllEntries')           return jsonResponse(getAllEntries(e.parameter.department));
    if (action === 'verifyPassword')         return jsonResponse(verifyPassword(e.parameter.password, e.parameter.type));
    if (action === 'getDepartments')         return jsonResponse(getDepartments());
    if (action === 'getPendingByApprover')   return jsonResponse(getPendingByApprover(e.parameter.approverName));
    if (action === 'getSignature')           return jsonResponse(getSignature(e.parameter.name));
    if (action === 'getApproverDepartments') return jsonResponse(getApproverDepartments(e.parameter.name));
    if (action === 'getEntriesByStatus')     return jsonResponse(getEntriesByStatus(e.parameter.status, e.parameter.department));

    return jsonResponse({ error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}


// ─────────────────────────────────────────
// Entry Point: POST
// ─────────────────────────────────────────

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action;

    if (action === 'addEntry')               return jsonResponse(addEntry(body));
    if (action === 'updateEntry')            return jsonResponse(updateEntry(body));
    if (action === 'deleteEntry')            return jsonResponse(deleteEntry(body.id));
    if (action === 'updateRate')             return jsonResponse(updateRate(body.name, body.hourlyRate));
    if (action === 'updateConfig')           return jsonResponse(updateConfig(body.key, body.value));
    if (action === 'addMember')              return jsonResponse(addMember(body));
    if (action === 'updateMember')           return jsonResponse(updateMember(body));
    if (action === 'approveEntries')         return jsonResponse(approveEntries(body));
    if (action === 'rejectEntries')          return jsonResponse(rejectEntries(body));
    if (action === 'uploadSignature')        return jsonResponse(uploadSignature(body));
    if (action === 'addDepartment')          return jsonResponse(addDepartment(body));
    if (action === 'updateDepartment')       return jsonResponse(updateDepartment(body));
    if (action === 'deleteDepartment')       return jsonResponse(deleteDepartment(body));
    if (action === 'updateMemberDepartment') return jsonResponse(updateMemberDepartment(body));
    if (action === 'notifyApprover')         return jsonResponse(notifyApprover(body));

    return jsonResponse({ error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}


// ─────────────────────────────────────────
// GET Handlers
// ─────────────────────────────────────────

function getConfig() {
  var rows = getSheetData(SHEET_CONFIG);
  var result = {};
  rows.forEach(function(row) {
    var key   = String(row[COL_CONFIG.key]).trim();
    var value = String(row[COL_CONFIG.value]).trim();
    if (key) result[key] = value;
  });
  return result;
}

function getMembers() {
  var rows = getSheetData(SHEET_MEMBERS);
  return rows
    .filter(function(row) { return String(row[COL_MEMBERS.isActive]).trim().toLowerCase() === 'true'; })
    .map(function(row) {
      return {
        name:        String(row[COL_MEMBERS.name]).trim(),
        role:        String(row[COL_MEMBERS.role]).trim(),
        hourlyRate:  parseFloat(row[COL_MEMBERS.hourlyRate]) || 0,
        isActive:    true,
        department:  String(row[COL_MEMBERS.department] || '').trim(),
        email:       String(row[COL_MEMBERS.email] || '').trim()
      };
    });
}

function getEntries(name) {
  if (!name) return { error: 'name parameter is required' };

  var rows = getSheetData(SHEET_ENTRIES);
  var filtered = rows.filter(function(row) {
    return String(row[COL_ENTRIES.name]).trim() === name.trim();
  });

  var entries = filtered.map(rowToEntry);
  entries.sort(function(a, b) { return b.date.localeCompare(a.date); });
  return entries;
}

function getAllEntries(departmentFilter) {
  var entryRows  = getSheetData(SHEET_ENTRIES);
  var memberRows = getSheetData(SHEET_MEMBERS);

  // Build member lookup map
  var memberMap = {};
  memberRows.forEach(function(row) {
    var name = String(row[COL_MEMBERS.name]).trim();
    if (name) {
      memberMap[name] = {
        role:       String(row[COL_MEMBERS.role]).trim(),
        hourlyRate: parseFloat(row[COL_MEMBERS.hourlyRate]) || 0,
        department: String(row[COL_MEMBERS.department] || '').trim()
      };
    }
  });

  var entries = entryRows.map(function(row) {
    var entry  = rowToEntry(row);
    var member = memberMap[entry.name] || {};
    entry.role       = member.role       || '';
    entry.hourlyRate = member.hourlyRate || 0;
    entry.department = member.department || '';
    return entry;
  });

  // Optional department filter
  if (departmentFilter) {
    entries = entries.filter(function(entry) {
      return entry.department === departmentFilter;
    });
  }

  entries.sort(function(a, b) { return b.date.localeCompare(a.date); });
  return entries;
}

function verifyPassword(password, type) {
  if (!password) return { valid: false, isAdmin: false };

  var config        = getConfig();
  var userPassword  = config['password']      || '';
  var adminPassword = config['adminPassword'] || '';

  var isAdmin = (password === adminPassword && adminPassword !== '');
  var isUser  = (password === userPassword  && userPassword  !== '');

  if (type === 'admin') {
    return { valid: isAdmin, isAdmin: isAdmin };
  }

  // type === 'user': accept both user password and admin password
  return { valid: isUser || isAdmin, isAdmin: isAdmin };
}

function getDepartments() {
  var rows = getSheetData(SHEET_DEPARTMENTS);
  return rows.map(function(row) {
    return {
      name:          String(row[COL_DEPARTMENTS.name] || '').trim(),
      approverName:  String(row[COL_DEPARTMENTS.approverName] || '').trim(),
      approverEmail: String(row[COL_DEPARTMENTS.approverEmail] || '').trim()
    };
  });
}

function getPendingByApprover(approverName) {
  if (!approverName) return { error: 'approverName parameter is required' };

  // Find departments this approver manages
  var deptRows = getSheetData(SHEET_DEPARTMENTS);
  var approverDepts = deptRows.filter(function(row) {
    return String(row[COL_DEPARTMENTS.approverName] || '').trim() === approverName.trim();
  }).map(function(row) {
    return String(row[COL_DEPARTMENTS.name] || '').trim();
  });

  if (approverDepts.length === 0) return [];

  // Build member map: name → department
  var memberRows = getSheetData(SHEET_MEMBERS);
  var memberDeptMap = {};
  memberRows.forEach(function(row) {
    var name = String(row[COL_MEMBERS.name] || '').trim();
    var dept = String(row[COL_MEMBERS.department] || '').trim();
    if (name) memberDeptMap[name] = {
      department: dept,
      role:       String(row[COL_MEMBERS.role] || '').trim()
    };
  });

  // Filter entries: status=pending and member in approver's department(s)
  var entryRows = getSheetData(SHEET_ENTRIES);
  var result = [];
  entryRows.forEach(function(row) {
    var status = String(row[COL_ENTRIES.status] || '').trim();
    if (status !== 'pending') return;

    var memberName = String(row[COL_ENTRIES.name] || '').trim();
    var memberInfo = memberDeptMap[memberName];
    if (!memberInfo) return;
    if (approverDepts.indexOf(memberInfo.department) === -1) return;

    var entry = rowToEntry(row);
    entry.department = memberInfo.department;
    entry.role       = memberInfo.role;
    result.push(entry);
  });

  result.sort(function(a, b) { return b.date.localeCompare(a.date); });
  return result;
}

function getSignature(name) {
  if (!name) return { error: 'name parameter is required' };

  var rows = getSheetData(SHEET_SIGNATURES);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][COL_SIGNATURES.name] || '').trim() === name.trim()) {
      return {
        name:          String(rows[i][COL_SIGNATURES.name]).trim(),
        signatureData: String(rows[i][COL_SIGNATURES.signatureData] || '').trim(),
        uploadedAt:    String(rows[i][COL_SIGNATURES.uploadedAt] || '').trim()
      };
    }
  }

  return { error: 'Signature not found: ' + name };
}

function getApproverDepartments(name) {
  if (!name) return { error: 'name parameter is required' };

  var rows = getSheetData(SHEET_DEPARTMENTS);
  return rows
    .filter(function(row) {
      return String(row[COL_DEPARTMENTS.approverName] || '').trim() === name.trim();
    })
    .map(function(row) {
      return String(row[COL_DEPARTMENTS.name] || '').trim();
    });
}

function getEntriesByStatus(status, departmentFilter) {
  if (!status) return { error: 'status parameter is required' };

  var entryRows  = getSheetData(SHEET_ENTRIES);
  var memberRows = getSheetData(SHEET_MEMBERS);

  // Build member map for department lookup
  var memberMap = {};
  memberRows.forEach(function(row) {
    var name = String(row[COL_MEMBERS.name] || '').trim();
    if (name) memberMap[name] = {
      department: String(row[COL_MEMBERS.department] || '').trim(),
      role:       String(row[COL_MEMBERS.role] || '').trim(),
      hourlyRate: parseFloat(row[COL_MEMBERS.hourlyRate]) || 0
    };
  });

  var entries = entryRows
    .filter(function(row) {
      return String(row[COL_ENTRIES.status] || '').trim() === status;
    })
    .map(function(row) {
      var entry  = rowToEntry(row);
      var member = memberMap[entry.name] || {};
      entry.department = member.department || '';
      entry.role       = member.role       || '';
      entry.hourlyRate = member.hourlyRate || 0;
      return entry;
    });

  // Optional department filter
  if (departmentFilter) {
    entries = entries.filter(function(entry) {
      return entry.department === departmentFilter;
    });
  }

  entries.sort(function(a, b) { return b.date.localeCompare(a.date); });
  return entries;
}


// ─────────────────────────────────────────
// POST Handlers — Entries
// ─────────────────────────────────────────

function addEntry(body) {
  var sheet = getSheet(SHEET_ENTRIES);
  var now   = new Date().toISOString();
  var id    = Utilities.getUuid();

  sheet.appendRow([
    id,
    body.name        || '',
    body.date        || '',
    body.startTime   || '',
    body.endTime     || '',
    body.category    || '',
    body.description || '',
    parseFloat(body.hours) || 0,
    now,   // submittedAt
    '',    // modifiedAt
    'pending', // status
    '',    // approverName
    '',    // approvedAt
    '',    // signatureId
    ''     // rejectionReason
  ]);

  return { success: true, id: id };
}

function updateEntry(body) {
  var sheet = getSheet(SHEET_ENTRIES);
  var data  = sheet.getDataRange().getValues();
  var now   = new Date().toISOString();

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][COL_ENTRIES.id]).trim() === String(body.id).trim()) {
      var row = i + 1; // 1-based
      sheet.getRange(row, COL_ENTRIES.name        + 1).setValue(body.name        || data[i][COL_ENTRIES.name]);
      sheet.getRange(row, COL_ENTRIES.date        + 1).setValue(body.date        || data[i][COL_ENTRIES.date]);
      sheet.getRange(row, COL_ENTRIES.startTime   + 1).setValue(body.startTime   !== undefined ? body.startTime : data[i][COL_ENTRIES.startTime]);
      sheet.getRange(row, COL_ENTRIES.endTime     + 1).setValue(body.endTime     !== undefined ? body.endTime   : data[i][COL_ENTRIES.endTime]);
      sheet.getRange(row, COL_ENTRIES.category    + 1).setValue(body.category    || data[i][COL_ENTRIES.category]);
      sheet.getRange(row, COL_ENTRIES.description + 1).setValue(body.description !== undefined ? body.description : data[i][COL_ENTRIES.description]);
      sheet.getRange(row, COL_ENTRIES.hours       + 1).setValue(parseFloat(body.hours) || data[i][COL_ENTRIES.hours]);
      sheet.getRange(row, COL_ENTRIES.modifiedAt  + 1).setValue(now);

      // If entry was rejected, reset to pending on edit (goes back for re-approval)
      var currentStatus = String(data[i][COL_ENTRIES.status] || '').trim();
      if (currentStatus === 'rejected') {
        sheet.getRange(row, COL_ENTRIES.status          + 1).setValue('pending');
        sheet.getRange(row, COL_ENTRIES.approverName    + 1).setValue('');
        sheet.getRange(row, COL_ENTRIES.rejectionReason + 1).setValue('');
      }

      return { success: true };
    }
  }

  return { error: 'Entry not found: ' + body.id };
}

function deleteEntry(id) {
  if (!id) return { error: 'id is required' };

  var sheet = getSheet(SHEET_ENTRIES);
  var data  = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][COL_ENTRIES.id]).trim() === String(id).trim()) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }

  return { error: 'Entry not found: ' + id };
}


// ─────────────────────────────────────────
// POST Handlers — Approval Workflow
// ─────────────────────────────────────────

function approveEntries(body) {
  if (!body.entryIds || !body.entryIds.length) return { error: 'entryIds is required' };
  if (!body.approverName) return { error: 'approverName is required' };

  var sheet = getSheet(SHEET_ENTRIES);
  var data  = sheet.getDataRange().getValues();
  var now   = new Date().toISOString();
  var count = 0;

  // Build an id→rowIndex map for efficient lookup
  var idToRow = {};
  for (var i = 1; i < data.length; i++) {
    var rowId = String(data[i][COL_ENTRIES.id] || '').trim();
    if (rowId) idToRow[rowId] = i;
  }

  body.entryIds.forEach(function(entryId) {
    var idx = idToRow[String(entryId).trim()];
    if (idx === undefined) return;
    var row = idx + 1; // 1-based
    sheet.getRange(row, COL_ENTRIES.status       + 1).setValue('approved');
    sheet.getRange(row, COL_ENTRIES.approverName + 1).setValue(body.approverName);
    sheet.getRange(row, COL_ENTRIES.approvedAt   + 1).setValue(now);
    sheet.getRange(row, COL_ENTRIES.signatureId  + 1).setValue(body.approverName);
    count++;
  });

  // Send confirmation email to admin
  try {
    var config     = getConfig();
    var adminEmail = config['adminEmail'] || '';
    if (adminEmail) {
      var subject = '[ECI 시수관리] 시수 승인 완료 - ' + body.approverName;
      var emailBody = body.approverName + '님이 시수 ' + count + '건을 승인했습니다.\n\n'
        + '승인 일시: ' + now + '\n\n'
        + '---\nECI 시수관리 시스템';
      MailApp.sendEmail(adminEmail, subject, emailBody);
    }
  } catch (emailErr) {
    // Email failure should not break the main operation
    Logger.log('approveEntries email error: ' + emailErr.message);
  }

  return { success: true, count: count };
}

function rejectEntries(body) {
  if (!body.entryIds || !body.entryIds.length) return { error: 'entryIds is required' };
  if (!body.approverName) return { error: 'approverName is required' };

  var sheet = getSheet(SHEET_ENTRIES);
  var data  = sheet.getDataRange().getValues();
  var count = 0;

  // Build member email map
  var memberRows = getSheetData(SHEET_MEMBERS);
  var memberEmailMap = {};
  memberRows.forEach(function(row) {
    var name  = String(row[COL_MEMBERS.name]  || '').trim();
    var email = String(row[COL_MEMBERS.email] || '').trim();
    if (name) memberEmailMap[name] = email;
  });

  // Build id→rowIndex map
  var idToRow = {};
  for (var i = 1; i < data.length; i++) {
    var rowId = String(data[i][COL_ENTRIES.id] || '').trim();
    if (rowId) idToRow[rowId] = i;
  }

  // Track which submitters we've notified (avoid duplicate emails per batch)
  var notifiedMembers = {};

  body.entryIds.forEach(function(entryId) {
    var idx = idToRow[String(entryId).trim()];
    if (idx === undefined) return;
    var row = idx + 1;
    var memberName = String(data[idx][COL_ENTRIES.name] || '').trim();

    sheet.getRange(row, COL_ENTRIES.status          + 1).setValue('rejected');
    sheet.getRange(row, COL_ENTRIES.approverName    + 1).setValue(body.approverName);
    sheet.getRange(row, COL_ENTRIES.rejectionReason + 1).setValue(body.reason || '');
    count++;

    // Send rejection email to submitter (once per member per batch)
    if (memberName && !notifiedMembers[memberName]) {
      notifiedMembers[memberName] = true;
      try {
        var memberEmail = memberEmailMap[memberName] || '';
        sendRejectionEmail(memberEmail, memberName, body.approverName, body.reason || '');
      } catch (emailErr) {
        Logger.log('rejectEntries email error: ' + emailErr.message);
      }
    }
  });

  return { success: true, count: count };
}

function notifyApprover(body) {
  if (!body.submitterName) return { error: 'submitterName is required' };

  // Look up submitter's department
  var memberRows = getSheetData(SHEET_MEMBERS);
  var submitterDept = '';
  for (var i = 0; i < memberRows.length; i++) {
    if (String(memberRows[i][COL_MEMBERS.name] || '').trim() === body.submitterName.trim()) {
      submitterDept = String(memberRows[i][COL_MEMBERS.department] || '').trim();
      break;
    }
  }

  if (!submitterDept) {
    return { success: true, skipped: true, reason: 'No department found for ' + body.submitterName };
  }

  // Look up department's approver email
  var deptRows = getSheetData(SHEET_DEPARTMENTS);
  var approverEmail = '';
  var approverName  = '';
  for (var j = 0; j < deptRows.length; j++) {
    if (String(deptRows[j][COL_DEPARTMENTS.name] || '').trim() === submitterDept) {
      approverEmail = String(deptRows[j][COL_DEPARTMENTS.approverEmail] || '').trim();
      approverName  = String(deptRows[j][COL_DEPARTMENTS.approverName]  || '').trim();
      break;
    }
  }

  if (!approverEmail) {
    return { success: true, skipped: true, reason: 'No approver email found for department: ' + submitterDept };
  }

  try {
    sendApprovalRequestEmail(
      approverEmail,
      approverName,
      body.submitterName,
      body.entryCount  || 0,
      body.totalHours  || 0
    );
  } catch (emailErr) {
    Logger.log('notifyApprover email error: ' + emailErr.message);
    return { success: true, skipped: true, reason: 'Email send failed: ' + emailErr.message };
  }

  return { success: true };
}


// ─────────────────────────────────────────
// POST Handlers — Signatures
// ─────────────────────────────────────────

function uploadSignature(body) {
  if (!body.name)          return { error: 'name is required' };
  if (!body.signatureData) return { error: 'signatureData is required' };

  var sheet = getSheet(SHEET_SIGNATURES);
  var data  = sheet.getDataRange().getValues();
  var now   = new Date().toISOString();

  // Check if signature already exists for this name
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][COL_SIGNATURES.name] || '').trim() === body.name.trim()) {
      var row = i + 1;
      sheet.getRange(row, COL_SIGNATURES.signatureData + 1).setValue(body.signatureData);
      sheet.getRange(row, COL_SIGNATURES.uploadedAt    + 1).setValue(now);
      return { success: true, updated: true };
    }
  }

  // New signature
  sheet.appendRow([body.name, body.signatureData, now]);
  return { success: true };
}


// ─────────────────────────────────────────
// POST Handlers — Departments
// ─────────────────────────────────────────

function addDepartment(body) {
  if (!body.name) return { error: 'name is required' };

  var rows = getSheetData(SHEET_DEPARTMENTS);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][COL_DEPARTMENTS.name] || '').trim() === body.name.trim()) {
      return { error: 'Department already exists: ' + body.name };
    }
  }

  var sheet = getSheet(SHEET_DEPARTMENTS);
  sheet.appendRow([
    body.name          || '',
    body.approverName  || '',
    body.approverEmail || ''
  ]);

  return { success: true };
}

function updateDepartment(body) {
  if (!body.name) return { error: 'name is required' };

  var sheet = getSheet(SHEET_DEPARTMENTS);
  var data  = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][COL_DEPARTMENTS.name] || '').trim() === body.name.trim()) {
      var row = i + 1;
      if (body.approverName  !== undefined) sheet.getRange(row, COL_DEPARTMENTS.approverName  + 1).setValue(body.approverName);
      if (body.approverEmail !== undefined) sheet.getRange(row, COL_DEPARTMENTS.approverEmail + 1).setValue(body.approverEmail);
      return { success: true };
    }
  }

  return { error: 'Department not found: ' + body.name };
}

function deleteDepartment(body) {
  if (!body.name) return { error: 'name is required' };

  var sheet = getSheet(SHEET_DEPARTMENTS);
  var data  = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][COL_DEPARTMENTS.name] || '').trim() === body.name.trim()) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }

  return { error: 'Department not found: ' + body.name };
}


// ─────────────────────────────────────────
// POST Handlers — Members (extended)
// ─────────────────────────────────────────

function updateRate(name, hourlyRate) {
  if (!name) return { error: 'name is required' };

  var sheet = getSheet(SHEET_MEMBERS);
  var data  = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][COL_MEMBERS.name]).trim() === name.trim()) {
      sheet.getRange(i + 1, COL_MEMBERS.hourlyRate + 1).setValue(parseFloat(hourlyRate) || 0);
      return { success: true };
    }
  }

  return { error: 'Member not found: ' + name };
}

function addMember(body) {
  if (!body.name) return { error: 'name is required' };

  // Prevent duplicate
  var rows = getSheetData(SHEET_MEMBERS);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][COL_MEMBERS.name]).trim() === body.name.trim()) {
      return { error: 'Member already exists: ' + body.name };
    }
  }

  var sheet = getSheet(SHEET_MEMBERS);
  sheet.appendRow([
    body.name       || '',
    body.role       || '',
    parseFloat(body.hourlyRate) || 0,
    true,
    body.department || '',
    body.email      || ''
  ]);

  return { success: true };
}

function updateMember(body) {
  if (!body.name) return { error: 'name is required' };

  var sheet = getSheet(SHEET_MEMBERS);
  var data  = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][COL_MEMBERS.name]).trim() === body.name.trim()) {
      var row = i + 1;
      if (body.role       !== undefined) sheet.getRange(row, COL_MEMBERS.role       + 1).setValue(body.role);
      if (body.hourlyRate !== undefined) sheet.getRange(row, COL_MEMBERS.hourlyRate + 1).setValue(parseFloat(body.hourlyRate) || 0);
      if (body.isActive   !== undefined) sheet.getRange(row, COL_MEMBERS.isActive   + 1).setValue(body.isActive);
      if (body.department !== undefined) sheet.getRange(row, COL_MEMBERS.department + 1).setValue(body.department);
      if (body.email      !== undefined) sheet.getRange(row, COL_MEMBERS.email      + 1).setValue(body.email);
      return { success: true };
    }
  }

  return { error: 'Member not found: ' + body.name };
}

function updateMemberDepartment(body) {
  if (!body.name) return { error: 'name is required' };

  var sheet = getSheet(SHEET_MEMBERS);
  var data  = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][COL_MEMBERS.name]).trim() === body.name.trim()) {
      var row = i + 1;
      if (body.department !== undefined) sheet.getRange(row, COL_MEMBERS.department + 1).setValue(body.department);
      if (body.email      !== undefined) sheet.getRange(row, COL_MEMBERS.email      + 1).setValue(body.email);
      return { success: true };
    }
  }

  return { error: 'Member not found: ' + body.name };
}

function updateConfig(key, value) {
  if (!key) return { error: 'key is required' };

  var sheet = getSheet(SHEET_CONFIG);
  var data  = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][COL_CONFIG.key]).trim() === key.trim()) {
      sheet.getRange(i + 1, COL_CONFIG.value + 1).setValue(value !== undefined ? value : '');
      return { success: true };
    }
  }

  // Key not found — append new row
  sheet.appendRow([key, value !== undefined ? value : '']);
  return { success: true, created: true };
}


// ─────────────────────────────────────────
// Email Helpers
// ─────────────────────────────────────────

function sendApprovalRequestEmail(approverEmail, approverName, submitterName, entryCount, totalHours) {
  var subject = '[ECI 시수관리] 승인 요청 - ' + submitterName;
  var body = approverName + '님,\n\n'
    + submitterName + '님이 시수 ' + entryCount + '건 (총 ' + totalHours + 'h)에 대한 승인을 요청했습니다.\n\n'
    + '프로그램에 접속하여 확인해주세요.\n\n'
    + '---\nECI 시수관리 시스템';
  MailApp.sendEmail(approverEmail, subject, body);
}

function sendRejectionEmail(memberEmail, memberName, approverName, reason) {
  if (!memberEmail) return; // skip if no email
  var subject = '[ECI 시수관리] 시수 반려 안내';
  var body = memberName + '님,\n\n'
    + approverName + '님이 제출하신 시수를 반려했습니다.\n\n'
    + '반려 사유: ' + reason + '\n\n'
    + '수정 후 다시 제출해주세요.\n\n'
    + '---\nECI 시수관리 시스템';
  MailApp.sendEmail(memberEmail, subject, body);
}


// ─────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────

function getSheet(name) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Sheet not found: ' + name);
  return sheet;
}

/**
 * Returns all data rows excluding the header row.
 * Empty trailing rows are excluded.
 */
function getSheetData(name) {
  var sheet = getSheet(name);
  var data  = sheet.getDataRange().getValues();
  if (data.length <= 1) return []; // header only or empty
  return data.slice(1).filter(function(row) {
    return row.some(function(cell) { return String(cell).trim() !== ''; });
  });
}

function rowToEntry(row) {
  return {
    id:              String(row[COL_ENTRIES.id]).trim(),
    name:            String(row[COL_ENTRIES.name]).trim(),
    date:            String(row[COL_ENTRIES.date]).trim(),
    startTime:       String(row[COL_ENTRIES.startTime]   || '').trim(),
    endTime:         String(row[COL_ENTRIES.endTime]     || '').trim(),
    category:        String(row[COL_ENTRIES.category]).trim(),
    description:     String(row[COL_ENTRIES.description]).trim(),
    hours:           parseFloat(row[COL_ENTRIES.hours]) || 0,
    submittedAt:     String(row[COL_ENTRIES.submittedAt]).trim(),
    modifiedAt:      String(row[COL_ENTRIES.modifiedAt]  || '').trim(),
    status:          String(row[COL_ENTRIES.status]          || 'pending').trim(),
    approverName:    String(row[COL_ENTRIES.approverName]    || '').trim(),
    approvedAt:      String(row[COL_ENTRIES.approvedAt]      || '').trim(),
    signatureId:     String(row[COL_ENTRIES.signatureId]     || '').trim(),
    rejectionReason: String(row[COL_ENTRIES.rejectionReason] || '').trim()
  };
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
