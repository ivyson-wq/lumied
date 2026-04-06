// Force Service Worker update — include in all portals
// Checks if SW cache is outdated and forces refresh
(function() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.getRegistrations().then(function(registrations) {
    for (var reg of registrations) {
      reg.update();
    }
  });
  // Listen for new SW activation and reload page
  navigator.serviceWorker.addEventListener('controllerchange', function() {
    if (!window._swReloading) {
      window._swReloading = true;
      window.location.reload();
    }
  });
})();
