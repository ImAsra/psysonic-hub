import { Check, Copy } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { copyText } from '../../utils/copyText.ts';

interface Props {
  id: string;
  label: string;
  value: string;
  /** Shown as dots until revealed (the text is still what gets copied). */
  secret?: boolean;
  /** Extra buttons next to Copy. */
  children?: ReactNode;
}

/** A read-only value with a Copy button. */
export function CopyField({ id, label, value, secret, children }: Props) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!(await copyText(value, input.current))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="copy-field">
      <label className="field" htmlFor={id}>
        {label}
      </label>
      <div className="copy-row">
        <input ref={input} id={id} type={secret ? 'password' : 'text'} readOnly value={value} spellCheck={false} />
        {children}
        <button type="button" className="btn ghost icon-label" onClick={() => void copy()}>
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? t('connect.copied') : t('connect.copy')}
        </button>
      </div>
    </div>
  );
}
