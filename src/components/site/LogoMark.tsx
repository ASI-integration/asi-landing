import Image from 'next/image';

/**
 * The ASI Global logo mark — approved gold split-circle icon.
 * Cropped from the approved brand reference; do not redraw.
 */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <Image
      src="/brand/asi-global-mark.png"
      alt="ASI Global"
      width={size}
      height={size}
      className="shrink-0"
      priority
    />
  );
}
