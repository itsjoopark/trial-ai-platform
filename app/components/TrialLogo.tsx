type TrialLogoProps = {
  size?: number;
  className?: string;
};

export default function TrialLogo({ size = 20, className = "mk" }: TrialLogoProps) {
  return (
    <img
      className={className}
      src="/images/trial-logo.png"
      alt=""
      width={size}
      height={size}
      aria-hidden
    />
  );
}
