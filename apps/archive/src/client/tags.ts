/**
 * The tag chips in the edit set dialog (`TagField` in views/edit.tsx): typing a tag and
 * pressing comma or Enter (or leaving the box, or pasting a comma-separated list) adds a
 * chip; a chip's × or Backspace in the empty box removes one. The chips are kept in the
 * hidden `tags` input, comma-separated, which is what the form sends. Delegated on
 * `document`, so it survives hx-boost swaps.
 */

/** Lowercase, single spaces; the server cleans tags properly. */
const tidy = (text: string): string => text.trim().replace(/\s+/g, ' ').toLowerCase();

const tagsOf = (field: HTMLElement): string[] =>
  [...field.querySelectorAll<HTMLElement>('[data-tag]')].map((chip) => chip.dataset['tag'] ?? '');

function sync(field: HTMLElement): void {
  const value = field.querySelector<HTMLInputElement>('[data-tag-value]');
  if (value) value.value = tagsOf(field).join(', ');
}

function chip(tag: string): HTMLElement {
  const element = document.createElement('span');
  element.className = 'badge badge-soft gap-1 pr-1';
  element.dataset['tag'] = tag;
  element.append(tag);
  const remove = document.createElement('button');
  remove.className = 'btn btn-ghost btn-xs btn-circle size-4 min-h-0';
  remove.type = 'button';
  remove.setAttribute('aria-label', `Remove ${tag}`);
  remove.dataset['tagRemove'] = '';
  remove.textContent = '×';
  element.append(remove);
  return element;
}

/** Add each comma-separated tag in `text` that isn't there yet. */
function add(field: HTMLElement, entry: HTMLInputElement, text: string): void {
  const existing = new Set(tagsOf(field));
  for (const tag of text.split(',').map(tidy)) {
    if (tag === '' || existing.has(tag)) continue;
    existing.add(tag);
    entry.before(chip(tag));
  }
  entry.value = '';
  sync(field);
}

const fieldOf = (target: EventTarget | null): HTMLElement | null =>
  target instanceof Element ? target.closest<HTMLElement>('[data-tags]') : null;

document.addEventListener('keydown', (event) => {
  const field = fieldOf(event.target);
  const entry = event.target;
  if (!field || !(entry instanceof HTMLInputElement) || !entry.matches('[data-tag-entry]')) return;
  if (event.key === ',' || event.key === 'Enter') {
    // Enter would otherwise submit the dialog.
    event.preventDefault();
    add(field, entry, entry.value);
  } else if (event.key === 'Backspace' && entry.value === '') {
    const chips = field.querySelectorAll('[data-tag]');
    chips[chips.length - 1]?.remove();
    sync(field);
  }
});

// Leaving the box (e.g. clicking Save) keeps what was typed.
document.addEventListener('focusout', (event) => {
  const field = fieldOf(event.target);
  const entry = event.target;
  if (field && entry instanceof HTMLInputElement && entry.matches('[data-tag-entry]')) {
    add(field, entry, entry.value);
  }
});

document.addEventListener('paste', (event) => {
  const field = fieldOf(event.target);
  const entry = event.target;
  const text = event.clipboardData?.getData('text') ?? '';
  if (!field || !(entry instanceof HTMLInputElement) || !text.includes(',')) return;
  if (!entry.matches('[data-tag-entry]')) return;
  event.preventDefault();
  add(field, entry, entry.value + text);
});

document.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  const remove = event.target.closest('[data-tag-remove]');
  const field = fieldOf(remove);
  if (!remove || !field) {
    // A click on the box itself puts the cursor in it.
    const box = fieldOf(event.target);
    if (box && event.target.matches('.input')) {
      box.querySelector<HTMLInputElement>('[data-tag-entry]')?.focus();
    }
    return;
  }
  remove.closest('[data-tag]')?.remove();
  sync(field);
});
