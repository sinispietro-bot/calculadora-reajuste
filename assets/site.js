// Marca o item do menu como "ativo" conforme a URL
(function(){
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const map = {
    '/': 'nav-home',
    '/dicas': 'nav-dicas',
    '/ferramentas': 'nav-ferramentas',
    '/planilhas': 'nav-planilhas',
    '/ferramentas/reajuste': 'nav-ferramentas'
  };
  const key = map[path] || map[path.split('/').slice(0,2).join('/')] || null;
  if(key){
    const el = document.getElementById(key);
    if(el) el.classList.add('active');
  }
})();
