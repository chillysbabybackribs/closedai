/** A menu or panel (not a tooltip) is open inside the quick chat layer; they portal into <body>. */
export function layerMenuOpen(): boolean {
  return [...document.querySelectorAll('[data-radix-popper-content-wrapper]')]
    .some((wrapper) => wrapper.querySelector('[role="dialog"], [role="menu"], [role="listbox"]') !== null)
}
