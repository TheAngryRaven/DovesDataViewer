// The LapWing brand mark shown in app/page headers (replaces the old gauge
// glyph). The asset lives in public/ — precached by the service worker — so it's
// referenced by absolute path. Size/spacing come from the caller's className.
export function BrandLogo({ className }: { className?: string }) {
  return <img src="/web-logo.png" alt="LapWing" className={className} />;
}
