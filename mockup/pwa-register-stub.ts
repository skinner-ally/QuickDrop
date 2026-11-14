// Заглушка virtual:pwa-register: в макете service worker не регистрируется.
export function registerSW(): () => Promise<void> {
  return () => Promise.resolve()
}
