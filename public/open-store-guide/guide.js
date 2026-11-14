const links = [...document.querySelectorAll('.step-nav a')];
const sections = links.map(link => document.querySelector(link.getAttribute('href'))).filter(Boolean);
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      for (const link of links) {
        const active = link.getAttribute('href') === `#${entry.target.id}`;
        link.classList.toggle('is-active', active);
        if (active) link.setAttribute('aria-current', 'step'); else link.removeAttribute('aria-current');
      }
    }
  }, {rootMargin:'-15% 0px -70% 0px'});
  sections.forEach(section => observer.observe(section));
}
