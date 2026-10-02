// Tema antes da renderização (evita piscar claro→escuro). Arquivo próprio: a CSP não permite script embutido.
try {
  var t = localStorage.getItem('rusten.theme') || 'auto';
  if (t === 'escuro' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.classList.add('dark');
} catch (e) { /* armazenamento indisponível */ }
