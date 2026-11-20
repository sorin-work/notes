import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { linkGraph } from '../api/links';
import { listNotebooks } from '../api/notebooks';
import { listTags } from '../api/tags';
import type { Graph } from '../api/types';
import { FilterSelects } from '../components/FilterSelects';
import { GraphCanvas } from '../components/GraphCanvas';
import { EmptyState, ErrorMessage, Spinner } from '../components/States';
import { readFilters, withFilters } from '../lib/filters';
import { neighbours } from '../lib/graph';

const count = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export function GraphPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { notebook, tag } = readFilters(params);
  const notebooks = useQuery({ queryKey: ['notebooks'], queryFn: listNotebooks });
  const tags = useQuery({ queryKey: ['tags'], queryFn: listTags });
  // Under 'notes', so that whatever changes a note and refreshes the note lists refreshes the graph too.
  const graph = useQuery({
    queryKey: ['notes', 'graph', notebook, tag],
    queryFn: () => linkGraph({ notebookId: notebook, tag }),
  });
  const data = graph.data;
  const cut = data !== undefined && data.total > data.nodes.length;

  return (
    <div className="page graph-page">
      <h1>Graph</h1>
      <p className="muted">
        Every note is a dot and every link between two notes a line. Notes that link a lot sit in the middle of their
        cluster, notes without links drift to the edge.
      </p>
      <FilterSelects
        notebooks={notebooks.data ?? []}
        tags={tags.data ?? []}
        notebook={notebook}
        tag={tag}
        onChange={(next) => setParams((current) => withFilters(current, next), { replace: true })}
      />
      {graph.isLoading && <Spinner />}
      {graph.error && <ErrorMessage error={graph.error} onRetry={() => void graph.refetch()} />}
      {data && (
        <>
          <p className={cut ? 'banner graph-cut' : 'muted'} role="status">
            {cut
              ? `Too many notes to draw: these are the ${count(data.nodes.length, 'note', 'notes')} edited last, out of ${data.total.toLocaleString()}. Pick a notebook or a tag above to see a smaller part in full.`
              : `${count(data.nodes.length, 'note', 'notes')}, ${count(data.edges.length, 'link', 'links')}.`}
          </p>
          {data.nodes.length === 0 ? (
            <EmptyState title="No notes to draw" />
          ) : (
            <>
              <GraphCanvas graph={data} onOpen={(id) => navigate(`/notes/${id}`)} />
              <GraphList graph={data} />
            </>
          )}
        </>
      )}
    </div>
  );
}

/** The graph in words: every note with the notes it links to and the notes that link to it. */
function GraphList({ graph }: { graph: Graph }) {
  const titles = new Map(graph.nodes.map((node) => [node.id, node.title]));
  const linked = neighbours(graph.edges);
  const links = (ids: string[]) =>
    ids.map((id, index) => (
      <span key={id}>
        {index > 0 && ', '}
        <Link to={`/notes/${id}`}>{titles.get(id)}</Link>
      </span>
    ));

  return (
    <section aria-labelledby="graph-list-heading">
      <h2 id="graph-list-heading">The same as a list</h2>
      <ul className="graph-list">
        {graph.nodes.map((node) => {
          const { out = [], in: incoming = [] } = linked.get(node.id) ?? {};
          return (
            <li key={node.id}>
              <Link to={`/notes/${node.id}`} className="backlink-title">
                {node.title}
              </Link>
              {out.length === 0 && incoming.length === 0 && <span className="muted"> · no links</span>}
              {out.length > 0 && <p className="backlink-context">Links to {links(out)}</p>}
              {incoming.length > 0 && <p className="backlink-context">Linked from {links(incoming)}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
