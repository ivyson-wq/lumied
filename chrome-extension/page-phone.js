// Lumied CRM — Page-level script (runs in MAIN world)
// Extracts phone number from WhatsApp Web's internal APIs.
// WhatsApp now uses @lid (Linked Device ID) instead of @c.us for chats.
// We need to resolve the LID back to a real phone number.

window.addEventListener('lumied-get-phone', function() {
  var phone = null;
  var jid = null;
  var debug = [];
  var activeChat = null;

  try {
    // ── Step 1: Find the active chat object ──
    // Try window.Store first, then require (webpack modules)
    var chatSources = [];
    if (window.Store?.Chat) chatSources.push({ name: 'Store.Chat', obj: window.Store.Chat });
    if (window.Store?.Chats) chatSources.push({ name: 'Store.Chats', obj: window.Store.Chats });

    // require-based modules (this is what actually works in current WhatsApp Web)
    if (window.require) {
      try { var m = window.require('WAWebCollections'); if (m?.Chat) chatSources.push({ name: 'require.Chat', obj: m.Chat }); } catch(e) {}
      try { var m2 = window.require('WAWebChatCollection'); if (m2) chatSources.push({ name: 'require.ChatColl', obj: m2 }); } catch(e) {}
    }

    for (var i = 0; i < chatSources.length; i++) {
      var src = chatSources[i];
      var chat = src.obj.active || src.obj.getActive?.() || null;
      if (!chat && src.obj.models) {
        for (var j = 0; j < src.obj.models.length; j++) {
          if (src.obj.models[j].active || src.obj.models[j].isActive) { chat = src.obj.models[j]; break; }
        }
      }
      if (chat) {
        activeChat = chat;
        jid = chat.id?._serialized || chat.id?.user || null;
        debug.push(src.name + ': ' + jid);
        break;
      }
    }

    if (!jid) { debug.push('no active chat found'); }

    // ── Step 2: Extract phone from JID ──
    if (jid) {
      if (jid.includes('@c.us') || jid.includes('@s.whatsapp.net')) {
        var match = jid.match(/^(\d{10,15})@/);
        if (match) { phone = match[1]; debug.push('direct @c.us phone: ' + phone); }

      } else if (jid.includes('@lid')) {
        debug.push('LID detected, trying resolution methods...');
        var lidUser = jid.split('@')[0];

        // ── Method A: LidUtils via require ──
        if (!phone) {
          var lidUtilsSources = [];
          if (window.Store?.LidUtils) lidUtilsSources.push(window.Store.LidUtils);
          if (window.require) {
            try { var lu = window.require('WAWebLidUtils'); if (lu) lidUtilsSources.push(lu); } catch(e) {}
            try { var lu2 = window.require('WAWebWidFactory'); if (lu2?.getPhoneNumber) lidUtilsSources.push(lu2); } catch(e) {}
          }
          for (var a = 0; a < lidUtilsSources.length; a++) {
            try {
              var lidObj = { _serialized: jid, user: lidUser, server: 'lid' };
              var fn = lidUtilsSources[a].getPhoneNumber || lidUtilsSources[a].getWid || lidUtilsSources[a].lidToWid;
              if (fn) {
                var result = fn(lidObj);
                if (result) {
                  var rs = result._serialized || result.user || String(result);
                  var rm = rs.match(/(\d{10,15})/);
                  if (rm) { phone = rm[1]; debug.push('LidUtils resolved: ' + phone); break; }
                }
              }
            } catch(e) { debug.push('LidUtils[' + a + '] error: ' + e.message); }
          }
        }

        // ── Method B: Contact object on active chat ──
        if (!phone && activeChat) {
          try {
            var contact = activeChat.contact;
            if (contact) {
              // Try every possible phone field
              var fields = ['id._serialized', 'id.user', 'phoneNumber', 'userid', 'number', 'jid', 'wid._serialized', 'wid.user'];
              for (var b = 0; b < fields.length; b++) {
                var val = fields[b].split('.').reduce(function(o, k) { return o?.[k]; }, contact);
                if (val) {
                  var vs = String(val);
                  // Must contain @c.us or be pure digits
                  var vm = vs.match(/(\d{10,15})(?:@|$)/);
                  if (vm && !vs.includes('@lid') && !vs.includes('@g.us')) {
                    phone = vm[1];
                    debug.push('contact.' + fields[b] + ': ' + phone);
                    break;
                  }
                }
              }
              // Dump all contact keys for debugging if phone not found
              if (!phone) {
                var keys = Object.keys(contact).filter(function(k) { return typeof contact[k] !== 'function' && typeof contact[k] !== 'object'; });
                debug.push('contact keys: ' + keys.join(','));
                var vals = keys.map(function(k) { return k + '=' + String(contact[k]).substring(0, 30); });
                debug.push('contact vals: ' + vals.join(' | '));
              }
            } else {
              debug.push('activeChat.contact is null');
            }
          } catch(e) { debug.push('contact error: ' + e.message); }
        }

        // ── Method C: Contact collection scan ──
        if (!phone) {
          var contactSources = [];
          if (window.Store?.Contact?.models) contactSources.push(window.Store.Contact.models);
          if (window.require) {
            try { var cc = window.require('WAWebCollections'); if (cc?.Contact?.models) contactSources.push(cc.Contact.models); } catch(e) {}
          }
          for (var c = 0; c < contactSources.length; c++) {
            var models = contactSources[c];
            debug.push('scanning ' + models.length + ' contacts...');
            for (var ci = 0; ci < models.length; ci++) {
              var ct = models[ci];
              var ctLid = ct.id?._serialized || '';
              if (ctLid === jid || ct.id?.user === lidUser) {
                // Found! Try to get phone
                var ctFields = [ct.userid, ct.phoneNumber, ct.number, ct.wid?._serialized, ct.wid?.user];
                for (var cf = 0; cf < ctFields.length; cf++) {
                  if (ctFields[cf]) {
                    var cfm = String(ctFields[cf]).match(/(\d{10,15})/);
                    if (cfm) { phone = cfm[1]; debug.push('Contact scan found: ' + phone); break; }
                  }
                }
                if (!phone) {
                  // Dump this contact's keys for debugging
                  var ctKeys = Object.keys(ct).filter(function(k) { return typeof ct[k] !== 'function' && typeof ct[k] !== 'object'; });
                  debug.push('matched contact keys: ' + ctKeys.map(function(k) { return k + '=' + String(ct[k]).substring(0, 25); }).join(' | '));
                }
                break;
              }
            }
            if (phone) break;
          }
        }

        // ── Method D: Check if chat has a 'wid' separate from 'id' ──
        if (!phone && activeChat) {
          try {
            var widPaths = ['wid', 'contactJid', 'pendingAction.wid', 'msgsLoaded.wid'];
            for (var d = 0; d < widPaths.length; d++) {
              var wid = widPaths[d].split('.').reduce(function(o, k) { return o?.[k]; }, activeChat);
              if (wid) {
                var ws = wid._serialized || wid.user || String(wid);
                var wm = ws.match(/(\d{10,15})(?:@c\.us|@s\.whatsapp|$)/);
                if (wm) { phone = wm[1]; debug.push('chat.' + widPaths[d] + ': ' + phone); break; }
              }
            }
          } catch(e) { debug.push('wid scan error: ' + e.message); }
        }

      } else {
        debug.push('unknown jid type: ' + jid);
      }
    }
  } catch(e) {
    debug.push('fatal error: ' + e.message);
  }

  window.dispatchEvent(new CustomEvent('lumied-phone-result', {
    detail: { phone: phone, jid: jid, debug: debug }
  }));
});
