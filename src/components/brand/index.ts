/**
 * Shared ASI visual brand primitives.
 * Re-exports guestautopilot site primitives + thin brand wrappers.
 * No market/legal/payment content.
 */

export {
  Section as BrandSection,
  Eyebrow as BrandEyebrow,
  GoldRule as BrandGoldRule,
  Headline as BrandHeadline,
  PrimaryCta as BrandPrimaryCta,
  SecondaryCta as BrandSecondaryCta,
} from '@/components/site/primitives';

export { Shiro as BrandShiro } from '@/components/site/Shiro';
export { LogoMark as BrandLogoMark } from '@/components/site/LogoMark';

export { BrandCard } from './BrandCard';
export { BrandPageShell } from './BrandPageShell';
