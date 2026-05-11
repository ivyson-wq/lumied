// Lumied CRM — Page-level script (runs in MAIN world, has access to window.Store)
// Extracts phone number from WhatsApp Web's internal Store API.

window.addEventListener('lumied-get-phone', function() {
  var phone = null;
  var jid = null;
  var debug = [];

  try {
    // Strategy 1: window.Store.Chat (most common path)
    if (window.Store && window.Store.Chat) {
      var active = window.Store.Chat.active;
      if (!active && window.Store.Chat.getActive) active = window.Store.Chat.getActive();
      if (active) {
        jid = active.id?._serialized || active.id?.user || null;
        debug.push('Store.Chat.active: ' + jid);
      }
    }

    // Strategy 2: window.Store.Chats.models (fallback)
    if (!jid && window.Store && window.Store.Chats && window.Store.Chats.models) {
      var models = window.Store.Chats.models || window.Store.Chats._models || [];
      for (var i = 0; i < models.length; i++) {
        if (models[i].active || models[i].isActive) {
          jid = models[i].id?._serialized || models[i].id?.user || null;
          debug.push('Store.Chats.models[active]: ' + jid);
          break;
        }
      }
    }

    // Strategy 3: window.Store.Chat.get() with currently visible chat
    if (!jid && window.Store && window.Store.Chat && window.Store.Chat.models) {
      var chatModels = window.Store.Chat.models || [];
      for (var j = 0; j < chatModels.length; j++) {
        if (chatModels[j].active) {
          jid = chatModels[j].id?._serialized || chatModels[j].id?.user || null;
          debug.push('Store.Chat.models[active]: ' + jid);
          break;
        }
      }
    }

    // Strategy 4: Look for Store in different module paths (WA updates move things around)
    if (!jid) {
      var storeKeys = ['Store', '__x_store', 'WWebJS'];
      for (var k = 0; k < storeKeys.length; k++) {
        var store = window[storeKeys[k]];
        if (store && store.Chat) {
          var ch = store.Chat.active || (store.Chat.getActive ? store.Chat.getActive() : null);
          if (ch) {
            jid = ch.id?._serialized || ch.id?.user || null;
            debug.push(storeKeys[k] + '.Chat.active: ' + jid);
            break;
          }
        }
      }
    }

    // Strategy 5: Search for require/webpack modules that expose Chat
    if (!jid && window.require) {
      try {
        var chatModule = window.require('WAWebCollections')?.Chat || window.require('WAWebChatCollection');
        if (chatModule) {
          var activeChat = chatModule.active || chatModule.getActive?.();
          if (activeChat) {
            jid = activeChat.id?._serialized || activeChat.id?.user || null;
            debug.push('require.Chat.active: ' + jid);
          }
        }
      } catch(e) { debug.push('require failed: ' + e.message); }
    }

    // Extract phone from JID
    if (jid) {
      debug.push('raw jid: ' + jid);

      if (jid.includes('@c.us') || jid.includes('@s.whatsapp.net')) {
        // Direct phone JID
        var match = jid.match(/^(\d{10,15})@/);
        if (match) { phone = match[1]; debug.push('phone from @c.us: ' + phone); }

      } else if (jid.includes('@lid')) {
        // LID (Linked Device ID) — need to resolve to real phone number
        debug.push('LID detected, resolving to phone...');

        // Method 1: Store.LidUtils.getPhoneNumber (best approach per whatsapp-web.js)
        try {
          var lidStores = [window.Store, window.__x_store];
          for (var ls = 0; ls < lidStores.length; ls++) {
            if (!lidStores[ls]?.LidUtils) continue;
            var lidObj = { _serialized: jid, user: jid.split('@')[0], server: 'lid' };
            var pnResult = lidStores[ls].LidUtils.getPhoneNumber(lidObj);
            if (pnResult) {
              var pnSerialized = pnResult._serialized || pnResult.user || String(pnResult);
              var pnMatch = pnSerialized.match(/(\d{10,15})/);
              if (pnMatch) { phone = pnMatch[1]; debug.push('LidUtils.getPhoneNumber: ' + phone); }
            }
            if (phone) break;
          }
        } catch(e) { debug.push('LidUtils.getPhoneNumber error: ' + e.message); }

        // Method 2: Contact object on the active chat
        if (!phone) {
          try {
            var lidStores2 = [window.Store, window.__x_store];
            for (var ls2 = 0; ls2 < lidStores2.length; ls2++) {
              if (!lidStores2[ls2]?.Chat) continue;
              var ac = lidStores2[ls2].Chat.active;
              if (!ac) continue;
              // contact.id might be @c.us even when chat.id is @lid
              var cid = ac.contact?.id?._serialized || ac.contact?.id?.user || '';
              var cidMatch = cid.match(/^(\d{10,15})@(?:c\.us|s\.whatsapp)/);
              if (cidMatch) { phone = cidMatch[1]; debug.push('contact.id: ' + phone); break; }
              // contact.phoneNumber or contact.userid
              var cpn = ac.contact?.phoneNumber || ac.contact?.userid || ac.contact?.number || '';
              if (cpn) { var cpnMatch = String(cpn).match(/(\d{10,15})/); if (cpnMatch) { phone = cpnMatch[1]; debug.push('contact.phoneNumber: ' + phone); break; } }
            }
          } catch(e) { debug.push('contact fallback error: ' + e.message); }
        }

        // Method 3: QueryExist to force resolve
        if (!phone) {
          try {
            var lidStores3 = [window.Store, window.__x_store];
            for (var ls3 = 0; ls3 < lidStores3.length; ls3++) {
              if (!lidStores3[ls3]?.QueryExist) continue;
              var qResult = lidStores3[ls3].QueryExist(jid);
              if (qResult && qResult.then) {
                // Can't await in sync context, skip async approach
                debug.push('QueryExist available but async, skipping');
              }
              break;
            }
          } catch(e) { debug.push('QueryExist error: ' + e.message); }
        }

        // Method 4: Scan contact list for matching LID
        if (!phone) {
          try {
            var contactStores = [window.Store, window.__x_store];
            for (var cs = 0; cs < contactStores.length; cs++) {
              var contacts = contactStores[cs]?.Contact?.models || contactStores[cs]?.Contacts?.models || [];
              for (var ci = 0; ci < contacts.length; ci++) {
                var c = contacts[ci];
                var cLid = c.id?._serialized || '';
                if (cLid === jid) {
                  // Found the contact by LID — now get phone from userid/phoneNumber
                  var realPhone = c.userid || c.phoneNumber || c.number || c.id?.user || '';
                  var rpMatch = String(realPhone).match(/(\d{10,15})/);
                  if (rpMatch) { phone = rpMatch[1]; debug.push('Contact.models match: ' + phone); break; }
                }
              }
              if (phone) break;
              // Also check if Contact has a getPhoneNumber method
              if (contactStores[cs]?.Contact?.getPhoneNumber) {
                try {
                  var gpn = contactStores[cs].Contact.getPhoneNumber({ _serialized: jid });
                  if (gpn) { var gpnMatch = String(gpn._serialized || gpn).match(/(\d{10,15})/); if (gpnMatch) { phone = gpnMatch[1]; debug.push('Contact.getPhoneNumber: ' + phone); break; } }
                } catch(e2) { /* skip */ }
              }
            }
          } catch(e) { debug.push('Contact scan error: ' + e.message); }
        }

      } else {
        debug.push('unknown jid type: ' + jid);
      }
    }
  } catch(e) {
    debug.push('error: ' + e.message);
  }

  window.dispatchEvent(new CustomEvent('lumied-phone-result', {
    detail: { phone: phone, jid: jid, debug: debug }
  }));
});
