import { useEffect, useState } from 'react';

/** The logo when /logo.svg exists (a file you can drop into ./public), otherwise the name as text. */
export function Logo() {
  const [hasLogo, setHasLogo] = useState(false);

  useEffect(() => {
    const probe = new Image();
    probe.onload = () => setHasLogo(true);
    probe.src = '/logo.svg';
  }, []);

  return (
    <>
      <span className={hasLogo ? 'logo ok' : 'logo'} role="img" aria-label="Psysonic" />
      {!hasLogo && <span className="brand-name">Psysonic</span>}
    </>
  );
}
