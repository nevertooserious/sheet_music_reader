type Child = Node | string | null | undefined | false;

export type Attrs = Record<string, string | number | boolean | null | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = String(value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

export interface IconButtonOptions {
  icon: string;
  label: string;
  action?: string;
  class?: string;
  attrs?: Attrs;
  onClick?: (event: MouseEvent) => void;
}

export function iconButton(options: IconButtonOptions): HTMLButtonElement {
  const button = el('button', {
    type: 'button',
    class: `icon-button ${options.class ?? ''}`.trim(),
    'aria-label': options.label,
    title: options.label,
    'data-action': options.action,
    ...(options.attrs ?? {}),
  });
  button.innerHTML = options.icon;
  if (options.onClick) button.addEventListener('click', options.onClick);
  return button;
}

export function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

export function setHidden(node: HTMLElement, hidden: boolean): void {
  if (node.hidden !== hidden) node.hidden = hidden;
}

export function setToggle(node: HTMLElement, className: string, on: boolean): void {
  node.classList.toggle(className, on);
}

export function setPressed(button: HTMLElement, pressed: boolean): void {
  const value = pressed ? 'true' : 'false';
  if (button.getAttribute('aria-pressed') !== value) button.setAttribute('aria-pressed', value);
}

export function setDisabled(node: HTMLButtonElement | HTMLInputElement, disabled: boolean): void {
  if (node.disabled !== disabled) node.disabled = disabled;
}
