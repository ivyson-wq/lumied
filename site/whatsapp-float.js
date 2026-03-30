// Lumied — Botão flutuante WhatsApp (site comercial)
// Inclua <script src="/site/whatsapp-float.js"></script> antes do </body>
(function(){
  var WA_NUMBER = '5500000000000'; // Substituir pelo número real
  var WA_MSG = encodeURIComponent('Olá! Gostaria de saber mais sobre o Lumied.');
  var css = document.createElement('style');
  css.textContent = '.whatsapp-float{position:fixed;bottom:24px;left:24px;z-index:998;display:flex;align-items:center;gap:10px;text-decoration:none;animation:waBounce 2s ease infinite;}.whatsapp-float:hover{text-decoration:none;}.whatsapp-float .wa-btn{width:56px;height:56px;border-radius:50%;background:#25D366;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(37,211,102,.4);transition:transform .2s;}.whatsapp-float:hover .wa-btn{transform:scale(1.1);}.whatsapp-float .wa-btn svg{width:28px;height:28px;fill:#fff;}.whatsapp-float .wa-tooltip{background:#fff;color:#1a1a1a;padding:8px 14px;border-radius:8px;font-family:Inter,sans-serif;font-size:13px;font-weight:500;box-shadow:0 4px 16px rgba(0,0,0,.1);white-space:nowrap;opacity:0;transform:translateX(-8px);transition:all .2s;}.whatsapp-float:hover .wa-tooltip{opacity:1;transform:translateX(0);}@keyframes waBounce{0%,100%{transform:translateY(0);}50%{transform:translateY(-4px);}}@media print{.whatsapp-float{display:none;}}';
  document.head.appendChild(css);
  var a = document.createElement('a');
  a.href = 'https://wa.me/' + WA_NUMBER + '?text=' + WA_MSG;
  a.className = 'whatsapp-float';
  a.target = '_blank';
  a.rel = 'noopener';
  a.innerHTML = '<div class="wa-btn"><svg viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg></div><span class="wa-tooltip">Fale conosco no WhatsApp</span>';
  document.body.appendChild(a);
})();
