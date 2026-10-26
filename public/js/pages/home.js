import { tracks, faqs } from '../data/home.js';
import { siteConfig } from '../data/site.js';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const icon = (name, className = '') => `<svg class="icon ${className}" aria-hidden="true"><use href="#icon-${name}"/></svg>`;
const pad = (number) => String(number).padStart(2, '0');

const trackPresentation = {
  'ideas-voting': { tone: 'cobalt', statement: 'Make every decision visible.' },
  'project-delivery': { tone: 'lime', statement: 'Keep every handoff connected.' },
  'meetings-coworking': { tone: 'paper', statement: 'Think together. Keep the record.' },
  'revenue-governance': { tone: 'graphite', statement: 'Let governance follow the work.' }
};

function trackVisual(track, index) {
  const label = track.stages.join(' / ');
  if (index === 1) {
    return `<div class="track-visual" aria-hidden="true"><svg viewBox="0 0 200 140"><rect x="34" y="30" width="66" height="66"/><rect x="67" y="48" width="66" height="66"/><path d="M18 122 166 14M145 14h21v21"/></svg><span>${label}</span></div>`;
  }
  if (index === 2) {
    return `<div class="track-visual track-visual--development" aria-hidden="true"><strong>${icon('message')}</strong><i></i><i></i><i></i><span>${label}</span></div>`;
  }
  if (index === 3) {
    return `<div class="track-visual" aria-hidden="true"><svg viewBox="0 0 200 140"><circle cx="87" cy="67" r="42"/><path d="m66 67 14 14 29-32M118 106l35 27M25 28h34M25 39h20M150 23v22M139 34h22"/></svg><span>${label}</span></div>`;
  }
  return `<div class="track-visual" aria-hidden="true"><svg viewBox="0 0 200 140"><circle cx="96" cy="70" r="43"/><circle cx="96" cy="70" r="27"/><circle cx="96" cy="70" r="8"/><path d="M25 70h142M96 5v130M117 50l33-27"/><path class="visual-fill" d="m128 38 39-20-14 39-10-10Z"/></svg><span>${label}</span></div>`;
}

function renderTracks() {
  const grid = document.querySelector('#course-grid');
  if (!grid) return;

  grid.innerHTML = tracks.map((track, index) => {
    const presentation = trackPresentation[track.id];
    return `
      <article class="track-row track-row--${presentation.tone}" data-reveal>
        <button class="track-row__hit" type="button" data-track="${track.id}" aria-label="Open ${track.title} capability preview" aria-haspopup="dialog" aria-controls="course-dialog" aria-expanded="false"></button>
        <span class="track-row__number" aria-hidden="true">/${pad(track.number)}</span>
        <div class="track-row__main">
          <span class="track-row__statement">${presentation.statement}</span>
          <h3 id="track-title-${track.id}">${track.title}</h3>
          <p>${track.description}</p>
        </div>
        ${trackVisual(track, index)}
        <div class="track-row__action" aria-hidden="true"><span>Preview capability</span>${icon('arrow-up-right')}</div>
      </article>
    `;
  }).join('');
}

function initTrackDialogs() {
  const dialog = document.querySelector('#course-dialog');
  const title = document.querySelector('#course-dialog-title');
  const description = document.querySelector('#course-dialog-description');
  const modules = document.querySelector('#course-dialog-modules');
  const dialogIcon = document.querySelector('#course-dialog-icon');
  const contact = document.querySelector('#course-dialog-contact');
  if (!dialog || !title || !description || !modules || !dialogIcon || !contact) return;

  let returnFocus = null;

  const openTrack = (id, trigger) => {
    const track = tracks.find((item) => item.id === id);
    if (!track) return;

    returnFocus = trigger;
    dialog.className = `course-dialog course-dialog--${trackPresentation[track.id].tone}`;
    title.textContent = track.title;
    description.textContent = `${track.description} ${track.audience}`;
    dialogIcon.innerHTML = `<span>/${pad(track.number)}</span>${icon(track.icon)}`;
    modules.innerHTML = track.modules.map((module, index) => `
      <li><span class="course-dialog__module-number">${pad(index + 1)}</span><span>${module.title}</span></li>
    `).join('');
    contact.href = siteConfig.routes.workspace;

    document.querySelectorAll('[data-track]').forEach((card) => {
      const selected = card.dataset.track === id;
      card.classList.toggle('is-selected', selected);
      card.setAttribute('aria-expanded', String(selected));
    });

    dialog.showModal();
    dialog.scrollTop = 0;
    document.body.classList.add('dialog-open');
    dialog.querySelector('[data-dialog-close]')?.focus({ preventScroll: true });
  };

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-track], [data-track-footer]');
    if (!trigger) return;
    event.preventDefault();
    openTrack(trigger.dataset.track || trigger.dataset.trackFooter, trigger);
  });

  dialog.querySelectorAll('[data-dialog-close]').forEach((button) => {
    button.addEventListener('click', () => dialog.close());
  });

  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    const withinDialog = event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
    if (!withinDialog) dialog.close();
  });

  dialog.addEventListener('close', () => {
    document.body.classList.remove('dialog-open');
    document.querySelectorAll('[data-track]').forEach((card) => {
      card.classList.remove('is-selected');
      card.setAttribute('aria-expanded', 'false');
    });
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  });

  document.addEventListener('keydown', (event) => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'].includes(event.key)) return;
    const current = event.target.closest('[data-track]');
    if (!current) return;
    event.preventDefault();
    const cards = [...document.querySelectorAll('[data-track]')];
    const direction = ['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1;
    const next = (cards.indexOf(current) + direction + cards.length) % cards.length;
    cards[next]?.focus();
  });
}

