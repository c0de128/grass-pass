/**
 * Browser event fired after a sign-in or sign-out server action finishes, so the header's account control
 * (in the static layout, which a server action's redirect doesn't re-render) reads /api/auth/session again.
 */
export const SESSION_EVENT = "grass-pass:session";

export function announceSessionChange(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SESSION_EVENT));
}
