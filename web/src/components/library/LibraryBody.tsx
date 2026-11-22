import { useLibraryStore } from '../../store/useLibraryStore.ts';
import { DetailBody } from './DetailBody.tsx';
import { SearchResults } from './SearchResults.tsx';
import { TabBody } from './TabBody.tsx';

/** The lists of the current library page. */
export function LibraryBody() {
  const view = useLibraryStore((s) => s.view);
  const tab = useLibraryStore((s) => s.tab);
  const result = useLibraryStore((s) => s.result);

  if (!result) return null;
  if (view.kind === 'search') return <SearchResults result={result} />;
  if (view.kind === 'tab') return <TabBody tab={tab} result={result} />;
  return <DetailBody view={view} result={result} />;
}
