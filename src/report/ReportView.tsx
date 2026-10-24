// The report page body (SPEC F-2, F-3, §8). A server component with no client JavaScript: the
// brand-snippet popovers are CSS (:hover and :focus), so they work on tap as well as hover.

import type { ReactNode } from "react";
import { COUNTRY_NAMES, type Country, type EngineId } from "../engines/types";
import type { BrandMention } from "../extract/brands";
import type { PageType } from "../extract/classify";
import type { EvidenceRef } from "../fixlist/gaps";
import { answerId } from "../fixlist/gaps";
import { METHOD_NOTE, type ScanReport } from "../scan/report";

export const ENGINE_LABELS: Record<EngineId, string> = { openai: "OpenAI", perplexity: "Perplexity", gemini: "Gemini" };

const PAGE_TYPE_LABELS: Record<PageType, string> = {
  listicle: "Listicle",
  review_site: "Review site",
  forum: "Forum",
  vendor_page: "Vendor page",
  video: "Video",
  other: "Other",
};

const countryName = (c: string) => COUNTRY_NAMES[c as Country] ?? c;
const pageName = (p: { title?: string; domain: string }) => (p.title && p.title !== p.domain ? p.title : p.domain);
const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** Links out to cited pages: new tab, and never the report's URL (with its share token) as referrer. */
function Out({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow">
      {children}
    </a>
  );
}

function PageType({ type }: { type: PageType }) {
  return <span className={`tag tag-${type}`}>{PAGE_TYPE_LABELS[type]}</span>;
}

function Section({ id, title, intro, children }: { id: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>{title}</h2>
      {intro ? <p className="intro">{intro}</p> : null}
      {children}
    </section>
  );
}

/** Answers are Markdown; bold markers only get in the way in a short snippet. */
export const plainSnippet = (snippet: string) => snippet.replace(/\*\*|__/g, "");

/** The snippet with the matched text marked, so a wrong match is easy to spot (SPEC §8). */
function Snippet({ mention }: { mention: BrandMention }) {
  const { matched } = mention;
  const snippet = plainSnippet(mention.snippet);
  const at = matched ? snippet.toLowerCase().indexOf(matched.toLowerCase()) : -1;
  if (at < 0) return <>{snippet}</>;
  return (
    <>
      {snippet.slice(0, at)}
      <mark>{snippet.slice(at, at + matched.length)}</mark>
      {snippet.slice(at + matched.length)}
    </>
  );
}

function MentionChip({ mention, id, target }: { mention: BrandMention; id: string; target: boolean }) {
  return (
    <li className={`mention${target ? " is-target" : ""}`} tabIndex={0} aria-describedby={id}>
      <span className="pos">{mention.position}</span> {mention.brand}
      <span className="snippet" role="tooltip" id={id}>
        <Snippet mention={mention} />
      </span>
    </li>
  );
}

