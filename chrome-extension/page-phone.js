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
      var match = jid.match(/(\d+)@/);
      if (match) phone = match[1];
    }
  } catch(e) {
    debug.push('error: ' + e.message);
  }

  window.dispatchEvent(new CustomEvent('lumied-phone-result', {
    detail: { phone: phone, jid: jid, debug: debug }
  }));
});
