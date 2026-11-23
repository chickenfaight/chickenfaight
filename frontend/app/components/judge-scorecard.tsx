import { Fragment, useId, useState } from "react";
import { JUDGE_RUBRIC } from "../lib/judge-rubric";
import { SIDE_LABEL, SIDE_TEXT } from "../lib/matches";
import { JUDGE_CATEGORIES, MAX_CATEGORY_SCORE, MAX_TOTAL_SCORE, type JudgeCategory, type Scorecard, type Side } from "../lib/protocol";
import Icon from "./line-icon";

function CategoryScore({ side, score }: { side: Side; score: number }) {
  return (
    <div className={`flex flex-col gap-1 sm:items-center sm:gap-3 ${side === "pro" ? "sm:flex-row" : "items-end sm:flex-row-reverse"}`}>
      <span className={`stat shrink-0 text-xl ${SIDE_TEXT[side]}`}>
        {score}<span className="ml-0.5 text-sm text-ink-faint">/{MAX_CATEGORY_SCORE}</span>
      </span>
      <span aria-hidden="true" className="flex h-1.5 w-full rounded-full bg-line-strong">
        <span className={`block rounded-full ${side === "pro" ? "ml-auto bg-side-pro" : "bg-side-con"}`} style={{ width: `${score / MAX_CATEGORY_SCORE * 100}%` }} />
      </span>
    </div>
  );
}

export default function JudgeScorecard({ scorecard, you, heading: Heading = "h2" }: { scorecard: Scorecard; you: Side | null; heading?: "h2" | "h3" }) {
  const id = useId();
  const [openCategory, setOpenCategory] = useState<JudgeCategory | null>(null);
  const proTotal = JUDGE_CATEGORIES.reduce((sum, category) => sum + scorecard[category].pro, 0);
  const conTotal = JUDGE_CATEGORIES.reduce((sum, category) => sum + scorecard[category].con, 0);

  return (
    <section aria-labelledby={id} className="mx-auto mt-6 max-w-3xl text-left">
      <Heading id={id} className="text-base font-semibold">Judge’s scorecard</Heading>
      <table aria-labelledby={id} className="mt-2 w-full table-fixed border-collapse">
        <colgroup>
          <col className="w-[24%] sm:w-[30%]" />
          <col />
          <col className="w-[24%] sm:w-[30%]" />
        </colgroup>
        <thead className="text-xs font-semibold">
          <tr className="border-b border-line-strong">
            <th scope="col" className="pb-2 text-left"><span className={SIDE_TEXT.pro}>{SIDE_LABEL.pro}</span>{you === "pro" && <span className="text-ink-muted"> · You</span>}</th>
            <th scope="col" className="pb-2 text-center text-ink-muted">Category</th>
            <th scope="col" className="pb-2 text-right"><span className={SIDE_TEXT.con}>{SIDE_LABEL.con}</span>{you === "con" && <span className="text-ink-muted"> · You</span>}</th>
          </tr>
        </thead>
        <tbody>
          {JUDGE_CATEGORIES.map(category => {
            const { label, description } = JUDGE_RUBRIC[category];
            const expanded = openCategory === category;
            const helpId = `${id}-${category}`;
            return <Fragment key={category}>
              <tr className={expanded ? undefined : "border-b border-line"}>
                <td className="py-2"><CategoryScore side="pro" score={scorecard[category].pro} /></td>
                <th scope="row" className="px-1 py-2 text-center text-xs font-semibold sm:px-3 sm:text-sm">
                  <div className="flex items-center justify-center gap-0.5 sm:gap-1">
                    <span className="min-w-0 text-balance wrap-anywhere">{label}</span>
                    <button type="button" aria-label={`How the judge scores ${label}`} aria-expanded={expanded} aria-controls={helpId}
                      onClick={() => setOpenCategory(expanded ? null : category)}
                      onKeyDown={event => { if (event.key === "Escape" && expanded) setOpenCategory(null); }}
                      className="inline-flex size-8 shrink-0 items-center justify-center rounded-control text-ink-muted transition-colors duration-(--duration-fast) hover:bg-surface-raised hover:text-ink aria-expanded:bg-surface-raised aria-expanded:text-ink focus-ring">
                      <Icon name="help" className="size-4" />
                    </button>
                  </div>
                </th>
                <td className="py-2"><CategoryScore side="con" score={scorecard[category].con} /></td>
              </tr>
              <tr hidden={!expanded} className="border-b border-line">
                <td colSpan={3} className="pb-3">
                  <p id={helpId} className="rounded-control bg-inset px-3 py-2 text-sm leading-relaxed text-ink-muted">{description}</p>
                </td>
              </tr>
            </Fragment>;
          })}
        </tbody>
        <tfoot>
          <tr>
            <td className={`stat pt-2.5 text-2xl ${SIDE_TEXT.pro}`}>{proTotal}<span className="ml-0.5 text-base text-ink-faint">/{MAX_TOTAL_SCORE}</span></td>
            <th scope="row" className="pt-2.5 text-center text-sm font-semibold">Total</th>
            <td className={`stat pt-2.5 text-right text-2xl ${SIDE_TEXT.con}`}>{conTotal}<span className="ml-0.5 text-base text-ink-faint">/{MAX_TOTAL_SCORE}</span></td>
          </tr>
        </tfoot>
      </table>
      {proTotal === conTotal && <p className="mt-1 text-center text-sm text-ink-muted">Equal totals · Judge tiebreak</p>}
    </section>
  );
}
