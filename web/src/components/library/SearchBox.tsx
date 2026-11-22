import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useLibraryStore } from '../../store/useLibraryStore.ts';

export function SearchBox() {
  const { t } = useTranslation();
  const query = useLibraryStore((s) => s.query);
  const setQuery = useLibraryStore((s) => s.setQuery);
  const search = useLibraryStore((s) => s.search);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    e.currentTarget.querySelector('input')?.blur();
    void search(query);
  };

  return (
    <form className="search" role="search" onSubmit={submit}>
      <input
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        placeholder={t('library.search')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
    </form>
  );
}
