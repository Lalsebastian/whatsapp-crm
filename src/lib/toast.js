let publisher = null;

export function setToastPublisher(next) {
  publisher = next;
}

export function toast(options) {
  publisher?.(typeof options === 'string' ? { title: options } : options);
}
