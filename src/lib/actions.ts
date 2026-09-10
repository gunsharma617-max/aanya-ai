export type ActionId = 'google' | 'youtube' | 'maps' | 'phone' | 'email' | 'share' | 'clipboard' | 'vibrate' | 'fullscreen' | 'notifications' | 'camera';
export type BrowserAction = { id: ActionId; label: string; description: string; placeholder?: string; button: string };
export const browserActions: BrowserAction[] = [
  { id: 'google', label: 'Google search', description: 'A world of answers, one search away.', placeholder: 'What would you like to find?', button: 'Search Google' },
  { id: 'youtube', label: 'YouTube', description: 'Find your next tutorial, song, or inspiration.', placeholder: 'Search videos or music', button: 'Open YouTube' },
  { id: 'maps', label: 'Explore places', description: 'Find a place and let Maps guide the way.', placeholder: 'A place, address, or nearby coffee', button: 'Open Google Maps' },
  { id: 'phone', label: 'Make a call', description: 'Open your phone’s dialer. You confirm the call.', placeholder: '+91 98765 43210', button: 'Open dialer' },
  { id: 'email', label: 'Send an email', description: 'Open a new draft in your email app.', placeholder: 'hello@example.com', button: 'Create email' },
  { id: 'share', label: 'Share Aanya', description: 'Share your assistant with someone.', button: 'Share this page' },
  { id: 'clipboard', label: 'Copy a note', description: 'Save a thought to your device’s clipboard.', placeholder: 'Write something to copy', button: 'Copy to clipboard' },
  { id: 'vibrate', label: 'Haptic check', description: 'A gentle vibration on supported Android devices.', button: 'Try haptic feedback' },
  { id: 'fullscreen', label: 'Immersive mode', description: 'More presence. Fewer distractions.', button: 'Toggle fullscreen' },
  { id: 'notifications', label: 'Notifications', description: 'Request permission and send a test notification.', button: 'Enable & test' },
  { id: 'camera', label: 'Camera check', description: 'Check browser camera support. No photo is taken and no camera is opened.', button: 'Check capability' },
];
export async function executeAction(id: ActionId, input: string): Promise<string> {
  const value = input.trim();
  const open = (url: string) => { const win = window.open(url, '_blank', 'noopener,noreferrer'); void win; };
  if (['google', 'youtube', 'maps', 'phone', 'email', 'clipboard'].includes(id) && !value) throw new Error('Enter a value to continue.');
  switch (id) {
    case 'google': open(`https://www.google.com/search?q=${encodeURIComponent(value)}`); return 'Google opened in a new tab. If it didn’t open, allow pop-ups for this site.';
    case 'youtube': open(`https://www.youtube.com/results?search_query=${encodeURIComponent(value)}`); return 'YouTube opened in a new tab. If it didn’t open, allow pop-ups for this site.';
    case 'maps': open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(value)}`); return 'Maps opened in a new tab. If it didn’t open, allow pop-ups for this site.';
    case 'phone': if (!/^\+?[\d\s()-]{3,22}$/.test(value)) throw new Error('Enter a valid phone number.'); window.location.href = `tel:${value.replace(/[\s()-]/g, '')}`; return 'Handing over to your phone app. A compatible dialer is required.';
    case 'email': if (!/^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(value)) throw new Error('Enter a valid email address.'); window.location.href = `mailto:${encodeURIComponent(value)}`; return 'Opening your email app. A configured mail app is required.';
    case 'share': if (!navigator.share) throw new Error('Web Share is not supported here. Use Copy a note to copy this page’s URL.'); await navigator.share({ title: 'Aanya — Your personal AI', text: 'A little intelligence. A world of possibilities.', url: location.href }); return 'Shared successfully.';
    case 'clipboard': if (!navigator.clipboard) throw new Error('Clipboard access requires HTTPS and a supported browser.'); await navigator.clipboard.writeText(value); return 'Copied to your clipboard.';
    case 'vibrate': if (!navigator.vibrate || !navigator.vibrate([50, 50, 50])) throw new Error('Haptic feedback is not supported on this device.'); return 'A little pulse. Your device supports haptic feedback.';
    case 'fullscreen': if (document.fullscreenElement) { await document.exitFullscreen(); return 'Immersive mode turned off.'; } if (!document.documentElement.requestFullscreen) throw new Error('Fullscreen isn’t supported in this browser.'); await document.documentElement.requestFullscreen(); return 'Immersive mode is on. Press Escape to leave.';
    case 'notifications': if (!('Notification' in window)) throw new Error('Notifications are not supported in this browser.'); { const permission = await Notification.requestPermission(); if (permission !== 'granted') throw new Error('Notification permission was not granted. You can change this in site settings.'); try { new Notification('Aanya is here', { body: 'Your assistant is ready when you are.' }); return 'Test notification sent.'; } catch { throw new Error('Permission granted. This mobile browser requires a service worker for notifications; background notifications are not available in this preview.'); } }
    case 'camera': return typeof navigator.mediaDevices?.getUserMedia === 'function' ? 'Camera APIs are available over this secure connection. Device availability and permission have not been tested. No camera was opened.' : 'Camera APIs are unavailable here. Use HTTPS and a supported browser. No camera was opened.';
  }
}