function EvidenceLinks({ evidence }: { evidence: EvidenceRef[] }) {
  return (
    <ul className="evidence">
      {evidence.map((e) => (
        <li key={`${e.callIndex}-${e.citationIndex ?? "a"}`}>
          <a href={`#${e.answerId}`}>
            {e.answerId} · {ENGINE_LABELS[e.engine]} · Q{e.questionIndex + 1}
            {e.citationIndex !== undefined ? ` · citation ${e.citationIndex + 1}` : ""}
          </a>
          {e.url ? (
            <>
              {" "}
              <Out href={e.url}>(page)</Out>
            </>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function Header({ report }: { report: ScanReport }) {
  return (
    <header className="report-head">
      <p className="eyebrow">FieldCite report</p>
      <h1>
        {report.category.name}: who AI recommends in {countryName(report.country)}
      </h1>
      <dl className="facts">
        <div>
          <dt>Generated</dt>
          <dd>{date(report.generatedAt)}</dd>
        </div>
        {report.targetBrand ? (
          <div>
            <dt>Your brand</dt>
            <dd>{report.targetBrand}</dd>
          </div>
        ) : null}
        <div>
          <dt>Engines</dt>
          <dd>{report.engines.map((e) => ENGINE_LABELS[e.id]).join(", ")}</dd>
        </div>
        <div>
          <dt>Answers</dt>
          <dd>
            {report.totals.ok} of {report.totals.plannedCalls} ({report.questions.length} questions × {report.runs} run
            {report.runs === 1 ? "" : "s"} × {report.engines.length} engines)
          </dd>
        </div>
      </dl>
      {report.totals.stoppedReason ? <p className="warn">This scan stopped early: {report.totals.stoppedReason}</p> : null}
    </header>
  );
}

function MethodBox({ report }: { report: ScanReport }) {
  return (
    <aside className="method" aria-labelledby="method-h">
      <h2 id="method-h">Method and disclaimer</h2>
      <p>{METHOD_NOTE}</p>
      <ul>
        <li>
          Each question was asked {report.runs === 1 ? "once" : `${report.runs} times`} per engine, with the location set to{" "}
          {countryName(report.country)}.
        </li>
        <li>Brands are matched by name and known aliases. Hover or tap a brand to see the answer text it matched.</li>
        <li>Google AI Mode is not covered.</li>
      </ul>
    </aside>
  );
}

function ShareOfVoice({ report }: { report: ScanReport }) {
  const engines = report.engines.map((e) => e.id);
  return (
    <Section id="share-of-voice" title="Share of voice" intro="How many answers named each brand, per engine.">
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Brand</th>
              {/* The total comes first so it stays in view when the table scrolls on a phone. */}
              <th scope="col" className="num">
                All engines
              </th>
              {engines.map((e) => (
                <th scope="col" key={e} className="num">
                  {ENGINE_LABELS[e]}
                </th>
              ))}
              <th scope="col" className="num">
                Avg position
              </th>
            </tr>
          </thead>
          <tbody>
            {report.shareOfVoice.map((row) => (
              <tr key={row.brand} className={row.brand === report.targetBrand ? "is-target" : undefined}>
                <th scope="row">{row.brand}</th>
                <td className="num">
                  <span className="total">
                    <span className="bar" aria-hidden="true">
                      <span style={{ width: `${row.answers ? (100 * row.mentioned) / row.answers : 0}%` }} />
                    </span>
                    {row.mentioned}/{row.answers}
                  </span>
                </td>
                {engines.map((e) => {
                  const v = row.byEngine[e];
                  return (
                    <td key={e} className="num" aria-label={v ? `${row.brand}: ${v.mentioned}/${v.answers} ${ENGINE_LABELS[e]} answers` : undefined}>
                      {v ? `${v.mentioned}/${v.answers}` : "–"}
                    </td>
                  );
                })}
                <td className="num">{row.avgPosition ?? "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function Gaps({ report }: { report: ScanReport }) {
  const target = report.targetBrand;
  if (!target || !report.gaps) {
    return (
      <Section id="gaps" title="Gaps">
        <p>No brand was set for this scan, so there is no gaps view or fix list.</p>
      </Section>
    );
  }
  return (
    <Section id="gaps" title={`Gaps: pages that cite competitors and not ${target}`} intro={`Each page below is cited by answers that name competitors but leave out ${target}.`}>
      {report.gaps.length === 0 ? (
        <p>No cited page backs an answer that names competitors and leaves out {target}.</p>
      ) : (
        <ol className="cards">
          {report.gaps.map((g) => (
            <li key={g.url} className="card">
              <p className="card-title">
                <Out href={g.url}>{pageName(g)}</Out> <PageType type={g.pageType} />
              </p>
              <p className="muted">{g.domain}</p>
              <p>
                Cited in {g.citedIn} of {g.answers} answers; <strong>{g.gapAnswers} without {target}</strong> ({g.engines.map((e) => ENGINE_LABELS[e]).join(", ")}).
              </p>
              <p>Competitors named: {g.competitors.join(", ")}</p>
              <EvidenceLinks evidence={g.evidence} />
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

function FixList({ report }: { report: ScanReport }) {
  if (!report.targetBrand || !report.fixList) return null;
  return (
    <Section
      id="fix-list"
      title={`Fix list for ${report.targetBrand}`}
      intro="Ranked by evidence strength: answers citing the page × 3 + engines × 2 + competitors named. Every action links to the answers behind it."
    >
      {report.fixListNote ? <p className="warn">{report.fixListNote}</p> : null}
      <ol className="fixes">
        {report.fixList.map((a) => (
          <li key={a.id} className="card">
            <p className="card-title">
              <span className="rank">{a.rank}</span> {a.title}
            </p>
            <p>
              <strong>Why:</strong> {a.why}
            </p>
            {a.pages.length ? (
              <p>
                <strong>Pages:</strong>{" "}
                {a.pages.map((p, i) => (
                  <span key={p.url}>
                    {i ? ", " : ""}
                    <Out href={p.url}>{pageName(p)}</Out>
                  </span>
                ))}
              </p>
            ) : null}
            <p>
              <strong>What to do:</strong> {a.detail}
            </p>
            <details>
              <summary>
                Evidence: {a.strength.answers} {a.strength.answers === 1 ? "answer" : "answers"} · score {a.strength.score}
              </summary>
              <EvidenceLinks evidence={a.evidence} />
            </details>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function CitedPages({ report }: { report: ScanReport }) {
  const counts = Object.entries(report.pageTypeCounts).filter(([, n]) => n > 0) as [PageType, number][];
  return (
    <Section id="cited-pages" title="Every cited page" intro={`${report.citedPages.length} pages were cited across ${report.totals.ok} answers.`}>
      <ul className="type-counts">
        {counts.map(([t, n]) => (
          <li key={t}>
            <PageType type={t} /> {n}
          </li>
        ))}
      </ul>
      <ul className="pages">
        {report.citedPages.map((p) => (
          <li key={p.url}>
            <p className="card-title">
              <Out href={p.url}>{pageName(p)}</Out> <PageType type={p.pageType} />
            </p>
            <p className="muted break">{p.url}</p>
            <p className="muted">
              Cited in {p.citedIn} {p.citedIn === 1 ? "answer" : "answers"} ({p.engines.map((e) => ENGINE_LABELS[e]).join(", ")})
              {p.owner ? ` · owned by ${p.owner}` : ""}
              {p.brandsInAnswers.length ? ` · brands in those answers: ${p.brandsInAnswers.join(", ")}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Answers({ report }: { report: ScanReport }) {
  return (
    <Section id="answers" title="Answers, question by question" intro="Brands are listed in the order each answer names them.">
      {report.questions.map((q, qi) => (
        <article key={qi} className="question" aria-labelledby={`q${qi + 1}`}>
          <h3 id={`q${qi + 1}`}>
            Q{qi + 1}. {q}
          </h3>
          {report.calls.map((c, ci) => {
            if (c.questionIndex !== qi) return null;
            const id = answerId(ci);
            return (
              <div key={id} id={id} className="answer">
                <p className="answer-head">
                  <span className="answer-id">{id}</span> {ENGINE_LABELS[c.engine]}
                  {report.runs > 1 ? ` · run ${c.run}` : ""}
                  {c.cacheHit ? " · cached" : ""}
                </p>
                {c.status !== "ok" ? (
                  <p className="warn">{c.status === "error" ? `No answer: ${c.error ?? "the call failed"}` : "Not run"}</p>
                ) : (
                  <>
                    {c.mentions.length ? (
                      <ol className="mentions" aria-label="Brands named">
                        {c.mentions.map((m, mi) => (
                          <MentionChip key={m.brand} mention={m} id={`${id}-m${mi + 1}`} target={m.brand === report.targetBrand} />
                        ))}
                      </ol>
                    ) : (
                      <p className="muted">No tracked brands named.</p>
                    )}
                    {report.targetBrand && !c.mentions.some((m) => m.brand === report.targetBrand) ? (
                      <p className="miss">{report.targetBrand} not named</p>
                    ) : null}
                    {c.citations.length ? (
                      <ol className="citations" aria-label="Cited pages">
                        {c.citations.map((cite, i) => (
                          <li key={`${cite.url}-${i}`} id={`${id}-c${i + 1}`}>
                            <Out href={cite.url}>{pageName(cite)}</Out> <PageType type={cite.pageType} />
                          </li>
                        ))}
                      </ol>
                    ) : null}
                    <details>
                      <summary>Full answer</summary>
                      <p className="answer-text">{c.text}</p>
                    </details>
                  </>
                )}
              </div>
            );
          })}
        </article>
      ))}
    </Section>
  );
}

export function ReportView({ report, sample = false }: { report: ScanReport; sample?: boolean }) {
  return (
    <main className="report">
      {sample || report.dryRun ? (
        <p className="sample-banner" role="note">
          <strong>Sample data.</strong> This report is built from synthetic answers, not real engine results. No API calls were made.
        </p>
      ) : null}
      <Header report={report} />
      <nav className="toc" aria-label="Sections">
        <a href="#share-of-voice">Share of voice</a>
        <a href="#gaps">Gaps</a>
        {report.fixList ? <a href="#fix-list">Fix list</a> : null}
        <a href="#cited-pages">Cited pages</a>
        <a href="#answers">Answers</a>
      </nav>
      <MethodBox report={report} />
      <ShareOfVoice report={report} />
      <Gaps report={report} />
      <FixList report={report} />
      <CitedPages report={report} />
      <Answers report={report} />
      <footer className="report-foot">
        <p>{METHOD_NOTE}</p>
      </footer>
    </main>
  );
}
