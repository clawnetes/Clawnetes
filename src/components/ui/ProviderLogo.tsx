import { memo } from "react";
import { PROVIDER_LOGOS } from "../../presets/modelsByProvider";

interface ProviderLogoProps {
  provider: string;
  size?: number;
  className?: string;
}

function ProviderLogo({ provider, size = 16, className = "" }: ProviderLogoProps) {
  const logoPath = PROVIDER_LOGOS[provider];

  if (logoPath) {
    return (
      <img
        src={logoPath}
        alt={provider}
        width={size}
        height={size}
        className={`inline-block shrink-0 ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  const initial = provider.charAt(0).toUpperCase();
  return (
    <span
      className={`inline-flex items-center justify-center rounded-sm bg-surface-hover text-t-muted text-[0.6rem] font-bold shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      {initial}
    </span>
  );
}

export default memo(ProviderLogo);
