(function () {
  function normPath(p){
    // remove trailing slash except root
    if (p.length > 1 && p.endsWith('/')) return p.slice(0, -1);
    return p;
  }

  const path = normPath(window.location.pathname);

  const map = [
    { id: 'nav-home', match: (p) => p === '' || p === '/' || p === '/index.html' },
    { id: 'nav-dicas', match: (p) => p.startsWith('/dicas') },
    { id: 'nav-ferramentas', match: (p) => p.startsWith('/ferramentas') },
    { id: 'nav-planilhas', match: (p) => p.startsWith('/planilhas') },
  ];

  map.forEach(item => {
    const el = document.getElementById(item.id);
    if (!el) return;
    if (item.match(path)) el.classList.add('active');
  });
})();