function renderFaqs() {
  const list = document.querySelector('#faq-list');
  if (!list) return;
  list.innerHTML = faqs.map((faq, index) => `
    <div class="faq-item ${index === 0 ? 'is-open' : ''}">
      <h3>
        <button class="faq-question" type="button" aria-expanded="${index === 0}" aria-controls="faq-answer-${index}" id="faq-question-${index}">
          <span class="faq-question__number">${pad(index + 1)}</span>
          <span class="faq-question__text">${faq.question}</span>
          ${icon('arrow-up-right', 'faq-chevron')}
        </button>
      </h3>
      <div class="faq-answer" id="faq-answer-${index}" role="region" aria-labelledby="faq-question-${index}" ${index === 0 ? '' : 'inert'}>
        <div><p>${faq.answer}</p></div>
      </div>
    </div>
  `).join('');

  list.addEventListener('click', (event) => {
    const button = event.target.closest('.faq-question');
    if (!button) return;
    const item = button.closest('.faq-item');
    const shouldOpen = !item.classList.contains('is-open');

    list.querySelectorAll('.faq-item').forEach((faqItem) => {
      const isTarget = faqItem === item;
      const open = isTarget && shouldOpen;
      faqItem.classList.toggle('is-open', open);
      faqItem.querySelector('.faq-question').setAttribute('aria-expanded', String(open));
      faqItem.querySelector('.faq-answer').inert = !open;
    });
  });
}

function initMenu() {
  const toggle = document.querySelector('[data-menu-toggle]');
  const nav = document.querySelector('[data-mobile-nav]');
  const main = document.querySelector('main');
  const footer = document.querySelector('footer');
  if (!toggle || !nav || !main || !footer) return;
  const label = toggle.querySelector('span');
  const focusable = () => [...nav.querySelectorAll('a[href], button:not([disabled])')];
  let open = false;

  nav.inert = true;

  const setMenu = (nextOpen, restoreFocus = true) => {
    open = nextOpen;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
    nav.setAttribute('aria-hidden', String(!open));
    nav.inert = !open;
    main.inert = open;
    footer.inert = open;
    document.body.classList.toggle('menu-open', open);
    if (label) label.textContent = open ? 'CLOSE' : 'MENU';

    if (open) {
      focusable()[0]?.focus();
    } else if (restoreFocus && nav.contains(document.activeElement)) {
      toggle.focus();
    }
  };

  toggle.addEventListener('click', () => setMenu(!open));
  nav.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => setMenu(false, false)));
  document.addEventListener('keydown', (event) => {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setMenu(false);
      return;
    }
    if (event.key !== 'Tab') return;
    const links = focusable();
    const first = links[0];
    const last = links[links.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === toggle)) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === toggle)) {
      event.preventDefault();
      first?.focus();
    }
  });

  const desktop = window.matchMedia('(min-width: 901px)');
  const closeAtDesktop = (event) => {
    if (event.matches && open) {
      setMenu(false, false);
      if (nav.contains(document.activeElement)) toggle.focus();
    }
  };
  desktop.addEventListener('change', closeAtDesktop);
}

function initActiveNavigation() {
  const links = [...document.querySelectorAll('[data-nav-link]')];
  const sections = links.map((link) => document.querySelector(link.getAttribute('href'))).filter(Boolean);
  if (!links.length || !sections.length || !('IntersectionObserver' in window)) return;

  const visible = new Map();
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => visible.set(entry.target.id, entry.isIntersecting ? entry.intersectionRatio : 0));
    const active = [...visible.entries()].sort((a, b) => b[1] - a[1])[0];
    links.forEach((link) => {
      const selected = active?.[1] > 0 && link.getAttribute('href') === `#${active[0]}`;
      link.classList.toggle('is-active', selected);
      if (selected) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }, { rootMargin: '-20% 0px -55% 0px', threshold: [0, 0.1, 0.25, 0.5, 0.75] });
  sections.forEach((section) => observer.observe(section));
}

function initReveals() {
  const elements = [...document.querySelectorAll('[data-reveal]')];
  if (reducedMotion.matches || !('IntersectionObserver' in window)) {
    elements.forEach((element) => element.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -7% 0px', threshold: 0.08 });
  elements.forEach((element) => observer.observe(element));
}

function initScrollEffects() {
  const header = document.querySelector('[data-site-header]');
  const progress = document.querySelector('[data-scroll-progress]');
  const hero = document.querySelector('.studio-hero');
  const visual = document.querySelector('.studio-hero__visual');
  let frame = null;

  const update = () => {
    const top = window.scrollY;
    const maximum = document.documentElement.scrollHeight - window.innerHeight;
    header?.classList.toggle('is-scrolled', top > 12);
    if (progress) progress.style.transform = `scaleX(${maximum > 0 ? Math.min(top / maximum, 1) : 0})`;
    if (hero && visual && !reducedMotion.matches && window.innerWidth > 960) {
      const heroBounds = hero.getBoundingClientRect();
      const distance = Math.max(0, -heroBounds.top);
      visual.style.setProperty('--hero-parallax', `${Math.min(distance * 0.075, 42)}px`);
    }
    frame = null;
  };

  window.addEventListener('scroll', () => {
    if (frame !== null) return;
    frame = window.requestAnimationFrame(update);
  }, { passive: true });
  update();
}

function initContactLinks() {
  document.querySelectorAll('[data-contact-link]').forEach((link) => {
    const route = siteConfig.routes[link.dataset.contactLink];
    if (route) link.href = route;
  });
}

renderTracks();
renderFaqs();
initTrackDialogs();
initMenu();
initActiveNavigation();
initReveals();
initScrollEffects();
initContactLinks();
document.querySelector('#current-year').textContent = new Date().getFullYear();
