// Multi-language support — Maple Bear RS
const I18N = {
  pt: {
    // Common
    save: 'Salvar', cancel: 'Cancelar', delete: 'Excluir', edit: 'Editar', close: 'Fechar',
    loading: 'Carregando...', search: 'Buscar...', confirm: 'Confirmar', back: 'Voltar',
    yes: 'Sim', no: 'Não', send: 'Enviar', update: 'Atualizar', create: 'Criar',
    // Auth
    login: 'Entrar', logout: 'Sair', email: 'E-mail', password: 'Senha',
    login_bio: 'Entrar com biometria', activate_bio: 'Ativar login por biometria (Face ID / Digital)',
    // Parent portal
    home: 'Início', shift_change: 'Mudança de Turno', activities: 'Atividades Extracurriculares',
    invoices: 'Boletos', lost_found: 'Achados & Perdidos',
    on_my_way: 'Estou a Caminho', select_child: 'Selecione a criança',
    on_way_desc: 'Avise a escola quando você estiver a caminho para buscar seu filho.',
    schedule: 'Agenda', no_items: 'Nenhum item encontrado.',
    // Teacher portal
    pickup_queue: 'Fila de Retirada', diplomas: 'Diplomas & Ranking',
    growth_plan: 'Annual Growth Plan', supplies: 'Materiais',
    certificates: 'Atestados', maintenance: 'Manutenção',
    my_score: 'Minha Pontuação', my_position: 'Minha Posição',
    diplomas_sent: 'Diplomas Enviados', submit_diploma: 'Enviar Diploma de Curso',
    submit_certificate: 'Enviar Atestado Médico',
    open_ticket: 'Abrir Chamado', register_item: 'Registrar Item Encontrado',
    // Gerente
    dashboard_analytics: 'Dashboard Analytics', school_calendar: 'Calendário Escolar',
    emergency: 'Emergência', teams: 'Equipe', settings: 'Configurações',
    families: 'Famílias', access_control: 'Controle de Acesso',
    fire: 'Incêndio', intruder: 'Intruso', medical_emergency: 'Emergência Médica',
    evacuation: 'Evacuação', resolve: 'Resolver',
    // Dates
    months: ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'],
    months_short: ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'],
    weekdays: ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'],
    // Greeting
    hello: 'Olá',
  },
  en: {
    // Common
    save: 'Save', cancel: 'Cancel', delete: 'Delete', edit: 'Edit', close: 'Close',
    loading: 'Loading...', search: 'Search...', confirm: 'Confirm', back: 'Back',
    yes: 'Yes', no: 'No', send: 'Send', update: 'Update', create: 'Create',
    // Auth
    login: 'Log in', logout: 'Log out', email: 'Email', password: 'Password',
    login_bio: 'Log in with biometrics', activate_bio: 'Activate biometric login (Face ID / Fingerprint)',
    // Parent portal
    home: 'Home', shift_change: 'Shift Change', activities: 'Extracurricular Activities',
    invoices: 'Invoices', lost_found: 'Lost & Found',
    on_my_way: 'On My Way', select_child: 'Select child',
    on_way_desc: 'Let the school know when you are on your way to pick up your child.',
    schedule: 'Schedule', no_items: 'No items found.',
    // Teacher portal
    pickup_queue: 'Pickup Queue', diplomas: 'Diplomas & Ranking',
    growth_plan: 'Annual Growth Plan', supplies: 'Supplies',
    certificates: 'Medical Certificates', maintenance: 'Maintenance',
    my_score: 'My Score', my_position: 'My Position',
    diplomas_sent: 'Diplomas Sent', submit_diploma: 'Submit Course Diploma',
    submit_certificate: 'Submit Medical Certificate',
    open_ticket: 'Open Ticket', register_item: 'Register Found Item',
    // Gerente
    dashboard_analytics: 'Analytics Dashboard', school_calendar: 'School Calendar',
    emergency: 'Emergency', teams: 'Team', settings: 'Settings',
    families: 'Families', access_control: 'Access Control',
    fire: 'Fire', intruder: 'Intruder', medical_emergency: 'Medical Emergency',
    evacuation: 'Evacuation', resolve: 'Resolve',
    // Dates
    months: ['January','February','March','April','May','June','July','August','September','October','November','December'],
    months_short: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
    weekdays: ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],
    // Greeting
    hello: 'Hello',
  }
};

// Get/set current language
function getLang() { return localStorage.getItem('mb_lang') || 'pt'; }
function setLang(lang) {
  localStorage.setItem('mb_lang', lang);
  location.reload();
}
function t(key) { return (I18N[getLang()] || I18N.pt)[key] || (I18N.pt[key] || key); }

// Language toggle component
function renderLangToggle(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const lang = getLang();
  el.innerHTML = `<div style="display:inline-flex;border:1.5px solid var(--border,#e2dbd1);border-radius:8px;overflow:hidden;font-size:11px;font-family:'DM Sans',sans-serif;">
    <button onclick="setLang('pt')" style="padding:4px 10px;border:none;cursor:pointer;font-weight:600;font-family:inherit;${lang==='pt'?'background:#C8102E;color:#fff;':'background:#fff;color:#666;'}">PT</button>
    <button onclick="setLang('en')" style="padding:4px 10px;border:none;cursor:pointer;font-weight:600;font-family:inherit;${lang==='en'?'background:#C8102E;color:#fff;':'background:#fff;color:#666;'}">EN</button>
  </div>`;
}
