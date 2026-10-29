/**
 * The admin image picker (`ImagePicker` in views/edit.tsx), for the image fields in the
 * edit dialogs (`data-crop`). A field's button opens it: choose an image (click, drop or
 * paste; pasting into an edit dialog opens it straight away), then frame it in a square
 * (round for a DJ) by dragging and zooming, with the rest of the image dimmed around the
 * frame. Apply puts the framed square, at most `OUTPUT_MAX` pixels, in the field's file
 * input, so Save uploads art that fills its square frames everywhere without being cut
 * off. The field's Remove and Undo are handled here too (`setField`). Delegated on
 * `document`, so it survives hx-boost swaps.
 */
import { cropSquare, dragged, outputSide, placement, type CropSquare } from './crop-geometry.ts';

const OUTPUT_MAX = 1024;
const WHEEL_STEP = 0.0015;
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];

interface Crop {
  image: HTMLImageElement;
  url: string;
  name: string;
  zoom: number;
  square: CropSquare;
}

/** The field the picker is choosing for, and the image being framed. */
let field: HTMLElement | null = null;
let crop: Crop | null = null;

const picker = () => document.querySelector<HTMLDialogElement>('[data-picker]');
const inPicker = (selector: string): HTMLElement | null =>
  picker()?.querySelector<HTMLElement>(selector) ?? null;

function step(name: 'choose' | 'crop'): void {
  for (const pane of picker()?.querySelectorAll<HTMLElement>('[data-picker-step]') ?? []) {
    pane.hidden = pane.dataset['pickerStep'] !== name;
  }
  const title = inPicker('[data-picker-title]');
  if (title) title.textContent = name === 'choose' ? 'Choose an image' : 'Frame the image';
}

function showError(message: string | null): void {
  const error = inPicker('[data-picker-error]');
  if (!error) return;
  error.textContent = message ?? '';
  error.hidden = message === null;
}

function render(): void {
  const stage = inPicker('[data-crop-stage]');
  const frame = inPicker('[data-crop-frame]');
  const shown = inPicker('[data-crop-image]');
  const zoom = inPicker('[data-crop-zoom]');
  if (!crop || !stage || !frame || !shown) return;
  const { scale, left, top } = placement(crop.square, frame.clientWidth);
  shown.style.width = `${String(crop.image.naturalWidth * scale)}px`;
  shown.style.transform = `translate(${String(frame.offsetLeft + left)}px, ${String(frame.offsetTop + top)}px)`;
  if (zoom instanceof HTMLInputElement) zoom.value = String(crop.zoom);
}

function setZoom(zoom: number): void {
  if (!crop) return;
  const { naturalWidth: width, naturalHeight: height } = crop.image;
  const square = cropSquare(width, height, zoom, crop.square.cx, crop.square.cy);
  crop.zoom = Math.min(width, height) / square.side;
  crop.square = square;
  render();
}

function reset(): void {
  if (!crop) return;
  const { naturalWidth: width, naturalHeight: height } = crop.image;
  crop.zoom = 1;
  crop.square = cropSquare(width, height, 1, width / 2, height / 2);
  render();
}

function discard(): void {
  if (crop) URL.revokeObjectURL(crop.url);
  crop = null;
}

function open(target: HTMLElement): void {
  const dialog = picker();
  if (!dialog) return;
  field = target;
  discard();
  dialog.dataset['shape'] = target.dataset['crop'] ?? 'square';
  showError(null);
  step('choose');
  if (!dialog.open) dialog.showModal();
}

