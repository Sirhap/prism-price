(() => {
  const selector = '#sortSelect, #shopSystemSelect, select[data-filter-key]';
  const controls = new WeakMap();
  const nativePicker = CSS.supports('appearance', 'base-select') && CSS.supports('selector(select::picker(select))');
  let menu;
  let current;

  function close(returnFocus = false) {
    if (!current) return;
    const { button } = current;
    current = null;
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (returnFocus) button.focus({ preventScroll: true });
  }

  function positionMenu() {
    if (!current) return;
    const { button } = current;
    if (!button.isConnected || !button.getClientRects().length) return close();
    const bounds = button.getBoundingClientRect();
    const width = Math.min(document.documentElement.clientWidth - 16, Math.max(168, bounds.width));
    const below = window.innerHeight - bounds.bottom - 13;
    const above = bounds.top - 13;
    const openAbove = below < 165 && above > below;
    menu.style.width = `${width}px`;
    menu.style.left = `${Math.max(8, Math.min(bounds.left, document.documentElement.clientWidth - width - 8))}px`;
    menu.style.maxHeight = `${Math.max(0, Math.min(250, openAbove ? above : below))}px`;
    menu.style.top = openAbove ? 'auto' : `${bounds.bottom + 5}px`;
    menu.style.bottom = openAbove ? `${window.innerHeight - bounds.top + 5}px` : 'auto';
  }

  function open(control) {
    close();
    current = control;
    const { select, label, button } = control;
    menu.setAttribute('aria-label', label);
    menu.replaceChildren(...Array.from(select.options, (option, index) => {
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.textContent = option.textContent;
      choice.disabled = option.disabled || (option.parentElement.tagName === 'OPTGROUP' && option.parentElement.disabled);
      choice.dataset.optionIndex = index;
      choice.setAttribute('aria-pressed', String(option.selected));
      return choice;
    }));
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    positionMenu();
    const selected = menu.querySelector('button[aria-pressed="true"]:enabled') || menu.querySelector('button:enabled');
    selected?.focus({ preventScroll: true });
    menu.scrollTop = selected ? Math.max(0, selected.offsetTop - menu.clientHeight + selected.offsetHeight) : 0;
  }

  function createMenu() {
    menu = document.createElement('div');
    menu.id = 'selectPickerOptions';
    menu.className = 'select-picker-options';
    menu.setAttribute('role', 'group');
    menu.hidden = true;
    document.body.append(menu);
    menu.addEventListener('click', (event) => {
      const choice = event.target.closest('button[data-option-index]');
      if (!choice || !current) return;
      const { select } = current;
      const index = Number(choice.dataset.optionIndex);
      close(true);
      if (select.selectedIndex === index) return;
      select.selectedIndex = index;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      sync();
    });
    menu.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        if (event.key === 'Escape') event.preventDefault();
        close(true);
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const choices = Array.from(menu.querySelectorAll('button:enabled'));
      const index = choices.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
      choices[next]?.focus();
    });
    document.addEventListener('pointerdown', (event) => {
      if (current && !menu.contains(event.target) && !current.button.contains(event.target)) close();
    });
    document.addEventListener('focusin', (event) => {
      if (current && !menu.contains(event.target) && !current.button.contains(event.target)) close();
    });
    window.addEventListener('resize', positionMenu);
    document.addEventListener('scroll', (event) => {
      if (event.target !== menu) positionMenu();
    }, true);
  }

  function mount(select) {
    if (!menu) createMenu();
    const wrapper = document.createElement('span');
    const button = document.createElement('button');
    wrapper.className = 'select-picker';
    button.className = 'select-picker-button';
    button.type = 'button';
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', menu.id);
    select.before(wrapper);
    wrapper.append(select, button);
    select.classList.add('select-picker-source');
    const control = { wrapper, button, select, label: '' };
    controls.set(select, control);
    button.addEventListener('click', () => current === control ? close(true) : open(control));
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      open(control);
    });
    return control;
  }

  /** 保留原生 select 的值与 change 事件；动态生成选项后同步可见控件。 */
  function sync() {
    if (nativePicker) return;
    for (const select of document.querySelectorAll(selector)) {
      const control = controls.get(select) || mount(select);
      const { wrapper, button } = control;
      const selected = select.selectedOptions[0]?.textContent || '';
      control.label = (select.getAttribute('aria-label') || select.labels?.[0]?.textContent || '').trim();
      wrapper.hidden = select.hidden;
      button.disabled = select.disabled;
      button.classList.toggle('is-selected', select.classList.contains('is-selected'));
      button.textContent = selected;
      button.setAttribute('aria-label', [control.label, selected].filter(Boolean).join('：'));
      if (select.title) button.title = select.title;
    }
    positionMenu();
  }

  window.prismSelectPicker = { sync };
})();
