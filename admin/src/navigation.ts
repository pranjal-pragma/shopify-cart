const internalLinkFromEvent = (event: MouseEvent): Element | null => {
  return event.composedPath().find(
    (target): target is Element => (
      target instanceof Element
      && (target.matches('a[href]') || target.matches('s-link[href]'))
    ),
  ) ?? null;
};

export const installInternalNavigation = () => {
  const navigate = (event: MouseEvent) => {
    if (
      event.defaultPrevented
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
    ) return;

    const link = internalLinkFromEvent(event);
    const href = link?.getAttribute('href');
    if (!link || !href) return;
    if (link instanceof HTMLAnchorElement && link.target && link.target !== '_self') return;

    const target = new URL(href, window.location.href);
    if (target.origin !== window.location.origin) return;

    const nextLocation = `${target.pathname}${target.search}${target.hash}`;
    const currentLocation = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextLocation === currentLocation) return;

    event.preventDefault();
    window.history.pushState({}, '', nextLocation);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  document.addEventListener('click', navigate);
  return () => document.removeEventListener('click', navigate);
};