async function load(file: File): Promise<void> {
  if (!ACCEPTED.includes(file.type)) {
    showError('Use a PNG, JPEG or WebP image.');
    step('choose');
    return;
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch {
    URL.revokeObjectURL(url);
    showError("That image couldn't be read.");
    step('choose');
    return;
  }
  discard();
  const shown = inPicker('[data-crop-image]');
  if (shown instanceof HTMLImageElement) shown.src = url;
  crop = {
    image,
    url,
    name: file.name.replace(/\.[^.]*$/, '') || 'image',
    zoom: 1,
    square: { cx: 0, cy: 0, side: 1 },
  };
  showError(null);
  step('crop');
  reset();
}

const encode = (canvas: HTMLCanvasElement, type: string): Promise<Blob | null> =>
  new Promise((resolve) => {
    canvas.toBlob(resolve, type, 0.9);
  });

/** The framed square as a file, WebP where the browser can write it, else PNG. */
async function cropped(current: Crop): Promise<File> {
  const side = outputSide(current.square, OUTPUT_MAX);
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const { cx, cy, side: source } = current.square;
  canvas
    .getContext('2d')
    ?.drawImage(current.image, cx - source / 2, cy - source / 2, source, source, 0, 0, side, side);
  let blob = await encode(canvas, 'image/webp');
  // Safari can't encode WebP and hands back PNG under the same call; ask for PNG outright.
  if (blob?.type !== 'image/webp') blob = await encode(canvas, 'image/png');
  if (!blob) throw new Error('Could not crop the image');
  const ext = blob.type === 'image/webp' ? 'webp' : 'png';
  return new File([blob], `${current.name}.${ext}`, { type: blob.type });
}

/**
 * Show a field as saved (its current image, or what it falls back to), with a new image
 * (`file`, waiting for Save), or removed (what it falls back to). Its hidden inputs say
 * which to the server: the file, or `removeImage=1`.
 */
function setField(target: HTMLElement, state: 'saved' | 'new' | 'removed', file?: File): void {
  const one = (selector: string) => target.querySelector<HTMLElement>(selector);
  const input = target.querySelector<HTMLInputElement>('input[type="file"]');
  const files = new DataTransfer();
  if (file) files.items.add(file);
  if (input) input.files = files.files;
  const removing = target.querySelector<HTMLInputElement>('input[name="removeImage"]');
  if (removing) removing.value = state === 'removed' ? '1' : '';

  const preview = one('[data-crop-preview]');
  const saved = preview?.dataset['current'];
  if (preview instanceof HTMLImageElement) {
    if (preview.src.startsWith('blob:')) URL.revokeObjectURL(preview.src);
    if (file) preview.src = URL.createObjectURL(file);
    else if (saved) preview.src = saved;
  }
  const showsImage = state === 'new' || (state === 'saved' && saved !== undefined);
  if (preview) preview.hidden = !showsImage;
  const fallback = one('[data-crop-fallback]');
  if (fallback) fallback.hidden = showsImage;

  const remove = one('[data-crop-remove]');
  if (remove) remove.hidden = !showsImage;
  const undo = one('[data-crop-undo]');
  if (undo) undo.hidden = state === 'saved';
  const status = one('[data-crop-status]');
  if (status) {
    status.textContent =
      state === 'new'
        ? 'New image, applied when you save.'
        : state === 'removed'
          ? 'Image removed, applied when you save.'
          : '';
    status.hidden = state === 'saved';
  }
}

/** Hand the framed square to the field, then close the picker. */
async function apply(): Promise<void> {
  if (!crop || !field) return;
  setField(field, 'new', await cropped(crop));
  picker()?.close();
}

/** The first image in a paste or drop, if any. */
const imageOf = (data: DataTransfer | null): File | undefined =>
  [...(data?.files ?? [])].find((file) => file.type.startsWith('image/'));

document.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  const pick = event.target.closest('[data-crop-pick]');
  const target = pick?.closest<HTMLElement>('[data-crop]');
  if (target) {
    open(target);
    return;
  }
  const changed = event.target.closest('[data-crop-remove], [data-crop-undo]');
  const owner = changed?.closest<HTMLElement>('[data-crop]');
  if (changed && owner) {
    setField(owner, changed.matches('[data-crop-remove]') ? 'removed' : 'saved');
    return;
  }
  if (event.target.closest('[data-picker-reset]')) reset();
  else if (event.target.closest('[data-picker-cancel]')) picker()?.close();
  else if (event.target.closest('[data-picker-apply]')) {
    apply().catch(() => {
      showError("That image couldn't be cropped.");
    });
  }
});

document.addEventListener('change', (event) => {
  if (!(event.target instanceof HTMLInputElement)) return;
  if (event.target.matches('[data-picker-file]')) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void load(file);
  }
});

document.addEventListener('input', (event) => {
  if (event.target instanceof HTMLInputElement && event.target.matches('[data-crop-zoom]')) {
    setZoom(Number(event.target.value));
  }
});

// Paste: into the open picker, or into an edit dialog with an image field (opening the
// picker for it).
document.addEventListener('paste', (event) => {
  const file = imageOf(event.clipboardData);
  if (!file) return;
  const dialog = picker();
  if (!dialog?.open) {
    const editing = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].at(-1);
    const target = editing?.querySelector<HTMLElement>('[data-crop]');
    if (!target) return;
    open(target);
  }
  event.preventDefault();
  void load(file);
});

document.addEventListener('dragover', (event) => {
  const drop = event.target instanceof Element ? event.target.closest('[data-picker-drop]') : null;
  if (!(drop instanceof HTMLElement)) return;
  event.preventDefault();
  drop.dataset['over'] = '';
});

document.addEventListener('dragleave', (event) => {
  const drop = event.target instanceof Element ? event.target.closest('[data-picker-drop]') : null;
  if (drop instanceof HTMLElement) delete drop.dataset['over'];
});

document.addEventListener('drop', (event) => {
  const drop = event.target instanceof Element ? event.target.closest('[data-picker-drop]') : null;
  if (!(drop instanceof HTMLElement)) return;
  event.preventDefault();
  delete drop.dataset['over'];
  const file = imageOf(event.dataTransfer);
  if (file) void load(file);
  else showError('Drop an image file.');
});

document.addEventListener('pointerdown', (event) => {
  const stage =
    event.target instanceof Element ? event.target.closest<HTMLElement>('[data-crop-stage]') : null;
  const frame = inPicker('[data-crop-frame]');
  const current = crop;
  if (!stage || !frame || !current) return;
  event.preventDefault();
  stage.setPointerCapture(event.pointerId);
  let last = { x: event.clientX, y: event.clientY };
  const move = (moved: PointerEvent) => {
    const { naturalWidth: width, naturalHeight: height } = current.image;
    current.square = dragged(
      current.square,
      width,
      height,
      current.zoom,
      frame.clientWidth,
      moved.clientX - last.x,
      moved.clientY - last.y,
    );
    last = { x: moved.clientX, y: moved.clientY };
    render();
  };
  const end = () => {
    stage.removeEventListener('pointermove', move);
    stage.removeEventListener('pointerup', end);
    stage.removeEventListener('pointercancel', end);
  };
  stage.addEventListener('pointermove', move);
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
});

document.addEventListener(
  'wheel',
  (event) => {
    if (!crop || !(event.target instanceof Element)) return;
    if (!event.target.closest('[data-crop-stage]')) return;
    event.preventDefault();
    setZoom(crop.zoom * (1 - event.deltaY * WHEEL_STEP));
  },
  { passive: false },
);

// Keep the framing when the picker's width changes (e.g. a phone turning).
window.addEventListener('resize', render);
