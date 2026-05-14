// Lumied CRM — Page-level script (runs in MAIN world)
// Extracts phone number from WhatsApp Web's internal APIs.
// WhatsApp now uses @lid (Linked Device ID) instead of @c.us for chats.
// We need to resolve the LID back to a real phone number.

window.addEventListener('lumied-get-phone', function() {
  var phone = null;
  var jid = null;
  var debug = [];
  var activeChat = null;
  var isGroup = false;
  var storeName = null; // pushname/verifiedName/name/notifyName do contato (sem ~)

  // Helper: extrai melhor nome disponivel do objeto contact
  function pickNameFromContact(c) {
    if (!c) return null;
    var candidates = [c.name, c.verifiedName, c.pushname, c.notifyName, c.formattedName, c.shortName];
    for (var i = 0; i < candidates.length; i++) {
      var n = candidates[i];
      if (typeof n === 'string') n = n.trim();
      // rejeitar vazio, numero puro, e o proprio LID/JID
      if (n && !/^[\d\s\-+()]+$/.test(n) && !/@(lid|c\.us|g\.us|s\.whatsapp)/.test(n)) {
        return n.replace(/^~\s*/, ''); // tira til se vier
      }
    }
    return null;
  }

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

    // ── Step 1.5: Tentar nome do Store via activeChat.contact ──
    // Funciona pra @c.us, @lid e @g.us. Esse é o nome "limpo" sem til.
    if (activeChat) {
      try {
        var ctName = pickNameFromContact(activeChat.contact);
        if (ctName) { storeName = ctName; debug.push('storeName from chat.contact: ' + ctName); }
        // Fallback: alguns chats tem `name` direto
        if (!storeName) {
          var chatName = pickNameFromContact(activeChat);
          if (chatName) { storeName = chatName; debug.push('storeName from chat: ' + chatName); }
        }
      } catch(e) { debug.push('storeName error: ' + e.message); }
    }

    // ── Step 2: Extract phone from JID ──
    if (jid) {
      // Group chats are blocked upstream (no individual phone to capture)
      if (jid.includes('@g.us')) {
        isGroup = true;
        debug.push('group chat detected: ' + jid);

      } else if (jid.includes('@c.us') || jid.includes('@s.whatsapp.net')) {
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
                // Tambem captura nome se ainda nao tem
                if (!storeName) {
                  var ctScanName = pickNameFromContact(ct);
                  if (ctScanName) { storeName = ctScanName; debug.push('storeName from contact scan: ' + ctScanName); }
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

    // ── Method E: IndexedDB lookup (model-storage > contact) ──
    // WhatsApp stores contacts in IndexedDB with both LID and phone number
    if (!phone && jid && jid.includes('@lid')) {
      try {
        var lidUser = jid.split('@')[0];
        debug.push('trying IndexedDB for LID ' + lidUser + '...');

        var dbRequest = indexedDB.open('model-storage');
        dbRequest.onsuccess = function(event) {
          var db = event.target.result;
          var storeNames = Array.from(db.objectStoreNames);
          debug.push('IDB stores: ' + storeNames.join(','));

          // Try 'contact' store first, then others
          var contactStore = storeNames.find(function(s) { return s === 'contact'; })
            || storeNames.find(function(s) { return s.includes('contact'); });

          if (!contactStore) {
            debug.push('no contact store in IDB');
            window.dispatchEvent(new CustomEvent('lumied-phone-result', { detail: { phone: null, jid: jid, isGroup: isGroup, name: storeName, debug: debug } }));
            return;
          }

          var tx = db.transaction([contactStore], 'readonly');
          var store = tx.objectStore(contactStore);
          var getAllReq = store.getAll();
          getAllReq.onsuccess = function() {
            var contacts = getAllReq.result || [];
            debug.push('IDB contacts: ' + contacts.length);

            for (var ci = 0; ci < contacts.length; ci++) {
              var c = contacts[ci];
              // Contact record might have: id (lid or phone), phoneNumber, userid, etc.
              var cId = c.id || c.__x_id || '';
              var cIdStr = typeof cId === 'object' ? (cId._serialized || cId.user || '') : String(cId);

              // Match by LID
              if (cIdStr.includes(lidUser) || cIdStr === jid) {
                // Look for phone in various fields
                var phoneFields = [c.phoneNumber, c.phone, c.number, c.userid, c.pn, c.wid];
                for (var pf = 0; pf < phoneFields.length; pf++) {
                  if (phoneFields[pf]) {
                    var pfStr = typeof phoneFields[pf] === 'object' ? (phoneFields[pf]._serialized || phoneFields[pf].user || '') : String(phoneFields[pf]);
                    var pfMatch = pfStr.match(/(\d{10,13})/);
                    if (pfMatch && !pfStr.includes('@lid')) {
                      phone = pfMatch[1];
                      debug.push('IDB contact match: ' + phone);
                      break;
                    }
                  }
                }
                // Tambem nome do IDB
                if (!storeName) {
                  var idbName = pickNameFromContact(c);
                  if (idbName) { storeName = idbName; debug.push('storeName from IDB: ' + idbName); }
                }
                if (!phone) {
                  // Dump keys for debugging
                  var keys = Object.keys(c).slice(0, 15);
                  debug.push('IDB matched contact keys: ' + keys.join(','));
                }
                break;
              }
            }

            // If still no match, try to find any contact whose LID field matches
            if (!phone) {
              for (var ci2 = 0; ci2 < contacts.length; ci2++) {
                var c2 = contacts[ci2];
                var allVals = JSON.stringify(c2);
                if (allVals.includes(lidUser)) {
                  // Found! Extract any phone-like number that's not the LID
                  var allPhones = allVals.match(/\d{10,13}/g) || [];
                  for (var ap = 0; ap < allPhones.length; ap++) {
                    if (allPhones[ap] !== lidUser && allPhones[ap].length <= 13) {
                      phone = allPhones[ap];
                      debug.push('IDB JSON scan match: ' + phone);
                      break;
                    }
                  }
                  if (phone) break;
                }
              }
            }

            console.log('[Lumied CRM page-phone] IDB result:', phone, 'debug:', debug.join(' | '));
            window.dispatchEvent(new CustomEvent('lumied-phone-result', { detail: { phone: phone, jid: jid, isGroup: isGroup, name: storeName, debug: debug } }));
          };
          getAllReq.onerror = function() {
            debug.push('IDB getAll failed');
            console.log('[Lumied CRM page-phone] IDB error, debug:', debug.join(' | '));
            window.dispatchEvent(new CustomEvent('lumied-phone-result', { detail: { phone: null, jid: jid, isGroup: isGroup, name: storeName, debug: debug } }));
          };
        };
        dbRequest.onerror = function() {
          debug.push('IDB open failed');
          console.log('[Lumied CRM page-phone] IDB open error, debug:', debug.join(' | '));
          window.dispatchEvent(new CustomEvent('lumied-phone-result', { detail: { phone: null, jid: jid, isGroup: isGroup, name: storeName, debug: debug } }));
        };
        return; // async — result dispatched in callbacks
      } catch(e) { debug.push('IDB error: ' + e.message); }
    }

  console.log('[Lumied CRM page-phone] result:', phone, 'debug:', debug.join(' | '));
  window.dispatchEvent(new CustomEvent('lumied-phone-result', {
    detail: { phone: phone, jid: jid, isGroup: isGroup, name: storeName, debug: debug }
  }));
});
