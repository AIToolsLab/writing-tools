import { BrowserMetadata } from '@/types/study';
import { MIN_SCREEN_HEIGHT, MIN_SCREEN_WIDTH } from './studyConfig';

/**
 * Collect browser and device metadata
 */
export function getBrowserMetadata(): BrowserMetadata {
  if (typeof window === 'undefined') {
    throw new Error('getBrowserMetadata must be called in browser context');
  }

  return {
    userAgent: navigator.userAgent,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    windowWidth: window.innerWidth,
    windowHeight: window.innerHeight,
    colorDepth: window.screen.colorDepth,
    pixelDepth: window.screen.pixelDepth,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    languages: Array.from(navigator.languages || []),
    platform: navigator.platform,
    cookieEnabled: navigator.cookieEnabled,
    onLine: navigator.onLine,
  };
}

/**
 * Check if screen size is valid for the study
 */
export function checkScreenSize(): { valid: boolean; reason?: string } {
  if (typeof window === 'undefined') {
    return { valid: false, reason: 'Not in browser context' };
  }

  const width = window.innerWidth;
  const height = window.innerHeight;

  if (width < MIN_SCREEN_WIDTH || height < MIN_SCREEN_HEIGHT) {
    return {
      valid: false,
      reason: `Screen size ${width}x${height} is below minimum ${MIN_SCREEN_WIDTH}x${MIN_SCREEN_HEIGHT}`,
    };
  }

  // Check for mobile user agents
  const isMobile =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    );

  if (isMobile) {
    return { valid: false, reason: 'Mobile devices are not supported' };
  }

  return { valid: true };
}
